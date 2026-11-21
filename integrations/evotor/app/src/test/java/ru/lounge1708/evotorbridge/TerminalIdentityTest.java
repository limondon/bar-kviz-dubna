package ru.lounge1708.evotorbridge;

import static org.junit.Assert.*;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONObject;
import org.junit.Test;

public class TerminalIdentityTest {
    private static final String OLD = "136fbf2d-e790-4ccf-9de1-09118ac28c7d";
    private static final class Server implements BridgeClient.Transport {
        Map<String, Object> data = new HashMap<>(); int writes; boolean race;
        public BridgeClient.Document call(String url, String method, String body, String etag, boolean getEtag, String contentType) throws Exception {
            if (url.startsWith("https://identitytoolkit.googleapis.com/")) return new BridgeClient.Document(new JSONObject().put("idToken", "test-id").put("refreshToken", "test-refresh").put("expiresIn", 3600), null);
            String path = url.substring(url.indexOf("/config/") + 1, url.indexOf(".json?"));
            assertTrue(path.contains("/terminalLinks/") || path.endsWith("/registration"));
            if (method.equals("GET")) return new BridgeClient.Document(data.containsKey(path) ? new JSONObject(data.get(path).toString()) : JSONObject.NULL, "test-etag");
            assertEquals("PUT", method); assertEquals("test-etag", etag); writes++;
            if (race) { data.put(path, new JSONObject().put("deviceId", OLD)); race = false; throw new IllegalStateException("Concurrent binding"); }
            data.put(path, new JSONObject(body)); return new BridgeClient.Document(new JSONObject(body), null);
        }
    }
    private BridgeClient login(Server server) throws Exception { BridgeClient c = new BridgeClient(server); c.login("manager@1708.local", "test"); return c; }
    @Test public void upgradePreservesMappingsAddressAndReinstallReturnsTheSameRegistration() throws Exception {
        Server server = new Server(); String key = TerminalIdentity.key("1234567890abcdef");
        assertEquals(OLD, login(server).resolveDevice(key, OLD)); assertEquals(1, server.writes);
        assertEquals(OLD, login(server).resolveDevice(key, null));
        assertEquals(OLD, login(server).resolveDevice(key, "different-local-registration")); assertEquals(1, server.writes);
    }
    @Test public void freshInstallAndAnotherTerminalHaveIndependentRegistrations() throws Exception {
        Server server = new Server(); String firstKey = TerminalIdentity.key("1234567890abcdef"), secondKey = TerminalIdentity.key("abcdef1234567890");
        String first = login(server).resolveDevice(firstKey, null), second = login(server).resolveDevice(secondKey, null);
        assertNotEquals(first, second); assertEquals(first, login(server).resolveDevice(firstKey, null)); assertEquals(2, server.writes);
        assertFalse(firstKey.contains("1234567890abcdef")); assertEquals(firstKey, TerminalIdentity.key("1234567890ABCDEF"));
    }
    @Test public void missingOrSharedIdentifierNeverCreatesAnotherRandomRegistration() throws Exception {
        for (String invalid : new String[]{null, "", "null", "0000000000000000", "9774d56d682e549c", "123"}) assertNull(TerminalIdentity.key(invalid));
        Server server = new Server(); BridgeClient c = login(server);
        assertEquals(OLD, c.resolveDevice(null, OLD));
        assertThrows(IllegalStateException.class, () -> c.resolveDevice(null, null)); assertEquals(0, server.writes);
    }
    @Test public void corruptedBindingBlocksInsteadOfReplacingStoredSettings() throws Exception {
        Server server = new Server(); String key = TerminalIdentity.key("1234567890abcdef");
        server.data.put("config/evotor/v1/terminalLinks/" + key, new JSONObject().put("deviceId", "../bad"));
        assertThrows(IllegalStateException.class, () -> login(server).resolveDevice(key, OLD)); assertEquals(0, server.writes);
    }
    @Test public void concurrentBindingDoesNotOverwriteWinnerAndCanBeReadOnRetry() throws Exception {
        Server server = new Server(); server.race = true; String key = TerminalIdentity.key("1234567890abcdef");
        assertThrows(IllegalStateException.class, () -> login(server).resolveDevice(key, null));
        assertEquals(OLD, login(server).resolveDevice(key, null)); assertEquals(1, server.writes);
    }
    @Test public void activeTerminalReturnsFromArchiveWithoutTouchingCatalogOrMappings() throws Exception {
        Server server = new Server(); String path = "config/evotor/v1/devices/" + OLD + "/registration";
        server.data.put(path, new JSONObject().put("archived", true).put("note", "keep"));
        login(server).identifyDevice(OLD, TerminalIdentity.key("1234567890abcdef"), "0.10");
        JSONObject result = (JSONObject) server.data.get(path);
        assertFalse(result.getBoolean("archived")); assertEquals("keep", result.getString("note")); assertEquals("0.10", result.getString("appVersion")); assertEquals(1, server.writes);
    }
}
