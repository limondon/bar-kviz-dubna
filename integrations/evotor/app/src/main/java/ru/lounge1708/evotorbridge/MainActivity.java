package ru.lounge1708.evotorbridge;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;
import ru.evotor.framework.core.IntegrationManagerFuture;
import ru.evotor.framework.core.action.command.open_receipt_command.OpenReceiptCommandResult;
import ru.evotor.framework.core.action.command.open_receipt_command.OpenSellReceiptCommand;
import ru.evotor.framework.core.action.event.receipt.changes.position.PositionAdd;
import ru.evotor.framework.core.action.event.receipt.changes.receipt.SetExtra;
import ru.evotor.framework.inventory.InventoryApi;
import ru.evotor.framework.inventory.ProductItem;
import ru.evotor.framework.inventory.ProductTable;
import ru.evotor.framework.navigation.NavigationApi;
import ru.evotor.framework.receipt.Position;
import ru.evotor.framework.receipt.Receipt;
import ru.evotor.framework.receipt.ReceiptApi;
import ru.evotor.framework.receipt.TaxNumber;

/** Offline, operator-controlled SDK test. No network, fiscalization or automatic import. */
public final class MainActivity extends Activity {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Handler ui = new Handler(Looper.getMainLooper());
    private TextView status, selection;
    private EditText search, quantity;
    private Button find, open;
    private LinearLayout results;
    private SharedPreferences preferences;
    private ProductItem.Product selected;
    private boolean busy;
    private boolean opening;
    private long operation;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        preferences = getSharedPreferences("draft-test", MODE_PRIVATE);
        ScrollView scroll = new ScrollView(this);
        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (20 * getResources().getDisplayMetrics().density);
        body.setPadding(pad, pad, pad, pad);
        scroll.addView(body);
        setContentView(scroll);
        text(body, "1708 · Проверка кассы", 24);
        button(body, "Счета с сайта · тест", v -> startActivity(new Intent(this, TransferActivity.class)));
        text(body, "Выбор существующего товара и открытие чека без оплаты. "
                + "Проверку проводите вне обслуживания гостей. Для передачи со страницы стола откройте «Счета с сайта».", 16);
        search = input(body, "Название товара", "Пиво", InputType.TYPE_CLASS_TEXT);
        find = button(body, "Найти в товарах кассы", v -> findProducts());
        results = new LinearLayout(this);
        results.setOrientation(LinearLayout.VERTICAL);
        body.addView(results);
        selection = text(body, "Товар не выбран", 18);
        quantity = input(body, "Количество", "1", InputType.TYPE_CLASS_NUMBER);
        open = button(body, "Открыть заполненный чек", v -> confirmOpen());
        button(body, "Посмотреть текущий чек", v -> showExistingReceipt());
        status = text(body, "Готово к проверке. Сначала найдите товар.", 16);
        if (preferences.getBoolean("attempted", false)) {
            status.setText("Ранее уже выполнялось открытие чека. Повторная отправка в этом прототипе отключена. "
                    + "Проверьте текущий чек на кассе.");
        }
        updateControls();
    }

    private TextView text(LinearLayout parent, String value, int size) {
        TextView label = new TextView(this);
        label.setText(value); label.setTextSize(size); label.setPadding(0, 12, 0, 12);
        parent.addView(label); return label;
    }
    private EditText input(LinearLayout parent, String hint, String value, int type) {
        EditText input = new EditText(this);
        input.setHint(hint); input.setText(value); input.setInputType(type); input.setSingleLine(true);
        parent.addView(input); return input;
    }
    private Button button(LinearLayout parent, String label, View.OnClickListener listener) {
        Button button = new Button(this); button.setText(label); button.setAllCaps(false);
        button.setMinHeight((int) (52 * getResources().getDisplayMetrics().density));
        button.setOnClickListener(listener); parent.addView(button); return button;
    }
    private void updateControls() {
        find.setEnabled(!busy);
        open.setEnabled(!busy && selected != null && !preferences.getBoolean("attempted", false));
        quantity.setEnabled(!busy);
        search.setEnabled(!busy);
    }
    private void post(Runnable action) { ui.post(() -> { if (!isFinishing() && !isDestroyed()) action.run(); }); }
    private void failure(Exception error) {
        busy = false; opening = false;
        status.setText("Не выполнено: " + error.getClass().getSimpleName() + ". "
                + (error.getMessage() == null ? "Нет описания ошибки." : error.getMessage()));
        updateControls();
    }

    private void findProducts() {
        if (busy) return;
        String query = search.getText().toString().trim();
        if (query.length() < 2) { status.setText("Введите минимум две буквы названия."); return; }
        busy = true; selected = null; selection.setText("Товар не выбран"); results.removeAllViews();
        status.setText("Читаю товары кассы…"); updateControls();
        worker.execute(() -> {
            try {
                List<ProductItem.Product> products = new ArrayList<>();
                List<String> unsupportedDetails = new ArrayList<>();
                int unsupported = 0;
                try (Cursor cursor = getContentResolver().query(ProductTable.URI,
                        new String[]{ProductTable.ROW_UUID, ProductTable.ROW_TYPE, ProductTable.ROW_TAX_NUMBER, ProductTable.ROW_NAME},
                        ProductTable.ROW_IS_GROUP + " = 0 AND " + ProductTable.ROW_NAME + " LIKE ?",
                        new String[]{"%" + query.replace("%", "").replace("_", "") + "%"},
                        ProductTable.ROW_NAME + " ASC")) {
                    if (cursor == null) throw new IllegalStateException("Касса не предоставила список товаров.");
                    while (cursor.moveToNext() && products.size() < 20) {
                        String id = cursor.getString(0), type = cursor.getString(1), tax = cursor.getString(2);
                        // The old SDK silently maps unknown types/taxes to NORMAL/NO_VAT. Reject before mapping.
                        if (!DraftPolicy.supportsType(type)) {
                            unsupported++;
                            if (unsupportedDetails.size() < 20) unsupportedDetails.add(cursor.getString(3) + " · тип: " + type);
                            continue;
                        }
                        try { TaxNumber.valueOf(tax); } catch (RuntimeException unknownTax) {
                            unsupported++;
                            if (unsupportedDetails.size() < 20) unsupportedDetails.add(cursor.getString(3) + " · налог: " + tax);
                            continue;
                        }
                        ProductItem item = InventoryApi.getProductByUuid(this, id);
                        if (item instanceof ProductItem.Product) products.add((ProductItem.Product) item);
                    }
                }
                final int skipped = unsupported;
                post(() -> {
                    busy = false;
                    for (ProductItem.Product product : products) {
                        button(results, product.getName() + " · " + product.getPrice().toPlainString()
                                + " ₽ · " + product.getType().name(), v -> {
                            if (busy) return;
                            selected = product;
                            selection.setText(product.getName() + "\nЦена: " + product.getPrice().toPlainString()
                                    + " ₽\nТип: " + product.getType().name());
                            updateControls();
                        });
                    }
                    for (String detail : unsupportedDetails) text(results, detail + "\nТолько просмотр: этот прототип не открывает чек с такими реквизитами.", 16);
                    status.setText("Найдено: " + products.size() + ". " + (skipped > 0
                            ? "Не показано товаров со специальными или неизвестными реквизитами: " + skipped
                            + ". Для них нужна отдельная проверка SDK и маркировки." : "Выберите товар."));
                    updateControls();
                });
            } catch (Exception error) { post(() -> failure(error)); }
        });
    }

    private void confirmOpen() {
        if (busy || selected == null || preferences.getBoolean("attempted", false)) return;
        try {
            BigDecimal count = DraftPolicy.quantity(quantity.getText().toString());
            ProductItem.Product product = selected;
            new AlertDialog.Builder(this).setTitle("Открыть тестовый чек?")
                    .setMessage(product.getName() + " × " + count.toPlainString() + "\nСумма: "
                            + product.getPrice().multiply(count).toPlainString() + " ₽\n\n"
                            + "Будет создан незакрытый чек. Не оплачивайте его: это проверка интеграции.")
                    .setNegativeButton("Отмена", null)
                    .setPositiveButton("Открыть чек", (dialog, which) -> prepareOpen(product, count)).show();
        } catch (Exception error) { failure(error); }
    }

    private void prepareOpen(ProductItem.Product product, BigDecimal count) {
        if (busy || preferences.getBoolean("attempted", false)) return;
        busy = true; updateControls(); status.setText("Проверяю текущий чек и версию кассы…");
        worker.execute(() -> {
            try {
                String version = getPackageManager().getPackageInfo("ru.atol.tabletpos", 0).versionName;
                if (!DraftPolicy.supportsPosVersion(version)) throw new IllegalStateException("Нужен Evotor POS 8.11 или новее.");
                Receipt receipt = ReceiptApi.getReceipt(this, Receipt.Type.SELL);
                if (receipt != null && (!receipt.getPositions().isEmpty() || !receipt.getPayments().isEmpty())) {
                    throw new IllegalStateException("На кассе уже есть чек. Сначала завершите работу с ним вручную.");
                }
                ProductItem current = InventoryApi.getProductByUuid(this, product.getUuid());
                if (!(current instanceof ProductItem.Product)) throw new IllegalStateException("Товар больше не доступен.");
                ProductItem.Product fresh = (ProductItem.Product) current;
                try (Cursor raw = getContentResolver().query(ProductTable.URI,
                        new String[]{ProductTable.ROW_TYPE, ProductTable.ROW_TAX_NUMBER},
                        ProductTable.ROW_UUID + " = ?", new String[]{product.getUuid()}, null)) {
                    if (raw == null || !raw.moveToFirst() || !DraftPolicy.supportsType(raw.getString(0))
                            || !fresh.getType().name().equals(raw.getString(0))
                            || fresh.getTaxNumber() != TaxNumber.valueOf(raw.getString(1))) {
                        throw new IllegalStateException("Реквизиты товара не поддерживаются этим прототипом или изменились.");
                    }
                }
                if (fresh.getType() != product.getType() || fresh.getTaxNumber() != product.getTaxNumber()
                        || fresh.getPrice().compareTo(product.getPrice()) != 0 || !fresh.getName().equals(product.getName())) {
                    throw new IllegalStateException("Карточка товара изменилась. Найдите и выберите её заново.");
                }
                Position position = Position.Builder.newInstance(fresh, count).build();
                JSONObject extra = new JSONObject();
                extra.put("prototype", "1708-offline-draft-test-v1");
                SetExtra metadata = new SetExtra(extra);
                post(() -> sendOpen(position, metadata));
            } catch (Exception error) { post(() -> failure(error)); }
        });
    }

    private void sendOpen(Position position, SetExtra metadata) {
        if (getPackageManager().queryIntentServices(new Intent(OpenSellReceiptCommand.NAME), 0).isEmpty()) {
            failure(new IllegalStateException("Обработчик открытия чека недоступен. Проверьте установку через Эвотор.Маркет."));
            return;
        }
        if (!preferences.edit().putBoolean("attempted", true).commit()) {
            failure(new IllegalStateException("Не удалось сохранить защиту от повторной отправки.")); return;
        }
        opening = true;
        final long token = ++operation;
        status.setText("Жду ответа кассы. Повторно нажимать не нужно.");
        ui.postDelayed(() -> {
            if (opening && operation == token && !isDestroyed()) {
                opening = false; busy = false;
                status.setText("За 15 секунд подтверждение не получено. Результат неизвестен. "
                        + "Повторная отправка заблокирована; проверьте текущий чек на кассе.");
                updateControls();
            }
        }, 15000);
        try {
            new OpenSellReceiptCommand(Collections.singletonList(new PositionAdd(position)), metadata, null)
                    .process(this, future -> {
                        try {
                            IntegrationManagerFuture.Result result = future.getResult();
                            post(() -> {
                                opening = false; busy = false;
                                if (result.getType() == IntegrationManagerFuture.Result.Type.OK) {
                                    OpenReceiptCommandResult created = OpenReceiptCommandResult.create(result.getData());
                                    status.setText("Чек открыт, оплаты нет. " + (created == null ? "" : created.getReceiptUuid()));
                                    showExistingReceipt();
                                } else {
                                    status.setText("Касса отклонила открытие: " + (result.getError() == null
                                            ? "ответ без описания ошибки" : result.getError().getCode() + " · " + result.getError().getMessage()));
                                }
                                updateControls();
                            });
                        } catch (Exception error) { post(() -> failure(error)); }
                    });
        } catch (Exception error) { failure(error); }
    }

    private void showExistingReceipt() {
        try { startActivity(NavigationApi.createIntentForSellReceiptEdit(false)); }
        catch (Exception error) { status.setText("Не удалось открыть экран чека: " + error.getMessage()); }
    }
    @Override protected void onDestroy() { worker.shutdownNow(); super.onDestroy(); }
}
