package ru.lounge1708.evotorbridge;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;

/** An app-scoped, non-secret terminal key. Never identify hardware by its model or catalog. */
final class TerminalIdentity {
    static String key(String androidId) throws Exception {
        if (androidId == null) return null;
        String value = androidId.trim().toLowerCase(Locale.ROOT);
        if (!value.matches("[0-9a-f]{16}") || value.equals("0000000000000000") || value.equals("9774d56d682e549c")) return null;
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(("ru.lounge1708.evotorbridge:android-id-v1:" + value).getBytes(StandardCharsets.UTF_8));
        StringBuilder result = new StringBuilder("android-");
        for (byte b : digest) result.append(String.format(Locale.ROOT, "%02x", b & 255));
        return result.toString();
    }
    static boolean validDeviceId(String value) { return value != null && value.matches("[a-zA-Z0-9-]{10,80}"); }
}
