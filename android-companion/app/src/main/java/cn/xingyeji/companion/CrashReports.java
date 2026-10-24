package cn.xingyeji.companion;

import android.content.Context;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/** Local diagnostic summary only: no exception messages, request bodies or diary contents. */
final class CrashReports {
    private static boolean installed;
    private static volatile String phase = "startup";
    static void phase(String value) { phase = value; }
    static synchronized void install(Context context) {
        if (installed) return;
        installed = true;
        Context app = context.getApplicationContext();
        Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
            record(app, error);
            if (previous != null) previous.uncaughtException(thread, error);
            else { android.os.Process.killProcess(android.os.Process.myPid()); System.exit(2); }
        });
    }
    static void record(Context context, Throwable error) {
        try {
            StringBuilder summary = new StringBuilder("HOSHINO TEAM · Android crash summary\n");
            summary.append("version=").append(context.getPackageManager().getPackageInfo(context.getPackageName(),0).versionName)
                .append(" code=").append(context.getPackageManager().getPackageInfo(context.getPackageName(),0).versionCode)
                .append("\nmodel=").append(android.os.Build.MANUFACTURER).append(' ').append(android.os.Build.MODEL)
                .append("\nAndroid=").append(android.os.Build.VERSION.RELEASE).append(" SDK=").append(android.os.Build.VERSION.SDK_INT)
                .append("\nphase=").append(phase).append("\n");
            for(int cause=0;error!=null && cause<6;cause++,error=error.getCause()) {
                summary.append(error.getClass().getName()).append('\n');
                StackTraceElement[] frames=error.getStackTrace();
                for(int i=0;i<Math.min(frames.length,48);i++) summary.append("  at ").append(frames[i]).append('\n');
            }
            Files.write(new File(context.getFilesDir(),"last-crash.txt").toPath(),summary.toString().getBytes(StandardCharsets.UTF_8));
        } catch (Exception ignored) { }
    }
    static String read(Context context) {
        try {
            File file=new File(context.getFilesDir(),"last-crash.txt");
            if(!file.exists() || file.length()>65536) return null;
            return new String(Files.readAllBytes(file.toPath()),StandardCharsets.UTF_8);
        } catch(Exception ignored) { return null; }
    }
    static void clear(Context context) { new File(context.getFilesDir(),"last-crash.txt").delete(); }
}
