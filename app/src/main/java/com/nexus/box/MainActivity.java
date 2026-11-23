package com.nexus.box;

import android.Manifest;
import android.app.ActivityManager;
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
import java.io.FileOutputStream;
import android.net.Uri;
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
    // The AI gets its own lines to Google, so news/weather/camera downloads can never make it wait in line.
    private final ExecutorService aiPool = Executors.newCachedThreadPool();
    private SharedPreferences prefs;
    // Nexus Cinema: movie library on external USB drives (read only)
    private CinemaLibrary cinema;
    private CinemaMeta cinemaMeta;   // movie and TV information and artwork from TMDB, kept on the box
    private Object cinemaVolumeCallback;
    private final BroadcastReceiver driveReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) {
            // let Android finish mounting / unmounting before looking at the drives
            ui.removeCallbacks(drivesChanged);
            ui.postDelayed(drivesChanged, 900);
        }
    };
    private final Runnable drivesChanged = () -> { if (cinema != null) cinema.volumesChanged(); };
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
        @Override public void onReceive(Context c, Intent i) { labelCache = null; appsCache = null; launchCache.clear(); }
    };
    private volatile long spPos = -1, spPosAt = 0; private volatile int spLen = 0;
    private final BroadcastReceiver spotifyReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) {
            String a = i.getAction();
            if (a == null) return;
            if (a.endsWith("metadatachanged")) {
                spTitle = i.getStringExtra("track");
                spArtist = i.getStringExtra("artist");
                if (i.hasExtra("playing")) spPlaying = i.getBooleanExtra("playing", spPlaying);
                spLen = i.getIntExtra("length", 0);
                spPos = 0; spPosAt = System.currentTimeMillis();
            } else if (a.endsWith("playbackstatechanged")) {
                spPlaying = i.getBooleanExtra("playing", false);
                if (i.hasExtra("playbackPosition")) { spPos = i.getIntExtra("playbackPosition", 0); spPosAt = System.currentTimeMillis(); }
            }
            spTime = System.currentTimeMillis();
        }
    };
    private Thread meterThread = null;
    private Visualizer visualizer = null;
    // Visuals asks for a finer music feed (six bands at the Visualizer's top rate). Party Mode never sets it.
    private volatile boolean meterDetail = false;
    private boolean visualizerDetail = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("nexus", MODE_PRIVATE);

        // Start the recorded greeting FIRST, before the screen (WebView) is even built,
        // so the voice comes out the moment Nexus starts (in Nexus's voice).
        // (no spoken greeting at startup: the Nexus logo intro plays instead)

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
        // The page and its film clips both come from the app's own files (file:///android_asset). Treat them
        // as one origin so the clips can be drawn through WebGL for the music effects. No remote content.
        s.setAllowFileAccessFromFileURLs(true);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        web.setWebViewClient(new WebViewClient() {
            // Nexus Cinema's film stills come from the box itself (made on demand, cached), never the internet
            @Override public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view, android.webkit.WebResourceRequest req) {
                Uri u = req.getUrl();
                if (u == null || !"cinema.nexus".equals(u.getHost())) return null;
                java.util.Map<String, String> headers = new java.util.HashMap<>();
                headers.put("Access-Control-Allow-Origin", "*");
                headers.put("Cache-Control", "max-age=86400");
                byte[] jpg = null;
                try {
                    if (cinema != null && "/thumb".equals(u.getPath()))
                        jpg = cinema.thumb(u.getQueryParameter("u"), u.getQueryParameter("r"), u.getQueryParameter("p"));
                    else if (cinemaMeta != null && "/art".equals(u.getPath()))
                        jpg = cinemaMeta.art(u.getQueryParameter("f"));   // saved posters, backgrounds and stills
                } catch (Throwable ignored) {}
                if (jpg == null) return new android.webkit.WebResourceResponse("image/jpeg", null, 404, "Not found", headers, new java.io.ByteArrayInputStream(new byte[0]));
                return new android.webkit.WebResourceResponse("image/jpeg", null, 200, "OK", headers, new java.io.ByteArrayInputStream(jpg));
            }
        });
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new Bridge(), "Android");
        setContentView(web);
        cinema = new CinemaLibrary(this, this::js);
        try { cinemaMeta = new CinemaMeta(this, this::js); } catch (Throwable ignored) {}
        try {
            IntentFilter df = new IntentFilter();
            df.addAction(Intent.ACTION_MEDIA_MOUNTED);
            df.addAction(Intent.ACTION_MEDIA_UNMOUNTED);
            df.addAction(Intent.ACTION_MEDIA_EJECT);
            df.addAction(Intent.ACTION_MEDIA_REMOVED);
            df.addAction(Intent.ACTION_MEDIA_BAD_REMOVAL);
            df.addDataScheme("file");
            registerReceiver(driveReceiver, df);
        } catch (Exception ignored) {}
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                android.os.storage.StorageManager sm = (android.os.storage.StorageManager) getSystemService(Context.STORAGE_SERVICE);
                android.os.storage.StorageManager.StorageVolumeCallback cb = new android.os.storage.StorageManager.StorageVolumeCallback() {
                    @Override public void onStateChanged(android.os.storage.StorageVolume v) { ui.removeCallbacks(drivesChanged); ui.postDelayed(drivesChanged, 900); }
                };
                sm.registerStorageVolumeCallback(getMainExecutor(), cb);
                cinemaVolumeCallback = cb;
            } catch (Exception ignored) {}
        }
        hideSystemUi();

        startTts();
        pool.execute(this::labels);
        // passengers' phones connect to the box (song requests, photos, shout-outs, remote)
        // wake Spotify up quietly in the background so tapping it opens fast (started sooner than before,
        // since the very first thing many people do after the truck boots is open Spotify)
        ui.postDelayed(this::warmSpotify, 1200);
        try {
            IntentFilter pf = new IntentFilter();
            pf.addAction(Intent.ACTION_PACKAGE_ADDED);
            pf.addAction(Intent.ACTION_PACKAGE_REMOVED);
            pf.addAction(Intent.ACTION_PACKAGE_CHANGED);
            pf.addDataScheme("package");
            registerReceiver(packageReceiver, pf);
            registerReceiver(new BroadcastReceiver() {
                @Override public void onReceive(Context c, Intent i) {
                    try {
                        String[] sp2 = prefs.getString("p_bye", "").split("\u0001");
                        if (sp2.length >= 3) playFile(lineFile(sp2[0], Float.parseFloat(sp2[1]), Float.parseFloat(sp2[2])), "bye");
                    } catch (Exception ignored) {}
                }
            }, new IntentFilter(Intent.ACTION_SHUTDOWN));
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
        // the startup intro plays once per real start of the app (a new process), not each time the
        // screen is rebuilt or Nexus comes back to the front
        boolean intro = savedInstanceState == null && !startupIntroShown;
        startupIntroShown = true;
        web.loadUrl(intro ? page + "#boot" : page);
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

    // ---------- INSTANT LINES: every fixed sentence (greetings, party shouts...) is recorded
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

    private static boolean startupIntroShown = false;
    private MediaPlayer introPlayer;

    // The startup announcement: a recording in the app (voice/startup.ogg), played as assistant speech so
    // the music only dips under it and comes straight back.
    private void playStartupVoice() {
        stopStartupVoice();
        try {
            android.content.res.AssetFileDescriptor fd = getAssets().openFd("voice/startup.ogg");
            MediaPlayer mp = new MediaPlayer();
            mp.setAudioAttributes(speechAttrs());
            mp.setDataSource(fd.getFileDescriptor(), fd.getStartOffset(), fd.getLength());
            fd.close();
            mp.prepare();
            introPlayer = mp;
            hold(true);
            mp.setOnCompletionListener(m -> { if (introPlayer == m) stopStartupVoice(); });
            mp.setOnErrorListener((m, w, e) -> { if (introPlayer == m) stopStartupVoice(); return true; });
            mp.start();
        } catch (Exception e) { introPlayer = null; }
    }
    private void stopStartupVoice() {
        MediaPlayer m = introPlayer;
        if (m == null) return;
        introPlayer = null;
        try { m.stop(); } catch (Exception ignored) {}
        try { m.release(); } catch (Exception ignored) {}
        hold(false);
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

    // Cold start: the page saved the greeting text for each time of day .
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

    // ---------- UPDATE: resolve the stable Nexus APK published at the truck's download endpoint ----------
    private static final String NEXUS_LATEST_RELEASE_API = "https://api.github.com/repos/nathanzehner34-lang/nexus-box/releases/tags/latest";
    private static final String NEXUS_LATEST_APK_URL = "https://github.com/nathanzehner34-lang/nexus-box/releases/download/latest/nexus.apk";
    private static final String NEXUS_APK_NAME = "nexus.apk";
    private static final String UPDATE_STATUS_ACTION = "com.nexus.box.UPDATE_STATUS";
    private volatile boolean updateBusy = false;
    private volatile long updateStartedAt = 0;
    private volatile boolean triedBackupInstall = false;
    private BroadcastReceiver updateReceiver;

    private void updateFailed(String why) {
        updateBusy = false;
        // remembered so Settings can show what went wrong last time
        try { prefs.edit().putString("lastUpdateError", why == null ? "" : why).apply(); } catch (Exception ignored) {}
        js("Nexus._update && Nexus._update('failed'," + JSONObject.quote(why == null ? "" : why) + ")");
    }

    // Backup route: hand the verified APK to Android's classic install screen.
    private boolean backupInstall(File apk) {
        if (triedBackupInstall || apk == null || !apk.isFile()) return false;
        triedBackupInstall = true;
        try {
            Intent i = new Intent(Intent.ACTION_INSTALL_PACKAGE);
            i.setDataAndType(ApkProvider.APK_URI, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            i.putExtra(Intent.EXTRA_NOT_UNKNOWN_SOURCE, true);
            i.putExtra(Intent.EXTRA_RETURN_RESULT, false);
            startActivity(i);
            updateBusy = false;
            js("Nexus._update && Nexus._update('ready')");
            return true;
        } catch (Exception e) {
            try {
                Intent v = new Intent(Intent.ACTION_VIEW);
                v.setDataAndType(ApkProvider.APK_URI, "application/vnd.android.package-archive");
                v.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(v);
                updateBusy = false;
                js("Nexus._update && Nexus._update('ready')");
                return true;
            } catch (Exception e2) { return false; }
        }
    }
    private File lastApk = null;

    private long installedVersion() throws Exception {
        android.content.pm.PackageInfo me = getPackageManager().getPackageInfo(getPackageName(), 0);
        return Build.VERSION.SDK_INT >= 28 ? me.getLongVersionCode() : me.versionCode;
    }

    private JSONObject fetchLatestRelease() throws Exception {
        Exception last = null;
        // The build deletes and re-creates the release, so a lookup during that moment is retried.
        for (int attempt = 0; attempt < 3; attempt++) {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(NEXUS_LATEST_RELEASE_API).openConnection();
                connection.setConnectTimeout(12000);
                connection.setReadTimeout(15000);
                connection.setRequestProperty("Accept", "application/vnd.github+json");
                connection.setRequestProperty("User-Agent", "Nexus-Box-Android-Updater");
                int code = connection.getResponseCode();
                if (code == 403 || code == 429) throw new Exception("GitHub is busy (limit reached). Try again in an hour.");
                if (code < 200 || code >= 300) throw new Exception("Could not reach the Nexus release (code " + code + ").");
                ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                try (InputStream in = connection.getInputStream()) {
                    byte[] buf = new byte[8192]; int n;
                    while ((n = in.read(buf)) != -1) bytes.write(buf, 0, n);
                }
                return new JSONObject(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
            } catch (java.io.IOException e) {
                last = new Exception("No internet connection to GitHub.");
            } catch (Exception e) {
                last = e;
            } finally {
                if (connection != null) connection.disconnect();
            }
            try { Thread.sleep(4000); } catch (InterruptedException ignored) {}
        }
        throw last;
    }

    private void startUpdate() {
        // A previous attempt that never reported back (install screen closed, Android silent) must not
        // block the button forever: after two minutes it counts as finished.
        if (updateBusy && System.currentTimeMillis() - updateStartedAt < 120000) { js("Nexus._update && Nexus._update('busy')"); return; }
        if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls() && !prefs.getBoolean("askedInstallPermission", false)) {
            // Ask once. Some car boxes have no such screen, or it doesn't stick: then just carry on,
            // Android asks during the install itself.
            prefs.edit().putBoolean("askedInstallPermission", true).apply();
            try {
                Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, android.net.Uri.parse("package:" + getPackageName()));
                settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(settings);
                js("Nexus._update && Nexus._update('allow')");
                return;
            } catch (Exception ignored) {}
        }
        updateBusy = true; updateStartedAt = System.currentTimeMillis(); triedBackupInstall = false;
        try { prefs.edit().putString("lastUpdateError", "").apply(); } catch (Exception ignored) {}
        js("Nexus._update && Nexus._update('searching')");
        pool.execute(() -> {
            try {
                JSONObject release = fetchLatestRelease();
                if (release.optBoolean("draft", true) || release.optBoolean("prerelease", true) || !"latest".equals(release.optString("tag_name", ""))) throw new Exception("No finished Nexus release yet. Try again in a few minutes.");
                java.util.regex.Matcher versionMatch = java.util.regex.Pattern.compile("(?i)build\\s+(\\d+)").matcher(release.optString("name", ""));
                if (!versionMatch.find()) throw new Exception("The release has no build number.");
                long releaseVersion = Long.parseLong(versionMatch.group(1));
                if (releaseVersion <= installedVersion()) { updateBusy = false; js("Nexus._update && Nexus._update('current')"); return; }
                JSONArray assets = release.optJSONArray("assets");
                boolean found = false; long size = -1;
                if (assets != null) for (int a = 0; a < assets.length(); a++) {
                    JSONObject asset = assets.optJSONObject(a);
                    if (asset != null && NEXUS_APK_NAME.equals(asset.optString("name")) && NEXUS_LATEST_APK_URL.equals(asset.optString("browser_download_url", ""))) { found = true; size = asset.optLong("size", -1); break; }
                }
                if (!found) throw new Exception("The release has no nexus.apk file yet. Try again in a few minutes.");
                File apk = downloadNexusApk(size);
                verifyNexusApk(apk);
                lastApk = apk;
                ui.post(() -> installNexusApk(apk));
            } catch (Exception e) {
                updateFailed(e.getMessage());
            }
        });
    }

    // Downloads straight into Nexus's private storage (no Android Download app involved), with live progress.
    private File downloadNexusApk(long expectedSize) throws Exception {
        File dir = new File(getFilesDir(), "updates");
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("No room to save the update.");
        File part = new File(dir, NEXUS_APK_NAME + ".part");
        File apk = new File(dir, NEXUS_APK_NAME);
        if (part.exists()) part.delete();
        if (apk.exists()) apk.delete();
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(NEXUS_LATEST_APK_URL).openConnection();
            c.setInstanceFollowRedirects(true);
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setRequestProperty("User-Agent", "Nexus-Box-Android-Updater");
            int code = c.getResponseCode();
            if (code < 200 || code >= 300) throw new Exception("Download refused by GitHub (code " + code + ").");
            long total = c.getContentLength() > 0 ? c.getContentLength() : expectedSize;
            js("Nexus._update && Nexus._update('downloading')");
            long got = 0; int lastPct = -1;
            try (InputStream in = c.getInputStream(); FileOutputStream out = new FileOutputStream(part)) {
                byte[] buf = new byte[32768]; int n;
                while ((n = in.read(buf)) != -1) {
                    out.write(buf, 0, n); got += n;
                    if (total > 0) {
                        int pct = (int) Math.min(100, got * 100 / total);
                        if (pct != lastPct) { lastPct = pct; js("Nexus._update && Nexus._update('progress'," + pct + ")"); }
                    }
                }
                out.getFD().sync();
            }
            if (expectedSize > 0 && got != expectedSize) throw new Exception("The download was cut off. Try again.");
            if (!part.renameTo(apk)) throw new Exception("Could not save the update.");
            return apk;
        } catch (java.io.IOException e) {
            throw new Exception("The internet dropped during the download. Try again.");
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private java.util.List<String> certificateDigests(android.content.pm.PackageInfo info) throws Exception {
        android.content.pm.Signature[] signatures;
        if (Build.VERSION.SDK_INT >= 28 && info.signingInfo != null) signatures = info.signingInfo.getApkContentsSigners();
        else signatures = info.signatures;
        if (signatures == null || signatures.length == 0) return null;   // this Android couldn't read them
        java.util.List<String> result = new ArrayList<>();
        java.security.MessageDigest digest = java.security.MessageDigest.getInstance("SHA-256");
        for (android.content.pm.Signature signature : signatures) {
            byte[] hash = digest.digest(signature.toByteArray());
            StringBuilder hex = new StringBuilder();
            for (byte value : hash) hex.append(String.format(Locale.ROOT, "%02x", value & 0xff));
            result.add(hex.toString());
        }
        Collections.sort(result);
        return result;
    }

    private void verifyNexusApk(File apk) throws Exception {
        if (!apk.isFile() || apk.length() < 256 * 1024) throw new Exception("The download is incomplete. Try again.");
        // Ask for both kinds: some Android builds only fill in one of them for a downloaded file.
        @SuppressWarnings("deprecation")
        int flags = PackageManager.GET_SIGNATURES | (Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : 0);
        android.content.pm.PackageInfo downloaded = getPackageManager().getPackageArchiveInfo(apk.getAbsolutePath(), flags);
        android.content.pm.PackageInfo installed = getPackageManager().getPackageInfo(getPackageName(), flags);
        if (downloaded == null) throw new Exception("The downloaded file is damaged. Try again.");
        if (!getPackageName().equals(downloaded.packageName)) throw new Exception("The download is not Nexus.");
        long downloadedVersion = Build.VERSION.SDK_INT >= 28 ? downloaded.getLongVersionCode() : downloaded.versionCode;
        long currentVersion = Build.VERSION.SDK_INT >= 28 ? installed.getLongVersionCode() : installed.versionCode;
        if (downloadedVersion < currentVersion) throw new Exception("The download is older than this Nexus.");
        java.util.List<String> got = certificateDigests(downloaded), have = certificateDigests(installed);
        // If this Android can't read the download's signature here, Android's own installer still checks it
        // and refuses an update signed differently, so the install goes ahead instead of stopping with an error.
        if (got != null && have != null && !got.equals(have)) throw new Exception("This box has a Nexus with a different signature. Install nexus.apk once from the GitHub page in the browser.");
    }

    // Installs through Android's own package installer session: Android shows its INSTALL/UPDATE screen.
    private void installNexusApk(File apk) {
        try {
            if (updateReceiver == null) {
                updateReceiver = new BroadcastReceiver() {
                    @Override public void onReceive(Context context, Intent intent) {
                        int status = intent.getIntExtra(android.content.pm.PackageInstaller.EXTRA_STATUS, android.content.pm.PackageInstaller.STATUS_FAILURE);
                        if (status == android.content.pm.PackageInstaller.STATUS_PENDING_USER_ACTION) {
                            Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                            if (confirm != null) {
                                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                try { startActivity(confirm); js("Nexus._update && Nexus._update('ready')"); }
                                catch (Exception e) { if (!backupInstall(lastApk)) updateFailed("Android could not open the install screen."); }
                            }
                        } else if (status == android.content.pm.PackageInstaller.STATUS_SUCCESS) {
                            updateBusy = false;
                        } else if (status == android.content.pm.PackageInstaller.STATUS_FAILURE_ABORTED) {
                            updateFailed("The install was cancelled. Tap DOWNLOAD UPDATE to try again.");
                        } else {
                            String msg = intent.getStringExtra(android.content.pm.PackageInstaller.EXTRA_STATUS_MESSAGE);
                            if (!backupInstall(lastApk)) updateFailed("Android refused the install" + (msg != null && !msg.isEmpty() ? ": " + msg : "."));
                        }
                    }
                };
                IntentFilter filter = new IntentFilter(UPDATE_STATUS_ACTION);
                if (Build.VERSION.SDK_INT >= 33) registerReceiver(updateReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
                else registerReceiver(updateReceiver, filter);
            }
            android.content.pm.PackageInstaller installer = getPackageManager().getPackageInstaller();
            android.content.pm.PackageInstaller.SessionParams params = new android.content.pm.PackageInstaller.SessionParams(android.content.pm.PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            params.setAppPackageName(getPackageName());
            params.setSize(apk.length());
            int sessionId = installer.createSession(params);
            android.content.pm.PackageInstaller.Session session = installer.openSession(sessionId);
            try (InputStream in = new java.io.FileInputStream(apk); java.io.OutputStream out = session.openWrite(NEXUS_APK_NAME, 0, apk.length())) {
                byte[] buf = new byte[65536]; int n;
                while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
                session.fsync(out);
            }
            Intent status = new Intent(UPDATE_STATUS_ACTION).setPackage(getPackageName());
            int piFlags = android.app.PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? android.app.PendingIntent.FLAG_MUTABLE : 0);
            android.app.PendingIntent pi = android.app.PendingIntent.getBroadcast(this, sessionId, status, piFlags);
            session.commit(pi.getIntentSender());
            session.close();
            js("Nexus._update && Nexus._update('installing')");
        } catch (Exception e) {
            if (!backupInstall(apk)) updateFailed("Android could not start the install: " + e.getClass().getSimpleName());
        }
    }

    // ---------- PHONES: passengers join from their phones ----------
    private volatile PhoneServer phones = null;
    private volatile String phoneStateJson = "{}";
    private String phonePin() {
        String p = prefs.getString("phonePin", "");
        if (p.isEmpty()) { p = String.valueOf(1000 + new java.util.Random().nextInt(9000)); prefs.edit().putString("phonePin", p).apply(); }
        return p;
    }
    private synchronized void startPhones() {
        if (phones != null) return;
        byte[] page;
        try (InputStream is = getAssets().open("phone.html")) { ByteArrayOutputStream bo = new ByteArrayOutputStream(); byte[] b = new byte[8192]; int n; while ((n = is.read(b)) > 0) bo.write(b, 0, n); page = bo.toByteArray(); }
        catch (Exception e) { return; }
        phones = new PhoneServer(page, this::phoneRequest);
        pool.execute(phones::start);
    }
    private String phoneRequest(String method, String path, String query, byte[] body) {
        try {
            if (path.equals("state")) return phoneStateJson;
            if (!method.equals("POST")) return null;
            JSONObject o = new JSONObject(new String(body, StandardCharsets.UTF_8));
            if (!phonePin().equals(o.optString("pin"))) return "{\"ok\":false,\"error\":\"pin\"}";
            String name = o.optString("name", "Someone").trim();
            if (name.length() > 24) name = name.substring(0, 24);
            JSONObject ev = new JSONObject();
            ev.put("type", path); ev.put("name", name);
            if (path.equals("photo")) {
                String data = o.optString("data", "");
                int comma = data.indexOf(',');
                if (comma < 0 || data.length() > 12 * 1024 * 1024) return "{\"ok\":false}";
                byte[] jpg = android.util.Base64.decode(data.substring(comma + 1), android.util.Base64.DEFAULT);
                File dir = new File(getFilesDir(), "photos"); if (!dir.exists()) dir.mkdirs();
                File[] old = dir.listFiles();
                if (old != null && old.length > 40) { java.util.Arrays.sort(old, (x, y) -> Long.compare(x.lastModified(), y.lastModified())); for (int i = 0; i < old.length - 40; i++) old[i].delete(); }
                String fn = "p" + System.currentTimeMillis() + ".jpg";
                try (FileOutputStream fo = new FileOutputStream(new File(dir, fn))) { fo.write(jpg); }
                ev.put("file", fn);
                ev.put("data", data);
            } else if (path.equals("song") || path.equals("msg")) {
                String t = o.optString("text", "").trim(); if (t.isEmpty()) return "{\"ok\":false}";
                if (t.length() > 160) t = t.substring(0, 160);
                ev.put("text", t);
            } else if (path.equals("remote")) {
                ev.put("cmd", o.optString("cmd", ""));
            } else if (!path.equals("join")) return null;
            js("Nexus._phone && Nexus._phone(" + JSONObject.quote(ev.toString()) + ")");
            return "{\"ok\":true}";
        } catch (Exception e) { return "{\"ok\":false}"; }
    }
    private String qrDataUrl(String text) {
        try {
            java.util.Map<com.google.zxing.EncodeHintType, Object> hints = new java.util.HashMap<>();
            hints.put(com.google.zxing.EncodeHintType.MARGIN, 2);
            com.google.zxing.common.BitMatrix m = new com.google.zxing.qrcode.QRCodeWriter().encode(text, com.google.zxing.BarcodeFormat.QR_CODE, 0, 0, hints);
            int w = m.getWidth(), h = m.getHeight(), sc = 10;
            android.graphics.Bitmap bmp = android.graphics.Bitmap.createBitmap(w * sc, h * sc, android.graphics.Bitmap.Config.ARGB_8888);
            int[] row = new int[w * sc];
            for (int y = 0; y < h; y++) {
                for (int x = 0; x < w; x++) { int c = m.get(x, y) ? 0xFF000000 : 0xFFFFFFFF; for (int k = 0; k < sc; k++) row[x * sc + k] = c; }
                for (int k = 0; k < sc; k++) bmp.setPixels(row, 0, w * sc, 0, y * sc + k, w * sc, 1);
            }
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            bmp.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, bo);
            return "data:image/png;base64," + android.util.Base64.encodeToString(bo.toByteArray(), android.util.Base64.NO_WRAP);
        } catch (Throwable e) { return ""; }
    }
    // Plays a song by name in Spotify straight away (no searching by hand), then brings Nexus back.
    private void playSearch(String query) {
        try {
            Intent i = new Intent(android.provider.MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH);
            i.putExtra(android.app.SearchManager.QUERY, query);
            i.putExtra(android.provider.MediaStore.EXTRA_MEDIA_FOCUS, "vnd.android.cursor.item/*");
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            boolean spotify = true;
            try { getPackageManager().getPackageInfo("com.spotify.music", 0); i.setPackage("com.spotify.music"); } catch (Exception e) { spotify = false; }
            if (i.resolveActivity(getPackageManager()) == null) {
                Intent v = new Intent(Intent.ACTION_VIEW, Uri.parse("spotify:search:" + Uri.encode(query))); v.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); startActivity(v);
            } else startActivity(i);
            ui.postDelayed(() -> { Intent back = new Intent(this, MainActivity.class); back.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_NEW_TASK); try { startActivity(back); } catch (Exception ignored) {} }, spotify ? 3500 : 4500);
        } catch (Exception e) { js("Nexus._toast && Nexus._toast('Could not start that song')"); }
    }

    // Starts Spotify's background service (no screen) so the app is already loaded when you tap it.
    private android.media.browse.MediaBrowser spotifyWarm = null;
    private void warmSpotify() {
        try { getPackageManager().getPackageInfo("com.spotify.music", 0); } catch (Exception e) { return; }
        try {
            if (spotifyWarm != null) {
                try {
                    if (spotifyWarm.isConnected()) {
                        ui.removeCallbacks(spotifyRewarm);
                        ui.postDelayed(spotifyRewarm, 8 * 60 * 1000L);
                        return;
                    }
                    spotifyWarm.disconnect();
                } catch (Exception ignored) {}
                spotifyWarm = null;
            }
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
        ui.removeCallbacks(spotifyRewarm); ui.postDelayed(spotifyRewarm, 8 * 60 * 1000L);
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
        pausedAt = 0;
        if (web != null) { web.onResume(); web.resumeTimers(); }
        js("Nexus.resumed && Nexus.resumed()");
        ui.postDelayed(this::warmSpotify, 4000);
        hideExitBubble();
    }

    // ---------- Floating "back to Nexus" button over Spotify ----------
    // Spotify is its own app, so Nexus floats a small button above it (Android's "Display over other
    // apps" permission, granted once from Nexus Settings). Tap it to come home; drag it to move it.
    // It is removed as soon as Nexus is back on screen.
    private static final java.util.Set<String> EXIT_BUBBLE_APPS = new java.util.HashSet<>(java.util.Arrays.asList("com.spotify.music"));
    private View exitBubble = null;
    private boolean overlayAllowed() { return Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(this); }
    private void showExitBubble() {
        if (exitBubble != null || !overlayAllowed() || prefs == null || "0".equals(prefs.getString("p_exitBubble", "1"))) return;
        try {
            final WindowManager wm = (WindowManager) getSystemService(WINDOW_SERVICE);
            float dp = getResources().getDisplayMetrics().density;
            android.widget.TextView b = new android.widget.TextView(this);
            b.setText("\u2039  NEXUS");
            b.setTextColor(0xFFFFFFFF);
            b.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 15);
            b.setLetterSpacing(.12f);
            b.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
            int ph = Math.round(18 * dp), pv = Math.round(12 * dp);
            b.setPadding(ph, pv, ph, pv);
            android.graphics.drawable.GradientDrawable bg = new android.graphics.drawable.GradientDrawable(
                android.graphics.drawable.GradientDrawable.Orientation.TL_BR, new int[]{0xE62A1B5C, 0xE6123A66});
            bg.setCornerRadius(28 * dp);
            bg.setStroke(Math.max(1, Math.round(dp)), 0x7FB79CFF);
            b.setBackground(bg);
            b.setElevation(8 * dp);
            b.setContentDescription("Back to Nexus");
            int type = Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE;
            final WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT, type,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                android.graphics.PixelFormat.TRANSLUCENT);
            lp.gravity = android.view.Gravity.TOP | android.view.Gravity.START;
            lp.x = prefs.getInt("exitBubbleX", Math.round(16 * dp));
            lp.y = prefs.getInt("exitBubbleY", Math.round(getResources().getDisplayMetrics().heightPixels * .42f));
            final float slop = 10 * dp;
            b.setOnTouchListener(new View.OnTouchListener() {
                float downX, downY; int startX, startY; boolean dragging;
                @Override public boolean onTouch(View v, android.view.MotionEvent e) {
                    switch (e.getActionMasked()) {
                        case android.view.MotionEvent.ACTION_DOWN:
                            downX = e.getRawX(); downY = e.getRawY(); startX = lp.x; startY = lp.y; dragging = false;
                            v.setAlpha(.8f); return true;
                        case android.view.MotionEvent.ACTION_MOVE:
                            float dx = e.getRawX() - downX, dy = e.getRawY() - downY;
                            if (!dragging && Math.hypot(dx, dy) > slop) dragging = true;
                            if (dragging) { lp.x = Math.max(0, Math.round(startX + dx)); lp.y = Math.max(0, Math.round(startY + dy)); try { wm.updateViewLayout(v, lp); } catch (Exception ignored) {} }
                            return true;
                        case android.view.MotionEvent.ACTION_UP:
                            v.setAlpha(1f);
                            if (dragging) prefs.edit().putInt("exitBubbleX", lp.x).putInt("exitBubbleY", lp.y).apply();
                            else backToNexus();
                            return true;
                        case android.view.MotionEvent.ACTION_CANCEL:
                            v.setAlpha(1f); return true;
                    }
                    return false;
                }
            });
            wm.addView(b, lp);
            exitBubble = b;
        } catch (Exception e) { exitBubble = null; }
    }
    private void hideExitBubble() {
        if (exitBubble == null) return;
        try { ((WindowManager) getSystemService(WINDOW_SERVICE)).removeView(exitBubble); } catch (Exception ignored) {}
        exitBubble = null;
    }
    private void backToNexus() {
        hideExitBubble();
        try {
            Intent back = new Intent(this, MainActivity.class);
            back.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(back);
        } catch (Exception ignored) {}
        js("Nexus.home && Nexus.home()");
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
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == CinemaLibrary.REQ_PERMISSION && cinema != null) cinema.onPermissionResult();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == CinemaLibrary.REQ_TREE && cinema != null) cinema.onTreeResult(resultCode, data);
    }

    @Override
    public void onBackPressed() {
        js("Nexus.back && Nexus.back()");
    }

    @Override
    protected void onDestroy() {
        hideExitBubble();
        try { if (updateReceiver != null) unregisterReceiver(updateReceiver); } catch (Exception ignored) {}
        if (tts != null) tts.shutdown();
        stopStartupVoice();
        stopMeter();
        try { unregisterReceiver(spotifyReceiver); } catch (Exception ignored) {}
        try { unregisterReceiver(packageReceiver); } catch (Exception ignored) {}
        try { unregisterReceiver(driveReceiver); } catch (Exception ignored) {}
        if (Build.VERSION.SDK_INT >= 30 && cinemaVolumeCallback != null) {
            try { ((android.os.storage.StorageManager) getSystemService(Context.STORAGE_SERVICE)).unregisterStorageVolumeCallback((android.os.storage.StorageManager.StorageVolumeCallback) cinemaVolumeCallback); } catch (Exception ignored) {}
        }
        if (cinema != null) cinema.shutdown();
        if (cinemaMeta != null) cinemaMeta.shutdown();
        if (recognizer != null) recognizer.destroy();
        try { if (spotifyWarm != null) spotifyWarm.disconnect(); } catch (Exception ignored) {}
        pool.shutdownNow();
        aiPool.shutdownNow();
        if (phones != null) phones.stop();
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

    private final java.util.Map<String, String[]> launchCache = new java.util.concurrent.ConcurrentHashMap<>();
    private void startComponent(String pkg, String cls) {
        try {
            Intent i = new Intent(Intent.ACTION_MAIN);
            i.addCategory(Intent.CATEGORY_LAUNCHER);
            i.setComponent(new ComponentName(pkg, cls));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED | Intent.FLAG_ACTIVITY_NO_ANIMATION);
            startActivity(i);
            if (EXIT_BUBBLE_APPS.contains(pkg)) ui.post(this::showExitBubble);
        } catch (Exception e) {
            launchCache.clear();
            ui.post(() -> Toast.makeText(this, "Could not open that app", Toast.LENGTH_SHORT).show());
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
        (url != null && url.contains("generativelanguage") ? aiPool : pool).execute(() -> {
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
        aiPool.execute(() -> {
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
            visualizerDetail = meterDetail;
            Visualizer v = new Visualizer(0);
            v.setEnabled(false);
            int[] range = Visualizer.getCaptureSizeRange();
            v.setCaptureSize(Math.max(range[0], Math.min(512, range[1])));
            v.setScalingMode(Visualizer.SCALING_MODE_NORMALIZED);
            v.setDataCaptureListener(new Visualizer.OnDataCaptureListener() {
                long lastSend = 0, lastDetail = 0;
                @Override public void onWaveFormDataCapture(Visualizer vis, byte[] wave, int rate) {}
                @Override public void onFftDataCapture(Visualizer vis, byte[] fft, int rate) {
                    long now = System.currentTimeMillis();
                    if (meterDetail && now - lastDetail >= 30) { lastDetail = now; sendDetail(fft, rate); }
                    if (now - lastSend < 80) return;
                    lastSend = now;
                    int n = fft.length / 2;
                    double bass = 0, mid = 0, high = 0, all = 0;
                    int midBins = 0, highBins = 0;
                    for (int k = 1; k < n; k++) {
                        double re = fft[2 * k], im = fft[2 * k + 1];
                        double mag = Math.sqrt(re * re + im * im) / 128.0;
                        if (k <= 6) bass += mag;
                        else if (k <= 24) mid += mag;
                        else high += mag;
                        if (k <= 64) all += mag;
                        if (k >= 7 && k <= 24) midBins++;
                        else if (k >= 25) highBins++;
                    }
                    bass /= 6.0; mid /= Math.max(1, midBins); high /= Math.max(1, highBins); all /= 64.0;
                    js("Nexus._meter && Nexus._meter(" + String.format(Locale.US, "%.4f", all) + "," + String.format(Locale.US, "%.4f", bass) + "," + String.format(Locale.US, "%.4f", mid) + "," + String.format(Locale.US, "%.4f", high) + ")");
                }
            }, visualizerDetail ? Visualizer.getMaxCaptureRate() : Math.min(Visualizer.getMaxCaptureRate(), 12000), false, true);
            v.setEnabled(true);
            visualizer = v;
            return true;
        } catch (Throwable t) {
            visualizer = null;
            return false;
        }
    }

    // Six bands by real frequency: sub (<120 Hz), bass (120-250), low-mid (250-700), mid (700-2500),
    // high (2.5-7 kHz) and air (above 7 kHz). Sent only while Visuals is open.
    private static final double[] DETAIL_EDGES = {20, 120, 250, 700, 2500, 7000, 16000};
    private void sendDetail(byte[] fft, int rateMilliHz) {
        int n = fft.length / 2;
        if (n < 8) return;
        double binHz = (rateMilliHz / 1000.0) / fft.length;
        if (binHz <= 0) binHz = 44100.0 / fft.length;
        double[] band = new double[6]; int[] count = new int[6];
        for (int k = 1; k < n; k++) {
            double f = k * binHz; int b = -1;
            for (int j = 0; j < 6; j++) if (f >= DETAIL_EDGES[j] && f < DETAIL_EDGES[j + 1]) { b = j; break; }
            if (b < 0) { if (f < DETAIL_EDGES[0]) b = 0; else continue; }
            double re = fft[2 * k], im = fft[2 * k + 1];
            band[b] += Math.sqrt(re * re + im * im) / 128.0; count[b]++;
        }
        StringBuilder sb = new StringBuilder("Nexus._meter6 && Nexus._meter6(");
        for (int j = 0; j < 6; j++) { if (j > 0) sb.append(','); sb.append(String.format(Locale.US, "%.4f", count[j] > 0 ? band[j] / count[j] : 0)); }
        js(sb.append(')').toString());
    }

    private void setMeterDetail(boolean on) {
        if (meterDetail == on) return;
        meterDetail = on;
        // a running Visualizer keeps its capture rate, so restart it to pick up the faster rate. The restart
        // reopens the playback Visualizer only: it never falls back to the microphone (Party Mode relies on that).
        if (on && meterOn && visualizer != null && !visualizerDetail) {
            stopMeter();
            if (startVisualizer()) { meterOn = true; js("Nexus._meterSource && Nexus._meterSource('music')"); }
            else { js("Nexus._meterSource && Nexus._meterSource('unavailable')"); js("Nexus._meterError && Nexus._meterError('playback')"); }
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

    // Party Mode follows device playback only. It never falls back to microphone capture,
    // which would light Android's microphone privacy indicator during ordinary playback.
    private void startPartyMeter() {
        if (meterOn && visualizer != null) return;
        stopMeter();
        if (startVisualizer()) {
            meterOn = true;
            js("Nexus._meterSource && Nexus._meterSource('music')");
        } else {
            js("Nexus._meterSource && Nexus._meterSource('unavailable')");
            js("Nexus._meterError && Nexus._meterError('playback')");
        }
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
        // ---------- Nexus Cinema (read only: nothing here changes anything on a drive) ----------
        @JavascriptInterface public String cinemaDrives() { return cinema == null ? "[]" : cinema.drivesJson(); }
        @JavascriptInterface public String cinemaLibrary() { return cinema == null ? "[]" : cinema.libraryJson(); }
        @JavascriptInterface public String cinemaProgress() { return cinema == null ? "{}" : cinema.progressJson(); }
        @JavascriptInterface public void cinemaGrant(String uuid) { if (cinema != null && uuid != null) ui.post(() -> cinema.grant(uuid)); }
        @JavascriptInterface public void cinemaScan(String uuid) { if (cinema != null && uuid != null) cinema.scan(uuid); }
        @JavascriptInterface public void cinemaInfo(String uuid, String rel) { if (cinema != null && uuid != null && rel != null) cinema.info(uuid, rel); }
        // movie and TV information (TMDB), saved on the box; everything here works without internet
        @JavascriptInterface public String cinemaMeta() { return cinemaMeta == null ? "{}" : cinemaMeta.allJson(); }
        @JavascriptInterface public String cinemaMetaStatus() { return cinemaMeta == null ? "{}" : cinemaMeta.statusJson(); }
        @JavascriptInterface public void cinemaMetaWant(String json) { if (cinemaMeta != null && json != null) { final String j = json; pool.execute(() -> cinemaMeta.want(j)); } }
        @JavascriptInterface public void cinemaMetaKey(String key) { if (cinemaMeta != null) cinemaMeta.setKey(key); }
        @JavascriptInterface public void cinemaMetaChoose(String key, String tmdbId) { if (cinemaMeta != null && key != null) { long id = 0; try { id = Long.parseLong(tmdbId); } catch (Exception ignored) {} cinemaMeta.choose(key, id); } }
        @JavascriptInterface public void cinemaMetaSearch(String key, String query) { if (cinemaMeta != null && key != null) cinemaMeta.research(key, query); }
        @JavascriptInterface public void cinemaMetaRetry() { if (cinemaMeta != null) cinemaMeta.retryAll(); }
        @JavascriptInterface
        public boolean cinemaPlay(String uuid, String rel, String title, double startMs, String subsJson) {
            if (cinema == null || uuid == null || rel == null) return false;
            Uri u = cinema.uriFor(uuid, rel);
            if (u == null) return false;
            try {
                JSONArray subs = new JSONArray();
                JSONArray in = new JSONArray(subsJson == null || subsJson.isEmpty() ? "[]" : subsJson);
                for (int i = 0; i < in.length(); i++) {
                    String sr = in.getString(i);
                    Uri su = cinema.uriFor(uuid, sr);
                    if (su == null) continue;
                    JSONObject o = new JSONObject();
                    o.put("uri", su.toString());
                    String nm = sr.substring(sr.lastIndexOf('/') + 1);
                    o.put("name", nm);
                    o.put("label", nm);
                    subs.put(o);
                }
                Uri share = "file".equals(u.getScheme()) ? MovieProvider.uriFor(new File(u.getPath())) : u;
                Intent i = new Intent(MainActivity.this, PlayerActivity.class);
                i.putExtra(PlayerActivity.EXTRA_URI, u.toString());
                i.putExtra(PlayerActivity.EXTRA_SHARE_URI, share.toString());
                i.putExtra(PlayerActivity.EXTRA_TITLE, title);
                i.putExtra(PlayerActivity.EXTRA_KEY, uuid + "|" + rel);
                i.putExtra(PlayerActivity.EXTRA_START, (long) Math.max(0, startMs));
                i.putExtra(PlayerActivity.EXTRA_SUBS, subs.toString());
                i.putExtra(PlayerActivity.EXTRA_DRIVE_PATH, cinema.pathFor(uuid));
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                ui.post(() -> { try { startActivity(i); } catch (Exception e) { js("window.NexusCinema && NexusCinema._error('The player could not start.')"); } });
                return true;
            } catch (Exception e) { return false; }
        }

        @JavascriptInterface
        public int deviceMemoryGb() {
            try {
                ActivityManager manager = (ActivityManager) MainActivity.this.getSystemService(Context.ACTIVITY_SERVICE);
                ActivityManager.MemoryInfo memory = new ActivityManager.MemoryInfo();
                if (manager == null) return 0;
                manager.getMemoryInfo(memory);
                return (int) Math.floor(memory.totalMem / (1024d * 1024d * 1024d));
            } catch (Exception ignored) { return 0; }
        }

        @JavascriptInterface
        public void speak(String text, String id) {
            if (tts == null) return;
            if (!ttsReady) { synchronized (pendingSpeech) { pendingSpeech.add(new String[]{text, id}); } return; }
            doSpeak(text, id);
        }

        @JavascriptInterface
        public boolean nativeGreeting() { return nativeGreeting; }
        @JavascriptInterface
        public boolean startupVoice() { ui.post(MainActivity.this::playStartupVoice); return true; }
        @JavascriptInterface
        public void stopStartupVoice() { ui.post(MainActivity.this::stopStartupVoice); }

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
        public String phoneInfo() {
            try {
                if (phones == null) { startPhones(); return "{\"ok\":false,\"starting\":true}"; }
                if (phones.port == 0) return "{\"ok\":false,\"starting\":true}";
                JSONObject o = new JSONObject(); JSONArray urls = new JSONArray();
                for (String ip : PhoneServer.addresses()) urls.put("http://" + ip + ":" + phones.port + "/");
                o.put("ok", true); o.put("pin", phonePin()); o.put("urls", urls);
                if (urls.length() > 0) o.put("qr", qrDataUrl(urls.getString(0) + "?p=" + phonePin()));
                return o.toString();
            } catch (Exception e) { return "{\"ok\":false}"; }
        }
        @JavascriptInterface
        public void phoneState(String json) { phoneStateJson = json == null ? "{}" : json; }
        @JavascriptInterface
        public void newPhonePin() { prefs.edit().putString("phonePin", "").apply(); phonePin(); }
        @JavascriptInterface
        public void playSearch(String q) { ui.post(() -> MainActivity.this.playSearch(q)); }
        @JavascriptInterface
        public String photoData(String fn) {
            try {
                File f = new File(new File(getFilesDir(), "photos"), new File(fn).getName());
                if (!f.exists()) return "";
                byte[] b = new byte[(int) f.length()];
                try (java.io.FileInputStream fi = new java.io.FileInputStream(f)) { int got = 0; while (got < b.length) { int n = fi.read(b, got, b.length - got); if (n < 0) break; got += n; } }
                return "data:image/jpeg;base64," + android.util.Base64.encodeToString(b, android.util.Base64.NO_WRAP);
            } catch (Exception e) { return ""; }
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
        public boolean exitBubbleAllowed() { return overlayAllowed(); }

        // Opens Android's "Display over other apps" screen for Nexus (needed once for the Spotify exit button).
        @JavascriptInterface
        public void allowExitBubble() {
            ui.post(() -> {
                try {
                    Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName()));
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i);
                } catch (Exception e) {
                    try { Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION); i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); startActivity(i); }
                    catch (Exception e2) { Toast.makeText(MainActivity.this, "This box does not offer that setting", Toast.LENGTH_LONG).show(); }
                }
            });
        }

        @JavascriptInterface
        public void refreshApps() { /* apps are re-scanned automatically when something is installed or removed */ }

        @JavascriptInterface
        public boolean launchApp(String namesCsv) {
            String[] hit = launchCache.get(namesCsv);
            if (hit != null) { try { startComponent(hit[0], hit[1]); return true; } catch (Exception e) { launchCache.remove(namesCsv); } }
            // Spotify is usually the very first thing tapped, often before the background app-label
            // scan below has finished populating its cache. Go straight to its own launcher intent
            // (the normal, fast way to start another app by package) instead of waiting on that scan.
            if (namesCsv.toLowerCase(Locale.ROOT).contains("spotify")) {
                try {
                    Intent spotifyIntent = getPackageManager().getLaunchIntentForPackage("com.spotify.music");
                    ComponentName spotifyComponent = spotifyIntent != null ? spotifyIntent.getComponent() : null;
                    if (spotifyComponent != null) {
                        String pkg = spotifyComponent.getPackageName(), cls = spotifyComponent.getClassName();
                        launchCache.put(namesCsv, new String[]{pkg, cls});
                        startComponent(pkg, cls);
                        return true;
                    }
                } catch (Exception ignored) {}
            }
            List<String[]> list = labels();
            for (String raw : namesCsv.split(",")) {
                String q = raw.trim().toLowerCase(Locale.ROOT);
                if (q.isEmpty()) continue;
                for (String[] a : list) {
                    if (a[0].contains(q) || a[1].toLowerCase(Locale.ROOT).contains(q)) {
                        final String pkg = a[1], cls = a[2];
                        launchCache.put(namesCsv, new String[]{pkg, cls});
                        startComponent(pkg, cls);
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
                    if (EXIT_BUBBLE_APPS.contains(pkg)) showExitBubble();
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
        public void updateNexus() { ui.post(MainActivity.this::startUpdate); }
        @JavascriptInterface
        public String lastUpdateError() { return prefs.getString("lastUpdateError", ""); }

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
                        if (spPos >= 0) o.put("pos", spPos + (spPlaying ? System.currentTimeMillis() - spPosAt : 0));
                        if (spLen > 0) o.put("dur", spLen);
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
                if (st != null) {
                    long pos = st.getPosition();
                    if (st.getState() == PlaybackState.STATE_PLAYING) pos += (long) ((android.os.SystemClock.elapsedRealtime() - st.getLastPositionUpdateTime()) * st.getPlaybackSpeed());
                    o.put("pos", pos);
                }
                if (md != null) {
                    o.put("dur", md.getLong(MediaMetadata.METADATA_KEY_DURATION));
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
        public String partyMediaInfo() {
            JSONObject o = new JSONObject();
            try {
                if (!hasMediaAccess()) {
                    o.put("access", false);
                    return o.toString();
                }
                o.put("access", true);
                MediaController c = activeController();
                if (c == null) {
                    return o.toString();
                }
                o.put("app", c.getPackageName());
                PlaybackState state = c.getPlaybackState();
                MediaMetadata metadata = c.getMetadata();
                long actions = state != null ? state.getActions() : 0L;
                boolean playing = state != null && state.getState() == PlaybackState.STATE_PLAYING;
                o.put("playing", playing);
                o.put("canPrevious", (actions & PlaybackState.ACTION_SKIP_TO_PREVIOUS) != 0);
                o.put("canNext", (actions & PlaybackState.ACTION_SKIP_TO_NEXT) != 0);
                o.put("canPlayPause", (actions & (PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE)) != 0);
                if (state != null) {
                    long position = state.getPosition();
                    if (playing && state.getLastPositionUpdateTime() > 0L) {
                        position += (long) ((android.os.SystemClock.elapsedRealtime() - state.getLastPositionUpdateTime()) * state.getPlaybackSpeed());
                    }
                    o.put("position", Math.max(0L, position));
                }
                if (metadata != null) {
                    String title = metadata.getString(MediaMetadata.METADATA_KEY_TITLE);
                    String artist = metadata.getString(MediaMetadata.METADATA_KEY_ARTIST);
                    String album = metadata.getString(MediaMetadata.METADATA_KEY_ALBUM);
                    if (title != null) o.put("title", title);
                    if (artist != null) o.put("artist", artist);
                    if (album != null) o.put("album", album);
                    o.put("duration", Math.max(0L, metadata.getLong(MediaMetadata.METADATA_KEY_DURATION)));
                }
            } catch (Exception ignored) {}
            return o.toString();
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
        public void meter(boolean on) { if (on) startMeter(); else { meterDetail = false; stopMeter(); } }
        @JavascriptInterface
        public void meterDetail(boolean on) { setMeterDetail(on); }

        @JavascriptInterface
        public void partyMeter(boolean on) { if (on) startPartyMeter(); else stopMeter(); }

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
