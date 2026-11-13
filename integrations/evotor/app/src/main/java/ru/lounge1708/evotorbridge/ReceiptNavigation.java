package ru.lounge1708.evotorbridge;

final class ReceiptNavigation {
    static void requireEditable(String uuid, int positions, int payments, String expectedUuid) {
        if (uuid == null || uuid.isEmpty() || (positions == 0 && payments == 0))
            throw new IllegalStateException("Сейчас заполненного текущего чека нет. Сохранённые счета остаются в списке столов этого приложения. Продолжить можно неоплаченный счёт; новый пустой чек для этого не нужен.");
        if (expectedUuid != null && !expectedUuid.equals(uuid))
            throw new IllegalStateException("Сейчас на кассе открыт другой чек. Он не будет подменён. Вернитесь в список счетов и проверьте нужный счёт отдельно.");
    }
}
