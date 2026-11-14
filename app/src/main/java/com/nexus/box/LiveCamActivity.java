package com.nexus.box;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

import org.json.JSONArray;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * LIVE CAM: one tap drops you on a random live camera somewhere in the world (24/7 YouTube live cams).
 * A list of cameras that are live right now is kept ready in the background, so a tap goes straight to video.
 * Tap the screen for a new random place; it also hops on its own every few minutes.
 */
public class LiveCamActivity extends Activity {

    private static final String[] SEARCHES = {
        "live webcam city 24/7", "live beach cam 24/7", "times square live cam", "tokyo live camera street",
        "shibuya crossing live camera", "las vegas strip live cam", "northern lights live cam", "africa safari live cam",
        "volcano live cam", "ocean live cam", "mountain live webcam", "airport live cam planes", "train live cam railfan",
        "japan live camera 24/7", "canada live webcam", "hawaii live cam", "miami beach live cam", "venice italy live webcam",
        "new york live cam", "london live webcam", "dubai live cam", "harbor live cam ships", "ski resort live cam",
        "niagara falls live cam", "space station live earth view"
    };
    private static final long REFRESH_MS = 3 * 60 * 60 * 1000L;

    // Makes the camera's video fill the whole screen and hides everything else on the page.
    private static final String FULLSCREEN_JS =
        "(function(){try{" +
        "if(!document.getElementById('nxs')){var s=document.createElement('style');s.id='nxs';" +
        "s.textContent='html,body{background:#000!important;overflow:hidden!important}" +
        "*{visibility:hidden!important}video,video *{visibility:visible!important}" +
        "video{position:fixed!important;left:0!important;top:0!important;width:100vw!important;height:100vh!important;" +
        "object-fit:contain!important;z-index:2147483647!important;background:#000!important}';" +
        "(document.head||document.documentElement).appendChild(s);}" +
        "var v=document.querySelector('video');if(!v)return 'no';" +
        "v.playsInline=true;if(v.paused){v.muted=false;var p=v.play();if(p&&p.catch)p.catch(function(){v.muted=true;v.play();});}" +
        "return (v.readyState>=2&&!v.paused&&v.currentTime>0)?'ok':'wait';}catch(e){return 'err';}})()";

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Random rnd = new Random();
    private WebView web;
    private TextView label, hint, cover;
    private String currentId = null;
    private final List<String> recent = new ArrayList<>();
    private int tries = 0;

    private final Runnable inject = new Runnable() {
        @Override public void run() {
            if (web == null) return;
            web.evaluateJavascript(FULLSCREEN_JS, v -> {
                if (v != null && v.contains("ok")) {
                    cover.animate().alpha(0f).setDuration(400).start();
                    ui.postDelayed(this, 3000);   // keep it fullscreen if the page re-renders
                } else if (++tries < 16) {
                    ui.postDelayed(this, 400);    // check fast so the picture shows the moment it's ready
                } else {
                    drop(currentId);              // this one won't play: forget it and go somewhere else
                    cover.setText("NO SIGNAL · JUMPING TO ANOTHER CAMERA");
                    ui.postDelayed(LiveCamActivity.this::jump, 600);
                }
            });
        }
    };
    private final Runnable autoHop = this::jump;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setBlockNetworkImage(true);       // we only need the video: skip thumbnails, loads faster
        web.setBackgroundColor(Color.BLACK);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                String h = u == null ? "" : String.valueOf(u.getHost());
                return !(h.endsWith("youtube.com") || h.endsWith("google.com") || h.endsWith("youtu.be"));   // block pop-ups taking us elsewhere
            }
            @Override public void onPageFinished(WebView v, String url) { tries = 0; ui.removeCallbacks(inject); ui.post(inject); }
        });
        web.setOnTouchListener((v, e) -> {
            if (e.getAction() == android.view.MotionEvent.ACTION_UP) jump();
            return true;    // the page itself never gets touches (no ads clicked)
        });
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));

        cover = new TextView(this);
        cover.setBackgroundColor(Color.BLACK);
        cover.setTextColor(Color.parseColor("#3dff9a"));
        cover.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        cover.setTextSize(20);
        cover.setGravity(Gravity.CENTER);
        cover.setLetterSpacing(.15f);
        cover.setPadding(40, 0, 40, 0);
        root.addView(cover, new FrameLayout.LayoutParams(-1, -1));

        label = new TextView(this);
        label.setTextColor(Color.WHITE);
        label.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        label.setTextSize(15);
        label.setShadowLayer(8, 0, 0, Color.BLACK);
        label.setPadding(30, 22, 30, 12);
        label.setMaxLines(1);
        root.addView(label, new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.START));

        hint = new TextView(this);
        hint.setText("TAP FOR A NEW PLACE  ·  BACK TO EXIT");
        hint.setTextColor(Color.parseColor("#bbffffff"));
        hint.setTypeface(Typeface.MONOSPACE);
        hint.setTextSize(12);
        hint.setShadowLayer(6, 0, 0, Color.BLACK);
        hint.setPadding(30, 10, 30, 22);
        root.addView(hint, new FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM | Gravity.END));

        setContentView(root);
        hideSystemUi();

        if (pool(this).length() > 0) jump();
        else { cover.setText("◍  FINDING A LIVE CAMERA…"); }
        // top the list up in the background (and right away if it's empty)
        new Thread(() -> {
            int before = pool(this).length();
            harvest(this, before == 0 ? 2 : 1);
            if (before == 0) ui.post(this::jump);
        }).start();
    }

    // ---------- the list of cameras that are live right now ----------

    private static SharedPreferences sp(Context c) { return c.getSharedPreferences("nexus", MODE_PRIVATE); }

    static JSONArray pool(Context c) {
        try { return new JSONArray(sp(c).getString("camPool", "[]")); } catch (Exception e) { return new JSONArray(); }
    }

    static boolean stale(Context c) { return System.currentTimeMillis() - sp(c).getLong("camPoolTime", 0) > REFRESH_MS || pool(c).length() < 12; }

    private static final Pattern VR = Pattern.compile("\"videoRenderer\":\\{\"videoId\":\"([A-Za-z0-9_-]{11})\"(.{0,4000}?)\"title\":\\{\"runs\":\\[\\{\"text\":\"((?:[^\"\\\\]|\\\\.)*)\"", Pattern.DOTALL);

    /** Look up live cameras on YouTube (a few searches) and keep the list. Runs on a background thread. */
    static synchronized void harvest(Context c, int searches) {
        try {
            JSONArray pool = pool(c);
            java.util.LinkedHashMap<String, String> map = new java.util.LinkedHashMap<>();
            for (int i = 0; i < pool.length(); i++) { JSONArray e = pool.getJSONArray(i); map.put(e.getString(0), e.getString(1)); }
            Random r = new Random();
            for (int n = 0; n < searches; n++) {
                String q = SEARCHES[r.nextInt(SEARCHES.length)];
                String html = get("https://www.youtube.com/results?search_query=" + URLEncoder.encode(q, "UTF-8") + "&sp=EgJAAQ%253D%253D");
                if (html == null) continue;
                Matcher m = VR.matcher(html);
                int found = 0;
                while (m.find() && found < 20) {
                    String id = m.group(1);
                    String title = m.group(3).replace("\\u0026", "&").replace("\\\"", "\"").replace("\\/", "/");
                    String t = title.toLowerCase();
                    // only real cameras: skip news channels, music streams, gaming, etc.
                    if (!(t.contains("cam") || t.contains("live view") || t.contains("live stream") && (t.contains("beach") || t.contains("city") || t.contains("street")))) continue;
                    if (t.contains("music") || t.contains("radio") || t.contains("lofi") || t.contains("news") || t.contains("game") || t.contains("chat")) continue;
                    map.put(id, title);
                    found++;
                }
            }
            JSONArray out = new JSONArray();
            List<String> keys = new ArrayList<>(map.keySet());
            int start = Math.max(0, keys.size() - 80);
            for (int i = start; i < keys.size(); i++) { JSONArray e = new JSONArray(); e.put(keys.get(i)); e.put(map.get(keys.get(i))); out.put(e); }
            sp(c).edit().putString("camPool", out.toString()).putLong("camPoolTime", System.currentTimeMillis()).apply();
        } catch (Exception ignored) {}
    }

    private static String get(String url) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(8000); c.setReadTimeout(12000);
            c.setRequestProperty("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36");
            c.setRequestProperty("Accept-Language", "en-US,en;q=0.9");
            c.setRequestProperty("Cookie", "CONSENT=YES+1; SOCS=CAI");
            if (c.getResponseCode() >= 400) return null;
            InputStream is = c.getInputStream(); ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[16384]; int n; while ((n = is.read(buf)) > 0) bo.write(buf, 0, n); is.close();
            return bo.toString("UTF-8");
        } catch (Exception e) { return null; } finally { if (c != null) c.disconnect(); }
    }

    private void drop(String id) {
        if (id == null) return;
        try {
            JSONArray p = pool(this), out = new JSONArray();
            for (int i = 0; i < p.length(); i++) if (!p.getJSONArray(i).getString(0).equals(id)) out.put(p.getJSONArray(i));
            sp(this).edit().putString("camPool", out.toString()).apply();
        } catch (Exception ignored) {}
    }

    // ---------- playing ----------

    private void jump() {
        JSONArray p = pool(this);
        if (p.length() == 0) { cover.setAlpha(1f); cover.setText("NO LIVE CAMERAS FOUND · CHECK THE INTERNET"); return; }
        String id = null, title = "";
        try {
            for (int k = 0; k < 12; k++) {
                JSONArray e = p.getJSONArray(rnd.nextInt(p.length()));
                id = e.getString(0); title = e.getString(1);
                if (!recent.contains(id)) break;
            }
        } catch (Exception ignored) {}
        if (id == null) return;
        currentId = id;
        recent.add(id); if (recent.size() > 10) recent.remove(0);
        tries = 0;
        ui.removeCallbacks(inject);
        ui.removeCallbacks(autoHop);
        cover.setAlpha(1f);
        cover.setText("◍  TUNING IN…\n\n" + title.toUpperCase());
        label.setText("● LIVE  ·  " + title);
        web.loadUrl("https://m.youtube.com/watch?v=" + id);
        ui.postDelayed(inject, 900);
        ui.postDelayed(autoHop, 3 * 60 * 1000);   // hop somewhere new every 3 minutes
    }

    private void hideSystemUi() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
    }

    @Override public void onWindowFocusChanged(boolean f) { super.onWindowFocusChanged(f); if (f) hideSystemUi(); }

    @Override protected void onPause() { super.onPause(); if (web != null) web.onPause(); }
    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); }

    @Override
    protected void onDestroy() {
        ui.removeCallbacksAndMessages(null);
        if (web != null) { web.loadUrl("about:blank"); web.destroy(); web = null; }
        super.onDestroy();
    }
}
