package ru.lounge1708.evotorbridge;

import static org.junit.Assert.*;
import org.json.JSONObject;
import org.junit.Test;

public class ReceiptRecoveryTest {
    private JSONObject opened() throws Exception {
        return new JSONObject().put("id", "bill").put("state", "opened").put("nonce", "attempt-1")
                .put("receiptUuid", "receipt-1").put("digest", "digest-1").put("createdAt", 1000);
    }
    @Test public void onlyEmptyUnpaidNonFiscalReceiptsCanBeRecovered() {
        ReceiptRecovery.requireCleared(null, 0, 0, 0);
        assertThrows(IllegalStateException.class, () -> ReceiptRecovery.requireCleared(null, 1, 0, 0));
        assertThrows(IllegalStateException.class, () -> ReceiptRecovery.requireCleared(null, 0, 1, 0));
        assertThrows(IllegalStateException.class, () -> ReceiptRecovery.requireCleared(null, 0, 0, 1));
        assertThrows(IllegalStateException.class, () -> ReceiptRecovery.requireCleared("123", 0, 0, 0));
    }
    @Test public void recoveryRetainsHistoryAndDoesNotRefreshTheOldSnapshot() throws Exception {
        JSONObject old = opened(), restored = ReceiptRecovery.requeue(old, old, 5000);
        assertEquals("cleared", restored.getString("state")); assertTrue(restored.getBoolean("needsRefresh"));
        assertEquals(1000, restored.getLong("createdAt")); assertFalse(restored.has("nonce")); assertFalse(restored.has("receiptUuid"));
        assertTrue(ReceiptRecovery.wasCleared(old, restored)); assertEquals(1, restored.getJSONArray("clearedAttempts").length());
        assertNull(ReceiptRecovery.requeue(restored, old, 6000));
        assertEquals("opened", old.getString("state"));
    }
    @Test public void unknownWrongTerminalAndChangedAttemptStayBlocked() throws Exception {
        JSONObject old = opened();
        assertThrows(IllegalStateException.class, () -> ReceiptRecovery.requireLocalMatch(null, old));
        assertThrows(IllegalStateException.class, () -> ReceiptRecovery.requireLocalMatch(new JSONObject(old.toString()).put("state", "unknown"), old));
        assertThrows(IllegalStateException.class, () -> ReceiptRecovery.requireLocalMatch(new JSONObject(old.toString()).put("receiptUuid", "another-receipt"), old));
        assertThrows(IllegalStateException.class, () -> ReceiptRecovery.requeue(new JSONObject(old.toString()).put("nonce", "attempt-2"), old, 2000));
        assertThrows(IllegalStateException.class, () -> ReceiptRecovery.requeue(new JSONObject(old.toString()).put("state", "unknown"), old, 2000));
    }
    @Test public void lateCallbacksCannotOverwriteClearedOrNewAttempts() throws Exception {
        JSONObject old = opened();
        assertFalse(ReceiptRecovery.acceptsResult(old, old));
        assertFalse(ReceiptRecovery.acceptsResult(new JSONObject(old.toString()).put("state", "cleared"), old));
        assertFalse(ReceiptRecovery.acceptsResult(new JSONObject(old.toString()).put("state", "rejected"), old));
        assertFalse(ReceiptRecovery.acceptsResult(new JSONObject(old.toString()).put("state", "opening").put("nonce", "attempt-2"), old));
        assertTrue(ReceiptRecovery.acceptsResult(new JSONObject(old.toString()).put("state", "unknown"), old));
        assertFalse(ReceiptRecovery.acceptsResult(null, old));
    }
    @Test public void postponedContextSurvivesAResetAcknowledgementLossButNotAnotherAttempt() throws Exception {
        JSONObject old = opened(), postponed = ReceiptRecovery.requeue(old, old, 5000, "postponed");
        assertTrue(ReceiptRecovery.wasPostponed(old, postponed)); ReceiptRecovery.requireResumeContext(old, postponed);
        JSONObject localCleared = new JSONObject(old.toString()).put("state", "cleared");
        ReceiptRecovery.requireResumeContext(localCleared, postponed);
        assertThrows(IllegalStateException.class, () -> ReceiptRecovery.requireResumeContext(new JSONObject(old.toString()).put("nonce", "other"), postponed));
        assertThrows(IllegalStateException.class, () -> ReceiptRecovery.requireResumeContext(old, new JSONObject(postponed.toString()).put("state", "opening")));
        assertFalse(ReceiptRecovery.wasPostponed(old, ReceiptRecovery.requeue(old, old, 5000)));
    }
}
