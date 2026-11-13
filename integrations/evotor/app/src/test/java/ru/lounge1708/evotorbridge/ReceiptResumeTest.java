package ru.lounge1708.evotorbridge;

import static org.junit.Assert.*;
import org.junit.Test;

public class ReceiptResumeTest {
    @Test public void activeOriginalIsContinuedRatherThanCreatedAgain() {
        assertEquals(ReceiptResume.State.ACTIVE, ReceiptResume.classify("first", 0, 0, "first", 4, 0));
        assertThrows(IllegalStateException.class, () -> ReceiptResume.requirePostponed(ReceiptResume.State.ACTIVE));
    }
    @Test public void firstUnpaidBillCanResumeAfterAnotherTablesReceiptWasFinished() {
        assertEquals(ReceiptResume.State.POSTPONED, ReceiptResume.classify("first", 0, 0, "new-empty", 0, 0));
        assertEquals(ReceiptResume.State.POSTPONED, ReceiptResume.classify("first", 0, 0, null, 0, 0));
        ReceiptResume.requirePostponed(ReceiptResume.State.POSTPONED);
    }
    @Test public void anotherActiveReceiptOrItsPaymentsAreNeverReplaced() {
        assertEquals(ReceiptResume.State.OTHER_ACTIVE, ReceiptResume.classify("first", 0, 0, "second", 3, 0));
        assertEquals(ReceiptResume.State.OTHER_ACTIVE, ReceiptResume.classify("first", 0, 0, "second", 0, 1));
        assertThrows(IllegalStateException.class, () -> ReceiptResume.requirePostponed(ReceiptResume.State.OTHER_ACTIVE));
    }
    @Test public void paidFiscalizedAndPartiallyPaidOriginalsCannotBeRecreated() {
        assertEquals(ReceiptResume.State.PAYMENT, ReceiptResume.classify("first", 1, 0, null, 0, 0));
        assertEquals(ReceiptResume.State.PAYMENT, ReceiptResume.classify("first", 0, 1, null, 0, 0));
        assertEquals(ReceiptResume.State.PAYMENT, ReceiptResume.classify("first", 0, 0, "first", 4, 1));
        assertThrows(IllegalStateException.class, () -> ReceiptResume.requirePostponed(ReceiptResume.State.PAYMENT));
    }
    @Test public void incompleteEvidenceDoesNotBecomeAnUnpaidReceipt() {
        assertThrows(IllegalStateException.class, () -> ReceiptResume.classify("", 0, 0, null, 0, 0));
        assertThrows(IllegalStateException.class, () -> ReceiptResume.classify("first", 0, -1, null, 0, 0));
    }
}
