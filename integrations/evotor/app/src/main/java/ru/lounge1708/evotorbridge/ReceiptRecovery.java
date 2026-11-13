package ru.lounge1708.evotorbridge;

import org.json.JSONArray;
import org.json.JSONObject;

/** Recovery applies only to a known successful draft whose positions/payments were cleared. */
final class ReceiptRecovery {
    static void requireCleared(String number, int positions, int payments, int fiscalDocuments) {
        if (fiscalDocuments != 0 || (number != null && !number.trim().isEmpty()) || payments != 0)
            throw new IllegalStateException("У прежнего чека есть оплата, номер или фискальный документ. Повторное создание заблокировано.");
        if (positions != 0)
            throw new IllegalStateException("В прежнем чеке ещё есть товары. Продолжите этот чек через «Текущий чек кассы»; новый чек не создаётся.");
    }

    static void requireLocalMatch(JSONObject local, JSONObject record) {
        if (local == null || !("opened".equals(local.optString("state")) || "cleared".equals(local.optString("state")))
                || !sameAttempt(local, record))
            throw new IllegalStateException("На этой кассе нет подтверждения открытия данного чека. Вернитесь на кассу, где его открыли. Данные приложения удалять нельзя.");
    }

    private static boolean sameAttempt(JSONObject left, JSONObject right) {
        for (String key : new String[]{"nonce", "receiptUuid", "digest"})
            if (left.optString(key).isEmpty() || !left.optString(key).equals(right.optString(key))) return false;
        return true;
    }

    static boolean wasCleared(JSONObject local, JSONObject record) {
        if (local == null) return false;
        JSONArray history = record.optJSONArray("clearedAttempts");
        if (history == null) return false;
        for (int i = 0; i < history.length(); i++) {
            JSONObject previous = history.optJSONObject(i);
            if (previous != null && sameAttempt(local, previous)) return true;
        }
        return false;
    }

    static JSONObject requeue(JSONObject current, JSONObject expected, long now) throws Exception {
        if (("cleared".equals(current.optString("state")) || "queued".equals(current.optString("state"))) && wasCleared(expected, current)) return null;
        if (!"opened".equals(current.optString("state")) || !sameAttempt(current, expected)
                || !current.getString("id").equals(expected.getString("id")))
            throw new IllegalStateException("Передача уже изменилась. Обновите список; повторный сброс не выполняется.");
        JSONObject next = new JSONObject(current.toString());
        JSONArray history = next.optJSONArray("clearedAttempts");
        if (history == null) history = new JSONArray();
        history.put(new JSONObject().put("nonce", current.getString("nonce"))
                .put("receiptUuid", current.getString("receiptUuid")).put("digest", current.getString("digest"))
                .put("clearedAt", now));
        next.put("clearedAttempts", history).put("needsRefresh", true).put("state", "cleared");
        for (String key : new String[]{"nonce", "receiptUuid", "startedAt", "finishedAt"}) next.remove(key);
        // Keep the original timestamp: recovery never pretends the old source snapshot is fresh.
        return next;
    }

    static boolean acceptsResult(JSONObject saved, JSONObject attempt) {
        return saved != null && !saved.optString("nonce").isEmpty()
                && saved.optString("nonce").equals(attempt.optString("nonce"))
                && ("opening".equals(saved.optString("state")) || "unknown".equals(saved.optString("state")));
    }
}
