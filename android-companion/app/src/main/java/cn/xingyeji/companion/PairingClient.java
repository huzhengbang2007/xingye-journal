package cn.xingyeji.companion;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.cert.X509Certificate;
import java.util.*;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import javax.net.ssl.*;

/** Device-only transport. No TLS defaults or other network clients are modified. */
final class PairingClient {
    static final class Failure extends Exception {
        final int status;
        Failure(String message, int status) { super(message); this.status = status; }
    }
    private final SharedPreferences preferences;
    private final Context context;
    private volatile boolean unlocked;
    private volatile int generation;
    private JSONObject credential;
    private long lastDiscovery;
    PairingClient(Context context) { this.context = context; preferences = context.getSharedPreferences("xingye-pairing", Context.MODE_PRIVATE); }
    void resume() { unlocked = true; }
    boolean isUnlocked() { return unlocked; }
    void lock() { unlocked = false; generation++; credential = null; }
    private void requireOpen() throws Failure { if (!unlocked) throw new Failure("请先解锁本机星野记", 401); }
    private static String hex(byte[] bytes) { StringBuilder out = new StringBuilder(); for (byte b : bytes) out.append(String.format(java.util.Locale.ROOT, "%02x", b & 255)); return out.toString(); }
    private static String hash(byte[] bytes) throws Exception { return hex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
    private javax.crypto.SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        String alias = "xingye-paired-devices-v1";
        if (store.containsAlias(alias)) return (javax.crypto.SecretKey) store.getKey(alias, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }
    private synchronized JSONObject load() throws Exception {
        if (credential != null) return credential;
        String value = preferences.getString("credential", null); if (value == null) return null;
        try {
            JSONObject envelope = new JSONObject(value);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(envelope.getString("iv"), Base64.NO_WRAP)));
            byte[] plaintext = cipher.doFinal(Base64.decode(envelope.getString("body"), Base64.NO_WRAP));
            try { credential = new JSONObject(new String(plaintext, StandardCharsets.UTF_8)); return credential; }
            finally { Arrays.fill(plaintext, (byte) 0); }
        } catch (Exception e) { throw new Failure("设备凭证无法读取，请重新扫描电脑二维码", 401); }
    }
    private synchronized void store(JSONObject value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] plaintext = value.toString().getBytes(StandardCharsets.UTF_8);
        try {
            JSONObject envelope = new JSONObject().put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)).put("body", Base64.encodeToString(cipher.doFinal(plaintext), Base64.NO_WRAP));
            if (!preferences.edit().putString("credential", envelope.toString()).commit()) throw new Failure("设备配对保存失败，请检查存储空间后重新扫码", 507);
            credential = value;
        } finally { Arrays.fill(plaintext, (byte) 0); }
    }
    synchronized JSONObject status() throws Exception {
        JSONObject c = load();
        return new JSONObject().put("paired", c != null).put("origin", c == null ? "" : c.getString("origin"));
    }
    synchronized void forget() throws Exception {
        generation++;
        if (!preferences.edit().remove("credential").commit()) throw new Exception("解除配对保存失败，请重试");
        credential = null;
    }
    private static String address(String value) throws Exception {
        String result = ServerAddress.parse(value);
        String ip = new URI(result).getHost();
        if (!(ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("127.") || ip.matches("100\\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\\..+") || ip.matches("172\\.(1[6-9]|2[0-9]|3[01])\\..+"))) throw new Failure("请连接同一网络或自己的手机热点", 400);
        return result;
    }
    static JSONObject request(String origin, String path, String fingerprint, String token, JSONObject body) throws Exception {
        origin = address(origin);
        if (!fingerprint.matches("[a-f0-9]{64}")) throw new Failure("电脑身份无效，请重新扫码", 401);
        HttpsURLConnection connection = (HttpsURLConnection) new URL(origin + path).openConnection();
        PinnedIdentity.configure(connection, fingerprint);
        connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(1800); connection.setReadTimeout(15000);
        connection.setRequestMethod(body == null ? "GET" : "POST");
        if (token != null) connection.setRequestProperty("Authorization", "Bearer " + token);
        try {
            if (body != null) { connection.setDoOutput(true); connection.setRequestProperty("Content-Type", "application/json"); try (java.io.OutputStream out = connection.getOutputStream()) { out.write(body.toString().getBytes(StandardCharsets.UTF_8)); } }
            int status = connection.getResponseCode();
            java.io.InputStream input = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
            java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
            if (input != null) try (java.io.InputStream in = input) { byte[] buffer = new byte[8192]; int count; while ((count = in.read(buffer)) != -1) { if (bytes.size() + count > 16 * 1024 * 1024) throw new Failure("同步响应超过 16 MiB 上限，请在电脑导出备份并分批减少记录", 413); bytes.write(buffer, 0, count); } }
            JSONObject result = new JSONObject(bytes.toString("UTF-8"));
            if (status < 200 || status >= 300) throw new Failure(result.optString("error", "电脑连接失败"), status);
            return result;
        } finally { connection.disconnect(); }
    }
    JSONObject pair(String contents) throws Exception {
        requireOpen(); final int currentGeneration = generation;
        if (contents.length() > 5000) throw new Failure("这不是星野记配对二维码", 400);
        JSONObject invitation = new JSONObject(contents);
        if (!"xingye-pair".equals(invitation.optString("type")) || invitation.optInt("version") != 1 || invitation.optLong("expires") < System.currentTimeMillis()) throw new Failure("二维码已过期，请在电脑刷新后重新扫码", 410);
        String pin = invitation.getString("fingerprint");
        if (!pin.equals(invitation.getString("computerId"))) throw new Failure("电脑身份无效", 401);
        JSONArray addresses = invitation.getJSONArray("addresses");
        if (addresses.length() == 0 || addresses.length() > 8) throw new Failure("电脑尚未连接可用网络", 400);
        String selected = null; JSONObject pending = null;
        for (int i = 0; i < addresses.length(); i++) {
            requireOpen(); if (currentGeneration != generation) throw new Failure("配对已取消", 401);
            try { selected = address(addresses.getString(i)); pending = request(selected, "/pair/request", pin, null, new JSONObject().put("code", invitation.getString("code")).put("name", android.os.Build.MODEL)); break; }
            catch (Failure | SSLException e) { throw e; } catch (java.io.IOException e) { selected = null; }
        }
        if (pending == null || selected == null) throw new Failure("无法连接电脑，请确认电脑仍打开；网络不通时让电脑连接自己的手机热点，并允许 Windows 防火墙的专用网络访问", 503);
        final String verificationCode = pending.getString("verificationCode");
        ((android.app.Activity) context).runOnUiThread(() -> new android.app.AlertDialog.Builder(context).setTitle("核对电脑配对码").setMessage("请核对电脑上同一设备的六位码：" + verificationCode + "。仅在两端一致时，在电脑允许配对。").setPositiveButton("知道了", null).show());
        long deadline = System.currentTimeMillis() + 90000;
        while (System.currentTimeMillis() < deadline) {
            requireOpen(); if (currentGeneration != generation) throw new Failure("配对已取消", 401);
            JSONObject result = request(selected, "/pair/poll", pin, null, pending);
            if (!result.optBoolean("waiting")) {
                requireOpen(); if (currentGeneration != generation) throw new Failure("配对已取消", 401);
                JSONObject next = new JSONObject().put("origin", selected).put("fingerprint", pin).put("computerId", invitation.getString("computerId")).put("discoveryPort", invitation.optInt("discoveryPort", 3212)).put("token", result.getString("token"));
                store(next); return status();
            }
            Thread.sleep(1000);
        }
        throw new Failure("等待电脑确认超时，请重新扫码", 408);
    }
    private String discover(JSONObject c) throws Exception {
        if (System.currentTimeMillis() - lastDiscovery < 15000) throw new Failure("等待电脑：请打开并解锁电脑上的星野记；网络不通时连接自己的手机热点", 503);
        lastDiscovery = System.currentTimeMillis();
        String nonce = UUID.randomUUID().toString();
        byte[] query = new JSONObject().put("type", "xingye-discover-v1").put("computerId", c.getString("computerId")).put("nonce", nonce).toString().getBytes(StandardCharsets.UTF_8);
        int discoveryPort = c.optInt("discoveryPort", 3212);
        if (discoveryPort < 1 || discoveryPort > 65535) throw new Failure("配对信息无效，请重新扫码", 400);
        try (DatagramSocket socket = new DatagramSocket()) {
            socket.setBroadcast(true); socket.setSoTimeout(1200);
            Set<String> destinations = new HashSet<>(); destinations.add("255.255.255.255");
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces.hasMoreElements()) for (InterfaceAddress item : interfaces.nextElement().getInterfaceAddresses()) if (item.getBroadcast() != null) destinations.add(item.getBroadcast().getHostAddress());
            for (String target : destinations) try { socket.send(new DatagramPacket(query, query.length, InetAddress.getByName(target), discoveryPort)); } catch (java.io.IOException ignored) {}
            long deadline = System.currentTimeMillis() + 2000;
            while (System.currentTimeMillis() < deadline) {
                byte[] bytes = new byte[1024]; DatagramPacket packet = new DatagramPacket(bytes, bytes.length);
                try { socket.receive(packet); } catch (SocketTimeoutException e) { break; }
                try {
                    JSONObject found = new JSONObject(new String(packet.getData(), 0, packet.getLength(), StandardCharsets.UTF_8));
                    if (!nonce.equals(found.optString("nonce")) || !c.getString("computerId").equals(found.optString("computerId"))) continue;
                    String origin = address("https://" + packet.getAddress().getHostAddress() + ":" + found.getInt("port"));
                    // Discovery is untrusted. Verify the pinned TLS identity before using or saving it.
                    request(origin, "/sync/snapshot", c.getString("fingerprint"), c.getString("token"), null);
                    return origin;
                } catch (Failure e) { if (e.status == 423 || e.status == 401) throw e; } catch (Exception ignored) {}
            }
        }
        throw new Failure("未找到电脑，请保持电脑打开；网络不通时连接自己的手机热点，或重新扫描二维码", 503);
    }
    JSONObject sync(String action, JSONObject body) throws Exception {
        requireOpen(); final int currentGeneration = generation;
        JSONObject c = load(); if (c == null) throw new Failure("请扫描电脑二维码完成配对", 401);
        String path = "metadata".equals(action) ? "/sync/metadata" : "snapshot".equals(action) ? "/sync/snapshot" : "merge".equals(action) ? "/sync/merge" : null;
        if (path == null) throw new Failure("不支持的同步操作", 400);
        try {
            JSONObject result = request(c.getString("origin"), path, c.getString("fingerprint"), c.getString("token"), body);
            requireOpen(); if (currentGeneration != generation) throw new Failure("本机已锁定，本次同步已停止", 401);
            return result;
        } catch (SSLException e) { throw new Failure("电脑身份校验失败，请重新扫描电脑二维码", 495); }
        catch (java.io.IOException e) {
            // A merge may have reached the computer. Never replay it automatically.
            if ("merge".equals(action)) throw new Failure("同步连接中断，稍后重新检查两端记录即可继续", 503);
            String origin = discover(c);
            requireOpen(); if (currentGeneration != generation) throw new Failure("本机已锁定", 401);
            JSONObject result = request(origin, path, c.getString("fingerprint"), c.getString("token"), null);
            JSONObject next = new JSONObject(c.toString()).put("origin", origin); store(next);
            return result;
        }
    }
}
