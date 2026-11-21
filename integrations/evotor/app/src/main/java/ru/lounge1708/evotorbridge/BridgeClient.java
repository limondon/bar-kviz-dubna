package ru.lounge1708.evotorbridge;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;
import org.json.JSONTokener;

/** Uses existing staff access. No guest access, stored passwords or automatic mutation retries. */
final class BridgeClient {
    interface Transport { Document call(String url, String method, String body, String etag, boolean getEtag, String contentType) throws Exception; }
    interface SessionStore { String load() throws Exception; void save(String refreshToken) throws Exception; void clear() throws Exception; }
    static final class ServiceException extends IllegalStateException {
        final int status;
        ServiceException(int status) { super("Сервис отклонил запрос (HTTP " + status + "). Проверьте вход и соединение."); this.status = status; }
    }
    private final Transport transport;
    private final SessionStore sessions;
    BridgeClient() { this(BridgeClient::request, null); }
    BridgeClient(SessionStore sessions) { this(BridgeClient::request, sessions); }
    BridgeClient(Transport transport) { this(transport, null); }
    BridgeClient(Transport transport, SessionStore sessions) { this.transport = transport; this.sessions = sessions; }
    private static final String API_KEY = "AIzaSyAdPAuuu7TRsJfI9jxyYkdscPvPObm-6h8";
    private static final String DATABASE = "https://project-3061022303410047846-default-rtdb.firebaseio.com/";
    static final String ROOT = "config/evotor/v1/transfers/";
    static final String DEVICES = "config/evotor/v1/devices/";
    private String token, refreshToken;
    private long expiresAt;
    static final class Document {
        final Object value; final String etag;
        Document(Object value, String etag) { this.value = value; this.etag = etag; }
        JSONObject object() { return value instanceof JSONObject ? (JSONObject) value : new JSONObject(); }
    }
    private static Document request(String url, String method, String body, String etag, boolean getEtag, String contentType) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(12000); connection.setReadTimeout(12000); connection.setRequestMethod(method);
        connection.setRequestProperty("Content-Type", contentType);
        if (getEtag) connection.setRequestProperty("X-Firebase-ETag", "true");
        if (etag != null) connection.setRequestProperty("if-match", etag);
        try {
            if (body != null) {
                connection.setDoOutput(true);
                try (OutputStream out = connection.getOutputStream()) { out.write(body.getBytes(StandardCharsets.UTF_8)); }
            }
            int code = connection.getResponseCode();
            // Never expose response bodies/URLs containing tokens or credential details in the UI/log.
            if (code == 412) throw new IllegalStateException("Счёт уже изменён или выбран другой кассой. Обновите список.");
            if (code < 200 || code >= 300) throw new ServiceException(code);
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (InputStream in = connection.getInputStream()) {
                byte[] buffer = new byte[4096]; int size;
                while ((size = in.read(buffer)) != -1) {
                    if (bytes.size() + size > 2000000) throw new IllegalStateException("Ответ слишком большой. Выберите другой день.");
                    bytes.write(buffer, 0, size);
                }
            }
            Object value = new JSONTokener(new String(bytes.toByteArray(), StandardCharsets.UTF_8)).nextValue();
            return new Document(value, connection.getHeaderField("ETag"));
        } finally { connection.disconnect(); }
    }
    synchronized void login(String email, String password) throws Exception {
        logout();
        if (!"manager@1708.local".equals(email.trim())) throw new IllegalArgumentException("Нужен существующий вход сотрудника сайта.");
        JSONObject body = new JSONObject().put("email", email.trim()).put("password", password).put("returnSecureToken", true);
        JSONObject result = transport.call("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + API_KEY,
                "POST", body.toString(), null, false, "application/json").object();
        acceptSession(result.getString("idToken"), result.getString("refreshToken"), result.getLong("expiresIn"));
    }
    synchronized void logout() throws Exception { token = null; refreshToken = null; expiresAt = 0; if (sessions != null) sessions.clear(); }
    synchronized boolean restoreSession() throws Exception {
        if (sessions == null) return false;
        String saved = sessions.load(); if (saved == null || saved.isEmpty()) return false;
        refreshToken = saved; renewSession(); return true;
    }
    private void acceptSession(String idToken, String refresh, long seconds) throws Exception {
        if (idToken.isEmpty() || refresh.isEmpty() || seconds < 1) throw new IllegalStateException("Сервис не подтвердил вход. Повторите вход.");
        if (sessions != null) sessions.save(refresh);
        token = idToken; refreshToken = refresh; expiresAt = System.currentTimeMillis() + seconds * 1000 - 60000;
    }
    private void renewSession() throws Exception {
        try {
            JSONObject result = transport.call("https://securetoken.googleapis.com/v1/token?key=" + API_KEY, "POST",
                    "grant_type=refresh_token&refresh_token=" + URLEncoder.encode(refreshToken, "UTF-8"), null, false,
                    "application/x-www-form-urlencoded").object();
            acceptSession(result.getString("id_token"), result.getString("refresh_token"), result.getLong("expires_in"));
        } catch (ServiceException e) {
            if (e.status == 400 || e.status == 401 || e.status == 403) { logout(); throw new IllegalStateException("Сохранённый вход отозван или истёк. Введите пароль заново."); }
            throw e;
        }
    }
    private synchronized String databaseUrl(String path) throws Exception {
        if (token == null) throw new IllegalStateException("Войдите с учётной записью сотрудника сайта.");
        if (System.currentTimeMillis() >= expiresAt) renewSession();
        return DATABASE + path + ".json?auth=" + URLEncoder.encode(token, "UTF-8");
    }
    Document get(String path) throws Exception { return transport.call(databaseUrl(path), "GET", null, null, true, "application/json"); }
    JSONObject dayOrders(String date) throws Exception {
        if (!date.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")) throw new IllegalArgumentException("Неверная дата.");
        return transport.call(databaseUrl("orders") + "&orderBy=%22date%22&equalTo="
                + URLEncoder.encode(JSONObject.quote(date), "UTF-8"), "GET", null, null, false, "application/json").object();
    }
    private void replace(String path, Document before, JSONObject value) throws Exception {
        if (before.etag == null) throw new IllegalStateException("Сервис не подтвердил версию счёта. Открытие заблокировано.");
        transport.call(databaseUrl(path), "PUT", value.toString(), before.etag, false, "application/json");
    }
    void saveCatalog(String deviceId, JSONObject catalog) throws Exception {
        if (!deviceId.matches("[a-zA-Z0-9-]{10,80}") || !deviceId.equals(catalog.getString("deviceId"))) throw new IllegalArgumentException("Неверная касса.");
        String path = DEVICES + deviceId + "/catalog"; replace(path, get(path), catalog);
    }
    String resolveDevice(String identityKey, String preferredId) throws Exception {
        if (identityKey == null) {
            if (TerminalIdentity.validDeviceId(preferredId)) return preferredId;
            throw new IllegalStateException("Не удалось определить терминал. Новая регистрация не создана. Повторите вход на кассе.");
        }
        if (!identityKey.matches("android-[0-9a-f]{64}")) throw new IllegalArgumentException("Неверный идентификатор терминала.");
        String path = "config/evotor/v1/terminalLinks/" + identityKey;
        Document before = get(path);
        if (before.value != null && before.value != JSONObject.NULL) {
            String linked = before.object().optString("deviceId");
            if (!TerminalIdentity.validDeviceId(linked)) throw new IllegalStateException("Повреждена привязка кассы. Обратитесь к администратору сайта.");
            return linked;
        }
        String selected = TerminalIdentity.validDeviceId(preferredId) ? preferredId : java.util.UUID.randomUUID().toString();
        replace(path, before, new JSONObject().put("schema", 1).put("deviceId", selected));
        return selected;
    }
    void identifyDevice(String deviceId, String identityKey, String appVersion) throws Exception {
        String path = DEVICES + deviceId + "/registration";
        Document before = get(path); JSONObject registration = before.object();
        registration.put("schema", 1).put("archived", false).put("appVersion", appVersion).put("lastSeenAt", System.currentTimeMillis());
        if (identityKey != null) registration.put("identityKey", identityKey);
        replace(path, before, registration);
    }
    void claim(CashBill bill, String nonce) throws Exception {
        // Reserve at day scope: a renamed table must not create a second receipt from the same order rows.
        String path = ROOT + bill.date;
        Document before = get(path); JSONObject day = before.object(), current = day.optJSONObject(bill.id);
        if (current == null) throw new IllegalStateException("Передача больше не существует. Обновите список.");
        if (!CashBill.canClaim(current.optString("state"), current.optString("digest"), bill.digest))
            throw new IllegalStateException("Состав изменился или открытие уже выполнялось. Обновите список.");
        new CashBill(current, bill.id, bill.date).requireFresh(System.currentTimeMillis());
        java.util.Iterator<String> keys = day.keys();
        while (keys.hasNext()) {
            String key = keys.next(); JSONObject other = day.getJSONObject(key);
            if (!key.equals(bill.id) && !"queued".equals(other.optString("state"))
                    && bill.overlaps(new CashBill(other, key, bill.date)))
                throw new IllegalStateException("Строки заказа уже переданы кассе, возможно до переименования стола. Повтор заблокирован.");
        }
        current.put("state", "opening").put("nonce", nonce).put("startedAt", System.currentTimeMillis());
        day.put(bill.id, current); replace(path, before, day);
    }
    void report(JSONObject acknowledgement) throws Exception {
        String path = ROOT + acknowledgement.getString("date") + "/" + acknowledgement.getString("id");
        Document before = get(path); JSONObject current = before.object();
        if (!CashBill.canReport(current, acknowledgement.getString("digest"), acknowledgement.getString("nonce"))) return;
        current.put("state", acknowledgement.getString("state"));
        current.put("receiptUuid", acknowledgement.optString("receiptUuid"));
        current.put("finishedAt", System.currentTimeMillis());
        replace(path, before, current);
    }
    void requeueCleared(CashBill bill) throws Exception {
        String path = ROOT + bill.date + "/" + bill.id;
        Document before = get(path);
        JSONObject next = ReceiptRecovery.requeue(before.object(), bill.record, System.currentTimeMillis());
        if (next != null) replace(path, before, next);
    }
    void requeuePostponed(CashBill bill) throws Exception {
        String path = ROOT + bill.date + "/" + bill.id;
        Document before = get(path);
        JSONObject next = ReceiptRecovery.requeue(before.object(), bill.record, System.currentTimeMillis(), "postponed");
        if (next != null) replace(path, before, next);
    }
    CashBill refreshPostponed(CashBill bill, JSONObject previous) throws Exception {
        String path = ROOT + bill.date + "/" + bill.id;
        Document before = get(path); JSONObject current = before.object();
        if (!ReceiptRecovery.wasPostponed(previous, current)) throw new IllegalStateException("Нет подтверждения отложения этого счёта.");
        if ("queued".equals(current.optString("state"))) return new CashBill(current, bill.id, bill.date);
        if (!"cleared".equals(current.optString("state")) || !bill.digest.equals(current.optString("digest")))
            throw new IllegalStateException("Счёт изменился. Выберите его заново из списка.");
        current.put("state", "queued").put("createdAt", System.currentTimeMillis()); current.remove("needsRefresh");
        replace(path, before, current);
        return new CashBill(current, bill.id, bill.date);
    }
    // Called only after source rows, stored prices and live cash cards have been validated.
    CashBill refreshUnchanged(CashBill bill) throws Exception {
        String path = ROOT + bill.date + "/" + bill.id;
        Document before = get(path); JSONObject current = before.object();
        if (!"queued".equals(current.optString("state")) || current.optBoolean("needsRefresh")
                || !bill.digest.equals(current.optString("digest")))
            throw new IllegalStateException("Состав или состояние счёта изменились. Обновите его на сайте и выберите заново.");
        new CashBill(current, bill.id, bill.date);
        current.put("createdAt", System.currentTimeMillis()); replace(path, before, current);
        return new CashBill(current, bill.id, bill.date);
    }
}
