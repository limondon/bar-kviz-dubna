package ru.lounge1708.evotorbridge;

import static org.junit.Assert.*;
import org.junit.Test;

public class ReceiptNavigationTest {
    @Test public void absentOrClearedReceiptCannotOpenAnEmptySalesScreen() {
        assertThrows(IllegalStateException.class, () -> ReceiptNavigation.requireEditable(null, 0, 0, null));
        assertThrows(IllegalStateException.class, () -> ReceiptNavigation.requireEditable("old", 0, 0, "old"));
    }
    @Test public void anotherTablesReceiptCannotBePresentedAsTheOriginal() {
        assertThrows(IllegalStateException.class, () -> ReceiptNavigation.requireEditable("another", 4, 0, "expected"));
    }
    @Test public void matchingFilledReceiptAndCurrentPaymentScreenRemainReachable() {
        ReceiptNavigation.requireEditable("expected", 4, 0, "expected");
        ReceiptNavigation.requireEditable("current", 0, 1, null);
    }
}
