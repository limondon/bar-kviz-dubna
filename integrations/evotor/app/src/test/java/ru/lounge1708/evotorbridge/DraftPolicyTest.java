package ru.lounge1708.evotorbridge;

import static org.junit.Assert.*;
import java.math.BigDecimal;
import org.junit.Test;

public class DraftPolicyTest {
    @Test public void acceptsWholeQuantitiesAndBounds() {
        assertEquals(new BigDecimal("3"), DraftPolicy.quantity(" 3 "));
        assertEquals(new BigDecimal("100"), DraftPolicy.quantity("100"));
    }
    @Test public void rejectsInvalidOrUnboundedQuantities() {
        for (String input : new String[]{null, "", "0", "-1", "101", "9999", "1.5", "1,5", "1e2"}) {
            try { DraftPolicy.quantity(input); fail("Accepted " + input); }
            catch (IllegalArgumentException expected) { /* Expected. */ }
        }
    }
    @Test public void neverDowngradesUnknownOrMarkedGoods() {
        assertTrue(DraftPolicy.supportsType("ALCOHOL_NOT_MARKED"));
        assertTrue(DraftPolicy.supportsType("NORMAL"));
        for (String type : new String[]{null, "BEER_MARKED", "ALCOHOL_MARKED", "WATER_MARKED", "FUTURE_TYPE"}) {
            assertFalse(DraftPolicy.supportsType(type));
        }
    }
    @Test public void requiresPosWithExistingReceiptProtection() {
        assertTrue(DraftPolicy.supportsPosVersion("8.25.1.1-865"));
        assertTrue(DraftPolicy.supportsPosVersion("8.11.0"));
        assertFalse(DraftPolicy.supportsPosVersion("8.10.9"));
        assertFalse(DraftPolicy.supportsPosVersion("unknown"));
        assertFalse(DraftPolicy.supportsPosVersion(null));
    }
}
