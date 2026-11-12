package ru.lounge1708.evotorbridge;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.math.BigDecimal;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;
import ru.evotor.framework.core.IntegrationManagerFuture;
import ru.evotor.framework.core.action.command.open_receipt_command.OpenReceiptCommandResult;
import ru.evotor.framework.core.action.command.open_receipt_command.OpenSellReceiptCommand;
import ru.evotor.framework.core.action.event.receipt.changes.position.PositionAdd;
import ru.evotor.framework.core.action.event.receipt.changes.receipt.SetExtra;
import ru.evotor.framework.inventory.ProductItem;
import ru.evotor.framework.navigation.NavigationApi;
import ru.evotor.framework.receipt.Position;
import ru.evotor.framework.receipt.Receipt;
import ru.evotor.framework.receipt.ReceiptApi;

/** Staff-only test bridge. Only opens receipt EDIT; never pays, prints, closes a table or edits an order. */
public final class TransferActivity extends Activity {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final BridgeClient client = new BridgeClient();
    private SharedPreferences storage;
    private LinearLayout body, list;
    private TextView status;
    private EditText day;
    private boolean busy, listing, started;
    private volatile String activeNonce;
    private String deviceId;
    private final Runnable poll = new Runnable() { public void run() {
        if (started && listing && !busy) refresh();
        if (started) ui.postDelayed(this, 10000);
    }};

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        storage = getSharedPreferences("cash-transfer-v1", MODE_PRIVATE);
        deviceId = storage.getString("device-id", null);
        if (deviceId == null) { deviceId = UUID.randomUUID().toString(); if (!storage.edit().putString("device-id", deviceId).commit()) deviceId = null; }
        loginView();
    }
    private void page(String title) {
        ScrollView scroll = new ScrollView(this); body = new LinearLayout(this); body.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (20 * getResources().getDisplayMetrics().density); body.setPadding(pad, pad, pad, pad);
        scroll.addView(body); setContentView(scroll); text(body, title, 23);
    }
    private TextView text(LinearLayout parent, String value, int size) {
        TextView view = new TextView(this); view.setText(value); view.setTextSize(size); view.setPadding(0, 12, 0, 12); parent.addView(view); return view;
    }
    private Button button(LinearLayout parent, String value, Runnable action) {
        Button view = new Button(this); view.setAllCaps(false); view.setText(value); view.setMinHeight((int) (52 * getResources().getDisplayMetrics().density));
        view.setOnClickListener(v -> { if (!busy) action.run(); }); parent.addView(view); return view;
    }
    private EditText input(LinearLayout parent, String hint, String value, int type) {
        EditText view = new EditText(this); view.setHint(hint); view.setInputType(type); view.setSingleLine(true); view.setText(value); parent.addView(view); return view;
    }
    private void post(Runnable action) { ui.post(() -> { if (!isDestroyed() && !isFinishing()) action.run(); }); }
    private void error(Exception error) {
        busy = false;
        status.setText((error instanceof IllegalStateException || error instanceof IllegalArgumentException) && error.getMessage() != null
                ? error.getMessage() : "Не удалось выполнить действие. Проверьте соединение и вход сотрудника.");
    }
    private void loginView() {
        listing = false; page("1708 · Счета с сайта · тест");
        text(body, "Войдите с существующей учётной записью сотрудника сайта. Пароль и сеанс входа на устройстве не сохраняются.", 16);
        EditText email = input(body, "Email сотрудника", "manager@1708.local", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        EditText password = input(body, "Пароль сайта", "", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        password.setSaveEnabled(false);
        button(body, "Войти", () -> {
            String name = email.getText().toString(), secret = password.getText().toString(); password.setText("");
            busy = true; status.setText("Выполняю вход…");
            worker.execute(() -> { try { client.login(name, secret); post(() -> { busy = false; listView(); }); } catch (Exception e) { post(() -> error(e)); } });
        });
        status = text(body, "Счёт открывается только после выбора товаров и вашего подтверждения. Тестовые чеки не оплачивайте.", 16);
    }
    private void listView() {
        listing = true; page("Счета с сайта");
        day = input(body, "Дата YYYY-MM-DD", new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(new java.util.Date()), InputType.TYPE_CLASS_DATETIME);
        button(body, "Обновить список", this::refresh);
        button(body, "Обновить каталог для сайта", () -> {
            busy = true; status.setText("Передаю каталог кассы на сайт…");
            worker.execute(() -> { try { syncCatalog(true); post(() -> { busy = false; status.setText("Каталог передан. Откройте «Касса Эвотор» в настройках сайта."); }); } catch (Exception e) { post(() -> error(e)); } });
        });
        button(body, "Текущий чек кассы", this::receiptScreen);
        button(body, "Выйти из аккаунта сайта", () -> { client.logout(); loginView(); });
        list = new LinearLayout(this); list.setOrientation(LinearLayout.VERTICAL); body.addView(list);
        status = text(body, "Список обновляется каждые 10 секунд, пока открыт этот экран.", 16); refresh();
    }
    private synchronized JSONObject journal() throws Exception { return new JSONObject(storage.getString("journal", "{}")); }
    private synchronized void remember(JSONObject entry) throws Exception {
        JSONObject ledger = journal(); ledger.put(entry.getString("id"), entry);
        if (!storage.edit().putString("journal", ledger.toString()).commit()) throw new IllegalStateException("Не удалось сохранить защиту от повтора. Открытие заблокировано.");
    }
    private synchronized void markSynced(JSONObject ack) throws Exception {
        JSONObject current = journal().optJSONObject(ack.getString("id"));
        if (current != null && current.optString("state").equals(ack.optString("state"))
                && current.optString("nonce").equals(ack.optString("nonce"))) {
            current.put("synced", true); remember(current);
        }
    }
    private void reconcile() throws Exception {
        JSONObject ledger = journal(); Iterator<String> keys = ledger.keys();
        while (keys.hasNext()) {
            JSONObject entry = ledger.getJSONObject(keys.next());
            // Restart cannot distinguish an unacknowledged open from a successful open. Never resend the SDK command.
            if ("opening".equals(entry.optString("state")) && !entry.optString("nonce").equals(activeNonce)) {
                entry.put("state", "unknown"); remember(entry);
            }
            if (!"opening".equals(entry.optString("state")) && !entry.optBoolean("synced", false)) { client.report(entry); markSynced(entry); }
        }
    }
    private void syncCatalog(boolean force) throws Exception {
        if (deviceId == null) throw new IllegalStateException("Не удалось сохранить идентификатор кассы.");
        JSONObject request = client.get(BridgeClient.DEVICES + deviceId + "/refreshRequest").object();
        String id = request.optString("id");
        if (!force && storage.getBoolean("catalog-exported", false) && id.equals(storage.getString("catalog-request", ""))) return;
        String label = android.os.Build.MODEL + " · " + deviceId.substring(0, 8);
        JSONObject catalog = CashCatalog.export(this, deviceId, label, id);
        client.saveCatalog(deviceId, catalog);
        if (!storage.edit().putBoolean("catalog-exported", true).putString("catalog-request", id).commit())
            throw new IllegalStateException("Каталог отправлен, но не удалось сохранить отметку обновления.");
    }
    private void refresh() {
        if (busy) return;
        String date = day.getText().toString().trim();
        if (!date.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")) { status.setText("Введите дату YYYY-MM-DD."); return; }
        busy = true; status.setText("Проверяю передачи и подтверждения…");
        worker.execute(() -> {
            try {
                syncCatalog(false); reconcile(); JSONObject records = client.get(BridgeClient.ROOT + date).object();
                List<CashBill> bills = new ArrayList<>(); Iterator<String> ids = records.keys();
                while (ids.hasNext()) { String id = ids.next(); bills.add(new CashBill(records.getJSONObject(id), id, date)); }
                java.util.Collections.sort(bills, (a, b) -> Long.compare(a.record.optLong("createdAt"), b.record.optLong("createdAt")));
                post(() -> {
                    busy = false; list.removeAllViews();
                    for (CashBill bill : bills) {
                        String state = bill.record.optString("state");
                        String label = "Стол " + bill.table + " · " + BigDecimal.valueOf(bill.total, 2).toPlainString() + " ₽ · " + stateLabel(state);
                        if ("queued".equals(state)) button(list, label, () -> billView(bill)); else text(list, label, 17);
                    }
                    status.setText(bills.isEmpty() ? "Нет переданных счетов за этот день. На сайте откройте стол и нажмите «Передать на кассу»." : "Выберите счёт. Передача не означает оплату.");
                });
            } catch (Exception e) { post(() -> error(e)); }
        });
    }
    private static String stateLabel(String state) {
        switch (state) {
            case "queued": return "ожидает открытия";
            case "opening": return "открывается — повтор заблокирован";
            case "opened": return "чек открыт, оплата отдельно";
            case "rejected": return "касса отклонила открытие";
            default: return "результат неизвестен — проверьте текущий чек";
        }
    }
    private void billView(CashBill bill) {
        busy = true; status.setText("Получаю соответствия с сайта…");
        worker.execute(() -> {
            try {
                JSONObject settings = client.get(BridgeClient.DEVICES + deviceId + "/settings").object();
                JSONObject catalog = client.get(BridgeClient.DEVICES + deviceId + "/catalog").object();
                post(() -> { busy = false; renderBill(bill, settings, catalog); });
            } catch (Exception e) { post(() -> error(e)); }
        });
    }
    private void renderBill(CashBill bill, JSONObject settings, JSONObject catalog) {
        listing = false; page("Стол " + bill.table + " · " + BigDecimal.valueOf(bill.total, 2).toPlainString() + " ₽");
        text(body, "Соответствия получены из раздела «Касса Эвотор» на сайте. Проверьте состав ниже. После попытки открытия повтор этого посещения заблокирован, включая дозаказы.", 16);
        boolean valid = true;
        for (CashBill.Line line : bill.lines) {
            text(body, line.name + " ×" + line.quantity + " · " + line.price().toPlainString() + " ₽/шт." + (line.estimated ? "\nЦена взята из текущего меню сайта." : ""), 18);
            try {
                List<CashMappings.Part> parts = CashMappings.resolve(line.name, settings);
                if (CashMappings.total(parts, catalog) != line.kopecks) throw new IllegalStateException("Цена кассы не совпадает с ценой этой позиции. Исправьте соответствие на сайте.");
                for (CashMappings.Part part : parts) text(body, "    " + catalog.getJSONObject("items").getJSONObject(part.uuid).getString("name") + " ×" + Math.multiplyExact(part.units, line.quantity), 16);
            } catch (Exception e) { valid = false; text(body, "Не готово: " + e.getMessage(), 16); }
        }
        Button openButton = button(body, "Проверить и открыть тестовый чек", () -> new AlertDialog.Builder(this).setTitle("Открыть счёт стола " + bill.table + "?")
                .setMessage("Строк: " + bill.lines.size() + ". Сумма: " + BigDecimal.valueOf(bill.total, 2).toPlainString()
                        + " ₽. Проверьте состав выше. Это тест: чек не оплачивайте. Стол на сайте не будет отмечен оплаченным.")
                .setNegativeButton("Отмена", null).setPositiveButton("Открыть чек", (d, w) -> prepare(bill, settings)).show());
        openButton.setEnabled(valid);
        button(body, "Получить изменённые настройки", () -> billView(bill));
        button(body, "К списку счетов", this::listView);
        status = text(body, "Настраивайте товары и добавки на сайте. После изменения нажмите «Получить изменённые настройки».", 16);
    }
    private void validateSources(CashBill bill) throws Exception {
        JSONObject meta = client.get("tables/" + bill.date + "_" + bill.table).object();
        if (!"open".equals(meta.optString("status")) || !bill.sid.equals(meta.optString("sid", "default")))
            throw new IllegalStateException("Посещение стола закрыто или изменилось. Открытие заблокировано.");
        bill.verifyOrders(client.dayOrders(bill.date));
    }
    private void prepare(CashBill bill, JSONObject shownSettings) {
        if (busy) return; busy = true; status.setText("Проверяю состав, карточки и текущий чек…");
        worker.execute(() -> {
            try {
                bill.requireFresh(System.currentTimeMillis());
                if (journal().has(bill.id)) throw new IllegalStateException("Этот счёт уже открывался или результат неизвестен. Проверьте текущий чек. Повтор заблокирован.");
                JSONObject ledger = journal(); Iterator<String> ids = ledger.keys();
                while (ids.hasNext()) {
                    String state = ledger.getJSONObject(ids.next()).optString("state");
                    if ("unknown".equals(state) || "opening".equals(state)) throw new IllegalStateException("Есть передача с неизвестным результатом. Сначала проверьте её на кассе; новые открытия заблокированы.");
                }
                if (!DraftPolicy.supportsPosVersion(getPackageManager().getPackageInfo("ru.atol.tabletpos", 0).versionName)) throw new IllegalStateException("Нужен Evotor POS 8.11 или новее.");
                Receipt receipt = ReceiptApi.getReceipt(this, Receipt.Type.SELL);
                if (receipt != null && (!receipt.getPositions().isEmpty() || !receipt.getPayments().isEmpty())) throw new IllegalStateException("На кассе уже есть чек. Завершите работу с ним вручную.");
                if (getPackageManager().queryIntentServices(new Intent(OpenSellReceiptCommand.NAME), 0).isEmpty()) throw new IllegalStateException("Открытие чеков недоступно. Проверьте установку через Маркет.");
                List<PositionAdd> positions = new ArrayList<>();
                JSONObject settings = client.get(BridgeClient.DEVICES + deviceId + "/settings").object();
                if (settings.optLong("revision", -1) != shownSettings.optLong("revision", -2)) throw new IllegalStateException("Соответствия изменились после просмотра. Получите настройки заново и проверьте состав.");
                for (CashBill.Line line : bill.lines) {
                    List<CashMappings.Part> parts = CashMappings.resolve(line.name, settings);
                    JSONObject freshCatalog = new JSONObject(), freshItems = new JSONObject();
                    for (CashMappings.Part part : parts) freshItems.put(part.uuid, CashCatalog.describe(this, part.uuid));
                    freshCatalog.put("items", freshItems);
                    if (CashMappings.total(parts, freshCatalog) != line.kopecks) throw new IllegalStateException("Сумма карточек не совпадает с позицией «" + line.name + "».");
                    for (CashMappings.Part part : parts) {
                        int count = Math.multiplyExact(line.quantity, part.units);
                        if (count > 100 || positions.size() >= 200) throw new IllegalStateException("Слишком много компонентов или количество больше 100.");
                        ProductItem.Product product = CashCatalog.checked(this, part.uuid);
                        if (product.getPrice().compareTo(BigDecimal.valueOf(freshItems.getJSONObject(part.uuid).getLong("priceKopecks"), 2)) != 0)
                            throw new IllegalStateException("Цена карточки изменилась во время проверки.");
                        positions.add(new PositionAdd(Position.Builder.newInstance(product, BigDecimal.valueOf(count)).build()));
                    }
                }
                validateSources(bill);
                String nonce = UUID.randomUUID().toString(); client.claim(bill, nonce);
                JSONObject attempt = new JSONObject().put("date", bill.date).put("id", bill.id).put("digest", bill.digest).put("nonce", nonce).put("state", "opening");
                remember(attempt); activeNonce = nonce;
                post(() -> send(bill, positions, attempt));
            } catch (Exception e) { post(() -> error(e)); }
        });
    }
    private void send(CashBill bill, List<PositionAdd> positions, JSONObject attempt) {
        status.setText("Открываю чек. Повторять нажатие не нужно.");
        ui.postDelayed(() -> {
            if (attempt.optString("nonce").equals(activeNonce)) {
                activeNonce = null; finishAttempt(attempt, "unknown", "", "Нет подтверждения за 15 секунд. Проверьте текущий чек. Повтор заблокирован.");
            }
        }, 15000);
        try {
            JSONObject extra = new JSONObject().put("transferId", bill.id).put("digest", bill.digest);
            new OpenSellReceiptCommand(positions, new SetExtra(extra), null).process(this, future -> {
                try {
                    IntegrationManagerFuture.Result result = future.getResult();
                    if (result.getType() == IntegrationManagerFuture.Result.Type.OK) {
                        OpenReceiptCommandResult opened = OpenReceiptCommandResult.create(result.getData());
                        String uuid = opened == null ? "" : opened.getReceiptUuid();
                        finishAttempt(attempt, uuid == null || uuid.isEmpty() ? "unknown" : "opened", uuid,
                                "Касса ответила на открытие. Проверьте текущий чек. Тестовый чек не оплачивайте.");
                        post(this::receiptScreen);
                    } else finishAttempt(attempt, "rejected", "", "Касса отклонила открытие. Проверьте текущий чек; повтор этого счёта заблокирован.");
                } catch (Exception e) { finishAttempt(attempt, "unknown", "", "Не удалось разобрать ответ кассы. Проверьте текущий чек; повтор заблокирован."); }
            });
        } catch (Exception e) { finishAttempt(attempt, "unknown", "", "Результат неизвестен. Проверьте текущий чек; повтор заблокирован."); }
    }
    private void finishAttempt(JSONObject attempt, String state, String receiptUuid, String message) {
        try {
            synchronized (this) {
                JSONObject saved = journal().optJSONObject(attempt.getString("id"));
                if (saved != null && "opened".equals(saved.optString("state"))) return; // A late timeout never downgrades success.
                attempt = new JSONObject(attempt.toString()).put("state", state).put("synced", false).put("receiptUuid", receiptUuid == null ? "" : receiptUuid);
                remember(attempt); activeNonce = null;
            }
            JSONObject ack = attempt;
            if (!worker.isShutdown()) worker.execute(() -> {
                try { client.report(ack); markSynced(ack); post(() -> { busy = false; status.setText(message); }); }
                catch (Exception e) { post(() -> { busy = false; status.setText(message + " Сайт пока не получил подтверждение. Нажмите обновление списка для синхронизации."); }); }
            });
        } catch (Exception e) { post(() -> { busy = false; status.setText("Не удалось сохранить результат. Проверьте текущий чек. Повтор заблокирован сервером."); }); }
    }
    private void receiptScreen() {
        try { startActivity(NavigationApi.createIntentForSellReceiptEdit(false)); }
        catch (Exception e) { status.setText("Не удалось открыть экран чека. Откройте «Продажа» на кассе вручную."); }
    }
    @Override protected void onStart() { super.onStart(); started = true; ui.postDelayed(poll, 10000); }
    @Override protected void onStop() { started = false; ui.removeCallbacks(poll); super.onStop(); }
    @Override protected void onDestroy() { worker.shutdown(); client.logout(); super.onDestroy(); }
}
