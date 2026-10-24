package cn.xingyeji.companion;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.AlarmClock;
import android.provider.CalendarContract;
import android.provider.Settings;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebMessage;
import android.webkit.WebMessagePort;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Native permissions live here. Diary/password payloads have no bridge methods. */
public final class MainActivity extends Activity {
    private WebView web;
    private PairingClient pairing;
    private String pendingUnlockRequest;
    private final AuthorizationGate authorization = new AuthorizationGate();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private android.os.CancellationSignal authenticationCancellation;
    private boolean activityResumed;
    private boolean crashReportShown;
    private String pendingScanRequest;
    private boolean scannerLaunchPending;
    private WebMessagePort port;
    private android.webkit.ValueCallback<Uri[]> fileCallback;
    private String origin = "https://appassets.androidplatform.net";
    private byte[] pendingExport;
    private String pendingExportRequest;
    private JSONArray pendingCalendar;
    private boolean calendarBusy;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private SharedPreferences preferences;
    private final ZoneId china = ZoneId.of("Asia/Shanghai");
    private int safeLeft, safeTop, safeRight, safeBottom;

    @Override public void onCreate(Bundle bundle) {
        super.onCreate(bundle);
        CrashReports.install(this);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        else getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 29) { getWindow().setStatusBarContrastEnforced(false); getWindow().setNavigationBarContrastEnforced(false); }
        if (Build.VERSION.SDK_INT >= 28) { WindowManager.LayoutParams params=getWindow().getAttributes(); params.layoutInDisplayCutoutMode=WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES; getWindow().setAttributes(params); }
        pairing = new PairingClient(this);
        preferences = getSharedPreferences("xingye-device", MODE_PRIVATE);
        openWeb();
    }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent);setIntent(intent);if(web!=null && intent.getBooleanExtra("openCourses",false))web.evaluateJavascript("window.dispatchEvent(new Event('xingye:open-courses'))",null); }
    private boolean ownOrigin(Uri uri) { return uri != null && origin != null && origin.equals(uri.getScheme() + "://" + uri.getEncodedAuthority()); }
    private void openWeb() {
        web = new WebView(this);
        WebView.setWebContentsDebuggingEnabled(false);
        web.setOnApplyWindowInsetsListener((view,insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                safeLeft=bars.left; safeTop=bars.top; safeRight=bars.right; safeBottom=bars.bottom;
            } else {
                safeLeft=insets.getSystemWindowInsetLeft(); safeTop=insets.getSystemWindowInsetTop(); safeRight=insets.getSystemWindowInsetRight(); safeBottom=insets.getSystemWindowInsetBottom();
                if (Build.VERSION.SDK_INT >= 28 && insets.getDisplayCutout()!=null) { android.view.DisplayCutout cutout=insets.getDisplayCutout(); safeLeft=Math.max(safeLeft,cutout.getSafeInsetLeft()); safeTop=Math.max(safeTop,cutout.getSafeInsetTop()); safeRight=Math.max(safeRight,cutout.getSafeInsetRight()); safeBottom=Math.max(safeBottom,cutout.getSafeInsetBottom()); }
            }
            publishInsets();
            return insets;
        });
        web.setBackgroundColor(Color.rgb(241,246,255));
        WebSettings settings = web.getSettings(); settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true); settings.setAllowFileAccess(false); settings.setAllowContentAccess(true); settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW); settings.setJavaScriptCanOpenWindowsAutomatically(false); settings.setSupportMultipleWindows(false); settings.setSupportZoom(false); settings.setBuiltInZoomControls(false); settings.setDisplayZoomControls(false); settings.setUseWideViewPort(true); settings.setLoadWithOverviewMode(true);
        android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, android.webkit.ValueCallback<Uri[]> callback, FileChooserParams params) { if(fileCallback!=null) fileCallback.onReceiveValue(null); fileCallback=callback; Intent choose=new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*"); try { startActivityForResult(choose,200); return true; } catch(Exception e) { fileCallback=null; return false; } }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if(!ownOrigin(request.getUrl())) return localError();
                String path=request.getUrl().getPath(); if(path==null || path.equals("/")) path="/index.html";
                if(path.contains("..") || path.contains("\\") || !path.matches("/[A-Za-z0-9_./-]+")) return localError();
                String mime=path.endsWith(".js")?"text/javascript":path.endsWith(".css")?"text/css":path.endsWith(".svg")?"image/svg+xml":path.endsWith(".png")?"image/png":path.endsWith(".webmanifest")?"application/manifest+json":"text/html";
                try { java.util.Map<String,String> headers=new java.util.HashMap<>(); headers.put("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-src 'none'; object-src 'none'; base-uri 'none'"); headers.put("Cache-Control","no-store");headers.put("X-Content-Type-Options","nosniff");return new android.webkit.WebResourceResponse(mime,"UTF-8",200,"OK",headers,getAssets().open("www"+path)); } catch(Exception e) { return localError(); }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { if (ownOrigin(request.getUrl())) return false; if (request.isForMainFrame() && "https".equals(request.getUrl().getScheme())) { try { startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl())); } catch (Exception ignored) {} } return true; }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) { handler.cancel(); new AlertDialog.Builder(MainActivity.this).setTitle("连接证书未通过验证").setMessage("连接身份未通过验证，请回到本机首页，通过扫描电脑二维码重新连接。").setPositiveButton("回到本机首页", (d,w) -> { closeWeb(); openWeb(); }).show(); }
            @Override public void onPageFinished(WebView view, String url) { if (!ownOrigin(Uri.parse(url))) return; publishInsets(); view.requestApplyInsets(); if (port != null) port.close(); WebMessagePort[] channels = view.createWebMessageChannel(); port = channels[0]; port.setWebMessageCallback(new WebMessagePort.WebMessageCallback() { @Override public void onMessage(WebMessagePort source, WebMessage message) { receive(message.getData()); } }, new Handler(Looper.getMainLooper())); view.postWebMessage(new WebMessage("xingye:bridge", new WebMessagePort[]{channels[1]}), Uri.parse(origin)); }
        });
        setContentView(web, new ViewGroup.LayoutParams(-1,-1)); web.loadUrl(origin + (getIntent().getBooleanExtra("openCourses",false)?"/?view=courses":"/"));
    }
    private void publishInsets() {
        if(web==null || !ownOrigin(Uri.parse(web.getUrl()))) return;
        float density=getResources().getDisplayMetrics().density;
        String[] names={"left","top","right","bottom"}; int[] values={safeLeft,safeTop,safeRight,safeBottom};
        StringBuilder script=new StringBuilder("(()=>{const s=document.documentElement.style;");
        for(int i=0;i<names.length;i++) script.append("s.setProperty('--native-safe-").append(names[i]).append("','").append(values[i]/density).append("px');");
        script.append("})()"); web.evaluateJavascript(script.toString(),null);
    }
    private void applyAppearance(boolean dark) {
        if(web==null) return;
        int background=dark?Color.rgb(15,23,38):Color.rgb(241,246,255);
        web.setBackgroundColor(background); getWindow().setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(background));
        if(Build.VERSION.SDK_INT>=30) {
            WindowInsetsController controller=getWindow().getInsetsController();
            if(controller!=null) { int mask=WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS; controller.setSystemBarsAppearance(dark?0:mask,mask); }
        } else {
            int flags=getWindow().getDecorView().getSystemUiVisibility(); int mask=View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            getWindow().getDecorView().setSystemUiVisibility(dark?(flags & ~mask):(flags | mask));
        }
    }
    private void openSystem(String target) {
        Intent intent;
        switch(target) {
            case "calendar": intent=new Intent(Intent.ACTION_VIEW,Uri.parse("content://com.android.calendar/time/"+System.currentTimeMillis())); break;
            case "app-settings": intent=new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getPackageName())); break;
            case "battery-settings": intent=new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS); break;
            default: reply(false,"不支持的系统入口"); return;
        }
        try { startActivity(intent); } catch(android.content.ActivityNotFoundException | SecurityException error) { reply(false,"系统未提供此入口，请在系统设置中查看日历权限、省电与后台限制"); }
    }
    private void receive(String payload) {
        if (payload == null || payload.length() > 24000000 || web == null || !ownOrigin(Uri.parse(web.getUrl()))) return;
        try { JSONObject message = new JSONObject(payload); switch (message.optString("type")) {
            case "widget.pin": DailyCoursesWidget.save(this,message.getJSONArray("events"),true); android.appwidget.AppWidgetManager manager=android.appwidget.AppWidgetManager.getInstance(this); if(manager.isRequestPinAppWidgetSupported()) { manager.requestPinAppWidget(new android.content.ComponentName(this,DailyCoursesWidget.class),null,null); reply(true,"已请求添加桌面课表，请在桌面确认"); } else reply(false,"请长按桌面，在小组件中选择星野记每日课表"); break;
            case "widget.snapshot": if(getSharedPreferences("course-widget",MODE_PRIVATE).getBoolean("enabled",false)) DailyCoursesWidget.save(this,message.getJSONArray("events"),false); break;
            case "widget.clear": DailyCoursesWidget.clear(this); reply(true,"桌面课表内容已清除"); break;
            case "appearance.set": applyAppearance(message.optString("resolvedTheme").equals("dark")); break;
            case "system.open": openSystem(message.optString("target")); break;
            case "pairing.scan":
                if(pendingScanRequest!=null) { rpc(message.optString("requestId"),false,null,"请先完成上一次扫码"); break; }
                pendingScanRequest=message.getString("requestId");
                scannerLaunchPending=true;
                if(checkSelfPermission(Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[]{Manifest.permission.CAMERA}, 101);
                } else startPairingScanner();
                break;
            case "pairing.resume": authorizePairing(message.optString("requestId")); break;
            case "pairing.forget": pairing.lock(); worker.execute(()->{try{pairing.forget();rpc(message.optString("requestId"),true,new JSONObject(),null);}catch(Exception e){rpc(message.optString("requestId"),false,null,e.getMessage());}});break;
            case "pairing.status": worker.execute(()->{try{rpc(message.optString("requestId"),true,pairing.status(),null);}catch(Exception e){rpc(message.optString("requestId"),false,null,e.getMessage());}});break;
            case "pairing.sync": worker.execute(()->{try{JSONObject data=pairing.sync(message.getString("action"),message.optJSONObject("body"));rpc(message.optString("requestId"),true,data,null);}catch(Exception e){int status=e instanceof PairingClient.Failure?((PairingClient.Failure)e).status:0;runOnUiThread(()->{try{if(port!=null)port.postMessage(new WebMessage(new JSONObject().put("requestId",message.optString("requestId")).put("ok",false).put("status",status).put("error",e.getMessage()).toString()));}catch(Exception ignored){}});}});break;
            case "ai.complete": worker.execute(() -> aiRequest(message)); break;
            case "sync.disconnect": pairing.lock(); rpc(message.optString("requestId"),true,new JSONObject(),null); break;
            case "file.save": saveFile(message); break;
            case "calendar.sync": JSONArray events = message.getJSONArray("events"); if (events.length() > 10000) throw new Exception("课表数量过多"); pendingCalendar = events; requestCalendar(); break;
            case "alarm.create": createAlarm(message.getJSONObject("event")); break;
            default: reply(false, "未知设备请求");
        } } catch (Exception error) { try{String requestId=new JSONObject(payload).optString("requestId");if(!requestId.isEmpty())rpc(requestId,false,null,error.getMessage());else reply(false,"联动失败，请检查日程格式与系统权限");}catch(Exception ignored){} }
    }
    private void reply(boolean ok, String message) { runOnUiThread(() -> { try { if (port != null) port.postMessage(new WebMessage(new JSONObject().put("ok",ok).put("message",message).toString())); } catch (Exception ignored) {} }); }
    private void authorizePairing(String requestId) {
        CrashReports.phase("sync-authentication");
        if (pairing.isUnlocked()) { rpc(requestId,true,new JSONObject(),null); return; }
        if (pendingUnlockRequest != null) { rpc(requestId,false,null,"请先完成系统身份确认"); return; }
        android.app.KeyguardManager keyguard = (android.app.KeyguardManager) getSystemService(KEYGUARD_SERVICE);
        if (keyguard == null || !keyguard.isDeviceSecure()) { rpc(requestId,false,null,"同步前请在手机设置中启用锁屏密码、PIN 或图案；离线记录仍可使用"); return; }
        pendingUnlockRequest = requestId;
        authorization.begin(requestId);
        if (Build.VERSION.SDK_INT >= 30) {
            authenticateBiometric(requestId);
            return;
        }
        try {
            Intent confirmation = keyguard.createConfirmDeviceCredentialIntent("星野记 · 允许设备同步", "验证手机锁屏身份后，本次前台使用期间可以与已配对电脑同步。");
            if (confirmation == null) throw new IllegalStateException();
            startActivityForResult(confirmation,204);
        }
        catch (Exception error) { cancelAuthorization(); rpc(requestId,false,null,"无法打开系统身份验证，请稍后重试"); }
    }
    @android.annotation.TargetApi(30)
    private void authenticateBiometric(String requestId) {
        try {
            authenticationCancellation = new android.os.CancellationSignal();
            new android.hardware.biometrics.BiometricPrompt.Builder(this)
                .setTitle("星野记 · 允许设备同步")
                .setDescription("验证手机身份后，本次前台使用期间可以与已配对电脑同步。")
                .setAllowedAuthenticators(android.hardware.biometrics.BiometricManager.Authenticators.BIOMETRIC_STRONG | android.hardware.biometrics.BiometricManager.Authenticators.DEVICE_CREDENTIAL)
                .build().authenticate(authenticationCancellation, getMainExecutor(), new android.hardware.biometrics.BiometricPrompt.AuthenticationCallback() {
                    @Override public void onAuthenticationSucceeded(android.hardware.biometrics.BiometricPrompt.AuthenticationResult result) {
                        CrashReports.phase("sync-authentication-success");
                        authorization.complete(requestId,true); scheduleAuthorizationResult();
                    }
                    @Override public void onAuthenticationError(int code, CharSequence message) {
                        authorization.complete(requestId,false); scheduleAuthorizationResult();
                    }
                });
        } catch (Exception error) {
            cancelAuthorization(); rpc(requestId,false,null,"无法打开系统身份验证，请检查锁屏设置后重试");
        }
    }
    private void scheduleAuthorizationResult() {
        // Leave the biometric/activity callback before posting into WebView or opening the camera.
        mainHandler.post(() -> {
            if (!activityResumed || isFinishing() || isDestroyed()) return;
            AuthorizationGate.Result result = authorization.take();
            if (result == null) return;
            pendingUnlockRequest=null; authenticationCancellation=null;
            CrashReports.phase("sync-authentication-delivery");
            if (result.success) { pairing.resume(); rpc(result.requestId,true,new JSONObject(),null); }
            else { pairing.lock(); rpc(result.requestId,false,null,"身份验证未完成，同步保持锁定，请重试"); }
        });
    }
    private void cancelAuthorization() {
        authorization.cancel(); pendingUnlockRequest=null;
        if(authenticationCancellation!=null) { authenticationCancellation.cancel(); authenticationCancellation=null; }
    }
    private void startPairingScanner() {
        if(!scannerLaunchPending || pendingScanRequest==null || !activityResumed || !getWindow().getDecorView().hasWindowFocus() || isFinishing() || isDestroyed()) return;
        if(checkSelfPermission(Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED) return;
        scannerLaunchPending=false;
        CrashReports.phase("sync-camera-open");
        try {
            new com.google.zxing.integration.android.IntentIntegrator(this)
                .setDesiredBarcodeFormats(com.google.zxing.integration.android.IntentIntegrator.QR_CODE)
                .setPrompt("扫描电脑星野记中的二维码，返回后请在电脑确认设备")
                .setBeepEnabled(false).setOrientationLocked(false).initiateScan();
        } catch(Exception error) {
            CrashReports.record(this,error);
            String requestId=pendingScanRequest; pendingScanRequest=null;
            rpc(requestId,false,null,"无法打开扫码，请检查相机权限后重试");
        }
    }
    private void requestCalendar() {
        if (checkSelfPermission(Manifest.permission.WRITE_CALENDAR) != PackageManager.PERMISSION_GRANTED || checkSelfPermission(Manifest.permission.READ_CALENDAR) != PackageManager.PERMISSION_GRANTED) { requestPermissions(new String[]{Manifest.permission.READ_CALENDAR,Manifest.permission.WRITE_CALENDAR}, 100); return; }
        syncCalendar();
    }
    @Override public void onRequestPermissionsResult(int request, String[] names, int[] results) {
        super.onRequestPermissionsResult(request,names,results);
        if(request==101) {
            if(results.length>0 && results[0]==PackageManager.PERMISSION_GRANTED) mainHandler.post(this::startPairingScanner);
            else { String requestId=pendingScanRequest; pendingScanRequest=null; scannerLaunchPending=false;if(requestId!=null)rpc(requestId,false,null,"相机权限未授予，可在系统设置中允许后重试"); }
            return;
        }
        if (request == 100) { if(results.length == 2 && results[0] == PackageManager.PERMISSION_GRANTED && results[1] == PackageManager.PERMISSION_GRANTED) syncCalendar(); else reply(false,"日历权限未授予，日程仍保存在星野记"); }
    }
    private Uri calendarSyncUri() { return CalendarContract.Calendars.CONTENT_URI.buildUpon().appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER,"true").appendQueryParameter(CalendarContract.Calendars.ACCOUNT_NAME,"xingye-local").appendQueryParameter(CalendarContract.Calendars.ACCOUNT_TYPE,CalendarContract.ACCOUNT_TYPE_LOCAL).build(); }
    private long calendarId() {
        try (Cursor cursor = getContentResolver().query(CalendarContract.Calendars.CONTENT_URI, new String[]{CalendarContract.Calendars._ID}, CalendarContract.Calendars.ACCOUNT_NAME + "=? AND " + CalendarContract.Calendars.ACCOUNT_TYPE + "=? AND " + CalendarContract.Calendars.NAME + "=?", new String[]{"xingye-local", CalendarContract.ACCOUNT_TYPE_LOCAL, "星野记"}, null)) { if (cursor != null && cursor.moveToFirst()) return cursor.getLong(0); }
        ContentValues c = new ContentValues(); c.put(CalendarContract.Calendars.ACCOUNT_NAME,"xingye-local"); c.put(CalendarContract.Calendars.ACCOUNT_TYPE,CalendarContract.ACCOUNT_TYPE_LOCAL); c.put(CalendarContract.Calendars.NAME,"星野记"); c.put(CalendarContract.Calendars.CALENDAR_DISPLAY_NAME,"星野记"); c.put(CalendarContract.Calendars.CALENDAR_COLOR,Color.rgb(96,133,227)); c.put(CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL,CalendarContract.Calendars.CAL_ACCESS_OWNER); c.put(CalendarContract.Calendars.OWNER_ACCOUNT,"xingye-local"); c.put(CalendarContract.Calendars.VISIBLE,1); c.put(CalendarContract.Calendars.SYNC_EVENTS,1); c.put(CalendarContract.Calendars.CALENDAR_TIME_ZONE,"Asia/Shanghai"); c.put(CalendarContract.Calendars.ALLOWED_REMINDERS,"1"); c.put(CalendarContract.Calendars.MAX_REMINDERS,1);
        Uri created = getContentResolver().insert(calendarSyncUri(), c); if (created == null) throw new IllegalStateException(); return ContentUris.parseId(created);
    }
    private long millis(JSONObject e, String field) throws Exception { return LocalDateTime.parse(e.getString("date") + "T" + e.getString(field)).atZone(china).toInstant().toEpochMilli(); }
    private void syncCalendar() {
        if (calendarBusy || pendingCalendar == null) return; calendarBusy = true; final JSONArray events = pendingCalendar; pendingCalendar = null;
        worker.execute(() -> { try {
            // Validate the complete snapshot before changing any provider records.
            for (int i=0;i<events.length();i++) { JSONObject e=events.getJSONObject(i); if (e.getString("id").length()>80 || e.getString("title").length()>120 || millis(e,"end")<=millis(e,"start")) throw new IllegalArgumentException(); }
            long calendar = calendarId(); String mappingKey = "event-map-"+origin; JSONObject map = new JSONObject(preferences.getString(mappingKey,"{}")); Set<String> keep = new HashSet<>(); int changed=0;
            for (int i=0;i<events.length();i++) { JSONObject e=events.getJSONObject(i); String uid=e.getString("id"); keep.add(uid); JSONObject old=map.optJSONObject(uid); String signature=android.util.Base64.encodeToString(java.security.MessageDigest.getInstance("SHA-256").digest(e.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)),android.util.Base64.NO_WRAP); if (old!=null && old.optBoolean("deleted",false)) continue; if (old!=null && signature.equals(old.optString("signature"))) continue;
                ContentValues values = new ContentValues(); values.put(CalendarContract.Events.CALENDAR_ID,calendar); values.put(CalendarContract.Events.TITLE,e.getString("title")); values.put(CalendarContract.Events.DTSTART,millis(e,"start")); values.put(CalendarContract.Events.DTEND,millis(e,"end")); values.put(CalendarContract.Events.EVENT_TIMEZONE,"Asia/Shanghai"); values.put(CalendarContract.Events.EVENT_LOCATION,e.optString("location","")); values.put(CalendarContract.Events.DESCRIPTION,"来自星野记 · "+uid); values.put(CalendarContract.Events.HAS_ALARM,e.optInt("reminder",10)>=0?1:0);
                long eventId=-1;
                if(old==null) { try(Cursor c=getContentResolver().query(CalendarContract.Events.CONTENT_URI,new String[]{CalendarContract.Events._ID},CalendarContract.Events.CALENDAR_ID+"=? AND "+CalendarContract.Events.DESCRIPTION+"=?",new String[]{String.valueOf(calendar),"来自星野记 · "+uid},null)) { if(c!=null && c.moveToFirst()) old=new JSONObject().put("row",c.getLong(0)); } }
                if (old!=null) { long oldId=old.optLong("row",-1); int updated=getContentResolver().update(CalendarContract.Events.CONTENT_URI,values,CalendarContract.Events._ID+"=? AND "+CalendarContract.Events.CALENDAR_ID+"=?",new String[]{String.valueOf(oldId),String.valueOf(calendar)}); if(updated>0) eventId=oldId; else { map.put(uid,new JSONObject().put("row",oldId).put("signature",signature).put("deleted",true)); continue; } }
                if (eventId<0) { Uri inserted=getContentResolver().insert(CalendarContract.Events.CONTENT_URI,values); if(inserted==null) throw new IllegalStateException(); eventId=ContentUris.parseId(inserted); }
                getContentResolver().delete(CalendarContract.Reminders.CONTENT_URI,CalendarContract.Reminders.EVENT_ID+"=?",new String[]{String.valueOf(eventId)}); int reminder=e.optInt("reminder",10); if(reminder>=0) { ContentValues r=new ContentValues(); r.put(CalendarContract.Reminders.EVENT_ID,eventId); r.put(CalendarContract.Reminders.MINUTES,reminder); r.put(CalendarContract.Reminders.METHOD,CalendarContract.Reminders.METHOD_ALERT); getContentResolver().insert(CalendarContract.Reminders.CONTENT_URI,r); }
                map.put(uid,new JSONObject().put("row",eventId).put("signature",signature)); changed++;
            }
            ArrayList<String> removed=new ArrayList<>(); java.util.Iterator<String> keys=map.keys(); while(keys.hasNext()) { String uid=keys.next(); if(!keep.contains(uid)) removed.add(uid); }
            for(String uid:removed) { long row=map.getJSONObject(uid).getLong("row"); getContentResolver().delete(CalendarContract.Events.CONTENT_URI,CalendarContract.Events._ID+"=? AND "+CalendarContract.Events.CALENDAR_ID+"=?",new String[]{String.valueOf(row),String.valueOf(calendar)}); map.remove(uid); changed++; }
            preferences.edit().putString(mappingKey,map.toString()).apply(); if(changed>0) reply(true,"已同步 "+changed+" 处变更到系统日历"); runOnUiThread(() -> { for(int i=0;i<events.length();i++) { try { JSONObject e=events.getJSONObject(i); long due=millis(e,"start"); if(e.optBoolean("alarm",false) && due>System.currentTimeMillis() && due-System.currentTimeMillis()<86400000L && !preferences.getBoolean("alarm/"+e.getString("id")+"/"+due,false)) createAlarm(e); } catch(Exception ignored) {} } });
        } catch (Exception error) { reply(false,"系统日历同步失败，请检查权限；原始日程仍保留"); } finally { runOnUiThread(() -> { calendarBusy=false; if(pendingCalendar!=null) syncCalendar(); }); } });
    }
    private void createAlarm(JSONObject e) throws Exception {
        long due=millis(e,"start"); long now=System.currentTimeMillis(); if(due<=now || due-now>=24*60*60*1000L) { reply(false,"系统时钟只能创建接下来 24 小时内的单次闹钟，远期请使用日历提醒"); return; }
        // AlarmClock has no calendar date: use the phone's local clock and verify next occurrence.
        java.time.ZonedDateTime target=java.time.Instant.ofEpochMilli(due).atZone(ZoneId.systemDefault()); java.time.ZonedDateTime next=java.time.Instant.ofEpochMilli(now).atZone(ZoneId.systemDefault()).withHour(target.getHour()).withMinute(target.getMinute()).withSecond(0).withNano(0); if(!next.isAfter(java.time.Instant.ofEpochMilli(now).atZone(ZoneId.systemDefault()))) next=next.plusDays(1); if(Math.abs(next.toInstant().toEpochMilli()-due)>1000) { reply(false,"闹钟日期无法精确匹配，已保留日历提醒"); return; }
        String identity=e.getString("id")+"/"+due; if(preferences.getBoolean("alarm/"+identity,false)) { reply(true,"这条安排已请求过系统闹钟，请在系统时钟中核对"); return; }
        Intent alarm=new Intent(AlarmClock.ACTION_SET_ALARM).putExtra(AlarmClock.EXTRA_HOUR,target.getHour()).putExtra(AlarmClock.EXTRA_MINUTES,target.getMinute()).putExtra(AlarmClock.EXTRA_MESSAGE,"星野记 · "+e.getString("title")).putExtra(AlarmClock.EXTRA_SKIP_UI,false);
        if(alarm.resolveActivity(getPackageManager())==null) { reply(false,"未找到支持标准闹钟接口的系统时钟"); return; }
        startActivity(alarm); preferences.edit().putBoolean("alarm/"+identity,true).apply(); reply(true,"已交给系统时钟，请核对并确认闹钟；修改或删除日程不会自动删除系统闹钟");
    }
    private android.webkit.WebResourceResponse localError() { return new android.webkit.WebResourceResponse("text/plain","UTF-8",404,"Not Found",java.util.Collections.emptyMap(),new java.io.ByteArrayInputStream(new byte[0])); }
    private void rpc(String requestId,boolean ok,JSONObject data,String error) { runOnUiThread(() -> { try { if(port!=null) port.postMessage(new WebMessage(new JSONObject().put("requestId",requestId).put("ok",ok).put("data",data).put("error",error).toString())); } catch(Exception ignored) {} }); }
    private static final class HttpFailure extends Exception { final int status; HttpFailure(String message,int status) { super(message); this.status=status; } }
    private JSONObject aiHttp(JSONObject body,String apiKey) throws Exception {
        String target="https://api.deepseek.com/chat/completions", method="POST";
        javax.net.ssl.HttpsURLConnection connection=(javax.net.ssl.HttpsURLConnection)new java.net.URL(target).openConnection();connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(15000);connection.setReadTimeout(60000);connection.setRequestMethod(method);
        Uri parsed=Uri.parse(target);connection.setRequestProperty("Origin",parsed.getScheme()+"://"+parsed.getEncodedAuthority());
        if(apiKey!=null)connection.setRequestProperty("Authorization","Bearer "+apiKey);
        try { if(body!=null){connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/json");try(java.io.OutputStream out=connection.getOutputStream()){out.write(body.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));}}int status=connection.getResponseCode();java.io.InputStream input=status>=200&&status<300?connection.getInputStream():connection.getErrorStream();java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream();if(input!=null)try(java.io.InputStream stream=input){byte[] buffer=new byte[8192];int read;while((read=stream.read(buffer))!=-1){if(bytes.size()+read>16000000)throw new Exception("同步内容超过手机端限制");bytes.write(buffer,0,read);}}JSONObject result=bytes.size()>0?new JSONObject(bytes.toString("UTF-8")):new JSONObject();if(status<200||status>=300)throw new HttpFailure(result.optString("error","连接失败，状态码 "+status),status);return result;}finally{connection.disconnect();}
    }
    private void aiRequest(JSONObject message) {String requestId=message.optString("requestId");try{String apiKey=message.getString("apiKey"),model=message.getString("model"),system=message.getString("system");if(apiKey.length()>256||apiKey.length()<10||!model.matches("[A-Za-z0-9._-]{1,80}")||system.length()>8000)throw new Exception("AI 参数无效");JSONObject body=new JSONObject().put("model",model).put("messages",new JSONArray().put(new JSONObject().put("role","system").put("content",system)).put(new JSONObject().put("role","user").put("content",message.getJSONObject("payload").toString()))).put("response_format",new JSONObject().put("type","json_object")).put("thinking",new JSONObject().put("type","disabled")).put("max_tokens",4096).put("stream",false);rpc(requestId,true,aiHttp(body,apiKey),null);}catch(Exception error){rpc(requestId,false,null,"DeepSeek 请求失败，请检查网络、密钥和额度");}}
    private void saveFile(JSONObject message) throws Exception {String filename=message.getString("filename");if(filename.length()>180||filename.contains("/")||filename.contains("\\")||!filename.matches(".+\\.(vault|csv|ics|md|txt)"))throw new Exception("文件名无效");if(pendingExport!=null){rpc(message.optString("requestId"),false,null,"请先完成上一次文件保存");return;}pendingExport=android.util.Base64.decode(message.getString("content"),android.util.Base64.DEFAULT);if(pendingExport.length>16000000){pendingExport=null;throw new Exception("导出超过手机端 16 MB 限制");}pendingExportRequest=message.getString("requestId");startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/octet-stream").putExtra(Intent.EXTRA_TITLE,filename),201);}
    @Override protected void onActivityResult(int request,int result,Intent value) {super.onActivityResult(request,result,value);
        if (request==204) { if(pendingUnlockRequest!=null) { authorization.complete(pendingUnlockRequest,result==RESULT_OK); scheduleAuthorizationResult(); } return; }
        com.google.zxing.integration.android.IntentResult scan=com.google.zxing.integration.android.IntentIntegrator.parseActivityResult(request,result,value);
        if(scan!=null && pendingScanRequest!=null) { final String requestId=pendingScanRequest;pendingScanRequest=null;if(scan.getContents()==null){rpc(requestId,false,null,"已取消扫码");return;} confirmPairing(scan.getContents(),requestId);return; }
if(request==200&&fileCallback!=null){fileCallback.onReceiveValue(result==RESULT_OK&&value!=null&&value.getData()!=null?new Uri[]{value.getData()}:null);fileCallback=null;}if(request==201&&pendingExport!=null){final byte[] content=pendingExport;final String requestId=pendingExportRequest;pendingExport=null;pendingExportRequest=null;if(result!=RESULT_OK||value==null||value.getData()==null){rpc(requestId,false,null,"已取消导出");java.util.Arrays.fill(content,(byte)0);return;}final Uri uri=value.getData();worker.execute(()->{try(java.io.OutputStream out=getContentResolver().openOutputStream(uri)){if(out==null)throw new Exception();out.write(content);rpc(requestId,true,new JSONObject(),null);}catch(Exception error){rpc(requestId,false,null,"保存文件失败");}finally{java.util.Arrays.fill(content,(byte)0);}});}}
    private void confirmPairing(String contents, String requestId) {
        try {
            if(contents.length()>5000)throw new Exception("二维码内容过长");
            JSONObject invitation=new JSONObject(contents);
            if(!"xingye-pair".equals(invitation.optString("type")) || !invitation.optString("fingerprint").matches("[a-f0-9]{64}"))throw new Exception("这不是星野记电脑配对二维码");
            String text="请确认这是你自己的电脑。连接地址：\n"+invitation.getJSONArray("addresses").toString()+"\n\n电脑指纹：\n"+invitation.getString("fingerprint")+"\n\n连接后还需在电脑核对六位码并批准。";
            new AlertDialog.Builder(this).setTitle("核对电脑连接").setMessage(text).setPositiveButton("连接这台电脑",(dialog,which)->worker.execute(()->{try{rpc(requestId,true,pairing.pair(contents),null);}catch(Exception error){rpc(requestId,false,null,error.getMessage());}})).setNegativeButton("取消",(dialog,which)->rpc(requestId,false,null,"已取消配对")).setOnCancelListener(dialog->rpc(requestId,false,null,"已取消配对")).show();
        } catch(Exception error) { rpc(requestId,false,null,error.getMessage()); }
    }
    private void closeWeb() { cancelAuthorization();pendingScanRequest=null;scannerLaunchPending=false;if(pairing!=null)pairing.lock(); if(port!=null) { port.close(); port=null; } if(web!=null) { web.destroy(); web=null; } }
    @Override protected void onPause() { activityResumed=false;authorization.pause();if(web!=null)web.onPause(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); if(web!=null)web.onResume(); }
    @Override public void onWindowFocusChanged(boolean focused) {
        super.onWindowFocusChanged(focused);authorization.focus(focused);
        if(focused) { scheduleAuthorizationResult();mainHandler.post(this::startPairingScanner); }
    }
    @Override protected void onPostResume() {
        super.onPostResume();activityResumed=true;authorization.resume();scheduleAuthorizationResult();mainHandler.post(this::startPairingScanner);
        if(!crashReportShown) {
            crashReportShown=true;
            String report=CrashReports.read(this);
            if(report!=null) new AlertDialog.Builder(this).setTitle("上次运行异常退出")
                .setMessage("可复制错误摘要反馈给开发者，帮助修复。摘要包含设备型号、系统版本和错误位置，不包含日记或密码。")
                .setPositiveButton("复制错误摘要",(dialog,which)->{
                    android.content.ClipboardManager clipboard=(android.content.ClipboardManager)getSystemService(CLIPBOARD_SERVICE);
                    if(clipboard!=null)clipboard.setPrimaryClip(android.content.ClipData.newPlainText("星野记错误摘要",report));
                    CrashReports.clear(this);
                }).setNegativeButton("关闭",(dialog,which)->CrashReports.clear(this)).show();
        }
    }
    @Override protected void onStop() { if(pairing!=null && pendingUnlockRequest==null && pendingScanRequest==null && pendingExport==null && fileCallback==null)pairing.lock(); super.onStop(); }
    @Override public void onBackPressed() { new AlertDialog.Builder(this).setTitle("离开星野记？").setMessage("请先在页面内保存并锁定手记。系统日历中已同步的提醒仍由系统管理。").setPositiveButton("回到本机首页",(d,w)->{closeWeb();openWeb();}).setNegativeButton("留在这里",null).show(); }
    @Override public void onDestroy() { closeWeb(); worker.shutdown(); super.onDestroy(); }
}
