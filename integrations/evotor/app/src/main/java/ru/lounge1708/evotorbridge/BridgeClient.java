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
    private final Transport transport;
    BridgeClient() { this(BridgeClient::request); }
    BridgeClient(Transport transport) { this.transport = transport; }
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
            if (code < 200 || code >= 300) throw new IllegalStateException("Сервис отклонил запрос (HTTP " + code + "). Проверьте вход и соединение.");
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
    void login(String email, String password) throws Exception {
        logout();
        if (!"manager@1708.local".equals(email.trim())) throw new IllegalArgumentException("Нужен существующий вход сотрудника сайта.");
        JSONObject body = new JSONObject().put("email", email.trim()).put("password", password).put("returnSecureToken", true);
        JSONObject result = transport.call("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + API_KEY,
                "POST", body.toString(), null, false, "application/json").object();
        token = result.getString("idToken"); refreshToken = result.getString("refreshToken");
        expiresAt = System.currentTimeMillis() + result.getLong("expiresIn") * 1000 - 60000;
    }
    void logout() { token = null; refreshToken = null; expiresAt = 0; }
    private String databaseUrl(String path) throws Exception {
        if (token == null) throw new IllegalStateException("Войдите с учётной записью сотрудника сайта.");
        if (System.currentTimeMillis() >= expiresAt) {
            JSONObject result = transport.call("https://securetoken.googleapis.com/v1/token?key=" + API_KEY, "POST",
                    "grant_type=refresh_token&refresh_token=" + URLEncoder.encode(refreshToken, "UTF-8"), null, false,
                    "application/x-www-form-urlencoded").object();
            token = result.getString("id_token"); refreshToken = result.getString("refresh_token");
            expiresAt = System.currentTimeMillis() + result.getLong("expires_in") * 1000 - 60000;
        }
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
