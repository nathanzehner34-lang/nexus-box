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
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
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
    // ---- Audio focus: while Nexus talks or listens it holds "transient" focus, which makes Spotify & co
    //      pause cleanly and resume by themselves when Nexus lets go (no volume jumps, no fake button presses).
    private int audioHolds = 0;
    private boolean hasFocus = false;
    private AudioFocusRequest focusRequest = null;
    private final Runnable releaseFocusRunnable = this::releaseFocusNow;
    private final Runnable focusSafety = () -> { audioHolds = 0; releaseFocusNow(); };
    private volatile List<String[]> labelCache = null;
    // Spotify's "Device broadcast status" feed (works even when notification access is blocked on the box)
    private volatile String spTitle = null, spArtist = null;
    private volatile boolean spPlaying = false;
    private volatile long spTime = 0;
    private final BroadcastReceiver packageReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) { labelCache = null; appsCache = null; }
    };
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

        // Start the recorded greeting FIRST, before the screen (WebView) is even built,
        // so the voice comes out the moment Nexus starts (in the current Alter Ego's voice and words).
        if (savedInstanceState == null) playBootGreeting();

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
        // keep a list of cameras that are live right now, so LIVE CAM opens straight onto video
        ui.postDelayed(() -> { if (LiveCamActivity.stale(this)) pool.execute(() -> LiveCamActivity.harvest(this, 3)); }, 20000);
        // wake Spotify up quietly in the background so tapping it opens fast
        ui.postDelayed(this::warmSpotify, 8000);
        try {
            IntentFilter pf = new IntentFilter();
            pf.addAction(Intent.ACTION_PACKAGE_ADDED);
            pf.addAction(Intent.ACTION_PACKAGE_REMOVED);
            pf.addAction(Intent.ACTION_PACKAGE_CHANGED);
            pf.addDataScheme("package");
            registerReceiver(packageReceiver, pf);
        } catch (Exception ignored) {}
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


        String page = "file:///android_asset/index.html";
        web.loadUrl(savedInstanceState == null ? page + "#boot" : page);
    }

    private void startTts() {
        TextToSpeech.OnInitListener listener = status -> {
            if (status == TextToSpeech.SUCCESS) {
                try { tts.setAudioAttributes(speechAttrs()); } catch (Exception ignored) {}
                applyVoice();
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String id) { js("Nexus._speakStart(" + JSONObject.quote(id) + ")"); }
                    @Override public void onDone(String id) { if (id != null && id.startsWith("cache_")) { cacheDone(id); return; } if (id != null) { spokenText.remove(id); retried.remove(id); } js("Nexus._spoken(" + JSONObject.quote(id) + ")"); }
                    @Override public void onError(String id) { if (id != null && id.startsWith("cache_")) { cacheDone(id); return; } onSpeakError(id); }
                    @Override public void onError(String id, int code) { if (id != null && id.startsWith("cache_")) { cacheDone(id); return; } onSpeakError(id); }
                });
                ttsReady = true;
                if (bootGreetPending != null) { Runnable r = bootGreetPending; bootGreetPending = null; r.run(); }
                else { try { Bundle wb = new Bundle(); wb.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 0f); tts.speak("Ready.", TextToSpeech.QUEUE_ADD, wb, "warmup"); } catch (Exception ignored) {} }
                ui.postDelayed(MainActivity.this::cacheNext, 2500);
                ui.postDelayed(MainActivity.this::warmRecognizer, 1500);
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

    // ---------- INSTANT LINES: every fixed sentence (greetings, Alter Ego intros, party shouts...) is recorded
    //            once in the background, then played straight from the file the moment it's needed. ----------

    private long pausedAt = 0;

    private String greetKey() {
        int hr = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY);
        try {
            String off = prefs.getString("p_utcoff", "");
            if (!off.isEmpty()) {
                long localMs = System.currentTimeMillis() + Long.parseLong(off) * 1000L;
                hr = (int) ((localMs / 3600000L) % 24);
            }
        } catch (Exception ignored) {}
        return hr >= 4 && hr < 12 ? "morning" : hr >= 12 && hr < 17 ? "afternoon" : "evening";
    }

    private File lineFile(String text, float rate, float pitch) {
        String sig = text + "|" + (rate > 0 ? rate : prefs.getFloat("rate", 0.95f)) + "|" + (pitch > 0 ? pitch : prefs.getFloat("pitch", 0.9f)) + "|" + prefs.getString("voice", "") + "|v3";
        File dir = new File(getFilesDir(), "lines"); if (!dir.exists()) dir.mkdirs();
        return new File(dir, Integer.toHexString(sig.hashCode()) + "_" + sig.length() + ".wav");
    }
    private boolean good(File f) { return f.exists() && f.length() > 6000; }

    // Lines waiting to be recorded: {text, rate, pitch}
    private final java.util.LinkedList<String[]> cacheQueue = new java.util.LinkedList<>();
    private boolean caching = false;
    private void queueCache(String text, float rate, float pitch) {
        if (text == null || text.trim().isEmpty() || text.length() > 600) return;
        synchronized (cacheQueue) {
            for (String[] q : cacheQueue) if (q[0].equals(text) && q[1].equals(String.valueOf(rate)) && q[2].equals(String.valueOf(pitch))) return;
            cacheQueue.add(new String[]{text, String.valueOf(rate), String.valueOf(pitch)});
        }
        ui.post(this::cacheNext);
    }
    private void cacheNext() {
        if (!ttsReady || caching) return;
        if (tts.isSpeaking()) { ui.postDelayed(this::cacheNext, 1500); return; }
        String[] q;
        synchronized (cacheQueue) { q = cacheQueue.poll(); }
        if (q == null) return;
        float rate = Float.parseFloat(q[1]), pitch = Float.parseFloat(q[2]);
        File f = lineFile(q[0], rate, pitch);
        if (good(f)) { ui.post(this::cacheNext); return; }
        try {
            caching = true;
            File tmp = new File(f.getParentFile(), f.getName() + ".tmp");
            pendingCache.put("cache_" + f.getName(), new File[]{tmp, f});
            tts.setSpeechRate(rate > 0 ? rate : prefs.getFloat("rate", 0.95f));
            tts.setPitch(pitch > 0 ? pitch : prefs.getFloat("pitch", 0.9f));
            int r = tts.synthesizeToFile(q[0], new Bundle(), tmp, "cache_" + f.getName());
            tts.setSpeechRate(prefs.getFloat("rate", 0.95f));
            tts.setPitch(prefs.getFloat("pitch", 0.9f));
            if (r != TextToSpeech.SUCCESS) { caching = false; pendingCache.remove("cache_" + f.getName()); ui.postDelayed(this::cacheNext, 300); }
            else ui.postDelayed(() -> { if (caching) { caching = false; cacheNext(); } }, 15000);
        } catch (Exception e) { caching = false; }
    }
    private final java.util.Map<String, File[]> pendingCache = new java.util.concurrent.ConcurrentHashMap<>();
    private void cacheDone(String id) {
        File[] p = pendingCache.remove(id);
        if (p != null) { try { if (p[0].length() > 6000) p[0].renameTo(p[1]); else p[0].delete(); } catch (Exception ignored) {} }
        ui.post(() -> { caching = false; cacheNext(); });
    }

    private MediaPlayer linePlayer;
    private String linePlayerId = null;
    private volatile boolean nativeGreeting = false;
    private volatile boolean nativeGreetUsed = false;

    // Play a recorded line instantly. Returns false if it isn't recorded yet (caller then speaks it live).
    private boolean playFile(File f, String id) {
        if (!good(f)) return false;
        try {
            stopLinePlayer(false);
            MediaPlayer mp = new MediaPlayer();
            mp.setAudioAttributes(speechAttrs());
            mp.setDataSource(f.getAbsolutePath());
            mp.prepare();
            hold(true);
            linePlayer = mp; linePlayerId = id;
            mp.setOnCompletionListener(m -> finishLine(m, id));
            mp.setOnErrorListener((m, w, e) -> { finishLine(m, id); return true; });
            mp.start();
            js("Nexus._speakStart(" + JSONObject.quote(id) + ")");
            return true;
        } catch (Exception e) { return false; }
    }
    private void finishLine(MediaPlayer m, String id) {
        if (linePlayer != m) return;
        hold(false); nativeGreeting = false;
        try { m.release(); } catch (Exception ignored) {}
        linePlayer = null; linePlayerId = null;
        js("Nexus._spoken(" + JSONObject.quote(id) + ")");
    }
    private void stopLinePlayer(boolean notify) {
        MediaPlayer m = linePlayer; String id = linePlayerId;
        if (m == null) return;
        linePlayer = null; linePlayerId = null; nativeGreeting = false;
        try { m.stop(); } catch (Exception ignored) {}
        try { m.release(); } catch (Exception ignored) {}
        hold(false);
        if (notify && id != null) js("Nexus._spoken(" + JSONObject.quote(id) + ")");
    }

    // Speak a fixed line: recorded file if we have it (instant), otherwise live voice + record it for next time.
    private void speakLine(String text, String id, float rate, float pitch, boolean flush) {
        if (playFile(lineFile(text, rate, pitch), id)) return;
        if (!ttsReady) { synchronized (pendingSpeech) { pendingSpeech.add(new String[]{text, id}); } queueCache(text, rate, pitch); return; }
        if (flush) { try { tts.stop(); } catch (Exception ignored) {} }
        if (rate > 0) tts.setSpeechRate(rate);
        if (pitch > 0) tts.setPitch(pitch);
        doSpeak(text, id);
        tts.setSpeechRate(prefs.getFloat("rate", 0.95f));
        tts.setPitch(prefs.getFloat("pitch", 0.9f));
        queueCache(text, rate, pitch);
    }

    // Cold start: the page saved the greeting text for each time of day (in the current Alter Ego's voice).
    private void playBootGreeting() {
        String spec = prefs.getString("p_greet_" + greetKey(), "");
        if (spec.isEmpty()) spec = "Good " + greetKey() + ", Nathan. Nexus online. How can I help?\u00010\u00010";
        String[] p = spec.split("\u0001");
        if (p.length < 3) return;
        float rate = 0, pitch = 0;
        try { rate = Float.parseFloat(p[1]); pitch = Float.parseFloat(p[2]); } catch (Exception ignored) {}
        nativeGreetUsed = true;
        if (playFile(lineFile(p[0], rate, pitch), "nativegreet")) { nativeGreeting = true; return; }
        // not recorded yet: speak it live as soon as the voice engine is up
        nativeGreeting = true;
        final float r = rate, pi = pitch; final String t = p[0];
        Runnable go = () -> speakLine(t, "nativegreet", r, pi, false);
        if (ttsReady) go.run(); else bootGreetPending = go;
    }
    private Runnable bootGreetPending = null;

    // ---------- UPDATE NEXUS: download the newest build and open the install screen ----------
    private static final String UPDATE_URL = "https://github.com/nathanzehner34-lang/nexus-box/releases/download/latest/nexus.apk";
    private long updateId = -1;
    private BroadcastReceiver updateReceiver;

    private void startUpdate() {
        try {
            if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
                Intent s = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, android.net.Uri.parse("package:" + getPackageName()));
                s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(s);
                js("Nexus._update && Nexus._update('allow')");
                return;
            }
            android.app.DownloadManager dm = (android.app.DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            File f = new File(getExternalFilesDir(null), "nexus-update.apk");
            if (f.exists()) f.delete();
            android.app.DownloadManager.Request r = new android.app.DownloadManager.Request(android.net.Uri.parse(UPDATE_URL));
            r.setDestinationUri(android.net.Uri.fromFile(f));
            r.setTitle("Nexus update");
            r.setNotificationVisibility(android.app.DownloadManager.Request.VISIBILITY_VISIBLE);
            if (updateReceiver == null) {
                updateReceiver = new BroadcastReceiver() {
                    @Override public void onReceive(Context c, Intent i) {
                        long id = i.getLongExtra(android.app.DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                        if (id != updateId) return;
                        installDownloaded(id);
                    }
                };
                registerReceiver(updateReceiver, new IntentFilter(android.app.DownloadManager.ACTION_DOWNLOAD_COMPLETE));
            }
            updateId = dm.enqueue(r);
            js("Nexus._update && Nexus._update('downloading')");
        } catch (Exception e) {
            js("Nexus._update && Nexus._update('failed')");
        }
    }

    private void installDownloaded(long id) {
        try {
            android.app.DownloadManager dm = (android.app.DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            android.database.Cursor cur = dm.query(new android.app.DownloadManager.Query().setFilterById(id));
            boolean ok = false;
            if (cur != null) { if (cur.moveToFirst()) ok = cur.getInt(cur.getColumnIndex(android.app.DownloadManager.COLUMN_STATUS)) == android.app.DownloadManager.STATUS_SUCCESSFUL; cur.close(); }
            if (!ok) { js("Nexus._update && Nexus._update('failed')"); return; }
            android.net.Uri u = dm.getUriForDownloadedFile(id);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(u, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
            js("Nexus._update && Nexus._update('ready')");
        } catch (Exception e) {
            js("Nexus._update && Nexus._update('failed')");
        }
    }

    // Starts Spotify's background service (no screen) so the app is already loaded when you tap it.
    private android.media.browse.MediaBrowser spotifyWarm = null;
    private void warmSpotify() {
        try { getPackageManager().getPackageInfo("com.spotify.music", 0); } catch (Exception e) { return; }
        try {
            if (spotifyWarm != null) { try { spotifyWarm.disconnect(); } catch (Exception ignored) {} spotifyWarm = null; }
            final android.media.browse.MediaBrowser[] holder = new android.media.browse.MediaBrowser[1];
            holder[0] = new android.media.browse.MediaBrowser(this,
                    new ComponentName("com.spotify.music", "com.spotify.mobile.android.service.media.browser.SpotifyBrowserService"),
                    new android.media.browse.MediaBrowser.ConnectionCallback() {
                        @Override public void onConnected() { }
                        @Override public void onConnectionFailed() { }
                    }, null);
            spotifyWarm = holder[0];
            spotifyWarm.connect();
        } catch (Throwable ignored) {}
        ui.removeCallbacks(spotifyRewarm); ui.postDelayed(spotifyRewarm, 20 * 60 * 1000L);
    }
    private final Runnable spotifyRewarm = this::warmSpotify;

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
        if (pausedAt > 0 && System.currentTimeMillis() - pausedAt > 10 * 60 * 1000L) playBootGreeting();
        pausedAt = 0;
        if (web != null) { web.onResume(); web.resumeTimers(); }
        js("Nexus.resumed && Nexus.resumed()");
    }

    @Override
    protected void onPause() {
        // Stop all drawing and timers while another app (SmartTube, Stremio...) is on screen.
        pausedAt = System.currentTimeMillis();
        js("Nexus.paused && Nexus.paused()");
        stopMeter();
        dropListenFocus();
        audioHolds = 0;
        ui.removeCallbacks(releaseFocusRunnable);
        if (!(tts != null && tts.isSpeaking())) releaseFocusNow();
        if (web != null) { web.onPause(); web.pauseTimers(); }
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
        try { unregisterReceiver(packageReceiver); } catch (Exception ignored) {}
        if (recognizer != null) recognizer.destroy();
        try { if (spotifyWarm != null) spotifyWarm.disconnect(); } catch (Exception ignored) {}
        pool.shutdownNow();
        super.onDestroy();
    }

    private void js(final String code) {
        ui.post(() -> { if (web != null) web.evaluateJavascript(code, null); });
    }

    // ---------- Voice ----------

    // A voice is only usable if it works offline AND is actually downloaded on the box.
    private boolean usable(Voice v) {
        try {
            if (v.isNetworkConnectionRequired()) return false;
            Set<String> f = v.getFeatures();
            return f == null || !f.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED);
        } catch (Exception e) { return true; }
    }

    private void applyVoice() {
        if (tts == null) return;
        tts.setSpeechRate(prefs.getFloat("rate", 0.95f));
        tts.setPitch(prefs.getFloat("pitch", 0.9f));
        String chosen = prefs.getString("voice", "");
        Set<Voice> voices = null;
        try { voices = tts.getVoices(); } catch (Exception ignored) {}
        if (voices != null) {
            if (!chosen.isEmpty()) {
                String local = chosen.replace("-network", "-local");
                for (Voice v : voices) if (v.getName().equals(local) && usable(v)) { tts.setVoice(v); return; }
                for (Voice v : voices) if (v.getName().equals(chosen) && usable(v)) { tts.setVoice(v); return; }
            }
            String[] preferred = {"en-gb-x-rjs", "en-gb-x-gbd", "en-gb-x-gbb", "en-us-x-iom", "en-us-x-iol", "en-us-x-tpd"};
            for (String p : preferred) {
                for (Voice v : voices) {
                    if (v.getName().startsWith(p) && usable(v)) { tts.setVoice(v); return; }
                }
            }
        }
        if (voices != null) for (Voice v : voices) if (v.getLocale() != null && "en".equals(v.getLocale().getLanguage()) && usable(v)) { tts.setVoice(v); return; }
        tts.setLanguage(Locale.UK);
    }

    // If a line fails to speak (voice missing/broken), say it again right away with a safe voice.
    private final java.util.Map<String, String> spokenText = new java.util.concurrent.ConcurrentHashMap<>();
    private final java.util.Set<String> retried = java.util.Collections.newSetFromMap(new java.util.concurrent.ConcurrentHashMap<>());
    private void onSpeakError(String id) {
        String text = id == null ? null : spokenText.get(id);
        if (text != null && !retried.contains(id) && tts != null) {
            retried.add(id);
            ui.post(() -> {
                try {
                    Voice safe = null;
                    try { safe = tts.getDefaultVoice(); } catch (Exception ignored) {}
                    if (safe == null || !usable(safe)) { Set<Voice> vs = tts.getVoices(); if (vs != null) for (Voice v : vs) if (v.getLocale() != null && "en".equals(v.getLocale().getLanguage()) && usable(v)) { safe = v; break; } }
                    if (safe != null) tts.setVoice(safe); else tts.setLanguage(Locale.UK);
                    Bundle b = new Bundle();
                    tts.speak(text, TextToSpeech.QUEUE_ADD, b, id);
                    js("Nexus._voiceFixed && Nexus._voiceFixed()");
                } catch (Exception e) { js("Nexus._spoken(" + JSONObject.quote(id) + ")"); }
            });
            return;
        }
        if (id != null) { spokenText.remove(id); retried.remove(id); }
        js("Nexus._spoken(" + JSONObject.quote(id) + ")");
    }

    private void doSpeak(String text, String id) {
        Bundle b = new Bundle();
        if (id != null) spokenText.put(id, text);
        int r = tts.speak(text, TextToSpeech.QUEUE_ADD, b, id);
        if (r != TextToSpeech.SUCCESS) onSpeakError(id);
    }

    // ---------- Speech recognition ----------

    private void warmRecognizer() {
        try { if (recognizer == null && SpeechRecognizer.isRecognitionAvailable(this)) makeRecognizer(); } catch (Exception ignored) {}
    }

    private void startListening() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            js("Nexus._heardError('unavailable')");
            return;
        }
        if (recognizer == null) makeRecognizer();
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag());
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 600L);
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 500L);
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 300L);
        i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());
        grabListenFocus();
        try { recognizer.startListening(i); } catch (Exception e) { dropListenFocus(); js("Nexus._heardError('start')"); }
    }

    private void makeRecognizer() {
        {
            recognizer = SpeechRecognizer.createSpeechRecognizer(this);
            recognizer.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle params) { js("Nexus._listening(true)"); }
                @Override public void onBeginningOfSpeech() { js("Nexus._speechBegan && Nexus._speechBegan()"); }
                @Override public void onRmsChanged(float rmsdB) { js("Nexus._level(" + rmsdB + ")"); }
                @Override public void onBufferReceived(byte[] buffer) {}
                @Override public void onEndOfSpeech() { dropListenFocus(); js("Nexus._listening(false)"); }
                @Override public void onError(int error) { dropListenFocus(); js("Nexus._heardError('" + error + "')"); }
                @Override public void onResults(Bundle results) {
                    dropListenFocus();
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
                if (c != null) c.disconnect();
            }
            js("Nexus._http(" + JSONObject.quote(id) + "," + code + "," + JSONObject.quote(text) + ")");
        });
    }

    // Streaming request: hands each piece of the AI answer to the page the moment it arrives.
    private void httpStream(String id, String url, String body, String headersJson) {
        pool.execute(() -> {
            int code = 0; HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setRequestMethod("POST"); c.setConnectTimeout(12000); c.setReadTimeout(30000);
                if (headersJson != null && !headersJson.isEmpty()) {
                    JSONObject h = new JSONObject(headersJson); Iterator<String> keys = h.keys();
                    while (keys.hasNext()) { String k = keys.next(); c.setRequestProperty(k, h.getString(k)); }
                }
                c.setDoOutput(true);
                try (OutputStream os = c.getOutputStream()) { os.write(body.getBytes(StandardCharsets.UTF_8)); }
                code = c.getResponseCode();
                if (code >= 400) {
                    InputStream es = c.getErrorStream(); String t = "";
                    if (es != null) { ByteArrayOutputStream bo = new ByteArrayOutputStream(); byte[] buf = new byte[4096]; int n; while ((n = es.read(buf)) > 0) bo.write(buf, 0, n); t = bo.toString("UTF-8"); es.close(); }
                    js("Nexus._streamEnd(" + JSONObject.quote(id) + "," + code + "," + JSONObject.quote(t) + ")");
                    return;
                }
                java.io.BufferedReader br = new java.io.BufferedReader(new java.io.InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8));
                String line;
                while ((line = br.readLine()) != null) {
                    if (line.startsWith("data:")) js("Nexus._streamChunk(" + JSONObject.quote(id) + "," + JSONObject.quote(line.substring(5).trim()) + ")");
                }
                br.close();
                js("Nexus._streamEnd(" + JSONObject.quote(id) + ",200,'')");
            } catch (Exception e) {
                if (c != null) c.disconnect();
                js("Nexus._streamEnd(" + JSONObject.quote(id) + ",-1," + JSONObject.quote(String.valueOf(e.getMessage())) + ")");
            }
        });
    }

    // ---------- Audio focus ----------

    private AudioAttributes speechAttrs() {
        return new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build();
    }

    private void grabFocus() {
        ui.removeCallbacks(releaseFocusRunnable);
        if (hasFocus) return;
        try {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            int res;
            if (Build.VERSION.SDK_INT >= 26) {
                if (focusRequest == null) {
                    focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                            .setAudioAttributes(speechAttrs())
                            .setOnAudioFocusChangeListener(duckListener)
                            .setWillPauseWhenDucked(false)
                            .build();
                }
                res = am.requestAudioFocus(focusRequest);
            } else {
                res = am.requestAudioFocus(duckListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
            }
            hasFocus = res == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        } catch (Exception ignored) {}
    }

    private void releaseFocusNow() {
        if (audioHolds > 0 || !hasFocus) return;
        try {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (Build.VERSION.SDK_INT >= 26 && focusRequest != null) am.abandonAudioFocusRequest(focusRequest);
            else am.abandonAudioFocus(duckListener);
        } catch (Exception ignored) {}
        hasFocus = false;
    }

    private final AudioManager.OnAudioFocusChangeListener duckListener = change -> {};
    // While the microphone listens, music pauses so Nexus hears you clearly; it comes back the moment you stop talking.
    private AudioFocusRequest listenRequest = null;
    private final AudioManager.OnAudioFocusChangeListener listenListener = change -> {};
    private boolean listenFocus = false;
    private void grabListenFocus() {
        if (listenFocus) return;
        try {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (Build.VERSION.SDK_INT >= 26) {
                if (listenRequest == null) listenRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
                        .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                        .setOnAudioFocusChangeListener(listenListener).build();
                am.requestAudioFocus(listenRequest);
            } else am.requestAudioFocus(listenListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
            listenFocus = true;
            ui.removeCallbacks(listenSafety); ui.postDelayed(listenSafety, 12000);
        } catch (Exception ignored) {}
    }
    private final Runnable listenSafety = this::dropListenFocus;
    private void dropListenFocus() {
        ui.removeCallbacks(listenSafety);
        if (!listenFocus) return;
        listenFocus = false;
        try {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (Build.VERSION.SDK_INT >= 26 && listenRequest != null) am.abandonAudioFocusRequest(listenRequest);
            else am.abandonAudioFocus(listenListener);
        } catch (Exception ignored) {}
    }

    private void hold(boolean on) {
        ui.post(() -> {
            if (on) {
                audioHolds++; grabFocus();
                ui.removeCallbacks(focusSafety); ui.postDelayed(focusSafety, 45000);
            }
            else {
                audioHolds = Math.max(0, audioHolds - 1);
                if (audioHolds == 0) { ui.removeCallbacks(releaseFocusRunnable); ui.postDelayed(releaseFocusRunnable, 450); }
            }
        });
    }

    // ---------- Party meter (listens to the music in the cab) ----------

    private boolean startVisualizer() {
        // Listens to the music the box itself is playing (no microphone, so the music isn't turned down).
        try {
            Visualizer v = new Visualizer(0);
            v.setEnabled(false);
            int[] range = Visualizer.getCaptureSizeRange();
            v.setCaptureSize(Math.max(range[0], Math.min(512, range[1])));
            v.setScalingMode(Visualizer.SCALING_MODE_NORMALIZED);
            v.setDataCaptureListener(new Visualizer.OnDataCaptureListener() {
                long lastSend = 0;
                @Override public void onWaveFormDataCapture(Visualizer vis, byte[] wave, int rate) {}
                @Override public void onFftDataCapture(Visualizer vis, byte[] fft, int rate) {
                    long now = System.currentTimeMillis();
                    if (now - lastSend < 80) return;
                    lastSend = now;
                    int n = fft.length / 2;
                    double bass = 0, all = 0;
                    for (int k = 1; k < n; k++) {
                        double re = fft[2 * k], im = fft[2 * k + 1];
                        double mag = Math.sqrt(re * re + im * im) / 128.0;
                        if (k <= 6) bass += mag;
                        if (k <= 64) all += mag;
                    }
                    bass /= 6.0; all /= 64.0;
                    js("Nexus._meter && Nexus._meter(" + String.format(Locale.US, "%.4f", all) + "," + String.format(Locale.US, "%.4f", bass) + ")");
                }
            }, Math.min(Visualizer.getMaxCaptureRate(), 12000), false, true);
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
        public void greet(String key, String text, String id) { ui.post(() -> MainActivity.this.speakLine(text, id, 0, 0, false)); }

        @JavascriptInterface
        public void speakLine(String text, String id, float rate, float pitch, boolean flush) { ui.post(() -> MainActivity.this.speakLine(text, id, rate, pitch, flush)); }

        // Record these lines in the background so they play instantly later. JSON: [[text, rate, pitch], ...]
        @JavascriptInterface
        public void precache(String json) {
            try { JSONArray a = new JSONArray(json); for (int i = 0; i < a.length(); i++) { JSONArray q = a.getJSONArray(i); queueCache(q.getString(0), (float) q.optDouble(1, 0), (float) q.optDouble(2, 0)); } } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public void finishListening() { ui.post(() -> { try { if (recognizer != null) recognizer.stopListening(); } catch (Exception ignored) {} }); }

        @JavascriptInterface
        public void speakWith(String text, String id, float rate, float pitch) {
            if (tts == null) return;
            if (!ttsReady) { speak(text, id); return; }
            ui.post(() -> {
                tts.setSpeechRate(rate);
                tts.setPitch(pitch);
                doSpeak(text, id);
                tts.setSpeechRate(prefs.getFloat("rate", 0.95f));
                tts.setPitch(prefs.getFloat("pitch", 0.9f));
            });
        }

        @JavascriptInterface
        public void stopSpeaking() { ui.post(() -> stopLinePlayer(true)); if (tts != null) tts.stop(); }

        @JavascriptInterface
        public void listen() { ui.post(MainActivity.this::startListening); }

        @JavascriptInterface
        public void stopListening() { ui.post(() -> { dropListenFocus(); if (recognizer != null) recognizer.cancel(); }); }

        @JavascriptInterface
        public String getVoices() {
            JSONArray arr = new JSONArray();
            try {
                if (tts != null && tts.getVoices() != null) {
                    List<String> names = new ArrayList<>();
                    for (Voice v : tts.getVoices()) {
                        if (v.getLocale() != null && "en".equals(v.getLocale().getLanguage()) && usable(v)) names.add(v.getName());
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
        public void refreshApps() { /* apps are re-scanned automatically when something is installed or removed */ }

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
        public void openLiveCam() {
            ui.post(() -> { try { startActivity(new Intent(MainActivity.this, LiveCamActivity.class)); } catch (Exception e) { js("Nexus._update && 0"); } });
        }

        @JavascriptInterface
        public void updateNexus() { ui.post(MainActivity.this::startUpdate); }

        // Download a picture (webcam snapshot) natively and hand it to the page as a data URL.
        @JavascriptInterface
        public void fetchImage(String id, String url, String referer) {
            pool.execute(() -> {
                String out = "";
                HttpURLConnection c = null;
                try {
                    c = (HttpURLConnection) new URL(url).openConnection();
                    c.setConnectTimeout(10000); c.setReadTimeout(20000);
                    c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36");
                    if (referer != null && !referer.isEmpty()) c.setRequestProperty("Referer", referer);
                    if (c.getResponseCode() < 400) {
                        InputStream is = c.getInputStream(); ByteArrayOutputStream bo = new ByteArrayOutputStream();
                        byte[] buf = new byte[16384]; int n; while ((n = is.read(buf)) > 0) bo.write(buf, 0, n); is.close();
                        String type = c.getContentType(); if (type == null || !type.startsWith("image")) type = "image/jpeg";
                        out = "data:" + type + ";base64," + Base64.encodeToString(bo.toByteArray(), Base64.NO_WRAP);
                    }
                } catch (Exception ignored) {
                } finally { if (c != null) c.disconnect(); }
                js("Nexus._img && Nexus._img(" + JSONObject.quote(id) + "," + JSONObject.quote(out) + ")");
            });
        }

        // Open a web page in the box's browser (or whatever app handles it).
        @JavascriptInterface
        public boolean openUrl(String url) {
            try {
                Intent i = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                if (i.resolveActivity(getPackageManager()) == null) return false;
                ui.post(() -> { try { startActivity(i); } catch (Exception ignored) {} });
                return true;
            } catch (Exception e) { return false; }
        }

        @JavascriptInterface
        public void httpStream(String id, String url, String body, String headersJson) { MainActivity.this.httpStream(id, url, body, headersJson); }

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
        public void audioHold(boolean on) { hold(on); }

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
