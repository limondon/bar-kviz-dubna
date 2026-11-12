package ru.lounge1708.evotorbridge;

import java.math.BigDecimal;

/** The prototype never substitutes a generic type for an unknown or marked product. */
final class DraftPolicy {
    static BigDecimal quantity(String input) {
        if (input == null || !input.trim().matches("[0-9]{1,3}")) {
            throw new IllegalArgumentException("Введите целое количество от 1 до 100.");
        }
        int value = Integer.parseInt(input.trim());
        if (value < 1 || value > 100) throw new IllegalArgumentException("Количество должно быть от 1 до 100.");
        return BigDecimal.valueOf(value);
    }

    static boolean supportsType(String type) {
        return "NORMAL".equals(type) || "SERVICE".equals(type) || "ALCOHOL_NOT_MARKED".equals(type);
    }

    static boolean supportsPosVersion(String version) {
        if (version == null) return false;
        String[] parts = version.split("[.\\-]");
        try {
            int major = Integer.parseInt(parts[0]), minor = Integer.parseInt(parts[1]);
            return major > 8 || (major == 8 && minor >= 11);
        } catch (RuntimeException invalidVersion) { return false; }
    }
}
