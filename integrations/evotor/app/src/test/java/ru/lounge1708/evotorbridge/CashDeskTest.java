package ru.lounge1708.evotorbridge;

import static org.junit.Assert.*;
import java.time.Instant;
import java.util.Arrays;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class CashDeskTest {
    private final long now = Instant.parse("2026-11-13T22:00:00Z").toEpochMilli();
    private CashBill bill(String date, String table, String state, long created) throws Exception {
        String sid = "visit-1", id = CashBill.hash(date + "\u001f" + table + "\u001f" + sid);
        JSONArray rows = new JSONArray().put(new JSONArray().put("order-1").put("line-1").put("tea").put("Чай с мёдом").put(2).put(55000).put(false));
        String canonical = new JSONArray().put(1).put(date).put(table).put(sid).put(rows).toString();
        return new CashBill(new JSONObject().put("schema", 1).put("date", date).put("table", table).put("sid", sid).put("id", id)
                .put("canonical", canonical).put("digest", CashBill.hash(canonical)).put("state", state).put("createdAt", created), id, date);
    }
    @Test public void todayAndYesterdayFollowMoscowAcrossMidnightAndMonthBoundaries() {
        TimeZone before = TimeZone.getDefault();
        try {
            TimeZone.setDefault(TimeZone.getTimeZone("Pacific/Honolulu"));
            assertEquals(Arrays.asList("2026-11-14", "2026-11-13"), CashDesk.dates(null, now));
            long month = Instant.parse("2026-02-28T21:00:00Z").toEpochMilli();
            assertEquals(Arrays.asList("2026-03-01", "2026-02-28"), CashDesk.dates(null, month));
            assertEquals("Вчера", CashDesk.dayLabel("2026-11-13", now));
        } finally { TimeZone.setDefault(before); }
    }
    @Test public void explicitDateIsNotReplacedAndInvalidDatesAreRejected() {
        assertEquals(Arrays.asList("2026-11-12"), CashDesk.dates("2026-11-12", now));
        assertEquals("12.11.2026", CashDesk.dayLabel("2026-11-12", now));
        assertThrows(IllegalArgumentException.class, () -> CashDesk.dates("2026-02-30", now));
        assertThrows(IllegalArgumentException.class, () -> CashDesk.dates("2026-1-2", now));
    }
    @Test public void filtersSeparateFreshStaleSavedAndUnknownWithoutInferringPayment() throws Exception {
        CashBill fresh = bill("2026-11-14", "4", "queued", now);
        assertEquals(CashDesk.NEW, CashDesk.group(fresh, now));
        assertEquals(CashDesk.ATTENTION, CashDesk.group(fresh, now + CashBill.MAX_AGE + 1));
        fresh.record.put("needsRefresh", true); assertEquals(CashDesk.ATTENTION, CashDesk.group(fresh, now));
        CashBill opened = bill("2026-11-13", "4", "opened", now - 3600000);
        assertEquals(CashDesk.SAVED, CashDesk.group(opened, now)); assertTrue(CashDesk.state(opened, now).contains("проверить"));
        assertFalse(CashDesk.state(opened, now).contains("не оплачен"));
        opened.record.put("state", "cleared").put("recoveryKind", "postponed"); assertEquals(CashDesk.SAVED, CashDesk.group(opened, now));
        opened.record.put("state", "unknown"); assertEquals(CashDesk.ATTENTION, CashDesk.group(opened, now));
    }
    @Test public void searchFindsTableAndProductsInEitherDayAndDoesNotChangeSnapshot() throws Exception {
        CashBill older = bill("2026-11-13", "4", "opened", now - 3600000); String before = older.record.toString();
        assertTrue(CashDesk.matches(older, CashDesk.ALL, "стол 4", now));
        assertTrue(CashDesk.matches(older, CashDesk.SAVED, " МЕДОМ ", now));
        assertFalse(CashDesk.matches(older, CashDesk.NEW, "4", now));
        assertFalse(CashDesk.matches(older, CashDesk.ALL, "лимонад", now));
        assertEquals(before, older.record.toString());
    }
    @Test public void tableSortUsesNumbersAndKeepsSourceDatesAndVisitsSeparate() throws Exception {
        CashBill two = bill("2026-11-14", "2", "queued", now), ten = bill("2026-11-14", "10", "queued", now);
        CashBill yesterday = bill("2026-11-13", "1", "opened", now);
        assertTrue(CashDesk.compare(two, ten) < 0); assertTrue(CashDesk.compare(yesterday, ten) > 0);
        assertNotEquals(two.id, bill("2026-11-13", "2", "opened", now).id);
        assertEquals("1 100 ₽", CashDesk.money(two.total)); assertEquals("100,25 ₽", CashDesk.money(10025));
    }
}
