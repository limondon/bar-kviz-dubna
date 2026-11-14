package ru.lounge1708.evotorbridge;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class SessionCipher {
    private static final byte[] AAD = "ru.lounge1708.evotorbridge/session-v1".getBytes(StandardCharsets.UTF_8);
    static byte[] seal(SecretKey key, String refreshToken) throws GeneralSecurityException {
        if (refreshToken == null || refreshToken.isEmpty() || refreshToken.length() > 16384) throw new GeneralSecurityException("Invalid session");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key); cipher.updateAAD(AAD);
        byte[] iv = cipher.getIV(), encrypted = cipher.doFinal(refreshToken.getBytes(StandardCharsets.UTF_8));
        return ByteBuffer.allocate(2 + iv.length + encrypted.length).put((byte) 1).put((byte) iv.length).put(iv).put(encrypted).array();
    }
    static String open(SecretKey key, byte[] sealed) throws GeneralSecurityException {
        if (sealed == null || sealed.length < 30 || sealed.length > 65536 || sealed[0] != 1 || sealed[1] != 12)
            throw new GeneralSecurityException("Invalid session envelope");
        ByteBuffer data = ByteBuffer.wrap(sealed); data.position(2); byte[] iv = new byte[12]; data.get(iv);
        byte[] encrypted = new byte[data.remaining()]; data.get(encrypted);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv)); cipher.updateAAD(AAD);
        String token = new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
        if (token.isEmpty() || token.length() > 16384) throw new GeneralSecurityException("Invalid session");
        return token;
    }
}
