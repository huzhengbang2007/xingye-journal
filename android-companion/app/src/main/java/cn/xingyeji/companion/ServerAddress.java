package cn.xingyeji.companion;

import java.net.URI;

/** Restrict the privileged wrapper to loopback, private LAN and Tailscale IPv4 hosts. */
public final class ServerAddress {
    private ServerAddress() {}
    public static String parse(String value) throws Exception {
        URI uri = new URI(value.trim()); String host = uri.getHost(); String path = uri.getRawPath(); int port = uri.getPort();
        if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null || (path != null && !path.isEmpty() && !path.equals("/")) || (port != -1 && (port < 1 || port > 65535))) throw new IllegalArgumentException();
        host = host.toLowerCase(java.util.Locale.ROOT);
        if (!host.equals("localhost")) {
            if (!host.matches("[0-9]{1,3}(\\.[0-9]{1,3}){3}")) throw new IllegalArgumentException();
            String[] pieces = host.split("\\."); int[] n = new int[4];
            for(int i=0;i<4;i++) { if(pieces[i].length()>1 && pieces[i].startsWith("0")) throw new IllegalArgumentException(); n[i]=Integer.parseInt(pieces[i]); if(n[i]>255) throw new IllegalArgumentException(); }
            if (!(n[0]==10 || n[0]==127 || (n[0]==192 && n[1]==168) || (n[0]==172 && n[1]>=16 && n[1]<=31) || (n[0]==100 && n[1]>=64 && n[1]<=127))) throw new IllegalArgumentException();
        }
        return "https://" + host + (port == -1 ? "" : ":" + port);
    }
}
