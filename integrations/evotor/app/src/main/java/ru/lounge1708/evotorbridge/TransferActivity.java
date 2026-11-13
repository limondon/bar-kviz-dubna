package ru.lounge1708.evotorbridge;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DatePickerDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.text.Editable;
import android.text.TextWatcher;
import android.graphics.Typeface;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.math.BigDecimal;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.TimeZone;
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
    private DeskUi design;
    private ScrollView scroll;
    private TextView status;
    private TextView syncStatus, listSummary;
    private Button refreshButton;
    private final List<CashBill> cachedBills = new ArrayList<>();
    private final List<Button> filterButtons = new ArrayList<>();
    private String searchQuery = "", listSignature = "";
    private int listFilter = CashDesk.ALL, pageId, skippedRecords, listScrollY;
    private long lastSync;
    private boolean refreshing;
    private Button openBillButton;
    private CashBill displayedBill;
    private CashBill receiptReturnBill;
    private boolean mappingReady;
    private String selectedDay;
    private boolean busy, listing, started, signedIn;
    private volatile String activeNonce;
    private String deviceId;
    private final Runnable poll = new Runnable() { public void run() {
        if (started && listing && !busy) refresh(true);
        if (started) ui.postDelayed(this, 10000);
    }};

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        design = new DeskUi(this);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN | WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        storage = getSharedPreferences("cash-transfer-v1", MODE_PRIVATE);
        deviceId = storage.getString("device-id", null);
        if (deviceId == null) { deviceId = UUID.randomUUID().toString(); if (!storage.edit().putString("device-id", deviceId).commit()) deviceId = null; }
        loginView();
    }
    private void page(String title) {
        pageId++;
        openBillButton = null; displayedBill = null; mappingReady = false;
        LinearLayout root = design.column(); root.setBackgroundColor(DeskUi.PAPER); root.setFocusableInTouchMode(true);
        int pad = design.dp(14); root.setPadding(pad, pad, pad, pad);
        design.heading(root, title, 23); TextView version = text(root, AppVersion.label(this), 12); version.setTextColor(DeskUi.MUTED);
        status = text(root, "", 15); status.setAccessibilityLiveRegion(android.view.View.ACCESSIBILITY_LIVE_REGION_POLITE);
        status.setTextColor(DeskUi.MUTED);
        scroll = new ScrollView(this); scroll.setFillViewport(true); body = design.column();
        scroll.addView(body); root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        actions = design.column(); root.addView(actions);
        setContentView(root);
    }
    private TextView text(LinearLayout parent, String value, int size) {
        return design.text(parent, value, size);
    }
    private Button button(LinearLayout parent, String value, Runnable action) {
        return design.button(parent, value, () -> { if (!busy) { if (listing) listScrollY = scroll.getScrollY(); status.setTextColor(DeskUi.MUTED); action.run(); } });
    }
    private Button primary(LinearLayout parent, String label, Runnable action) { Button result = button(parent, label, action); design.primary(result); return result; }
    private void secondaryActions(String first, Runnable firstAction, String second, Runnable secondAction) {
        LinearLayout row = design.row(actions); design.weighted(button(row, first, firstAction)); design.weighted(button(row, second, secondAction));
    }
    private EditText input(LinearLayout parent, String hint, String value, int type) {
        EditText view = new EditText(this); view.setHint(hint); view.setInputType(type); view.setSingleLine(true); view.setText(value); view.setTextSize(17);
        view.setTextColor(DeskUi.INK); view.setHintTextColor(DeskUi.MUTED); view.setPadding(design.dp(12), design.dp(10), design.dp(12), design.dp(10));
        view.setBackground(design.background(android.graphics.Color.WHITE, DeskUi.LINE));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2); params.topMargin = design.dp(8); parent.addView(view, params); return view;
    }
    private void post(Runnable action) { ui.post(() -> { if (!isDestroyed() && !isFinishing()) action.run(); }); }
    private void error(Exception error) {
        busy = false;
        status.setText((error instanceof IllegalStateException || error instanceof IllegalArgumentException) && error.getMessage() != null
                ? error.getMessage() : "Не удалось выполнить действие. Проверьте соединение и вход сотрудника.");
        status.setTextColor(DeskUi.RED);
        if (listing && refreshButton != null) refreshButton.setEnabled(true);
        updateOpenButton();
    }
    private void updateOpenButton() {
        if (openBillButton == null || displayedBill == null) return;
        boolean fresh = displayedBill.isFresh(System.currentTimeMillis());
        openBillButton.setEnabled(!busy && mappingReady && fresh);
        openBillButton.setAlpha(openBillButton.isEnabled() ? 1f : .5f);
        openBillButton.setText(busy ? "Проверяю чек…" : fresh ? "Проверить и открыть чек" : "Сначала проверьте свежесть");
    }
    private void loginView() {
        listing = false; page("1708 · Счета с сайта · тест");
        text(body, "Войдите с существующей учётной записью сотрудника сайта. Пароль и сеанс входа на устройстве не сохраняются.", 16);
        EditText email = input(body, "Email сотрудника", "manager@1708.local", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        EditText password = input(body, "Пароль сайта", "", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        password.setSaveEnabled(false);
        primary(actions, "Войти", () -> {
            String name = email.getText().toString(), secret = password.getText().toString(); password.setText("");
            busy = true; status.setText("Выполняю вход…");
            worker.execute(() -> { try { client.login(name, secret); post(() -> { busy = false; signedIn = true; listView(); }); } catch (Exception e) { post(() -> error(e)); } });
        });
        status.setText("Счёт открывается только после проверки и вашего подтверждения. Тестовые чеки не оплачивайте.");
    }
    private void listView() {
        listing = true; page("Счета с сайта");
        status.setText("Выберите стол. Ранее открытый счёт остаётся в списке.");
        // Controls stay above the scrolling bills, so a long list never hides navigation.
        LinearLayout controls = design.column(); LinearLayout root = (LinearLayout) scroll.getParent(); root.addView(controls, root.indexOfChild(scroll));
        LinearLayout top = design.row(controls);
        design.weighted(button(top, selectedDay == null ? "Сегодня и вчера ▾" : CashDesk.dayLabel(selectedDay, System.currentTimeMillis()) + " ▾", this::chooseDay));
        design.weighted(button(top, "Настройки", this::settingsView));
        EditText search = input(controls, "Стол или название товара", searchQuery, InputType.TYPE_CLASS_TEXT);
        search.setImeOptions(android.view.inputmethod.EditorInfo.IME_ACTION_DONE);
        search.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int start, int count, int after) { }
            public void onTextChanged(CharSequence s, int start, int before, int count) { searchQuery = s.toString(); listScrollY = 0; renderList(true); }
            public void afterTextChanged(Editable s) { }
        });
        filterButtons.clear(); LinearLayout filters = design.row(controls);
        for (int filter = 0; filter < 4; filter++) {
            final int selected = filter;
            Button tab = button(filters, "", () -> { listFilter = selected; listScrollY = 0; renderList(true); }); tab.setTextSize(12); design.weighted(tab); filterButtons.add(tab);
        }
        listSummary = text(controls, "", 13); syncStatus = text(controls, "", 12); syncStatus.setTextColor(DeskUi.MUTED);
        list = design.column(); body.addView(list); listSignature = "";
        LinearLayout footer = design.row(actions);
        refreshButton = button(footer, "Обновить", this::refresh); design.weighted(refreshButton);
        design.weighted(button(footer, "Чек на кассе", this::receiptScreen));
        renderList(true); scroll.post(() -> scroll.scrollTo(0, listScrollY)); refresh();
    }
    private void chooseDay() {
        new AlertDialog.Builder(this).setTitle("За какие дни показать счета?")
                .setItems(new String[]{"Сегодня и вчера", "Только сегодня", "Только вчера", "Выбрать дату"}, (dialog, which) -> {
                    if (which == 3) {
                        Calendar date = Calendar.getInstance(TimeZone.getTimeZone("Europe/Moscow"));
                        if (selectedDay != null) date.setTime(CashDesk.parseDate(selectedDay));
                        new DatePickerDialog(this, (picker, year, month, dayOfMonth) -> {
                            selectedDay = String.format(Locale.ROOT, "%04d-%02d-%02d", year, month + 1, dayOfMonth); changeDay();
                        }, date.get(Calendar.YEAR), date.get(Calendar.MONTH), date.get(Calendar.DAY_OF_MONTH)).show();
                    } else { selectedDay = which == 0 ? null : CashDesk.date(System.currentTimeMillis(), which == 1 ? 0 : -1); changeDay(); }
                }).setNegativeButton("Отмена", null).show();
    }
    private void changeDay() { cachedBills.clear(); lastSync = 0; skippedRecords = 0; listScrollY = 0; listView(); }
    private void settingsView() {
        listing = false; page("Настройки кассы");
        design.heading(body, "Каталог и товары", 19);
        text(body, "Соответствия товаров и добавок редактируются на сайте: «Ещё → Касса Эвотор».", 16);
        button(body, "Передать каталог на сайт", () -> {
            busy = true; status.setText("Передаю каталог кассы на сайт…");
            worker.execute(() -> { try { syncCatalog(true); post(() -> { busy = false; status.setTextColor(DeskUi.GREEN); status.setText("Каталог передан. Теперь настройте товары на сайте."); }); } catch (Exception e) { post(() -> error(e)); } });
        });
        design.heading(body, "Как отложить счёт", 19);
        text(body, "1. Выберите ранее открытый стол и нажмите «Отложить счёт».\n2. В «Продажа» очистите неоплаченный чек.\n3. Рассчитайте другой стол.\n4. Вернитесь к первому столу и нажмите «Продолжить счёт».", 16);
        text(body, "Приложение не принимает оплату и не отмечает стол оплаченным на сайте. Тестовые чеки не оплачивайте.", 15);
        button(body, "Проверка отдельного товара", () -> startActivity(new Intent(this, MainActivity.class).putExtra("diagnostic", true)));
        button(body, "Выйти из аккаунта", () -> new AlertDialog.Builder(this).setTitle("Выйти из аккаунта сайта?")
                .setMessage("Сохранённые счета и защита от повторного открытия останутся на этой кассе.")
                .setNegativeButton("Отмена", null).setPositiveButton("Выйти", (d, w) -> { signedIn = false; client.logout(); cachedBills.clear(); lastSync = 0; loginView(); }).show());
        primary(actions, "К счетам", this::listView);
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
    private void refresh() { refresh(false); }
    private void refresh(boolean automatic) {
        if (busy || refreshing || !listing) return;
        final List<String> dates = CashDesk.dates(selectedDay, System.currentTimeMillis());
        final int screen = pageId;
        refreshing = true;
        if (!automatic) { busy = true; refreshButton.setEnabled(false); status.setText("Обновляю счета…"); }
        worker.execute(() -> {
            try {
                syncCatalog(false); reconcile();
                List<CashBill> bills = new ArrayList<>(); int skipped = 0;
                for (String date : dates) {
                    JSONObject records = client.get(BridgeClient.ROOT + date).object(); Iterator<String> ids = records.keys();
                    while (ids.hasNext()) {
                        String id = ids.next();
                        try { bills.add(new CashBill(records.getJSONObject(id), id, date)); }
                        catch (Exception invalid) { skipped++; }
                    }
                }
                java.util.Collections.sort(bills, CashDesk::compare); final int invalidCount = skipped;
                post(() -> {
                    refreshing = false; if (!automatic) busy = false;
                    if (screen != pageId || !listing) { if (listing) refresh(true); return; }
                    cachedBills.clear(); cachedBills.addAll(bills); skippedRecords = invalidCount; lastSync = System.currentTimeMillis();
                    refreshButton.setEnabled(true); renderList(false); status.setTextColor(DeskUi.MUTED);
                    status.setText(skippedRecords > 0 ? "Не удалось прочитать счетов: " + skippedRecords + ". Остальные доступны; повреждённые не открываются."
                            : "Выберите стол. Ранее открытый счёт остаётся в списке.");
                });
            } catch (Exception e) { post(() -> {
                refreshing = false; if (!automatic) busy = false;
                if (screen != pageId || !listing) { if (listing) refresh(true); return; }
                error(e); syncStatus.setText(lastSync == 0 ? "Свежий список не получен. Нажмите «Обновить»." : "Показан прежний список. Нет свежего подтверждения с сайта.");
            }); }
        });
    }
    private void renderList(boolean resetScroll) {
        if (!listing || list == null) return;
        long now = System.currentTimeMillis(); int[] counts = new int[4]; counts[CashDesk.ALL] = cachedBills.size();
        for (CashBill bill : cachedBills) counts[CashDesk.group(bill, now)]++;
        String[] labels = {"Все", "Новые", "Открывались", "Проверить"};
        for (int i = 0; i < filterButtons.size(); i++) {
            Button tab = filterButtons.get(i); tab.setText(labels[i] + "\n" + counts[i]); tab.setSelected(i == listFilter);
            tab.setBackground(design.background(i == listFilter ? DeskUi.AMBER : android.graphics.Color.WHITE, i == listFilter ? 0 : DeskUi.LINE));
            tab.setTypeface(null, i == listFilter ? Typeface.BOLD : Typeface.NORMAL);
        }
        List<CashBill> shown = new ArrayList<>(); long sum = 0; StringBuilder signature = new StringBuilder();
        for (CashBill bill : cachedBills) if (CashDesk.matches(bill, listFilter, searchQuery, now)) {
            shown.add(bill); sum = Math.addExact(sum, bill.total);
            signature.append(bill.id).append(bill.digest).append(bill.record.toString()).append(CashDesk.group(bill, now));
        }
        listSummary.setText("Счетов: " + shown.size() + " из " + cachedBills.size() + "  ·  " + CashDesk.money(sum));
        if (lastSync != 0) syncStatus.setText("Обновлено " + new SimpleDateFormat("HH:mm:ss", Locale.ROOT).format(new java.util.Date(lastSync)) + " · автоматически каждые 10 сек.");
        String nextSignature = shown.isEmpty() ? "empty:" + searchQuery + ":" + listFilter + ":" + cachedBills.size() : signature.toString();
        if (!resetScroll && nextSignature.equals(listSignature)) return;
        listSignature = nextSignature; int previousY = resetScroll ? 0 : scroll.getScrollY(); list.removeAllViews();
        if (shown.isEmpty()) {
            LinearLayout empty = design.card(list); design.heading(empty, cachedBills.isEmpty() ? lastSync == 0 ? "Список ещё не получен" : skippedRecords > 0 ? "Счета требуют проверки" : "Счетов пока нет" : "Ничего не найдено", 20);
            text(empty, cachedBills.isEmpty() ? lastSync == 0 ? "Ожидаю ответ сайта. Если список не появится, нажмите «Обновить»."
                    : "На сайте откройте стол и нажмите «Передать на кассу». Для старого счёта выберите его дату сверху."
                    : "Измените поиск или выберите фильтр «Все».", 16);
            if (!cachedBills.isEmpty()) button(empty, "Сбросить поиск и фильтр", () -> { searchQuery = ""; listFilter = CashDesk.ALL; listScrollY = 0; listView(); });
        }
        for (CashBill bill : shown) {
            LinearLayout card = design.card(list); LinearLayout heading = design.row(card);
            TextView table = design.heading(heading, "Стол " + bill.table, 22); table.setLayoutParams(new LinearLayout.LayoutParams(0, -2, 1)); table.setMaxLines(2); table.setEllipsize(android.text.TextUtils.TruncateAt.END);
            design.heading(heading, CashDesk.money(bill.total), 21);
            TextView state = text(card, CashDesk.state(bill, now), 15); state.setTextColor(CashDesk.group(bill, now) == CashDesk.ATTENTION ? DeskUi.RED : DeskUi.GREEN);
            text(card, CashDesk.dayLabel(bill.date, now) + " · " + bill.date, 13).setTextColor(DeskUi.MUTED);
            TextView contents = text(card, CashDesk.contents(bill), 14); contents.setMaxLines(2); contents.setEllipsize(android.text.TextUtils.TruncateAt.END);
            String stateName = bill.record.optString("state");
            if ("queued".equals(stateName) || "cleared".equals(stateName) || "opened".equals(stateName)) {
                Runnable open = () -> { listScrollY = scroll.getScrollY(); if ("opened".equals(stateName)) openedBillView(bill); else billView(bill); };
                primary(card, CashDesk.group(bill, now) == CashDesk.SAVED ? "Продолжить / проверить" : "Открыть состав", open);
                card.setOnClickListener(v -> { if (!busy) open.run(); });
            } else button(card, "Проверить текущий чек", this::receiptScreen);
        }
        scroll.post(() -> scroll.scrollTo(0, previousY));
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
        listing = false; page("Стол " + bill.table + " · сохранённый счёт");
        status.setText("Проверяю, можно ли продолжить этот счёт…"); busy = true;
        worker.execute(() -> {
            try {
                CashBill fresh = new CashBill(client.get(BridgeClient.ROOT + bill.date + "/" + bill.id).object(), bill.id, bill.date);
                if (!("opened".equals(fresh.record.optString("state")) || ("cleared".equals(fresh.record.optString("state")) && "postponed".equals(fresh.record.optString("recoveryKind"))))) {
                    post(() -> { busy = false; billView(fresh); }); return;
                }
                JSONObject previous = journal().optJSONObject(fresh.id);
                ReceiptRecovery.requireResumeContext(previous, fresh.record);
                String uuid = previous.getString("receiptUuid");
                ReceiptResume.State receiptState = inspectPreviousReceipt(uuid);
                post(() -> renderSavedBill(fresh, uuid, receiptState));
            } catch (Exception e) {
                post(() -> {
                    error(e);
                    button(actions, "Обновить состояние счёта", () -> openedBillView(bill));
                    button(actions, "К списку счетов", this::listView);
                });
            }
        });
    }
    private ReceiptResume.State inspectPreviousReceipt(String uuid) throws Exception {
        CashBill.text(uuid);
        Receipt previous = ReceiptApi.getReceipt(this, uuid);
        if (previous != null && !uuid.equals(previous.getHeader().getUuid())) throw new IllegalStateException("Касса вернула другой прежний чек.");
        int fiscalCount;
        try (ru.evotor.query.Cursor<ru.evotor.framework.receipt.FiscalReceipt> fiscal = ReceiptApi.getFiscalReceipts(this, uuid)) {
            if (fiscal == null) throw new IllegalStateException("Не удалось проверить фискальные документы. Продолжение заблокировано.");
            fiscalCount = fiscal.getCount();
        }
        Receipt current = ReceiptApi.getReceipt(this, Receipt.Type.SELL);
        return ReceiptResume.classify(uuid, previous == null ? 0 : previous.getPayments().size(), fiscalCount,
                current == null ? null : current.getHeader().getUuid(), current == null ? 0 : current.getPositions().size(), current == null ? 0 : current.getPayments().size());
    }
    private void renderSavedBill(CashBill bill, String uuid, ReceiptResume.State receiptState) {
        busy = false;
        displayedBill = bill;
        design.heading(body, CashDesk.money(bill.total), 30);
        text(body, CashDesk.dayLabel(bill.date, System.currentTimeMillis()) + " · " + bill.date, 14).setTextColor(DeskUi.MUTED);
        if (receiptState == ReceiptResume.State.ACTIVE) {
            status.setText("Этот неоплаченный счёт сейчас открыт на кассе. Можно продолжить его или отложить для расчёта другого стола.");
            primary(actions, "Продолжить счёт", () -> receiptScreen(uuid));
            button(body, "Отложить счёт", () -> new AlertDialog.Builder(this).setTitle("Отложить счёт стола " + bill.table + "?")
                    .setMessage("Состав уже сохранён в нашем списке. На следующем экране кассы нажмите «Очистить», чтобы освободить кассу для другого стола. Позже выберите этот стол в нашем списке и нажмите «Продолжить счёт».")
                    .setNegativeButton("Отмена", null).setPositiveButton("Перейти к чеку", (d, w) -> receiptScreen(uuid)).show());
        } else if (receiptState == ReceiptResume.State.POSTPONED) {
            status.setText("Этот счёт не оплачен и сейчас не открыт на кассе. Состав сохранён. Нажмите «Продолжить счёт», чтобы проверить и снова заполнить кассу.");
            primary(actions, "Продолжить счёт", () -> resumePostponed(bill));
        } else if (receiptState == ReceiptResume.State.OTHER_ACTIVE) {
            status.setText("На кассе сейчас другой заполненный чек. Завершите работу с ним или отложите его. Счёт этого стола остаётся сохранённым.");
            button(actions, "Открыть текущий чек кассы", this::receiptScreen);
        } else {
            status.setText("По прежнему чеку найдена оплата или фискальный документ. Создавать этот счёт заново нельзя. Если оплата ещё не завершена, продолжите её в «Продажа».");
        }
        secondaryActions("Обновить состояние", () -> openedBillView(bill), "К счетам", this::listView);
    }
    private synchronized void rememberCleared(String id, JSONObject expected) throws Exception {
        rememberCleared(id, expected, "cleared");
    }
    private synchronized void rememberCleared(String id, JSONObject expected, String kind) throws Exception {
        JSONObject local = journal().optJSONObject(id);
        ReceiptRecovery.requireLocalMatch(local, expected);
        local.put("state", "cleared").put("synced", true).put("recoveryKind", kind);
        remember(local);
    }
    private void resumePostponed(CashBill bill) {
        if (busy) return; busy = true; status.setText("Проверяю сохранённый счёт, оплату и актуальный состав…");
        worker.execute(() -> {
            boolean postponed = "cleared".equals(bill.record.optString("state"));
            try {
                JSONObject previous = journal().optJSONObject(bill.id);
                ReceiptRecovery.requireResumeContext(previous, bill.record);
                ReceiptResume.requirePostponed(inspectPreviousReceipt(previous.getString("receiptUuid")));
                if ("opened".equals(bill.record.optString("state"))) client.requeuePostponed(bill);
                postponed = true; rememberCleared(bill.id, previous, "postponed");
                JSONObject orders = validateSources(bill); bill.requireStoredPricesForResume(orders);
                JSONObject settings = client.get(BridgeClient.DEVICES + deviceId + "/settings").object();
                JSONObject freshItems = new JSONObject();
                for (CashBill.Line line : bill.lines)
                    for (CashMappings.Part part : CashMappings.resolve(line.name, settings))
                        if (!freshItems.has(part.uuid)) freshItems.put(part.uuid, CashCatalog.describe(this, part.uuid));
                CashReceiptPlan.build(bill, settings, new JSONObject().put("items", freshItems));
                ReceiptResume.requirePostponed(inspectPreviousReceipt(previous.getString("receiptUuid")));
                CashBill fresh = client.refreshPostponed(bill, previous);
                post(() -> { busy = false; billView(fresh); });
            } catch (Exception e) {
                boolean saved = postponed;
                post(() -> {
                    busy = false;
                    if (!saved) { error(e); return; }
                    page("Стол " + bill.table + " · счёт сохранён");
                    error(e);
                    text(body, "Счёт остаётся в списке. Если состав или цена изменились, на сайте обновите состав этого стола, затем нажмите кнопку ниже.", 16);
                    button(actions, "Обновить счёт и настройки", () -> billView(bill));
                    button(actions, "К списку счетов", this::listView);
                });
            }
        });
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
                post(() -> { busy = false; if ("opened".equals(fresh.record.optString("state")) || ("cleared".equals(fresh.record.optString("state")) && "postponed".equals(fresh.record.optString("recoveryKind")))) openedBillView(fresh); else renderBill(fresh, settings, catalog); });
            } catch (Exception e) { post(() -> error(e)); }
        });
    }
    private void renderBill(CashBill bill, JSONObject settings, JSONObject catalog) {
        listing = false; page("Стол " + bill.table);
        design.heading(body, CashDesk.money(bill.total), 30);
        text(body, CashDesk.dayLabel(bill.date, System.currentTimeMillis()) + " · " + bill.date, 14).setTextColor(DeskUi.MUTED);
        displayedBill = bill;
        List<CashReceiptPlan.Item> plan = null;
        try {
            plan = CashReceiptPlan.build(bill, settings, catalog);
            mappingReady = "queued".equals(bill.record.optString("state")) && !bill.record.optBoolean("needsRefresh");
            for (CashReceiptPlan.Item item : plan) {
                LinearLayout row = design.card(body);
                design.heading(row, item.name + " ×" + item.quantity, 19);
                text(row, CashDesk.money(item.priceKopecks) + " за шт.   Итого " + CashDesk.money(item.priceKopecks * item.quantity), 16);
                if (item.sourceNames.size() != 1 || !item.sourceNames.iterator().next().equalsIgnoreCase(item.name))
                    text(row, "На сайте: " + android.text.TextUtils.join(", ", item.sourceNames), 14).setTextColor(DeskUi.MUTED);
                if (item.estimated) text(row, "Цена из меню сайта; проверьте перед открытием.", 14).setTextColor(DeskUi.RED);
            }
            status.setText("Проверьте состав кассового чека. Товары, количества и сумма показаны один раз.");
        } catch (Exception e) { mappingReady = false; status.setText("Не готово: " + e.getMessage()); }
        if (bill.record.optBoolean("needsRefresh")) status.setText("Прежний чек очищен. На сайте нажмите «Обновить состав счёта», затем здесь — «Обновить счёт и настройки».");
        else if (!bill.isFresh(System.currentTimeMillis())) status.setText("Снимок старше 15 минут. Нажмите «Проверить свежесть»: неизменившийся заказ обновится здесь. Дозаказ обновляется на сайте.");
        else if (!"queued".equals(bill.record.optString("state"))) status.setText("Состояние передачи: " + stateLabel(bill.record.optString("state")) + ". Вернитесь к списку счетов.");
        final int rowCount = plan == null ? 0 : plan.size();
        openBillButton = primary(actions, "Проверить и открыть чек", () -> {
            try { bill.requireFresh(System.currentTimeMillis()); }
            catch (Exception e) { error(e); return; }
            new AlertDialog.Builder(this).setTitle("Открыть счёт стола " + bill.table + "?")
                    .setMessage("Позиций в чеке: " + rowCount + ". Сумма: " + BigDecimal.valueOf(bill.total, 2).toPlainString()
                            + " ₽. Проверьте состав выше. Это тест: чек не оплачивайте. Стол на сайте не будет отмечен оплаченным.")
                    .setNegativeButton("Отмена", null).setPositiveButton("Открыть чек", (d, w) -> prepare(bill, settings)).show();
        });
        secondaryActions(bill.isFresh(System.currentTimeMillis()) ? "Обновить данные" : "Проверить свежесть", () -> refreshBill(bill), "К счетам", this::listView);
        text(body, "Тестовый режим. Оплата выполняется отдельно; стол на сайте автоматически не закрывается.", 14).setTextColor(DeskUi.MUTED);
        updateOpenButton();
    }
    private void refreshBill(CashBill bill) {
        if (bill.isFresh(System.currentTimeMillis()) || !"queued".equals(bill.record.optString("state")) || bill.record.optBoolean("needsRefresh")) { billView(bill); return; }
        busy = true; updateOpenButton(); status.setText("Проверяю исходный заказ, цены и товары кассы…");
        worker.execute(() -> {
            try {
                bill.requireStoredPricesForResume(validateSources(bill));
                JSONObject settings = client.get(BridgeClient.DEVICES + deviceId + "/settings").object(); JSONObject items = new JSONObject();
                for (CashBill.Line line : bill.lines) for (CashMappings.Part part : CashMappings.resolve(line.name, settings))
                    if (!items.has(part.uuid)) items.put(part.uuid, CashCatalog.describe(this, part.uuid));
                CashReceiptPlan.build(bill, settings, new JSONObject().put("items", items));
                CashBill fresh = client.refreshUnchanged(bill);
                post(() -> { busy = false; billView(fresh); });
            } catch (Exception e) { post(() -> error(e)); }
        });
    }
    private JSONObject validateSources(CashBill bill) throws Exception {
        JSONObject meta = client.get("tables/" + bill.date + "_" + bill.table).object();
        if (!"open".equals(meta.optString("status")) || !bill.sid.equals(meta.optString("sid", "default")))
            throw new IllegalStateException("Посещение стола закрыто или изменилось. Открытие заблокировано.");
        JSONObject orders = client.dayOrders(bill.date); bill.verifyOrders(orders); return orders;
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
                    boolean postponed = ReceiptRecovery.wasPostponed(previous, bill.record);
                    if (postponed) ReceiptResume.requirePostponed(inspectPreviousReceipt(previous.getString("receiptUuid")));
                    else verifyClearedReceipt(previous.getString("receiptUuid"));
                    rememberCleared(bill.id, previous, postponed ? "postponed" : "cleared");
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
                    try {
                        busy = false; updateOpenButton(); status.setText("Открываю заполненный чек кассы. Оплата выполняется отдельно.");
                        receiptReturnBill = expectedUuid == null ? null : displayedBill;
                        startActivity(NavigationApi.createIntentForSellReceiptEdit(false));
                    } catch (Exception e) { receiptReturnBill = null; error(new IllegalStateException("Не удалось открыть заполненный чек. Откройте «Продажа» на кассе вручную.")); }
                });
            } catch (Exception e) { post(() -> error(e)); }
        });
    }
    @Override protected void onStart() { super.onStart(); started = true; ui.postDelayed(poll, 10000); }
    @Override protected void onResume() {
        super.onResume();
        if (receiptReturnBill != null && signedIn) {
            CashBill saved = receiptReturnBill; receiptReturnBill = null; openedBillView(saved);
        }
    }
    @Override protected void onStop() { started = false; ui.removeCallbacks(poll); super.onStop(); }
    @Override protected void onDestroy() { worker.shutdown(); client.logout(); super.onDestroy(); }
    @Override public void onBackPressed() {
        if (busy) { status.setText("Дождитесь завершения действия. Повторять открытие не нужно."); return; }
        if (!listing && signedIn) { listView(); return; }
        if (listing) new AlertDialog.Builder(this).setTitle("Закрыть приложение?")
                .setMessage("Счета и журнал попыток сохранятся. Для нового входа понадобится пароль сотрудника.")
                .setNegativeButton("Остаться", null).setPositiveButton("Закрыть", (d, w) -> finish()).show();
        else super.onBackPressed();
    }
}
