import cn.xingyeji.companion.PinnedIdentity;
import javax.net.ssl.HttpsURLConnection;
import java.net.URL;

public class PinnedIdentityCheck {
    public static void main(String[] args) throws Exception {
        HttpsURLConnection request = (HttpsURLConnection) new URL(args[0]).openConnection();
        PinnedIdentity.configure(request, args[1]);
        request.setConnectTimeout(4000); request.setReadTimeout(4000);
        try {
            int status = request.getResponseCode();
            if (args[2].equals("reject")) throw new AssertionError("Wrong computer identity was accepted");
            if (status != Integer.parseInt(args[2])) throw new AssertionError("Unexpected status " + status);
            System.out.println("Pinned TLS identity verified without installing a system certificate");
        } catch (javax.net.ssl.SSLHandshakeException error) {
            if (!args[2].equals("reject")) throw error;
            System.out.println("Wrong computer identity rejected");
        } finally { request.disconnect(); }
    }
}
