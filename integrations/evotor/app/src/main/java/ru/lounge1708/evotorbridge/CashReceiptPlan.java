package ru.lounge1708.evotorbridge;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.json.JSONObject;

/** Only the SDK positions are grouped. Source rows and their digest remain unchanged. */
final class CashReceiptPlan {
    static final class Item {
        final String uuid, name, fingerprint;
        final long priceKopecks;
        final Set<String> sourceNames = new LinkedHashSet<>();
        int quantity;
        boolean estimated;
        Item(String uuid, JSONObject card) throws Exception {
            this.uuid = uuid; name = card.getString("name"); fingerprint = card.getString("fingerprint");
            priceKopecks = CashBill.integer(card.get("priceKopecks"));
        }
    }
    static List<Item> build(CashBill bill, JSONObject settings, JSONObject catalog) throws Exception {
        Map<String, Item> grouped = new LinkedHashMap<>();
        for (CashBill.Line line : bill.lines) {
            try {
                List<CashMappings.Part> parts = CashMappings.resolve(line.name, settings);
                if (CashMappings.total(parts, catalog) != line.kopecks)
                    throw new IllegalStateException("Цена кассы не совпадает с ценой этой позиции. Исправьте соответствие на сайте.");
                for (CashMappings.Part part : parts) {
                    Item item = grouped.get(part.uuid);
                    if (item == null) { item = new Item(part.uuid, catalog.getJSONObject("items").getJSONObject(part.uuid)); grouped.put(part.uuid, item); }
                    item.quantity = Math.addExact(item.quantity, Math.multiplyExact(line.quantity, part.units));
                    item.estimated |= line.estimated; item.sourceNames.add(line.name);
                }
            } catch (Exception e) { throw new IllegalStateException("«" + line.name + "»: " + e.getMessage(), e); }
        }
        List<Item> result = new ArrayList<>(); long total = 0;
        for (Item item : grouped.values()) {
            int remaining = item.quantity;
            while (remaining > 0) {
                if (result.size() >= 200) throw new IllegalStateException("В чеке больше 200 позиций.");
                JSONObject card = catalog.getJSONObject("items").getJSONObject(item.uuid);
                Item chunk = new Item(item.uuid, card); chunk.quantity = Math.min(100, remaining);
                chunk.sourceNames.addAll(item.sourceNames); chunk.estimated = item.estimated;
                result.add(chunk); remaining -= chunk.quantity;
                total = Math.addExact(total, Math.multiplyExact(chunk.priceKopecks, chunk.quantity));
            }
        }
        if (total != bill.total) throw new IllegalStateException("Итог кассовых позиций не совпадает со счётом сайта.");
        return result;
    }
}
