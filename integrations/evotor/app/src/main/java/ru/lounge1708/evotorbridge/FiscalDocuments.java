package ru.lounge1708.evotorbridge;

import android.content.Context;
import ru.evotor.framework.receipt.ReceiptApi;

final class FiscalDocuments {
    static final String AUTHORITY = "ru.evotor.framework.document.fiscal";
    static int count(Context context, String uuid) throws Exception {
        CashBill.text(uuid);
        if (context.getPackageManager().resolveContentProvider(AUTHORITY, 0) == null)
            throw new IllegalStateException("Сервис фискальных документов не виден приложению. Обновите приложение кассы поверх установленного, затем откройте его снова. Если ошибка остаётся — откройте диагностику в настройках.");
        try (ru.evotor.query.Cursor<ru.evotor.framework.receipt.FiscalReceipt> cursor = ReceiptApi.getFiscalReceipts(context, uuid)) {
            return checkedCount(cursor == null ? null : cursor.getCount());
        }
    }
    static int checkedCount(Integer count) {
        if (count == null || count < 0)
            throw new IllegalStateException("Сервис кассы доступен, но не вернул список фискальных документов. Это не означает оплату. Нажмите «Обновить состояние»; повторное создание пока заблокировано.");
        return count;
    }
}
