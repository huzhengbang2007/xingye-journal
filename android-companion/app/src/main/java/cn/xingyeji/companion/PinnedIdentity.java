package cn.xingyeji.companion;

import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import javax.net.ssl.*;

/** Pure Java, also exercised against the real Windows pairing TLS listener. */
public final class PinnedIdentity {
    private PinnedIdentity() {}
    public static String fingerprint(java.security.cert.Certificate certificate) throws Exception {
        StringBuilder result = new StringBuilder();
        for (byte b : MessageDigest.getInstance("SHA-256").digest(certificate.getEncoded())) result.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
        return result.toString();
    }
    public static void configure(HttpsURLConnection connection, String pin) throws Exception {
        if (!pin.matches("[a-f0-9]{64}")) throw new GeneralSecurityException("Invalid computer identity");
        X509TrustManager trust = new X509TrustManager() {
            public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
            public void checkClientTrusted(X509Certificate[] chain, String auth) throws java.security.cert.CertificateException { throw new java.security.cert.CertificateException("Client certificates are not used"); }
            public void checkServerTrusted(X509Certificate[] chain, String auth) throws java.security.cert.CertificateException {
                try {
                    if (chain == null || chain.length == 0 || !pin.equals(fingerprint(chain[0]))) throw new GeneralSecurityException("Device identity changed");
                    chain[0].checkValidity();
                } catch (Exception e) { throw new java.security.cert.CertificateException("电脑身份已变化，请重新扫码确认", e); }
            }
        };
        SSLContext context = SSLContext.getInstance("TLS"); context.init(null, new TrustManager[]{trust}, new SecureRandom());
        connection.setSSLSocketFactory(context.getSocketFactory());
        connection.setHostnameVerifier((hostname, session) -> { try { return pin.equals(fingerprint(session.getPeerCertificates()[0])); } catch (Exception e) { return false; } });
    }
}
