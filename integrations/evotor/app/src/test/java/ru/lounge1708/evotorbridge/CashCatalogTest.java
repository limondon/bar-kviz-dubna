package ru.lounge1708.evotorbridge;

import android.database.Cursor;
import java.lang.reflect.Proxy;
import java.math.BigDecimal;
import org.junit.Test;
import static org.junit.Assert.*;
import ru.evotor.framework.CursorExtKt;
import ru.evotor.framework.inventory.ProductTable;

public class CashCatalogTest {
    private Cursor row(String raw) {
        return (Cursor) Proxy.newProxyInstance(Cursor.class.getClassLoader(), new Class<?>[]{Cursor.class}, (proxy, method, args) -> {
            switch (method.getName()) {
                case "getColumnIndex": case "getColumnIndexOrThrow": return 0;
                case "getString": return raw;
                case "getLong": return Long.parseLong(raw);
                default: throw new AssertionError("Unexpected cursor read: " + method.getName());
            }
        });
    }
    @Test public void exportsRawMinorUnitsAndAgreesWithOfficialSdkMoneyReader() {
        for (long value : new long[]{0,1,5000,25000,54900,12345}) {
            Cursor cursor=row(Long.toString(value));
            assertEquals(value,CashCatalog.priceKopecks(cursor));
            BigDecimal sdkRubles=CursorExtKt.getMoney(cursor,ProductTable.ROW_PRICE_OUT);
            assertEquals(sdkRubles.movePointRight(2).longValueExact(),CashCatalog.priceKopecks(cursor));
        }
        assertEquals(0,new BigDecimal("250").compareTo(BigDecimal.valueOf(CashCatalog.priceKopecks(row("25000")),2)));
    }
    @Test public void rejectsMissingNegativeFractionalAndOverflowPrices() {
        for(String raw:new String[]{null,"-1","25000.5","wrong","9223372036854775808"})
            assertThrows(RuntimeException.class,()->CashCatalog.priceKopecks(row(raw)));
    }
}
