import cn.xingyeji.companion.ServerAddress;
public final class ServerAddressCheck {
    public static void main(String[] args) throws Exception {
        String[] allowed={"https://192.168.1.23:3210/","https://10.0.0.2:443","https://172.16.0.2","https://172.31.255.254","https://100.64.0.1:3210","https://100.127.1.1","https://localhost:3210","https://127.0.0.1:3210"};
        String[] denied={"http://192.168.1.23:3210","https://example.com:3210","https://8.8.8.8","https://172.32.0.1","https://100.128.0.1","https://192.168.1.1@evil.example","https://192.168.1.1/secret","https://192.168.1.1?key=x","https://192.168.1.1#x","https://192.168.1.1:0","https://192.168.1.1:99999","https://192.168.001.1","https://192.168.1.999","https://192.168.1.1.evil.example","https://[::1]"};
        for(String value:allowed) ServerAddress.parse(value);
        for(String value:denied) { boolean rejected=false; try{ServerAddress.parse(value);}catch(Exception e){rejected=true;} if(!rejected) throw new AssertionError(value); }
        System.out.println("Android server address checks passed: "+allowed.length+" accepted, "+denied.length+" rejected.");
    }
}
