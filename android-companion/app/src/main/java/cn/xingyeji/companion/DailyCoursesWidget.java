package cn.xingyeji.companion;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import android.util.AtomicFile;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import org.json.JSONArray;
import org.json.JSONObject;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import java.security.KeyStore;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;

/** Explicit opt-in, course-only desktop cache encrypted with an Android Keystore key. */
public final class DailyCoursesWidget extends AppWidgetProvider {
    private static AtomicFile file(Context c) { return new AtomicFile(new java.io.File(c.getFilesDir(),"daily-courses.enc")); }
    private static SecretKey key() throws Exception {
        String alias="xingye-course-widget";
        KeyStore store=KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if(store.containsAlias(alias)) return (SecretKey)store.getKey(alias,null);
        KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }
    public static synchronized void save(Context c,JSONArray rows,boolean enable) throws Exception {
        if(rows.length()>10000) throw new IllegalArgumentException("课程数量过多");
        JSONArray clean=new JSONArray();
        for(int i=0;i<rows.length();i++) {
            JSONObject e=rows.getJSONObject(i);String title=e.getString("title"),date=e.getString("date"),start=e.getString("start"),end=e.getString("end"),location=e.optString("location","");LocalDate.parse(date);
            if(title.length()>120 || location.length()>120 || !start.matches("(?:[01]\\d|2[0-3]):[0-5]\\d") || !end.matches("(?:[01]\\d|2[0-3]):[0-5]\\d") || start.compareTo(end)>=0)throw new IllegalArgumentException("课程格式无效");
            clean.put(new JSONObject().put("title",title).put("date",date).put("start",start).put("end",end).put("location",location));
        }
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());
        byte[] plain=clean.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8),body;
        try { body=cipher.doFinal(plain); } finally { java.util.Arrays.fill(plain,(byte)0); }
        AtomicFile target=file(c);java.io.FileOutputStream out=null;
        try { out=target.startWrite();out.write(cipher.getIV());out.write(body);target.finishWrite(out); }
        catch(Exception error) { if(out!=null)target.failWrite(out);throw error; }
        if(enable)c.getSharedPreferences("course-widget",Context.MODE_PRIVATE).edit().putBoolean("enabled",true).apply();
        updateAll(c);
    }
    public static synchronized void clear(Context c) {
        c.getSharedPreferences("course-widget",Context.MODE_PRIVATE).edit().putBoolean("enabled",false).apply();file(c).delete();updateAll(c);
    }
    public static void updateAll(Context c) { AppWidgetManager m=AppWidgetManager.getInstance(c);render(c,m,m.getAppWidgetIds(new ComponentName(c,DailyCoursesWidget.class))); }
    @Override public void onUpdate(Context c,AppWidgetManager m,int[] ids) { render(c,m,ids); }
    @Override public void onDisabled(Context c) { clear(c); }
    private static void render(Context c,AppWidgetManager m,int[] ids) {
        String today=LocalDate.now(ZoneId.of("Asia/Shanghai")).toString(),content="打开星野记，在每日课表中启用桌面展示";
        if(c.getSharedPreferences("course-widget",Context.MODE_PRIVATE).getBoolean("enabled",false))try {
            byte[] bytes=file(c).readFully();if(bytes.length<28 || bytes.length>8*1024*1024)throw new IllegalArgumentException();
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,bytes,0,12));
            byte[] plain=cipher.doFinal(bytes,12,bytes.length-12);JSONArray rows;
            try{rows=new JSONArray(new String(plain,java.nio.charset.StandardCharsets.UTF_8));}finally{java.util.Arrays.fill(plain,(byte)0);}
            ArrayList<String> lines=new ArrayList<>();
            for(int i=0;i<rows.length();i++){JSONObject e=rows.getJSONObject(i);if(today.equals(e.getString("date")))lines.add(e.getString("start")+"–"+e.getString("end")+"  "+e.getString("title")+"\n"+e.optString("location",""));}
            java.util.Collections.sort(lines);content=lines.isEmpty()?"今天没有课程，留一点时间给自己。":String.join("\n\n",lines.subList(0,Math.min(5,lines.size())))+(lines.size()>5?"\n\n另有 "+(lines.size()-5)+" 节，点此查看":"");
        }catch(Exception error){content="课表暂不可读，请打开应用更新";}
        for(int id:ids){RemoteViews v=new RemoteViews(c.getPackageName(),R.layout.daily_courses_widget);v.setTextViewText(R.id.widget_date,today+" · 每日课表");v.setTextViewText(R.id.widget_courses,content);
            Intent open=new Intent(c,MainActivity.class).putExtra("openCourses",true).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
            v.setOnClickPendingIntent(R.id.widget_root,PendingIntent.getActivity(c,id,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE));m.updateAppWidget(id,v);}
    }
}
