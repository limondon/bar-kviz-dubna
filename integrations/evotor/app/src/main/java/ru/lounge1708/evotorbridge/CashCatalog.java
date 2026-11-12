package ru.lounge1708.evotorbridge;

import android.content.Context;
import android.database.Cursor;
import java.util.ArrayList;
import java.util.List;
import ru.evotor.framework.inventory.InventoryApi;
import ru.evotor.framework.inventory.ProductItem;
import ru.evotor.framework.inventory.ProductTable;
import ru.evotor.framework.receipt.TaxNumber;
import org.json.JSONArray;
import org.json.JSONObject;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;

final class CashCatalog {
    private static JSONObject describe(Cursor row) throws Exception {
        String uuid = row.getString(row.getColumnIndexOrThrow(ProductTable.ROW_UUID));
        String type = row.getString(row.getColumnIndexOrThrow(ProductTable.ROW_TYPE));
        String tax = row.getString(row.getColumnIndexOrThrow(ProductTable.ROW_TAX_NUMBER));
        List<String> columns = new ArrayList<>(); Collections.addAll(columns, row.getColumnNames()); Collections.sort(columns);
        JSONArray signature = new JSONArray();
        // Stock changes must not invalidate a mapping. All other raw card fields are fingerprinted.
        for (String column : columns) if (!ProductTable.ROW_QUANTITY.equals(column))
            signature.put(new JSONArray().put(column).put(row.getString(row.getColumnIndexOrThrow(column))));
        JSONObject result = new JSONObject().put("uuid", uuid).put("name", row.getString(row.getColumnIndexOrThrow(ProductTable.ROW_NAME)))
                .put("parentUuid", row.getString(row.getColumnIndexOrThrow(ProductTable.ROW_PARENT_UUID)))
                .put("type", type).put("tax", tax).put("fingerprint", CashBill.hash(signature.toString()));
        boolean supported = DraftPolicy.supportsType(type);
        try { TaxNumber.valueOf(tax); } catch (RuntimeException e) { supported = false; }
        try {
            long price = new BigDecimal(row.getString(row.getColumnIndexOrThrow(ProductTable.ROW_PRICE_OUT))).setScale(2, RoundingMode.UNNECESSARY).movePointRight(2).longValueExact();
            result.put("priceKopecks", price); if (price < 0) supported = false;
        } catch (RuntimeException e) { supported = false; }
        return result.put("supported", supported);
    }
    static JSONObject describe(Context context, String uuid) throws Exception {
        try (Cursor row = context.getContentResolver().query(ProductTable.URI, null, ProductTable.ROW_UUID + " = ?", new String[]{uuid}, null)) {
            if (row == null || !row.moveToFirst()) throw new IllegalStateException("Карточка кассы больше недоступна.");
            return describe(row);
        }
    }
    static JSONObject export(Context context, String deviceId, String deviceName, String requestId) throws Exception {
        Map<String, JSONObject> entries = new HashMap<>(); Map<String, Boolean> groups = new HashMap<>();
        try (Cursor rows = context.getContentResolver().query(ProductTable.URI, null, null, null, ProductTable.ROW_NAME + " ASC")) {
            if (rows == null) throw new IllegalStateException("Каталог кассы недоступен.");
            while (rows.moveToNext()) {
                if (entries.size() >= 2000) throw new IllegalStateException("Каталог больше 2000 записей. Экспорт остановлен без обрезки данных.");
                JSONObject entry = describe(rows); entries.put(entry.getString("uuid"), entry);
                groups.put(entry.getString("uuid"), rows.getInt(rows.getColumnIndexOrThrow(ProductTable.ROW_IS_GROUP)) != 0);
            }
        }
        JSONObject items = new JSONObject();
        for (Map.Entry<String, JSONObject> pair : entries.entrySet()) if (!groups.get(pair.getKey())) {
            JSONObject entry = pair.getValue(); String parent = entry.optString("parentUuid"), category = ""; HashSet<String> seen = new HashSet<>();
            while (!parent.isEmpty() && entries.containsKey(parent) && seen.add(parent) && seen.size() <= 20) {
                JSONObject folder = entries.get(parent); category = folder.optString("name") + (category.isEmpty() ? "" : " / " + category); parent = folder.optString("parentUuid");
            }
            items.put(pair.getKey(), entry.put("category", category));
        }
        return new JSONObject().put("schema", 1).put("deviceId", deviceId).put("deviceName", deviceName).put("requestId", requestId)
                .put("exportedAt", System.currentTimeMillis()).put("items", items);
    }
    static ProductItem.Product checked(Context context, String uuid) throws Exception {
        ProductItem item = InventoryApi.getProductByUuid(context, uuid);
        if (!(item instanceof ProductItem.Product)) throw new IllegalStateException("Карточка товара недоступна.");
        ProductItem.Product product = (ProductItem.Product) item;
        try (Cursor raw = context.getContentResolver().query(ProductTable.URI,
                new String[]{ProductTable.ROW_TYPE, ProductTable.ROW_TAX_NUMBER},
                ProductTable.ROW_UUID + " = ?", new String[]{uuid}, null)) {
            if (raw == null || !raw.moveToFirst() || !DraftPolicy.supportsType(raw.getString(0))
                    || !product.getType().name().equals(raw.getString(0))
                    || product.getTaxNumber() != TaxNumber.valueOf(raw.getString(1)))
                throw new IllegalStateException("Маркированная или неизвестная карточка не поддерживается. Проверьте её вручную.");
        }
        if (product.getPrice() == null || product.getPrice().signum() < 0) throw new IllegalStateException("Некорректная цена карточки.");
        return product;
    }
    static List<ProductItem.Product> search(Context context, String query) throws Exception {
        List<ProductItem.Product> products = new ArrayList<>();
        try (Cursor rows = context.getContentResolver().query(ProductTable.URI, new String[]{ProductTable.ROW_UUID},
                ProductTable.ROW_IS_GROUP + " = 0 AND " + ProductTable.ROW_NAME + " LIKE ?",
                new String[]{"%" + query.replace("%", "").replace("_", "") + "%"}, ProductTable.ROW_NAME + " ASC")) {
            if (rows == null) throw new IllegalStateException("Список товаров недоступен.");
            int scanned = 0;
            while (rows.moveToNext() && products.size() < 20 && scanned++ < 200) {
                try { products.add(checked(context, rows.getString(0))); }
                catch (IllegalStateException | IllegalArgumentException unsupported) { /* Never coerce special types/taxes. */ }
            }
        }
        return products;
    }
}
