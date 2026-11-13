package com.nexus.box;

import android.Manifest;
import android.app.Activity;
import android.content.ComponentName;
import android.content.Context;
import android.content.BroadcastReceiver;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.location.Address;
import android.location.Geocoder;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaMetadata;
import android.media.MediaPlayer;
import java.io.File;
import android.media.audiofx.Visualizer;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.view.KeyEvent;
import android.media.MediaRecorder;
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
    private volatile boolean meterOn = false;
    private volatile List<String[]> labelCache = null;
    // Spotify's "Device broadcast status" feed (works even when notification access is blocked on the box)
    private volatile String spTitle = null, spArtist = null;
    private volatile boolean spPlaying = false;
    private volatile long spTime = 0;
    private final BroadcastReceiver spotifyReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) {
            String a = i.getAction();
            if (a == null) return;
            if (a.endsWith("metadatachanged")) {
                spTitle = i.getStringExtra("track");
                spArtist = i.getStringExtra("artist");
                if (i.hasExtra("playing")) spPlaying = i.getBooleanExtra("playing", spPlaying);
            } else if (a.endsWith("playbackstatechanged")) {
                spPlaying = i.getBooleanExtra("playing", false);
            }
            spTime = System.currentTimeMillis();
        }
    };
    private Thread meterThread = null;
    private Visualizer visualizer = null;

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

        startTts();
        pool.execute(this::labels);
        try {
            IntentFilter f = new IntentFilter();
            f.addAction("com.spotify.music.metadatachanged");
            f.addAction("com.spotify.music.playbackstatechanged");
            registerReceiver(spotifyReceiver, f);
        } catch (Exception ignored) {}

        if (Build.VERSION.SDK_INT >= 23) {
            List<String> need = new ArrayList<>();
            for (String perm : new String[]{Manifest.permission.RECORD_AUDIO, Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}) {
                if (checkSelfPermission(perm) != PackageManager.PERMISSION_GRANTED) need.add(perm);
            }
            if (!need.isEmpty()) requestPermissions(need.toArray(new String[0]), 7);
        }

        // Start the recorded greeting right away, before the screen has even finished loading.
        if (savedInstanceState == null) {
            int hr = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY);
            String key = hr >= 4 && hr < 12 ? "morning" : hr >= 12 && hr < 17 ? "afternoon" : "evening";
            if (greetFile(key).exists() && greetFile(key).length() > 1000) {
                nativeGreeting = true;
                nativeGreetUsed = true;
                playGreeting(key, "", "nativegreet");
            }
        }

        String page = "file:///android_asset/index.html";
        web.loadUrl(savedInstanceState == null ? page + "#boot" : page);
    }

    private void startTts() {
        TextToSpeech.OnInitListener listener = status -> {
            if (status == TextToSpeech.SUCCESS) {
                applyVoice();
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String id) { js("Nexus._speakStart(" + JSONObject.quote(id) + ")"); }
                    @Override public void onDone(String id) { js("Nexus._spoken(" + JSONObject.quote(id) + ")"); }
                    @Override public void onError(String id) { js("Nexus._spoken(" + JSONObject.quote(id) + ")"); }
                });
                ttsReady = true;
                ui.postDelayed(MainActivity.this::cacheGreetings, 4000);
                synchronized (pendingSpeech) {
                    for (String[] p : pendingSpeech) doSpeak(p[0], p[1]);
                    pendingSpeech.clear();
                }
            }
        };
        boolean hasGoogle = false;
        try { getPackageManager().getPackageInfo("com.google.android.tts", 0); hasGoogle = true; } catch (Exception ignored) {}
        tts = hasGoogle ? new TextToSpeech(this, listener, "com.google.android.tts") : new TextToSpeech(this, listener);
    }

    // ---------- Instant greeting: record it once, then play the recording at startup ----------

    private static final String[][] GREETINGS = {
        {"morning", "Good morning, Nathan. I am Nexus, your personal assistant. How may I assist you?"},
        {"afternoon", "Good afternoon, Nathan. I am Nexus, your personal assistant. How may I assist you?"},
        {"evening", "Good evening, Nathan. I am Nexus, your personal assistant. How may I assist you?"}
    };

    private File greetFile(String key) { return new File(getFilesDir(), "greet_" + key + ".wav"); }

    private void cacheGreetings() {
        if (!ttsReady) return;
        for (String[] g : GREETINGS) {
            File f = greetFile(g[0]);
            if (f.exists() && f.length() > 1000) continue;
            try {
                Bundle b = new Bundle();
                tts.synthesizeToFile(g[1], b, f, "cache_" + g[0]);
            } catch (Exception ignored) {}
        }
    }

    private void clearGreetings() {
        for (String[] g : GREETINGS) { try { greetFile(g[0]).delete(); } catch (Exception ignored) {} }
        ui.postDelayed(this::cacheGreetings, 1500);
    }

    private MediaPlayer greetPlayer;
    private volatile boolean nativeGreeting = false;
    private volatile boolean nativeGreetUsed = false;

    private void playGreeting(String key, String text, String id) {
        File f = greetFile(key);
        if (f.exists() && f.length() > 1000) {
            try {
                if (greetPlayer != null) greetPlayer.release();
                greetPlayer = new MediaPlayer();
                greetPlayer.setAudioStreamType(AudioManager.STREAM_MUSIC);
                greetPlayer.setDataSource(f.getAbsolutePath());
                greetPlayer.setOnCompletionListener(mp -> { nativeGreeting = false; js("Nexus._spoken(" + JSONObject.quote(id) + ")"); mp.release(); greetPlayer = null; });
                greetPlayer.setOnErrorListener((mp, w, e) -> { nativeGreeting = false; js("Nexus._spoken(" + JSONObject.quote(id) + ")"); return true; });
                greetPlayer.prepare();
                greetPlayer.start();
                return;
            } catch (Exception ignored) {}
        }
        if (!ttsReady) { synchronized (pendingSpeech) { pendingSpeech.add(new String[]{text, id}); } }
        else doSpeak(text, id);
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
        if (web != null) { web.onResume(); web.resumeTimers(); }
        js("Nexus.resumed && Nexus.resumed()");
    }

    @Override
    protected void onPause() {
        // Stop all drawing and timers while another app (SmartTube, Stremio...) is on screen.
        if (web != null) { web.onPause(); web.pauseTimers(); }
        js("Nexus.paused && Nexus.paused()");
        super.onPause();
    }

    @Override
    public void onBackPressed() {
        js("Nexus.back && Nexus.back()");
    }

    @Override
    protected void onDestroy() {
        if (tts != null) tts.shutdown();
        stopMeter();
        try { unregisterReceiver(spotifyReceiver); } catch (Exception ignored) {}
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
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 700L);
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 600L);
        i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());
        try { recognizer.startListening(i); } catch (Exception e) { js("Nexus._heardError('start')"); }
    }

    // ---------- Apps ----------

    private List<ResolveInfo> launchables() {
        Intent main = new Intent(Intent.ACTION_MAIN);
        main.addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> list = getPackageManager().queryIntentActivities(main, 0);
        return list == null ? new ArrayList<>() : list;
    }

    private List<String[]> labels() {
        List<String[]> c = labelCache;
        if (c != null) return c;
        PackageManager pm = getPackageManager();
        List<String[]> out = new ArrayList<>();
        for (ResolveInfo ri : launchables()) {
            if (ri.activityInfo.packageName.equals(getPackageName())) continue;
            out.add(new String[]{String.valueOf(ri.loadLabel(pm)).toLowerCase(Locale.ROOT),
                    ri.activityInfo.packageName, ri.activityInfo.name});
        }
        labelCache = out;
        return out;
    }

    private void startComponent(String pkg, String cls) {
        try {
            Intent i = new Intent(Intent.ACTION_MAIN);
            i.addCategory(Intent.CATEGORY_LAUNCHER);
            i.setComponent(new ComponentName(pkg, cls));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
            startActivity(i);
        } catch (Exception e) {
            Toast.makeText(this, "Could not open that app", Toast.LENGTH_SHORT).show();
        }
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

    // ---------- Party meter (listens to the music in the cab) ----------

    private boolean startVisualizer() {
        // Listens to the music the box itself is playing (no microphone, so the music isn't turned down).
        try {
            Visualizer v = new Visualizer(0);
            v.setEnabled(false);
            int[] range = Visualizer.getCaptureSizeRange();
            v.setCaptureSize(Math.min(1024, range[1]));
            v.setScalingMode(Visualizer.SCALING_MODE_NORMALIZED);
            v.setDataCaptureListener(new Visualizer.OnDataCaptureListener() {
                long lastSend = 0;
                @Override public void onWaveFormDataCapture(Visualizer vis, byte[] wave, int rate) {
                    long now = System.currentTimeMillis();
                    if (now - lastSend < 70) return;
                    lastSend = now;
                    double sum = 0;
                    for (byte b : wave) { double x = ((b & 0xFF) - 128) / 128.0; sum += x * x; }
                    double rms = Math.sqrt(sum / Math.max(1, wave.length)) * 0.35;
                    js("Nexus._meter && Nexus._meter(" + String.format(Locale.US, "%.4f", rms) + ")");
                }
                @Override public void onFftDataCapture(Visualizer vis, byte[] fft, int rate) {}
            }, Math.min(Visualizer.getMaxCaptureRate(), 20000), true, false);
            v.setEnabled(true);
            visualizer = v;
            return true;
        } catch (Throwable t) {
            visualizer = null;
            return false;
        }
    }

    private void startMeter() {
        if (meterOn) return;
        if (Build.VERSION.SDK_INT >= 23 && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            js("Nexus._meterError && Nexus._meterError('permission')");
            return;
        }
        meterOn = true;
        if (startVisualizer()) { js("Nexus._meterSource && Nexus._meterSource('music')"); return; }
        js("Nexus._meterSource && Nexus._meterSource('mic')");
        meterThread = new Thread(() -> {
            int rate = 22050;
            int min = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            AudioRecord rec = null;
            try {
                rec = new AudioRecord(MediaRecorder.AudioSource.MIC, rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(min, 4096));
                rec.startRecording();
                short[] buf = new short[1024];
                long lastSend = 0;
                while (meterOn) {
                    int n = rec.read(buf, 0, buf.length);
                    if (n <= 0) continue;
                    double sum = 0;
                    for (int i = 0; i < n; i++) sum += (double) buf[i] * buf[i];
                    double rms = Math.sqrt(sum / n) / 32768.0;
                    long now = System.currentTimeMillis();
                    if (now - lastSend > 80) {
                        lastSend = now;
                        js("Nexus._meter && Nexus._meter(" + String.format(Locale.US, "%.4f", rms) + ")");
                    }
                }
            } catch (Exception e) {
                js("Nexus._meterError && Nexus._meterError('mic')");
            } finally {
                try { if (rec != null) { rec.stop(); rec.release(); } } catch (Exception ignored) {}
            }
        });
        meterThread.start();
    }

    private void stopMeter() {
        meterOn = false;
        if (visualizer != null) {
            try { visualizer.setEnabled(false); visualizer.release(); } catch (Throwable ignored) {}
            visualizer = null;
        }
    }

    // ---------- Music control (Spotify etc.) ----------

    private MediaController activeController() {
        try {
            MediaSessionManager msm = (MediaSessionManager) getSystemService(Context.MEDIA_SESSION_SERVICE);
            List<MediaController> list = msm.getActiveSessions(new ComponentName(this, NexusListener.class));
            if (list == null || list.isEmpty()) return null;
            for (MediaController c : list) {
                PlaybackState st = c.getPlaybackState();
                if (st != null && st.getState() == PlaybackState.STATE_PLAYING) return c;
            }
            return list.get(0);
        } catch (SecurityException e) {
            return null;
        } catch (Exception e) {
            return null;
        }
    }

    private boolean hasMediaAccess() {
        try {
            MediaSessionManager msm = (MediaSessionManager) getSystemService(Context.MEDIA_SESSION_SERVICE);
            msm.getActiveSessions(new ComponentName(this, NexusListener.class));
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private void sendMediaKey(int code) {
        AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        am.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, code));
        am.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_UP, code));
    }

    // ---------- Location ----------

    private Location bestLocation() {
        try {
            LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
            Location best = null;
            for (String prov : lm.getProviders(true)) {
                Location l = null;
                try { l = lm.getLastKnownLocation(prov); } catch (SecurityException ignored) {}
                if (l != null && (best == null || l.getTime() > best.getTime())) best = l;
            }
            return best;
        } catch (Exception e) {
            return null;
        }
    }

    private void requestFreshLocation() {
        ui.post(() -> {
            try {
                LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
                for (String prov : lm.getProviders(true)) {
                    if (LocationManager.PASSIVE_PROVIDER.equals(prov)) continue;
                    try {
                        lm.requestSingleUpdate(prov, new LocationListener() {
                            @Override public void onLocationChanged(Location location) { js("Nexus.locationChanged && Nexus.locationChanged()"); }
                            @Override public void onStatusChanged(String p, int s, Bundle b) {}
                            @Override public void onProviderEnabled(String p) {}
                            @Override public void onProviderDisabled(String p) {}
                        }, Looper.getMainLooper());
                    } catch (SecurityException ignored) {}
                }
            } catch (Exception ignored) {}
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
        public boolean nativeGreeting() { return nativeGreeting; }

        @JavascriptInterface
        public boolean takeNativeGreetUsed() { boolean u = nativeGreetUsed; nativeGreetUsed = false; return u; }

        @JavascriptInterface
        public void greet(String key, String text, String id) { ui.post(() -> playGreeting(key, text, id)); }

        @JavascriptInterface
        public void speakWith(String text, String id, float rate, float pitch) {
            if (tts == null) return;
            if (!ttsReady) { speak(text, id); return; }
            tts.setSpeechRate(rate);
            tts.setPitch(pitch);
            doSpeak(text, id);
            tts.setSpeechRate(prefs.getFloat("rate", 0.95f));
            tts.setPitch(prefs.getFloat("pitch", 0.9f));
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
            if (!name.equals(prefs.getString("voice", ""))) clearGreetings();
            prefs.edit().putString("voice", name).apply();
            ui.post(MainActivity.this::applyVoice);
        }

        @JavascriptInterface
        public void setVoiceTuning(float rate, float pitch) {
            if (rate != prefs.getFloat("rate", 0.95f) || pitch != prefs.getFloat("pitch", 0.9f)) clearGreetings();
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
        public void refreshApps() { appsCache = null; labelCache = null; pool.execute(MainActivity.this::labels); }

        @JavascriptInterface
        public boolean launchApp(String namesCsv) {
            List<String[]> list = labels();
            for (String raw : namesCsv.split(",")) {
                String q = raw.trim().toLowerCase(Locale.ROOT);
                if (q.isEmpty()) continue;
                for (String[] a : list) {
                    if (a[0].contains(q) || a[1].toLowerCase(Locale.ROOT).contains(q)) {
                        final String pkg = a[1], cls = a[2];
                        ui.post(() -> startComponent(pkg, cls));
                        return true;
                    }
                }
            }
            labelCache = null;
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
        public String nowPlaying() {
            if (!hasMediaAccess()) {
                try {
                    JSONObject o = new JSONObject();
                    if (spTime > 0) {
                        o.put("access", true);
                        o.put("source", "spotify");
                        o.put("playing", spPlaying);
                        if (spTitle != null) o.put("title", spTitle);
                        if (spArtist != null) o.put("artist", spArtist);
                        o.put("app", "com.spotify.music");
                    } else {
                        o.put("access", false);
                    }
                    return o.toString();
                } catch (Exception e) { return "{\"access\":false}"; }
            }
            try {
                JSONObject o = new JSONObject();
                o.put("access", true);
                MediaController c = activeController();
                if (c == null) return o.toString();
                MediaMetadata md = c.getMetadata();
                PlaybackState st = c.getPlaybackState();
                o.put("playing", st != null && st.getState() == PlaybackState.STATE_PLAYING);
                if (md != null) {
                    o.put("title", String.valueOf(md.getString(MediaMetadata.METADATA_KEY_TITLE)));
                    o.put("artist", String.valueOf(md.getString(MediaMetadata.METADATA_KEY_ARTIST)));
                }
                o.put("app", c.getPackageName());
                return o.toString();
            } catch (Exception e) {
                return "{\"access\":true}";
            }
        }

        @JavascriptInterface
        public void media(String action) {
            ui.post(() -> {
                MediaController c = activeController();
                try {
                    if (c != null) {
                        MediaController.TransportControls t = c.getTransportControls();
                        switch (action) {
                            case "next": t.skipToNext(); return;
                            case "prev": t.skipToPrevious(); return;
                            case "pause": t.pause(); return;
                            case "play": t.play(); return;
                            case "toggle": {
                                PlaybackState st = c.getPlaybackState();
                                if (st != null && st.getState() == PlaybackState.STATE_PLAYING) t.pause(); else t.play();
                                return;
                            }
                        }
                    }
                } catch (Exception ignored) {}
                switch (action) {
                    case "next": sendMediaKey(KeyEvent.KEYCODE_MEDIA_NEXT); break;
                    case "prev": sendMediaKey(KeyEvent.KEYCODE_MEDIA_PREVIOUS); break;
                    case "pause": sendMediaKey(KeyEvent.KEYCODE_MEDIA_PAUSE); break;
                    case "play": sendMediaKey(KeyEvent.KEYCODE_MEDIA_PLAY); break;
                    default: sendMediaKey(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE); break;
                }
            });
        }

        @JavascriptInterface
        public void volume(int steps) {
            ui.post(() -> {
                AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
                int dir = steps > 0 ? AudioManager.ADJUST_RAISE : AudioManager.ADJUST_LOWER;
                for (int i = 0; i < Math.abs(steps); i++) am.adjustStreamVolume(AudioManager.STREAM_MUSIC, dir, i == Math.abs(steps) - 1 ? AudioManager.FLAG_SHOW_UI : 0);
            });
        }

        @JavascriptInterface
        public boolean isMusicActive() {
            try { return ((AudioManager) getSystemService(Context.AUDIO_SERVICE)).isMusicActive(); } catch (Exception e) { return false; }
        }

        @JavascriptInterface
        public void openNotificationAccess() {
            ui.post(() -> {
                try { startActivity(new Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
                catch (Exception e) { Toast.makeText(MainActivity.this, "Open Settings > Apps > Special access > Notification access", Toast.LENGTH_LONG).show(); }
            });
        }

        @JavascriptInterface
        public void meter(boolean on) { if (on) startMeter(); else stopMeter(); }

        @JavascriptInterface
        public String getLocation() {
            Location l = bestLocation();
            if (l == null) { requestFreshLocation(); return ""; }
            if (System.currentTimeMillis() - l.getTime() > 10 * 60 * 1000) requestFreshLocation();
            try {
                JSONObject o = new JSONObject();
                o.put("lat", l.getLatitude());
                o.put("lon", l.getLongitude());
                o.put("acc", l.getAccuracy());
                return o.toString();
            } catch (Exception e) { return ""; }
        }

        @JavascriptInterface
        public String placeName(double lat, double lon) {
            try {
                if (!Geocoder.isPresent()) return "";
                List<Address> list = new Geocoder(MainActivity.this, Locale.getDefault()).getFromLocation(lat, lon, 1);
                if (list == null || list.isEmpty()) return "";
                Address a = list.get(0);
                String town = a.getLocality() != null ? a.getLocality() : (a.getSubAdminArea() != null ? a.getSubAdminArea() : "");
                String region = a.getAdminArea() != null ? a.getAdminArea() : "";
                if (town.isEmpty()) return region;
                return region.isEmpty() ? town : town + ", " + region;
            } catch (Exception e) { return ""; }
        }

        @JavascriptInterface
        public String version() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
            catch (Exception e) { return "?"; }
        }
    }
}
