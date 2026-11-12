package ru.lounge1708.evotorbridge;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/** Versioned immutable wire format. The hash is calculated over the original UTF-8 string. */
final class CashBill {
    static final long MAX_AGE = 15 * 60 * 1000;
    final JSONObject record;
    final String id, date, table, sid, digest;
    final List<Line> lines = new ArrayList<>();
    long total;
    static final class Line {
        final String orderId, itemId, productId, name, mappingKey;
        final int quantity;
        final long kopecks;
        final boolean estimated;
        Line(JSONArray row) throws Exception {
            if (row.length() != 7) throw new IllegalArgumentException("Неверный формат строки счёта.");
            orderId = text(row.get(0)); itemId = text(row.get(1));
            productId = row.getString(2); if (!productId.isEmpty()) text(productId);
            name = text(row.get(3));
            quantity = Math.toIntExact(integer(row.get(4)));
            kopecks = integer(row.get(5));
            if (!(row.get(6) instanceof Boolean)) throw new IllegalArgumentException("Неверный источник цены.");
            estimated = row.getBoolean(6);
            if (quantity < 1 || quantity > 100 || kopecks < 0 || kopecks > 100000000)
                throw new IllegalArgumentException("Недопустимое количество или цена.");
            mappingKey = hash(productId + "\u001f" + name + "\u001f" + kopecks);
        }
        BigDecimal price() { return BigDecimal.valueOf(kopecks, 2); }
    }
    CashBill(JSONObject record, String expectedId, String expectedDate) throws Exception {
        this.record = record;
        if (record.getInt("schema") != 1) throw new IllegalArgumentException("Версия счёта не поддерживается.");
        String canonical = record.getString("canonical");
        if (canonical.length() > 100000) throw new IllegalArgumentException("Слишком большой счёт.");
        digest = record.getString("digest");
        if (!hash(canonical).equals(digest)) throw new IllegalArgumentException("Состав счёта повреждён.");
        JSONArray payload = new JSONArray(canonical);
        if (payload.length() != 5 || payload.getInt(0) != 1) throw new IllegalArgumentException("Неверная версия состава.");
        date = text(payload.get(1)); table = text(payload.get(2)); sid = text(payload.get(3));
        if (table.matches("(?s).*[.#$\\[\\]/].*")) throw new IllegalArgumentException("Недопустимое название стола.");
        id = hash(date + "\u001f" + table + "\u001f" + sid);
        if (!date.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}") || !date.equals(expectedDate) || !id.equals(expectedId)
                || !id.equals(record.getString("id")) || !date.equals(record.getString("date"))
                || !table.equals(record.getString("table")) || !sid.equals(record.getString("sid")))
            throw new IllegalArgumentException("Не совпало посещение стола.");
        JSONArray rows = payload.getJSONArray(4);
        if (rows.length() < 1 || rows.length() > 100) throw new IllegalArgumentException("Допустимо от 1 до 100 строк.");
        Set<String> seen = new HashSet<>();
        for (int i = 0; i < rows.length(); i++) {
            Line line = new Line(rows.getJSONArray(i));
            if (!seen.add(line.orderId + "\u001f" + line.itemId)) throw new IllegalArgumentException("Повторная строка заказа.");
            lines.add(line); total = Math.addExact(total, Math.multiplyExact(line.kopecks, line.quantity));
        }
        if (total <= 0 || total > 100000000) throw new IllegalArgumentException("Недопустимая сумма счёта.");
    }
    void requireFresh(long now) throws Exception {
        long createdAt = record.getLong("createdAt");
        if (createdAt > now + 60000 || now - createdAt > MAX_AGE)
            throw new IllegalStateException("Счёт старше 15 минут. Обновите состав на сайте.");
    }
    void verifyOrders(JSONObject orders) throws Exception {
        java.util.Map<String, JSONObject> actual = new java.util.HashMap<>();
        java.util.Iterator<String> keys = orders.keys();
        while (keys.hasNext()) {
            String orderId = keys.next(); JSONObject order = orders.getJSONObject(orderId);
            if (!date.equals(order.optString("date")) || !table.equals(order.optString("table"))
                    || !sid.equals(order.optString("sid", "default")) || order.optString("status").matches("cancelled|canceled|deleted")) continue;
            Object raw = order.opt("items");
            JSONObject items;
            if (raw instanceof JSONObject) items = (JSONObject) raw;
            else if (raw instanceof JSONArray) {
                items = new JSONObject(); JSONArray array = (JSONArray) raw;
                for (int i = 0; i < array.length(); i++) if (!array.isNull(i)) items.put(String.valueOf(i), array.get(i));
            } else throw new IllegalStateException("Старый формат заказа: сначала пересохраните состав на сайте.");
            java.util.Iterator<String> itemKeys = items.keys();
            while (itemKeys.hasNext()) {
                String key = itemKeys.next(); Object item = items.get(key);
                if (!(item instanceof JSONObject)) continue;
                String name = ((JSONObject) item).optString("name");
                if (name.matches("(?iu)^\\s*(?:\\d+\\s*)?(?:кружк[аиу]|кружек)\\s*$")) continue;
                actual.put(orderId + "\u001f" + key, (JSONObject) item);
            }
        }
        if (actual.size() != lines.size()) throw new IllegalStateException("Появился дозаказ или изменился состав. Обновите счёт на сайте.");
        for (Line line : lines) {
            JSONObject item = actual.get(line.orderId + "\u001f" + line.itemId);
            if (item == null || !line.name.equals(item.optString("name"))
                    || new BigDecimal(item.get("qty").toString()).compareTo(BigDecimal.valueOf(line.quantity)) != 0
                    || !line.productId.equals(item.optString("menuItemId", item.optString("productId", ""))))
                throw new IllegalStateException("Состав исходного заказа изменился. Обновите счёт на сайте.");
            if (item.has("price") && !item.isNull("price") && !item.optString("price").isEmpty()
                    && new BigDecimal(item.get("price").toString()).compareTo(line.price()) != 0)
                throw new IllegalStateException("Цена заказа изменилась. Обновите счёт на сайте.");
        }
    }
    static String text(Object value) {
        if (!(value instanceof String) || ((String) value).isEmpty() || ((String) value).length() > 200
                || ((String) value).matches("(?s).*[\\x00-\\x1f].*")) throw new IllegalArgumentException("Неверное поле счёта.");
        return (String) value;
    }
    static long integer(Object value) {
        if (!(value instanceof Number)) throw new IllegalArgumentException("Ожидалось число.");
        try { return new BigDecimal(value.toString()).longValueExact(); }
        catch (ArithmeticException error) { throw new IllegalArgumentException("Ожидалось целое число."); }
    }
    static String hash(String value) throws Exception {
        byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
        StringBuilder result = new StringBuilder();
        for (byte b : bytes) result.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
        return result.toString();
    }
    static boolean canClaim(String state, String currentDigest, String expectedDigest) {
        return "queued".equals(state) && expectedDigest.equals(currentDigest);
    }
    boolean overlaps(CashBill other) {
        Set<String> sources = new HashSet<>();
        // Partial receipts are outside this test version. Even regenerated row IDs must not replay an order.
        for (Line line : lines) sources.add(line.orderId);
        for (Line line : other.lines) if (sources.contains(line.orderId)) return true;
        return false;
    }
    static boolean canReport(JSONObject current, String digest, String nonce) {
        String state = current.optString("state");
        return digest.equals(current.optString("digest")) && nonce.equals(current.optString("nonce"))
                && ("opening".equals(state) || "unknown".equals(state));
    }
}
