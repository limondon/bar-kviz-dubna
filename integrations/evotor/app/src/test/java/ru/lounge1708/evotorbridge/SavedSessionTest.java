package ru.lounge1708.evotorbridge;

import static org.junit.Assert.*;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.Arrays;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import org.json.JSONObject;
import org.junit.Test;

public class SavedSessionTest {
    private static final class Store implements BridgeClient.SessionStore {
        String saved; boolean failSave;
        public String load() { return saved; }
        public void save(String refresh) throws Exception { if (failSave) throw new IOException("Storage unavailable"); saved = refresh; }
        public void clear() { saved = null; }
    }
    private static final class Server implements BridgeClient.Transport {
        int logins, renewals, reads; Exception refreshError;
        public BridgeClient.Document call(String url, String method, String body, String etag, boolean getEtag, String contentType) throws Exception {
            if (url.startsWith("https://identitytoolkit.googleapis.com/")) {
                logins++; return new BridgeClient.Document(new JSONObject().put("idToken", "id-login").put("refreshToken", "refresh-login").put("expiresIn", 3600), null);
            }
            if (url.startsWith("https://securetoken.googleapis.com/")) {
                renewals++; assertEquals("POST", method); assertTrue(body.contains("refresh_token=refresh-"));
                assertFalse(body.contains("password")); if (refreshError != null) throw refreshError;
                return new BridgeClient.Document(new JSONObject().put("id_token", "id-renewed").put("refresh_token", "refresh-rotated-" + renewals).put("expires_in", "3600"), null);
            }
            assertEquals("GET", method); reads++; assertTrue(url.contains("auth=id-renewed"));
            return new BridgeClient.Document(new JSONObject(), "etag");
        }
    }
    @Test public void restartedClientRestoresAndRotatesTokenWithoutPassword() throws Exception {
        Store store = new Store(); Server server = new Server(); BridgeClient first = new BridgeClient(server, store);
        first.login("manager@1708.local", "password-only-in-request"); assertEquals("refresh-login", store.saved);
        BridgeClient restarted = new BridgeClient(server, store); assertTrue(restarted.restoreSession()); restarted.get("tables/example");
        assertEquals("refresh-rotated-1", store.saved); assertEquals(1, server.logins); assertEquals(1, server.reads);
        BridgeClient next = new BridgeClient(server, store); assertTrue(next.restoreSession()); assertEquals("refresh-rotated-2", store.saved);
    }
    @Test public void explicitLogoutRemovesSavedSessionAndBlocksNewRequests() throws Exception {
        Store store = new Store(); Server server = new Server(); BridgeClient client = new BridgeClient(server, store);
        client.login("manager@1708.local", "test"); client.logout(); assertNull(store.saved);
        assertFalse(new BridgeClient(server, store).restoreSession()); assertEquals(0, server.renewals);
        assertThrows(IllegalStateException.class, () -> client.get("tables/example"));
    }
    @Test public void temporaryNetworkOrServerFailureDoesNotEraseSavedLogin() throws Exception {
        Store store = new Store(); store.saved = "refresh-before-offline"; Server server = new Server(); BridgeClient client = new BridgeClient(server, store);
        server.refreshError = new IOException("offline"); assertThrows(IOException.class, client::restoreSession); assertEquals("refresh-before-offline", store.saved);
        server.refreshError = new BridgeClient.ServiceException(503); assertThrows(BridgeClient.ServiceException.class, client::restoreSession); assertNotNull(store.saved);
        server.refreshError = null; assertTrue(client.restoreSession()); assertEquals(0, server.logins);
    }
    @Test public void revokedRefreshRequiresLoginAndDoesNotKeepOldCredential() throws Exception {
        for (int status : new int[]{400, 401, 403}) {
            Store store = new Store(); store.saved = "refresh-revoked"; Server server = new Server(); server.refreshError = new BridgeClient.ServiceException(status);
            assertThrows(IllegalStateException.class, () -> new BridgeClient(server, store).restoreSession()); assertNull(store.saved);
        }
    }
    @Test public void failedStorageCannotPretendLoginWasSaved() throws Exception {
        Store store = new Store(); store.failSave = true; BridgeClient client = new BridgeClient(new Server(), store);
        assertThrows(IOException.class, () -> client.login("manager@1708.local", "test")); assertNull(store.saved);
        assertThrows(IllegalStateException.class, () -> client.get("tables/example"));
    }
    private SecretKey key() throws Exception { KeyGenerator generator = KeyGenerator.getInstance("AES"); generator.init(128); return generator.generateKey(); }
    @Test public void encryptedSessionRoundTripsUsesNewIvAndHasNoPlaintextToken() throws Exception {
        SecretKey key = key(); String token = "refresh-secret-for-test-only";
        byte[] first = SessionCipher.seal(key, token), second = SessionCipher.seal(key, token);
        assertEquals(token, SessionCipher.open(key, first)); assertFalse(Arrays.equals(first, second));
        assertFalse(new String(first, StandardCharsets.ISO_8859_1).contains(token));
    }
    @Test public void corruptedWrongKeyOrTruncatedSessionNeverRestores() throws Exception {
        SecretKey key = key(); byte[] sealed = SessionCipher.seal(key, "refresh-test-only");
        assertThrows(GeneralSecurityException.class, () -> SessionCipher.open(key(), sealed));
        byte[] changed = sealed.clone(); changed[changed.length - 1] ^= 1;
        assertThrows(GeneralSecurityException.class, () -> SessionCipher.open(key, changed));
        assertThrows(GeneralSecurityException.class, () -> SessionCipher.open(key, Arrays.copyOf(sealed, 20)));
        assertThrows(GeneralSecurityException.class, () -> SessionCipher.seal(key, ""));
    }
}
