package ru.lounge1708.evotorbridge;

final class ReceiptNavigation {
    static void requireEditable(String uuid, int positions, int payments, String expectedUuid) {
        if (uuid == null || uuid.isEmpty() || (positions == 0 && payments == 0))
            throw new IllegalStateException("Заполненного текущего чека нет. Пустое окно продажи не восстанавливает удалённые товары. Вернитесь в список, нажмите ранее открытый счёт и выберите возврат очищенного счёта.");
        if (expectedUuid != null && !expectedUuid.equals(uuid))
            throw new IllegalStateException("Сейчас на кассе открыт другой чек. Он не будет подменён. Вернитесь в список счетов и проверьте нужный счёт отдельно.");
    }
}
