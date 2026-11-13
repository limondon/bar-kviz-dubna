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
    private LinearLayout body, list, actions;
    private TextView status;
    private Button openBillButton;
    private CashBill displayedBill;
    private boolean mappingReady;
    private String selectedDay;
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
        openBillButton = null; displayedBill = null; mappingReady = false;
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (16 * getResources().getDisplayMetrics().density); root.setPadding(pad, pad, pad, pad);
        text(root, title, 21); text(root, AppVersion.label(this), 14);
        status = text(root, "", 17); status.setAccessibilityLiveRegion(android.view.View.ACCESSIBILITY_LIVE_REGION_POLITE);
        ScrollView scroll = new ScrollView(this); body = new LinearLayout(this); body.setOrientation(LinearLayout.VERTICAL);
        scroll.addView(body); root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        actions = new LinearLayout(this); actions.setOrientation(LinearLayout.VERTICAL); root.addView(actions);
        setContentView(root);
    }
    private TextView text(LinearLayout parent, String value, int size) {
        TextView view = new TextView(this); view.setText(value); view.setTextSize(size); view.setTextColor(android.graphics.Color.rgb(35, 35, 35)); view.setPadding(0, 8, 0, 8); parent.addView(view); return view;
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
        updateOpenButton();
    }
    private void updateOpenButton() {
        if (openBillButton == null || displayedBill == null) return;
        boolean fresh = displayedBill.isFresh(System.currentTimeMillis());
        openBillButton.setEnabled(!busy && mappingReady && fresh);
        openBillButton.setText(busy ? "Проверяю чек…" : fresh ? "Проверить и открыть тестовый чек" : "Сначала обновите счёт на сайте");
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
        status.setText("Счёт открывается только после проверки и вашего подтверждения. Тестовые чеки не оплачивайте.");
    }
    private void listView() {
        listing = true; page("Счета с сайта");
        day = input(body, "Дата YYYY-MM-DD", selectedDay == null ? new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(new java.util.Date()) : selectedDay, InputType.TYPE_CLASS_DATETIME);
        button(body, "Обновить список", this::refresh);
        button(body, "Обновить каталог для сайта", () -> {
            busy = true; status.setText("Передаю каталог кассы на сайт…");
            worker.execute(() -> { try { syncCatalog(true); post(() -> { busy = false; status.setText("Каталог передан. Откройте «Касса Эвотор» в настройках сайта."); }); } catch (Exception e) { post(() -> error(e)); } });
        });
        button(body, "Текущий чек кассы", this::receiptScreen);
        button(body, "Выйти из аккаунта сайта", () -> { client.logout(); loginView(); });
        list = new LinearLayout(this); list.setOrientation(LinearLayout.VERTICAL); body.addView(list);
        status.setText("Список обновляется каждые 10 секунд, пока открыт этот экран."); refresh();
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
        if (!force && CashCatalog.MONEY_FORMAT.equals(storage.getString("catalog-money-format", "")) && storage.getBoolean("catalog-exported", false) && id.equals(storage.getString("catalog-request", ""))) return;
        String label = android.os.Build.MODEL + " · " + deviceId.substring(0, 8);
        JSONObject catalog = CashCatalog.export(this, deviceId, label, id);
        client.saveCatalog(deviceId, catalog);
        if (!storage.edit().putBoolean("catalog-exported", true).putString("catalog-money-format", CashCatalog.MONEY_FORMAT).putString("catalog-request", id).commit())
            throw new IllegalStateException("Каталог отправлен, но не удалось сохранить отметку обновления.");
    }
    private void refresh() {
        if (busy) return;
        String date = day.getText().toString().trim();
        if (!date.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")) { status.setText("Введите дату YYYY-MM-DD."); return; }
        selectedDay = date;
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
                        if ("queued".equals(state) || "cleared".equals(state)) button(list, label, () -> billView(bill));
                        else if ("opened".equals(state)) button(list, label + " · проверить чек", () -> openedBillView(bill));
                        else text(list, label, 17);
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
            case "cleared": return "чек очищен — обновите состав на сайте";
            case "rejected": return "касса отклонила открытие";
            default: return "результат неизвестен — проверьте текущий чек";
        }
    }
    private void verifyClearedReceipt(String uuid) throws Exception {
        if (uuid == null || uuid.isEmpty()) throw new IllegalStateException("Нет идентификатора прежнего чека. Повтор заблокирован.");
        Receipt previous = ReceiptApi.getReceipt(this, uuid);
        int fiscalCount;
        // A failed/null provider lookup is not proof that a fiscal receipt is absent.
        try (ru.evotor.query.Cursor<ru.evotor.framework.receipt.FiscalReceipt> fiscal = ReceiptApi.getFiscalReceipts(this, uuid)) {
            if (fiscal == null) throw new IllegalStateException("Касса не подтвердила отсутствие фискального документа. Повтор заблокирован.");
            fiscalCount = fiscal.getCount();
        }
        if (previous != null && !uuid.equals(previous.getHeader().getUuid()))
            throw new IllegalStateException("Касса вернула другой чек. Повтор заблокирован.");
        ReceiptRecovery.requireCleared(previous == null ? null : previous.getHeader().getNumber(),
                previous == null ? 0 : previous.getPositions().size(), previous == null ? 0 : previous.getPayments().size(), fiscalCount);
    }
    private void openedBillView(CashBill bill) {
        listing = false; page("Стол " + bill.table + " · ранее открытый чек");
        status.setText("Проверяю прежний чек на этой кассе…"); busy = true;
        worker.execute(() -> {
            String problem = null;
            try {
                ReceiptRecovery.requireLocalMatch(journal().optJSONObject(bill.id), bill.record);
                verifyClearedReceipt(bill.record.getString("receiptUuid"));
            } catch (Exception e) {
                problem = e instanceof IllegalStateException ? e.getMessage() : "Не удалось проверить прежний чек. Повторное создание заблокировано.";
            }
            String reason = problem;
            post(() -> {
                busy = false;
                status.setText(reason == null ? "Прежний чек очищен: товаров, оплат и фискальных документов не найдено. Можно вернуть счёт в список для новой передачи с сайта." : reason);
                if (reason == null) button(body, "Вернуть очищенный счёт в список", () -> new AlertDialog.Builder(this)
                        .setTitle("Вернуть счёт стола " + bill.table + "?")
                        .setMessage("Подтвердите, что вы очистили прежний чек и не принимали по нему оплату. Новый чек сейчас не создаётся. Затем обновите состав счёта на сайте.")
                        .setNegativeButton("Отмена", null).setPositiveButton("Вернуть в список", (d, w) -> recoverCleared(bill)).show());
                if (reason != null) button(body, "Продолжить прежний чек", () -> receiptScreen(bill.record.optString("receiptUuid")));
                button(body, "К списку счетов", this::listView);
            });
        });
    }
    private synchronized void rememberCleared(String id, JSONObject expected) throws Exception {
        JSONObject local = journal().optJSONObject(id);
        ReceiptRecovery.requireLocalMatch(local, expected);
        local.put("state", "cleared").put("synced", true);
        remember(local);
    }
    private void recoverCleared(CashBill bill) {
        if (busy) return; busy = true; status.setText("Повторно проверяю чек и возвращаю счёт в список…");
        worker.execute(() -> {
            try {
                ReceiptRecovery.requireLocalMatch(journal().optJSONObject(bill.id), bill.record);
                verifyClearedReceipt(bill.record.getString("receiptUuid"));
                client.requeueCleared(bill);
                rememberCleared(bill.id, bill.record);
                post(() -> { busy = false; listView(); });
            } catch (Exception e) { post(() -> error(e)); }
        });
    }
    private void billView(CashBill bill) {
        busy = true; updateOpenButton(); status.setText("Получаю свежий счёт и соответствия с сайта…");
        worker.execute(() -> {
            try {
                CashBill fresh = new CashBill(client.get(BridgeClient.ROOT + bill.date + "/" + bill.id).object(), bill.id, bill.date);
                JSONObject settings = client.get(BridgeClient.DEVICES + deviceId + "/settings").object();
                JSONObject catalog = client.get(BridgeClient.DEVICES + deviceId + "/catalog").object();
                post(() -> { busy = false; if ("opened".equals(fresh.record.optString("state"))) openedBillView(fresh); else renderBill(fresh, settings, catalog); });
            } catch (Exception e) { post(() -> error(e)); }
        });
    }
    private void renderBill(CashBill bill, JSONObject settings, JSONObject catalog) {
        listing = false; page("Стол " + bill.table + " · " + BigDecimal.valueOf(bill.total, 2).toPlainString() + " ₽");
        displayedBill = bill;
        List<CashReceiptPlan.Item> plan = null;
        try {
            plan = CashReceiptPlan.build(bill, settings, catalog);
            mappingReady = "queued".equals(bill.record.optString("state")) && !bill.record.optBoolean("needsRefresh");
            for (CashReceiptPlan.Item item : plan) {
                text(body, item.name + " ×" + item.quantity + " · " + BigDecimal.valueOf(item.priceKopecks, 2).toPlainString()
                        + " ₽/шт. = " + BigDecimal.valueOf(item.priceKopecks * item.quantity, 2).toPlainString() + " ₽", 19);
                if (item.sourceNames.size() != 1 || !item.sourceNames.iterator().next().equalsIgnoreCase(item.name))
                    text(body, "На сайте: " + android.text.TextUtils.join(", ", item.sourceNames), 14);
                if (item.estimated) text(body, "Для части заказа цена взята из текущего меню сайта.", 14);
            }
            status.setText("Проверьте состав кассового чека. Товары, количества и сумма показаны один раз.");
        } catch (Exception e) { mappingReady = false; status.setText("Не готово: " + e.getMessage()); }
        if (bill.record.optBoolean("needsRefresh")) status.setText("Прежний чек очищен. На сайте нажмите «Обновить состав счёта», затем здесь — «Обновить счёт и настройки».");
        else if (!bill.isFresh(System.currentTimeMillis())) status.setText("Счёт старше 15 минут. На сайте обновите состав этого стола, затем нажмите «Обновить счёт и настройки» здесь.");
        else if (!"queued".equals(bill.record.optString("state"))) status.setText("Состояние передачи: " + stateLabel(bill.record.optString("state")) + ". Вернитесь к списку счетов.");
        final int rowCount = plan == null ? 0 : plan.size();
        openBillButton = button(actions, "Проверить и открыть тестовый чек", () -> {
            try { bill.requireFresh(System.currentTimeMillis()); }
            catch (Exception e) { error(e); return; }
            new AlertDialog.Builder(this).setTitle("Открыть счёт стола " + bill.table + "?")
                    .setMessage("Позиций в чеке: " + rowCount + ". Сумма: " + BigDecimal.valueOf(bill.total, 2).toPlainString()
                            + " ₽. Проверьте состав выше. Это тест: чек не оплачивайте. Стол на сайте не будет отмечен оплаченным.")
                    .setNegativeButton("Отмена", null).setPositiveButton("Открыть чек", (d, w) -> prepare(bill, settings)).show();
        });
        button(actions, "Обновить счёт и настройки", () -> billView(bill));
        button(actions, "К списку счетов", this::listView);
        updateOpenButton();
    }
    private void validateSources(CashBill bill) throws Exception {
        JSONObject meta = client.get("tables/" + bill.date + "_" + bill.table).object();
        if (!"open".equals(meta.optString("status")) || !bill.sid.equals(meta.optString("sid", "default")))
            throw new IllegalStateException("Посещение стола закрыто или изменилось. Открытие заблокировано.");
        bill.verifyOrders(client.dayOrders(bill.date));
    }
    private void prepare(CashBill bill, JSONObject shownSettings) {
        if (busy) return; busy = true; updateOpenButton(); status.setText("Проверяю состав, карточки и текущий чек…");
        worker.execute(() -> {
            try {
                if (bill.record.optBoolean("needsRefresh")) throw new IllegalStateException("После очистки чека обновите состав счёта на сайте.");
                bill.requireFresh(System.currentTimeMillis());
                JSONObject previous = journal().optJSONObject(bill.id);
                if (previous != null) {
                    if (!ReceiptRecovery.wasCleared(previous, bill.record))
                        throw new IllegalStateException("Этот счёт уже открывался или результат неизвестен. Проверьте текущий чек. Повтор заблокирован.");
                    // Recheck even after a restart or an acknowledged recovery. A missing ack cannot unlock an unknown attempt.
                    if (!("opened".equals(previous.optString("state")) || "cleared".equals(previous.optString("state"))))
                        throw new IllegalStateException("Нет подтверждённой очистки прежнего чека. Повтор заблокирован.");
                    verifyClearedReceipt(previous.getString("receiptUuid"));
                    rememberCleared(bill.id, previous);
                }
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
                JSONObject freshItems = new JSONObject();
                for (CashBill.Line line : bill.lines)
                    for (CashMappings.Part part : CashMappings.resolve(line.name, settings))
                        if (!freshItems.has(part.uuid)) freshItems.put(part.uuid, CashCatalog.describe(this, part.uuid));
                List<CashReceiptPlan.Item> plan = CashReceiptPlan.build(bill, settings, new JSONObject().put("items", freshItems));
                for (CashReceiptPlan.Item item : plan) {
                    ProductItem.Product product = CashCatalog.checked(this, item.uuid);
                    if (product.getPrice().compareTo(BigDecimal.valueOf(item.priceKopecks, 2)) != 0)
                        throw new IllegalStateException("Цена карточки изменилась во время проверки.");
                    positions.add(new PositionAdd(Position.Builder.newInstance(product, BigDecimal.valueOf(item.quantity)).build()));
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
                        boolean accepted = finishAttempt(attempt, uuid == null || uuid.isEmpty() ? "unknown" : "opened", uuid,
                                uuid == null || uuid.isEmpty() ? "Касса не вернула идентификатор чека. Результат неизвестен, повтор заблокирован." : "Касса ответила на открытие. Проверьте текущий чек. Тестовый чек не оплачивайте.");
                        if (accepted && uuid != null && !uuid.isEmpty()) post(() -> receiptScreen(uuid));
                    } else finishAttempt(attempt, "rejected", "", "Касса отклонила открытие. Проверьте текущий чек; повтор этого счёта заблокирован.");
                } catch (Exception e) { finishAttempt(attempt, "unknown", "", "Не удалось разобрать ответ кассы. Проверьте текущий чек; повтор заблокирован."); }
            });
        } catch (Exception e) { finishAttempt(attempt, "unknown", "", "Результат неизвестен. Проверьте текущий чек; повтор заблокирован."); }
    }
    private boolean finishAttempt(JSONObject attempt, String state, String receiptUuid, String message) {
        try {
            synchronized (this) {
                JSONObject saved = journal().optJSONObject(attempt.getString("id"));
                if (!ReceiptRecovery.acceptsResult(saved, attempt)) return false;
                attempt = new JSONObject(attempt.toString()).put("state", state).put("synced", false).put("receiptUuid", receiptUuid == null ? "" : receiptUuid);
                remember(attempt); activeNonce = null;
            }
            JSONObject ack = attempt;
            post(() -> { mappingReady = false; updateOpenButton(); });
            if (!worker.isShutdown()) worker.execute(() -> {
                try { client.report(ack); markSynced(ack); post(() -> { busy = false; status.setText(message); }); }
                catch (Exception e) { post(() -> { busy = false; status.setText(message + " Сайт пока не получил подтверждение. Нажмите обновление списка для синхронизации."); }); }
            });
            return true;
        } catch (Exception e) { post(() -> { busy = false; status.setText("Не удалось сохранить результат. Проверьте текущий чек. Повтор заблокирован сервером."); }); return false; }
    }
    private void receiptScreen() { receiptScreen(null); }
    private void receiptScreen(String expectedUuid) {
        busy = true; updateOpenButton(); status.setText("Проверяю заполненный чек перед переходом…");
        worker.execute(() -> {
            try {
                Receipt current = ReceiptApi.getReceipt(this, Receipt.Type.SELL);
                ReceiptNavigation.requireEditable(current == null ? null : current.getHeader().getUuid(),
                        current == null ? 0 : current.getPositions().size(), current == null ? 0 : current.getPayments().size(), expectedUuid);
                post(() -> {
                    try { busy = false; updateOpenButton(); status.setText("Открываю заполненный чек кассы. Оплата выполняется отдельно."); startActivity(NavigationApi.createIntentForSellReceiptEdit(false)); }
                    catch (Exception e) { error(new IllegalStateException("Не удалось открыть заполненный чек. Откройте «Продажа» на кассе вручную.")); }
                });
            } catch (Exception e) { post(() -> error(e)); }
        });
    }
    @Override protected void onStart() { super.onStart(); started = true; ui.postDelayed(poll, 10000); }
    @Override protected void onStop() { started = false; ui.removeCallbacks(poll); super.onStop(); }
    @Override protected void onDestroy() { worker.shutdown(); client.logout(); super.onDestroy(); }
}
