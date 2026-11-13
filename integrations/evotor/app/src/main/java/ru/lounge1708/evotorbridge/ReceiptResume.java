package ru.lounge1708.evotorbridge;

/** Classifies the original draft separately from the terminal's current draft. */
final class ReceiptResume {
    enum State { ACTIVE, POSTPONED, OTHER_ACTIVE, PAYMENT }
    static State classify(String originalUuid, int originalPayments, int fiscalDocuments,
                          String currentUuid, int currentPositions, int currentPayments) {
        if (originalUuid == null || originalUuid.isEmpty() || originalPayments < 0 || fiscalDocuments < 0
                || currentPositions < 0 || currentPayments < 0)
            throw new IllegalStateException("Не удалось подтвердить состояние счёта. Продолжение заблокировано.");
        boolean same = originalUuid.equals(currentUuid);
        if (originalPayments > 0 || fiscalDocuments > 0 || (same && currentPayments > 0)) return State.PAYMENT;
        if (same && currentPositions > 0) return State.ACTIVE;
        if (currentUuid != null && !currentUuid.isEmpty() && !same && (currentPositions > 0 || currentPayments > 0)) return State.OTHER_ACTIVE;
        return State.POSTPONED;
    }
    static void requirePostponed(State state) {
        if (state == State.PAYMENT) throw new IllegalStateException("По прежнему чеку есть оплата или фискальный документ. Создавать его заново нельзя.");
        if (state == State.ACTIVE) throw new IllegalStateException("Этот счёт уже открыт на кассе. Нажмите «Продолжить счёт», чтобы вернуться к нему.");
        if (state == State.OTHER_ACTIVE) throw new IllegalStateException("На кассе сейчас другой заполненный чек. Сначала завершите работу с ним или отложите его.");
    }
}
