package ru.lounge1708.evotorbridge;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.security.KeyStore;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;

/** Only an encrypted refresh token is persisted. Passwords and ID tokens never go to disk. */
final class SessionVault implements BridgeClient.SessionStore {
    private static final String ALIAS = "1708-cash-session-v1";
    private final SharedPreferences preferences;
    SessionVault(Context context) { preferences = context.getSharedPreferences("cash-session-v1", Context.MODE_PRIVATE); }
    private SecretKey key(boolean create) throws Exception {
        KeyStore keys = KeyStore.getInstance("AndroidKeyStore"); keys.load(null);
        if (keys.containsAlias(ALIAS)) return (SecretKey) keys.getKey(ALIAS, null);
        if (!create) throw new IllegalStateException("Сохранённый вход недоступен. Войдите один раз заново.");
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }
    @Override public String load() throws Exception {
        String sealed = preferences.getString("refresh", null); if (sealed == null) return null;
        try {
            return SessionCipher.open(key(false), Base64.decode(sealed, Base64.NO_WRAP));
        } catch (Exception e) { clear(); throw new IllegalStateException("Не удалось восстановить сохранённый вход. Введите пароль один раз заново."); }
    }
    @Override public void save(String refreshToken) throws Exception {
        String sealed = Base64.encodeToString(SessionCipher.seal(key(true), refreshToken), Base64.NO_WRAP);
        if (!preferences.edit().putString("refresh", sealed).commit()) throw new IllegalStateException("Не удалось сохранить вход на кассе. Повторите вход.");
    }
    @Override public void clear() throws Exception {
        if (!preferences.edit().remove("refresh").commit()) throw new IllegalStateException("Не удалось удалить сохранённый вход. Повторите выход из аккаунта.");
    }
}
