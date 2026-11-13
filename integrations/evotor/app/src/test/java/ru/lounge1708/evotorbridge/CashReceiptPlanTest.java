package ru.lounge1708.evotorbridge;

import static org.junit.Assert.*;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class CashReceiptPlanTest {
    private JSONArray row(String id, String name, int quantity, long price, boolean estimated) throws Exception {
        return new JSONArray().put("order-" + id).put("item-" + id).put("product-" + id).put(name).put(quantity).put(price).put(estimated);
    }
    private CashBill bill(JSONArray rows) throws Exception {
        String date = "2026-11-13", table = "1", sid = "visit";
        String id = CashBill.hash(date + "\u001f" + table + "\u001f" + sid);
        String wire = new JSONArray().put(1).put(date).put(table).put(sid).put(rows).toString();
        return new CashBill(new JSONObject().put("schema", 1).put("date", date).put("table", table).put("sid", sid).put("id", id)
                .put("canonical", wire).put("digest", CashBill.hash(wire)).put("state", "queued").put("createdAt", System.currentTimeMillis()), id, date);
    }
    private JSONObject settings = new JSONObject(), products = new JSONObject(), items = new JSONObject();
    private void mapping(String name, String uuid, String cashName, long price) throws Exception {
        JSONObject part = new JSONObject().put("uuid", uuid).put("units", 1).put("fingerprint", uuid + "-v1");
        products.put(CashMappings.key(name, false), new JSONObject().put("name", name).put("parts", new JSONArray().put(part)));
        items.put(uuid, new JSONObject().put("name", cashName).put("priceKopecks", price).put("fingerprint", uuid + "-v1").put("supported", true));
        settings.put("schema", 1).put("products", products);
    }
    private List<CashReceiptPlan.Item> plan(CashBill bill) throws Exception { return CashReceiptPlan.build(bill, settings, new JSONObject().put("items", items)); }

    @Test public void sixSourceRowsProduceFourCashPositionsWithHoegaardenFour() throws Exception {
        mapping("Чипсы", "chips", "Чипсы Lays", 25000); mapping("Hoegarden", "beer", "Hoegarden", 25000);
        mapping("Fanta", "fanta", "Fanta ж/б", 25000); mapping("Stella", "stella", "Stella Artois", 25000);
        CashBill bill = bill(new JSONArray().put(row("1", "Чипсы", 2, 25000, false)).put(row("2", "Hoegarden", 2, 25000, false))
                .put(row("3", "Fanta", 1, 25000, false)).put(row("4", "Stella", 1, 25000, false))
                .put(row("5", "Hoegarden", 2, 25000, true)).put(row("6", "Stella", 1, 25000, true)));
        String digest = bill.digest, canonical = bill.record.getString("canonical"); List<CashReceiptPlan.Item> plan = plan(bill);
        assertEquals(4, plan.size()); assertEquals("beer", plan.get(1).uuid); assertEquals(4, plan.get(1).quantity);
        assertTrue(plan.get(1).estimated); assertEquals(2, plan.get(3).quantity); assertEquals(225000, bill.total);
        assertEquals(6, bill.lines.size()); assertEquals(digest, bill.digest); assertEquals(canonical, bill.record.getString("canonical"));
    }
    @Test public void equalNamesWithDifferentCashUuidsRemainSeparate() throws Exception {
        mapping("Вода 1", "water-1", "Вода", 10000); mapping("Вода 2", "water-2", "Вода", 15000);
        List<CashReceiptPlan.Item> plan = plan(bill(new JSONArray().put(row("1", "Вода 1", 1, 10000, false)).put(row("2", "Вода 2", 1, 15000, false))));
        assertEquals(2, plan.size()); assertNotEquals(plan.get(0).uuid, plan.get(1).uuid);
    }
    @Test public void teaAndAdditionsAggregateWithoutLosingUnits() throws Exception {
        mapping("Сенча", "tea", "чай 1л", 50000); mapping("лимон", "lemon", "Добавка лимон", 5000);
        JSONObject lemonRule = products.getJSONObject(CashMappings.key("лимон", false)); products.remove(CashMappings.key("лимон", false));
        settings.put("addons", new JSONObject().put(CashMappings.key("лимон", true), lemonRule));
        List<CashReceiptPlan.Item> plan = plan(bill(new JSONArray().put(row("1", "Сенча + лимон", 2, 55000, false)).put(row("2", "Сенча", 1, 50000, false))));
        assertEquals(2, plan.size()); assertEquals("tea", plan.get(0).uuid); assertEquals(3, plan.get(0).quantity); assertEquals(2, plan.get(1).quantity);
    }
    @Test public void aggregationCannotHidePriceOrFingerprintMismatch() throws Exception {
        mapping("Пиво", "beer", "Пиво", 25000);
        CashBill wrongPrice = bill(new JSONArray().put(row("1", "Пиво", 2, 25000, false)).put(row("2", "Пиво", 2, 20000, false)));
        assertThrows(IllegalStateException.class, () -> plan(wrongPrice));
        items.getJSONObject("beer").put("fingerprint", "changed");
        assertThrows(IllegalStateException.class, () -> plan(bill(new JSONArray().put(row("1", "Пиво", 2, 25000, false)))));
    }
    @Test public void quantitiesOverOneHundredSplitWithoutLosingTheTotal() throws Exception {
        mapping("Пиво", "beer", "Пиво", 25000);
        CashBill bill = bill(new JSONArray().put(row("1", "Пиво", 100, 25000, false)).put(row("2", "Пиво", 1, 25000, false)));
        List<CashReceiptPlan.Item> plan = plan(bill); assertEquals(2, plan.size());
        assertEquals(100, plan.get(0).quantity); assertEquals(1, plan.get(1).quantity);
        assertEquals(bill.total, plan.get(0).quantity * plan.get(0).priceKopecks + plan.get(1).quantity * plan.get(1).priceKopecks);
    }
}
