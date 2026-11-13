package ru.lounge1708.evotorbridge;

import static org.junit.Assert.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.io.IOException;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class CashBridgeTest {
    private static JSONObject fixture() throws Exception {
        JSONObject result = new JSONObject(new String(Files.readAllBytes(Paths.get(System.getProperty("cash.fixture"))), StandardCharsets.UTF_8));
        result.put("createdAt", System.currentTimeMillis()); return result;
    }
    private static CashBill bill(JSONObject record) throws Exception { return new CashBill(record, record.getString("id"), record.getString("date")); }
    private static JSONObject renamed(JSONObject record, String table) throws Exception {
        JSONObject next = new JSONObject(record.toString()); JSONArray canonical = new JSONArray(next.getString("canonical")); canonical.put(2, table);
        next.put("table", table).put("id", CashBill.hash(next.getString("date") + "\u001f" + table + "\u001f" + next.getString("sid")))
                .put("canonical", canonical.toString()).put("digest", CashBill.hash(canonical.toString())); return next;
    }
    private static final class Backend implements BridgeClient.Transport {
        JSONObject day = new JSONObject(); long version = 1; int writes; boolean race, loseAck;
        Backend(JSONObject record) throws Exception { day.put(record.getString("id"), record); }
        @Override public BridgeClient.Document call(String url, String method, String body, String etag, boolean getEtag, String contentType) throws Exception {
            if (url.startsWith("https://identitytoolkit.googleapis.com/")) return new BridgeClient.Document(new JSONObject().put("idToken", "test-token").put("refreshToken", "test-refresh").put("expiresIn", 3600), null);
            String recordId = url.substring(url.lastIndexOf('/') + 1, url.indexOf(".json"));
            boolean wholeDay = recordId.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}");
            if ("GET".equals(method)) return new BridgeClient.Document(new JSONObject((wholeDay ? day : day.getJSONObject(recordId)).toString()), "version-" + version);
            if (!"PUT".equals(method)) throw new AssertionError("Unexpected method");
            writes++;
            if (race) { race = false; version++; }
            if (!("version-" + version).equals(etag)) throw new IllegalStateException("Conflict");
            JSONObject next = new JSONObject(body); if (wholeDay) day = next; else day.put(recordId, next); version++;
            if (loseAck) { loseAck = false; throw new IOException("Lost acknowledgement"); }
            return new BridgeClient.Document(next, "version-" + version);
        }
    }
    private static BridgeClient connected(Backend backend) throws Exception {
        BridgeClient client = new BridgeClient(backend); client.login("manager@1708.local", "test-only"); return client;
    }
    @Test public void realJavascriptFixtureHasSameUtf8DigestAmountsAndRows() throws Exception {
        CashBill bill = bill(fixture()); assertEquals(80025, bill.total); assertEquals(2, bill.lines.size());
        assertEquals("Чай «Облепиха» + лимон", bill.lines.get(0).name); assertEquals(2, bill.lines.get(0).quantity);
        assertEquals("water", bill.lines.get(1).productId); assertEquals("100.25", bill.lines.get(1).price().toPlainString());
    }
    @Test public void corruptionAndDuplicateRowsAreRejected() throws Exception {
        JSONObject record = fixture(); record.put("canonical", record.getString("canonical") + " ");
        JSONObject damaged = record; assertThrows(IllegalArgumentException.class, () -> bill(damaged));
        record = fixture(); JSONArray data = new JSONArray(record.getString("canonical")), rows = data.getJSONArray(4); rows.put(rows.get(0));
        record.put("canonical", data.toString()).put("digest", CashBill.hash(data.toString()));
        JSONObject duplicate = record; assertThrows(IllegalArgumentException.class, () -> bill(duplicate));
    }
    @Test public void onlyOneTerminalCanClaimEvenAfterLosingAcknowledgement() throws Exception {
        JSONObject record = fixture(); Backend backend = new Backend(record); BridgeClient first = connected(backend), second = connected(backend); CashBill bill = bill(record);
        backend.loseAck = true; assertThrows(IOException.class, () -> first.claim(bill, "first"));
        assertEquals("opening", backend.day.getJSONObject(bill.id).getString("state"));
        assertThrows(IllegalStateException.class, () -> second.claim(bill, "second")); assertEquals(1, backend.writes);
    }
    @Test public void conditionalWriteConflictNeverClaimsTheReceipt() throws Exception {
        JSONObject record = fixture(); Backend backend = new Backend(record); BridgeClient client = connected(backend); backend.race = true;
        assertThrows(IllegalStateException.class, () -> client.claim(bill(record), "first"));
        assertEquals("queued", backend.day.getJSONObject(record.getString("id")).getString("state"));
    }
    @Test public void renameCannotReplayTheSameOrderRows() throws Exception {
        JSONObject original = fixture(); Backend backend = new Backend(original); BridgeClient client = connected(backend);
        client.claim(bill(original), "first"); JSONObject next = renamed(original, "2");
        JSONArray changed = new JSONArray(next.getString("canonical"));
        changed.getJSONArray(4).getJSONArray(0).put(1, "regenerated-line-1");
        changed.getJSONArray(4).getJSONArray(1).put(1, "regenerated-line-2");
        next.put("canonical", changed.toString()).put("digest", CashBill.hash(changed.toString())); backend.day.put(next.getString("id"), next);
        assertThrows(IllegalStateException.class, () -> client.claim(bill(next), "second")); assertEquals(1, backend.writes);
    }
    @Test public void unknownCanBecomeOpenedButLateUnknownCannotOverwriteOpened() throws Exception {
        JSONObject original = fixture(); CashBill bill = bill(original); Backend backend = new Backend(original); BridgeClient client = connected(backend); client.claim(bill, "first");
        JSONObject ack = new JSONObject().put("id", bill.id).put("date", bill.date).put("digest", bill.digest).put("nonce", "wrong").put("state", "opened");
        client.report(ack); assertEquals("opening", backend.day.getJSONObject(bill.id).getString("state"));
        ack.put("nonce", "first").put("state", "unknown"); client.report(ack);
        ack.put("state", "opened").put("receiptUuid", "receipt-1"); client.report(ack);
        ack.put("state", "unknown"); client.report(ack);
        assertEquals("opened", backend.day.getJSONObject(bill.id).getString("state")); assertEquals("receipt-1", backend.day.getJSONObject(bill.id).getString("receiptUuid"));
    }
    @Test public void staleSnapshotAndLogoutBlockFurtherRequests() throws Exception {
        JSONObject record = fixture().put("createdAt", System.currentTimeMillis() - CashBill.MAX_AGE - 1000); Backend backend = new Backend(record); BridgeClient client = connected(backend);
        assertThrows(IllegalStateException.class, () -> client.claim(bill(record), "one")); assertEquals(0, backend.writes);
        client.logout(); assertThrows(IllegalStateException.class, () -> client.get("config/evotor/v1/transfers/2026-11-12"));
    }
    @Test public void visibleFreshnessCheckUsesTheSameBoundariesAsOpening() throws Exception {
        long now = System.currentTimeMillis(); JSONObject record = fixture().put("createdAt", now - CashBill.MAX_AGE);
        assertTrue(bill(record).isFresh(now)); bill(record).requireFresh(now);
        record.put("createdAt", now - CashBill.MAX_AGE - 1); assertFalse(bill(record).isFresh(now));
        record.put("createdAt", now + 60000); assertTrue(bill(record).isFresh(now));
        record.put("createdAt", now + 60001); assertFalse(bill(record).isFresh(now));
    }
    @Test public void clearedRecoveryIsConditionalAndIdempotentAfterLostAcknowledgement() throws Exception {
        JSONObject original = fixture().put("state", "opened").put("nonce", "first").put("receiptUuid", "receipt-1");
        Backend backend = new Backend(original); BridgeClient client = connected(backend); CashBill shown = bill(original);
        backend.loseAck = true; assertThrows(IOException.class, () -> client.requeueCleared(shown));
        assertEquals("cleared", backend.day.getJSONObject(shown.id).getString("state"));
        client.requeueCleared(shown); assertEquals(1, backend.writes);
        assertThrows(IllegalStateException.class, () -> client.claim(bill(backend.day.getJSONObject(shown.id)), "second"));
        assertEquals(1, backend.writes);
        JSONObject oldAck = new JSONObject().put("id", shown.id).put("date", shown.date).put("digest", shown.digest)
                .put("nonce", "first").put("state", "opened").put("receiptUuid", "receipt-1");
        client.report(oldAck); assertEquals("cleared", backend.day.getJSONObject(shown.id).getString("state"));
    }
    @Test public void recoveryConflictDoesNotUnlockOrModifyTheOriginalReceipt() throws Exception {
        JSONObject original = fixture().put("state", "opened").put("nonce", "first").put("receiptUuid", "receipt-1");
        Backend backend = new Backend(original); BridgeClient client = connected(backend); backend.race = true;
        assertThrows(IllegalStateException.class, () -> client.requeueCleared(bill(original)));
        assertEquals("opened", backend.day.getJSONObject(original.getString("id")).getString("state"));
        assertFalse(backend.day.getJSONObject(original.getString("id")).has("clearedAttempts"));
    }
    @Test public void oldPostponedSnapshotCanBeRefreshedOnceButLateOriginalAckCannotReplaceNewOpening() throws Exception {
        JSONObject original = fixture().put("state", "opened").put("nonce", "first").put("receiptUuid", "receipt-1")
                .put("createdAt", System.currentTimeMillis() - 3600000);
        Backend backend = new Backend(original); BridgeClient client = connected(backend); CashBill shown = bill(original);
        client.requeuePostponed(shown); assertEquals("cleared", backend.day.getJSONObject(shown.id).getString("state"));
        CashBill fresh = client.refreshPostponed(shown, original); fresh.requireFresh(System.currentTimeMillis());
        assertEquals(shown.record.getString("canonical"), fresh.record.getString("canonical"));
        assertEquals(shown.digest, fresh.digest); assertTrue(ReceiptRecovery.wasPostponed(original, fresh.record));
        assertFalse(fresh.record.has("needsRefresh")); assertEquals(2, backend.writes);
        client.claim(fresh, "second");
        assertThrows(IllegalStateException.class, () -> client.refreshPostponed(shown, original));
        JSONObject ack = new JSONObject().put("id", shown.id).put("date", shown.date).put("digest", shown.digest).put("nonce", "first")
                .put("receiptUuid", "receipt-1").put("state", "opened"); client.report(ack);
        assertEquals("second", backend.day.getJSONObject(shown.id).getString("nonce"));
        assertEquals("opening", backend.day.getJSONObject(shown.id).getString("state"));
    }
    @Test public void refreshPostponedIsIdempotentAfterLostAckAndConditionalOnTheServerVersion() throws Exception {
        JSONObject original = fixture().put("state", "opened").put("nonce", "first").put("receiptUuid", "receipt-1");
        Backend backend = new Backend(original); BridgeClient client = connected(backend); CashBill shown = bill(original); client.requeuePostponed(shown);
        backend.race = true; assertThrows(IllegalStateException.class, () -> client.refreshPostponed(shown, original));
        assertEquals("cleared", backend.day.getJSONObject(shown.id).getString("state"));
        backend.loseAck = true; assertThrows(IOException.class, () -> client.refreshPostponed(shown, original));
        int writes = backend.writes; assertEquals("queued", client.refreshPostponed(shown, original).record.getString("state"));
        assertEquals(writes, backend.writes);
        assertThrows(IllegalStateException.class, () -> client.refreshPostponed(shown, new JSONObject(original.toString()).put("receiptUuid", "wrong")));
    }
    @Test public void nativeResumeRequiresStoredUnchangedPricesRatherThanGuessingFromOldMenu() throws Exception {
        JSONObject record = fixture(); JSONArray canonical = new JSONArray(record.getString("canonical"));
        for (int i = 0; i < canonical.getJSONArray(4).length(); i++) canonical.getJSONArray(4).getJSONArray(i).put(6, false);
        record.put("canonical", canonical.toString()).put("digest", CashBill.hash(canonical.toString()));
        CashBill bill = bill(record); JSONObject orders = sourceOrders(bill); bill.verifyOrders(orders); bill.requireStoredPricesForResume(orders);
        orders.getJSONObject("order-1").getJSONObject("items").getJSONObject("line-1").remove("price");
        assertThrows(IllegalStateException.class, () -> bill.requireStoredPricesForResume(orders));
        canonical.getJSONArray(4).getJSONArray(0).put(6, true);
        record.put("canonical", canonical.toString()).put("digest", CashBill.hash(canonical.toString())); CashBill estimated = bill(record);
        assertThrows(IllegalStateException.class, () -> estimated.requireStoredPricesForResume(sourceOrders(estimated)));
    }
    private static JSONObject sourceOrders(CashBill bill) throws Exception {
        JSONObject items = new JSONObject();
        for (CashBill.Line line : bill.lines) items.put(line.itemId, new JSONObject().put("name", line.name).put("qty", line.quantity).put("price", line.price()).put("menuItemId", line.productId));
        items.put("cups", new JSONObject().put("name", "2 кружки").put("qty", 1));
        items.put("cups5", new JSONObject().put("name", "5 кружек").put("qty", 1));
        items.put("cups12", new JSONObject().put("name", "12 кружек").put("qty", 1));
        return new JSONObject().put("order-1", new JSONObject().put("table", bill.table).put("date", bill.date).put("sid", bill.sid).put("status", "done").put("items", items));
    }
    @Test public void liveSourcesRejectAdditionalOrdersEditsAndDeletionButIgnorePreparationStatus() throws Exception {
        CashBill bill = bill(fixture()); JSONObject source = sourceOrders(bill); bill.verifyOrders(source);
        source.getJSONObject("order-1").put("status", "making"); bill.verifyOrders(source);
        JSONObject extra = new JSONObject(source.getJSONObject("order-1").toString()); source.put("order-2", extra);
        assertThrows(IllegalStateException.class, () -> bill.verifyOrders(source)); source.remove("order-2");
        source.getJSONObject("order-1").getJSONObject("items").getJSONObject("line-1").put("qty", 3);
        assertThrows(IllegalStateException.class, () -> bill.verifyOrders(source));
        source.getJSONObject("order-1").getJSONObject("items").getJSONObject("line-1").put("qty", 2).put("price", 351);
        assertThrows(IllegalStateException.class, () -> bill.verifyOrders(source));
        source.remove("order-1"); assertThrows(IllegalStateException.class, () -> bill.verifyOrders(source));
    }
}
