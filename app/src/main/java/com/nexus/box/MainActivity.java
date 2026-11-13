package com.nexus.box;

import android.Manifest;
import android.app.Activity;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.media.AudioManager;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {

    private WebView web;
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private final List<String[]> pendingSpeech = new ArrayList<>();
    private SpeechRecognizer recognizer;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService pool = Executors.newFixedThreadPool(3);
    private SharedPreferences prefs;
    private String appsCache = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("nexus", MODE_PRIVATE);

        Window w = getWindow();
        w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        w.addFlags(WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED);

        web = new WebView(this);
        web.setBackgroundColor(0xFF01030F);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(true);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new Bridge(), "Android");
        setContentView(web);
        hideSystemUi();

        tts = new TextToSpeech(this, status -> {
            if (status == TextToSpeech.SUCCESS) {
                applyVoice();
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String id) { js("Nexus._speakStart(" + JSONObject.quote(id) + ")"); }
                    @Override public void onDone(String id) { js("Nexus._spoken(" + JSONObject.quote(id) + ")"); }
                    @Override public void onError(String id) { js("Nexus._spoken(" + JSONObject.quote(id) + ")"); }
                });
                ttsReady = true;
                synchronized (pendingSpeech) {
                    for (String[] p : pendingSpeech) doSpeak(p[0], p[1]);
                    pendingSpeech.clear();
                }
            }
        });

        if (Build.VERSION.SDK_INT >= 23 &&
                checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, 7);
        }

        String page = "file:///android_asset/index.html";
        web.loadUrl(savedInstanceState == null ? page + "#boot" : page);
    }

    private void hideSystemUi() {
        web.setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        js("Nexus.home && Nexus.home()");
    }

    @Override
    protected void onResume() {
        super.onResume();
        js("Nexus.resumed && Nexus.resumed()");
    }

    @Override
    public void onBackPressed() {
        js("Nexus.back && Nexus.back()");
    }

    @Override
    protected void onDestroy() {
        if (tts != null) tts.shutdown();
        if (recognizer != null) recognizer.destroy();
        pool.shutdownNow();
        super.onDestroy();
    }

    private void js(final String code) {
        ui.post(() -> { if (web != null) web.evaluateJavascript(code, null); });
    }

    // ---------- Voice ----------

    private void applyVoice() {
        if (tts == null) return;
        tts.setSpeechRate(prefs.getFloat("rate", 0.95f));
        tts.setPitch(prefs.getFloat("pitch", 0.9f));
        String chosen = prefs.getString("voice", "");
        Set<Voice> voices = null;
        try { voices = tts.getVoices(); } catch (Exception ignored) {}
        if (voices != null) {
            if (!chosen.isEmpty()) {
                for (Voice v : voices) if (v.getName().equals(chosen)) { tts.setVoice(v); return; }
            }
            String[] preferred = {"en-gb-x-rjs", "en-gb-x-gbd", "en-gb-x-gbb", "en-us-x-iom", "en-us-x-iol", "en-us-x-tpd"};
            for (String p : preferred) {
                for (Voice v : voices) {
                    if (v.getName().startsWith(p) && !v.isNetworkConnectionRequired()) { tts.setVoice(v); return; }
                }
            }
        }
        tts.setLanguage(Locale.UK);
    }

    private void doSpeak(String text, String id) {
        Bundle b = new Bundle();
        b.putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, AudioManager.STREAM_MUSIC);
        tts.speak(text, TextToSpeech.QUEUE_ADD, b, id);
    }

    // ---------- Speech recognition ----------

    private void startListening() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            js("Nexus._heardError('unavailable')");
            return;
        }
        if (recognizer == null) {
            recognizer = SpeechRecognizer.createSpeechRecognizer(this);
            recognizer.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle params) { js("Nexus._listening(true)"); }
                @Override public void onBeginningOfSpeech() {}
                @Override public void onRmsChanged(float rmsdB) { js("Nexus._level(" + rmsdB + ")"); }
                @Override public void onBufferReceived(byte[] buffer) {}
                @Override public void onEndOfSpeech() { js("Nexus._listening(false)"); }
                @Override public void onError(int error) { js("Nexus._heardError('" + error + "')"); }
                @Override public void onResults(Bundle results) {
                    ArrayList<String> r = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    String best = (r != null && !r.isEmpty()) ? r.get(0) : "";
                    js("Nexus._heard(" + JSONObject.quote(best) + ")");
                }
                @Override public void onPartialResults(Bundle partial) {
                    ArrayList<String> r = partial.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    if (r != null && !r.isEmpty()) js("Nexus._partial(" + JSONObject.quote(r.get(0)) + ")");
                }
                @Override public void onEvent(int eventType, Bundle params) {}
            });
        }
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag());
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        try { recognizer.startListening(i); } catch (Exception e) { js("Nexus._heardError('start')"); }
    }

    // ---------- Apps ----------

    private List<ResolveInfo> launchables() {
        Intent main = new Intent(Intent.ACTION_MAIN);
        main.addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> list = getPackageManager().queryIntentActivities(main, 0);
        return list == null ? new ArrayList<>() : list;
    }

    private boolean launch(ResolveInfo ri) {
        try {
            Intent i = new Intent(Intent.ACTION_MAIN);
            i.addCategory(Intent.CATEGORY_LAUNCHER);
            i.setComponent(new ComponentName(ri.activityInfo.packageName, ri.activityInfo.name));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
            startActivity(i);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private String iconBase64(Drawable d) {
        try {
            int size = 72;
            Bitmap bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
            Canvas c = new Canvas(bmp);
            d.setBounds(0, 0, size, size);
            d.draw(c);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            bmp.compress(Bitmap.CompressFormat.PNG, 90, out);
            bmp.recycle();
            return "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        } catch (Exception e) {
            return "";
        }
    }

    // ---------- HTTP ----------

    private void http(String id, String method, String url, String body, String headersJson) {
        pool.execute(() -> {
            int code = 0;
            String text = "";
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setRequestMethod(method);
                c.setConnectTimeout(15000);
                c.setReadTimeout(45000);
                if (headersJson != null && !headersJson.isEmpty()) {
                    JSONObject h = new JSONObject(headersJson);
                    Iterator<String> keys = h.keys();
                    while (keys.hasNext()) { String k = keys.next(); c.setRequestProperty(k, h.getString(k)); }
                }
                if (body != null && !body.isEmpty()) {
                    c.setDoOutput(true);
                    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                    try (OutputStream os = c.getOutputStream()) { os.write(bytes); }
                }
                code = c.getResponseCode();
                InputStream is = code >= 400 ? c.getErrorStream() : c.getInputStream();
                if (is != null) {
                    ByteArrayOutputStream bo = new ByteArrayOutputStream();
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = is.read(buf)) > 0) bo.write(buf, 0, n);
                    text = bo.toString("UTF-8");
                    is.close();
                }
            } catch (Exception e) {
                code = -1;
                text = String.valueOf(e.getMessage());
            } finally {
                if (c != null) c.disconnect();
            }
            js("Nexus._http(" + JSONObject.quote(id) + "," + code + "," + JSONObject.quote(text) + ")");
        });
    }

    // ---------- JS bridge ----------

    private class Bridge {

        @JavascriptInterface
        public void speak(String text, String id) {
            if (tts == null) return;
            if (!ttsReady) { synchronized (pendingSpeech) { pendingSpeech.add(new String[]{text, id}); } return; }
            doSpeak(text, id);
        }

        @JavascriptInterface
        public void stopSpeaking() { if (tts != null) tts.stop(); }

        @JavascriptInterface
        public void listen() { ui.post(MainActivity.this::startListening); }

        @JavascriptInterface
        public void stopListening() { ui.post(() -> { if (recognizer != null) recognizer.cancel(); }); }

        @JavascriptInterface
        public String getVoices() {
            JSONArray arr = new JSONArray();
            try {
                if (tts != null && tts.getVoices() != null) {
                    List<String> names = new ArrayList<>();
                    for (Voice v : tts.getVoices()) {
                        if (v.getLocale() != null && "en".equals(v.getLocale().getLanguage())) names.add(v.getName());
                    }
                    Collections.sort(names);
                    for (String n : names) arr.put(n);
                }
            } catch (Exception ignored) {}
            return arr.toString();
        }

        @JavascriptInterface
        public String currentVoice() {
            try { return tts.getVoice() != null ? tts.getVoice().getName() : ""; } catch (Exception e) { return ""; }
        }

        @JavascriptInterface
        public void setVoice(String name) {
            prefs.edit().putString("voice", name).apply();
            ui.post(MainActivity.this::applyVoice);
        }

        @JavascriptInterface
        public void setVoiceTuning(float rate, float pitch) {
            prefs.edit().putFloat("rate", rate).putFloat("pitch", pitch).apply();
            ui.post(MainActivity.this::applyVoice);
        }

        @JavascriptInterface
        public String getPref(String key) { return prefs.getString("p_" + key, ""); }

        @JavascriptInterface
        public void setPref(String key, String value) { prefs.edit().putString("p_" + key, value).apply(); }

        @JavascriptInterface
        public String getApps() {
            if (appsCache != null) return appsCache;
            JSONArray arr = new JSONArray();
            PackageManager pm = getPackageManager();
            List<ResolveInfo> list = launchables();
            Collections.sort(list, (a, b) -> String.valueOf(a.loadLabel(pm)).compareToIgnoreCase(String.valueOf(b.loadLabel(pm))));
            for (ResolveInfo ri : list) {
                if (ri.activityInfo.packageName.equals(getPackageName())) continue;
                try {
                    JSONObject o = new JSONObject();
                    o.put("label", String.valueOf(ri.loadLabel(pm)));
                    o.put("pkg", ri.activityInfo.packageName);
                    o.put("cls", ri.activityInfo.name);
                    o.put("icon", iconBase64(ri.loadIcon(pm)));
                    arr.put(o);
                } catch (Exception ignored) {}
            }
            appsCache = arr.toString();
            return appsCache;
        }

        @JavascriptInterface
        public void refreshApps() { appsCache = null; }

        @JavascriptInterface
        public boolean launchApp(String namesCsv) {
            PackageManager pm = getPackageManager();
            List<ResolveInfo> list = launchables();
            for (String raw : namesCsv.split(",")) {
                String q = raw.trim().toLowerCase(Locale.ROOT);
                if (q.isEmpty()) continue;
                for (ResolveInfo ri : list) {
                    if (ri.activityInfo.packageName.equals(getPackageName())) continue;
                    String label = String.valueOf(ri.loadLabel(pm)).toLowerCase(Locale.ROOT);
                    String pkg = ri.activityInfo.packageName.toLowerCase(Locale.ROOT);
                    if (label.contains(q) || pkg.contains(q)) {
                        final ResolveInfo target = ri;
                        ui.post(() -> launch(target));
                        return true;
                    }
                }
            }
            return false;
        }

        @JavascriptInterface
        public void launchComponent(String pkg, String cls) {
            ui.post(() -> {
                try {
                    Intent i = new Intent(Intent.ACTION_MAIN);
                    i.addCategory(Intent.CATEGORY_LAUNCHER);
                    i.setComponent(new ComponentName(pkg, cls));
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
                    startActivity(i);
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Could not open that app", Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public String otherHomes() {
            JSONArray arr = new JSONArray();
            Intent home = new Intent(Intent.ACTION_MAIN);
            home.addCategory(Intent.CATEGORY_HOME);
            PackageManager pm = getPackageManager();
            List<ResolveInfo> list = pm.queryIntentActivities(home, 0);
            if (list != null) for (ResolveInfo ri : list) {
                if (ri.activityInfo.packageName.equals(getPackageName())) continue;
                try {
                    JSONObject o = new JSONObject();
                    o.put("label", String.valueOf(ri.loadLabel(pm)));
                    o.put("pkg", ri.activityInfo.packageName);
                    o.put("cls", ri.activityInfo.name);
                    arr.put(o);
                } catch (Exception ignored) {}
            }
            return arr.toString();
        }

        @JavascriptInterface
        public void openOtherHome(String pkg, String cls) {
            ui.post(() -> {
                try {
                    Intent i = new Intent(Intent.ACTION_MAIN);
                    i.addCategory(Intent.CATEGORY_HOME);
                    i.setComponent(new ComponentName(pkg, cls));
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i);
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Could not open that home screen", Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public void openSystemSettings() {
            ui.post(() -> {
                try { startActivity(new Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
                catch (Exception ignored) {}
            });
        }

        @JavascriptInterface
        public void openHomeChooser() {
            ui.post(() -> {
                try { startActivity(new Intent(Settings.ACTION_HOME_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
                catch (Exception e) {
                    try { startActivity(new Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); } catch (Exception ignored) {}
                }
            });
        }

        @JavascriptInterface
        public void http(String id, String method, String url, String body, String headersJson) {
            MainActivity.this.http(id, method, url, body, headersJson);
        }

        @JavascriptInterface
        public boolean isOnline() {
            try {
                ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
                NetworkInfo ni = cm.getActiveNetworkInfo();
                return ni != null && ni.isConnected();
            } catch (Exception e) { return true; }
        }

        @JavascriptInterface
        public void setBrightness(float value) {
            ui.post(() -> {
                WindowManager.LayoutParams lp = getWindow().getAttributes();
                lp.screenBrightness = value < 0 ? WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE : value;
                getWindow().setAttributes(lp);
            });
        }

        @JavascriptInterface
        public void toast(String msg) {
            ui.post(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show());
        }

        @JavascriptInterface
        public String version() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
            catch (Exception e) { return "?"; }
        }
    }
}
