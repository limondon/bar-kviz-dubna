package ru.lounge1708.evotorbridge;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/** Editable data only: one source line can resolve to a base card and any configured modifiers. */
final class CashMappings {
    static final class Part {
        final String uuid, fingerprint; final int units;
        Part(JSONObject value) throws Exception {
            uuid = CashBill.text(value.get("uuid")); fingerprint = CashBill.text(value.get("fingerprint"));
            units = Math.toIntExact(CashBill.integer(value.get("units")));
            if (units < 1 || units > 10) throw new IllegalArgumentException("Количество карточки должно быть от 1 до 10.");
        }
    }
    static String key(String name, boolean addon) throws Exception {
        return CashBill.hash(addon ? name.trim().toLowerCase(new Locale("ru", "RU")) : name.trim());
    }
    static List<Part> resolve(String name, JSONObject settings) throws Exception {
        if (settings.optInt("schema") != 1) throw new IllegalStateException("Настройте соответствия на сайте в разделе «Касса Эвотор».");
        List<Part> parts = new ArrayList<>();
        JSONObject exact = rule(settings, "products", name, false);
        if (exact != null) { append(parts, exact); return parts; }
        // Options may change meaning even when free. Require an explicit editable rule for that full variant.
        if (name.matches("(?s).*\\s[—–-]\\s.*")) throw new IllegalStateException("Настройте полный вариант «" + name + "» на сайте.");
        int plus = name.indexOf(" + ");
        if (plus < 0) throw new IllegalStateException("Не настроено соответствие для «" + name + "».");
        JSONObject base = rule(settings, "products", name.substring(0, plus), false);
        if (base == null) throw new IllegalStateException("Не настроена основная позиция «" + name.substring(0, plus) + "».");
        append(parts, base);
        for (String addon : name.substring(plus + 3).split(",", -1)) {
            if (addon.trim().isEmpty()) throw new IllegalStateException("Не распознана добавка в «" + name + "».");
            JSONObject modifier = rule(settings, "addons", addon, true);
            if (modifier == null) throw new IllegalStateException("Настройте добавку «" + addon.trim() + "» на сайте.");
            append(parts, modifier);
        }
        if (parts.size() > 24) throw new IllegalStateException("Слишком много компонентов позиции.");
        return parts;
    }
    private static JSONObject rule(JSONObject settings, String kind, String name, boolean addon) throws Exception {
        JSONObject rules = settings.optJSONObject(kind); if (rules == null) return null;
        JSONObject rule = rules.optJSONObject(key(name, addon));
        if (rule != null && !key(rule.getString("name"), addon).equals(key(name, addon))) throw new IllegalStateException("Имя соответствия повреждено.");
        return rule;
    }
    private static void append(List<Part> target, JSONObject rule) throws Exception {
        JSONArray parts = rule.getJSONArray("parts");
        if (parts.length() < 1 || parts.length() > 12) throw new IllegalArgumentException("Нужно от 1 до 12 карточек в соответствии.");
        for (int i = 0; i < parts.length(); i++) target.add(new Part(parts.getJSONObject(i)));
    }
    static long total(List<Part> parts, JSONObject catalog) throws Exception {
        long total = 0; JSONObject items = catalog.optJSONObject("items");
        for (Part part : parts) {
            JSONObject product = items == null ? null : items.optJSONObject(part.uuid);
            if (product == null || !product.optBoolean("supported") || !part.fingerprint.equals(product.optString("fingerprint")))
                throw new IllegalStateException("Карточка кассы изменилась или не поддерживается. Обновите каталог и сохраните соответствие на сайте.");
            long price = CashBill.integer(product.get("priceKopecks"));
            if (price < 0) throw new IllegalStateException("Неверная цена карточки.");
            total = Math.addExact(total, Math.multiplyExact(price, part.units));
        }
        return total;
    }
}
