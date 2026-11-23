package com.nexus.box;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.MediaController;
import android.widget.TextView;
import android.widget.VideoView;

import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.Tracks;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Nexus Cinema's full-screen player. Plays straight from the drive (nothing is copied), with pause, seek,
 * subtitles and audio-track choice. If the main player can't decode a film's picture or sound, it retries
 * once with the box's own built-in player before saying clearly that the film can't be played. Remembers
 * where you stopped. If the drive is unplugged mid-film it stops safely and says so.
 */
public class PlayerActivity extends Activity {
    public static final String EXTRA_URI = "uri", EXTRA_TITLE = "title", EXTRA_KEY = "key", EXTRA_START = "startMs",
        EXTRA_SUBS = "subs", EXTRA_DRIVE_PATH = "drivePath", EXTRA_SHARE_URI = "shareUri";

    private final Handler ui = new Handler(Looper.getMainLooper());
    private FrameLayout root;
    private PlayerView playerView;
    private ExoPlayer exo;
    private VideoView compat;
    private TextView message;
    private LinearLayout buttons;
    private Uri uri;
    private String key, title, drivePath;
    private long startMs, lastPos = 0, lastDur = 0;
    private boolean usingCompat = false, tracksChecked = false, finishedSafely = false;
    private SharedPreferences progress;

    private final Runnable saver = new Runnable() {
        @Override public void run() { savePosition(false); ui.postDelayed(this, 10000); }
    };

    private final BroadcastReceiver unplug = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) {
            Uri d = i.getData();
            String p = d == null ? null : d.getPath();
            if (drivePath != null && p != null && (drivePath.equals(p) || p.startsWith(drivePath + "/"))) { driveGone(); return; }
            // another drive, or a path we can't match: stop only if the film itself became unreadable
            ui.postDelayed(() -> { if (!driveAvailable()) driveGone(); }, 1000);
        }
    };

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_FULLSCREEN);
        progress = getSharedPreferences("cinema_progress", MODE_PRIVATE);
        Intent in = getIntent();
        uri = Uri.parse(in.getStringExtra(EXTRA_URI));
        key = in.getStringExtra(EXTRA_KEY);
        title = in.getStringExtra(EXTRA_TITLE);
        drivePath = in.getStringExtra(EXTRA_DRIVE_PATH);
        startMs = in.getLongExtra(EXTRA_START, 0);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        setContentView(root);
        hideBars();

        message = new TextView(this);
        message.setTextColor(Color.WHITE);
        message.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        message.setGravity(Gravity.CENTER);
        message.setLineSpacing(0, 1.2f);
        int pad = dp(22);
        message.setPadding(pad, pad, pad, pad);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(0xE60A1020);
        bg.setCornerRadius(dp(18));
        bg.setStroke(Math.max(1, dp(1)), 0x6648D8FF);
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackground(bg);
        box.setPadding(dp(10), dp(10), dp(10), dp(16));
        box.addView(message);
        buttons = new LinearLayout(this);
        buttons.setGravity(Gravity.CENTER);
        box.addView(buttons);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER);
        lp.leftMargin = lp.rightMargin = dp(40);
        box.setVisibility(View.GONE);
        message.setTag(box);

        try {
            IntentFilter f = new IntentFilter();
            f.addAction(Intent.ACTION_MEDIA_EJECT);
            f.addAction(Intent.ACTION_MEDIA_UNMOUNTED);
            f.addAction(Intent.ACTION_MEDIA_REMOVED);
            f.addAction(Intent.ACTION_MEDIA_BAD_REMOVAL);
            f.addDataScheme("file");
            registerReceiver(unplug, f);
        } catch (Exception ignored) {}

        startExo();
        root.addView(box, lp);
        ui.postDelayed(saver, 10000);
    }

    private int dp(float v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    private void hideBars() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
    }

    @Override public void onWindowFocusChanged(boolean f) { super.onWindowFocusChanged(f); if (f) hideBars(); }

    // ------------------------------------------------------------------ main player

    private List<MediaItem.SubtitleConfiguration> subtitles() {
        List<MediaItem.SubtitleConfiguration> out = new ArrayList<>();
        try {
            JSONArray a = new JSONArray(getIntent().getStringExtra(EXTRA_SUBS) == null ? "[]" : getIntent().getStringExtra(EXTRA_SUBS));
            for (int i = 0; i < a.length(); i++) {
                JSONObject s = a.getJSONObject(i);
                String name = s.optString("name").toLowerCase(Locale.ROOT);
                String mime = name.endsWith(".vtt") ? MimeTypes.TEXT_VTT : (name.endsWith(".ass") || name.endsWith(".ssa")) ? MimeTypes.TEXT_SSA : MimeTypes.APPLICATION_SUBRIP;
                out.add(new MediaItem.SubtitleConfiguration.Builder(Uri.parse(s.getString("uri")))
                    .setMimeType(mime).setLabel(s.optString("label", "Subtitles")).setLanguage(s.optString("lang", "und"))
                    .setSelectionFlags(0).build());
            }
        } catch (Exception ignored) {}
        return out;
    }

    private void startExo() {
        try {
            DefaultRenderersFactory rf = new DefaultRenderersFactory(this).setEnableDecoderFallback(true);
            exo = new ExoPlayer.Builder(this, rf).build();
            exo.setAudioAttributes(new androidx.media3.common.AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true);
            playerView = new PlayerView(this);
            playerView.setPlayer(exo);
            playerView.setShowSubtitleButton(true);
            playerView.setKeepScreenOn(true);
            root.addView(playerView, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
            exo.addListener(new Player.Listener() {
                @Override public void onTracksChanged(Tracks tracks) { checkTracks(tracks); }
                @Override public void onPlayerError(PlaybackException e) { exoFailed(e); }
                @Override public void onPlaybackStateChanged(int state) {
                    if (state == Player.STATE_ENDED) { savePosition(true); finishSoon(); }
                }
            });
            MediaItem item = new MediaItem.Builder().setUri(uri).setSubtitleConfigurations(subtitles()).build();
            exo.setMediaItem(item, Math.max(0, startMs));
            exo.prepare();
            exo.play();
        } catch (Throwable t) {
            startCompat("The main player couldn't start.");
        }
    }

    private void checkTracks(Tracks tracks) {
        if (tracksChecked || tracks.isEmpty()) return;
        tracksChecked = true;
        boolean hasVideo = false, videoOk = false, hasAudio = false, audioOk = false;
        for (Tracks.Group g : tracks.getGroups()) {
            if (g.getType() == C.TRACK_TYPE_VIDEO) { hasVideo = true; if (g.isSupported()) videoOk = true; }
            if (g.getType() == C.TRACK_TYPE_AUDIO) { hasAudio = true; if (g.isSupported()) audioOk = true; }
        }
        if (hasVideo && !videoOk) startCompat("This film's picture format isn't supported by the main player.");
        else if (hasAudio && !audioOk) startCompat("This film's sound format isn't supported by the main player.");
    }

    private void exoFailed(PlaybackException e) {
        if (!driveAvailable()) { driveGone(); return; }
        int code = e.errorCode;
        boolean format = code >= 3000 && code < 5000;   // parsing / decoding problems
        if (format && !usingCompat) { startCompat("The main player couldn't decode this film."); return; }
        fail("This film couldn't be played.\n(" + e.getErrorCodeName() + ")");
    }

    // ------------------------------------------------------------------ the box's own player (fallback)

    private void startCompat(String why) {
        if (usingCompat || finishedSafely) return;
        usingCompat = true;
        long pos = startMs;
        if (exo != null) {
            try { long p = exo.getCurrentPosition(); if (p > 0) pos = p; } catch (Exception ignored) {}
            try { exo.release(); } catch (Exception ignored) {}
            exo = null;
        }
        if (playerView != null) { root.removeView(playerView); playerView = null; }
        final long seekTo = pos;
        compat = new VideoView(this);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT, Gravity.CENTER);
        root.addView(compat, 0, lp);
        MediaController mc = new MediaController(this);
        mc.setAnchorView(compat);
        compat.setMediaController(mc);
        compat.setOnPreparedListener(mp -> {
            if (seekTo > 0) compat.seekTo((int) Math.min(Integer.MAX_VALUE, seekTo));
            compat.start();
            toast("Playing with the box's built-in player");
        });
        compat.setOnCompletionListener(mp -> { savePosition(true); finishSoon(); });
        compat.setOnErrorListener((mp, what, extra) -> {
            if (!driveAvailable()) driveGone();
            else fail(why + "\nThe box's built-in player couldn't play it either, so this film's format isn't supported on this box.");
            return true;
        });
        try { compat.setVideoURI(uri); }
        catch (Exception e) { fail(why + "\nThe box's built-in player couldn't open it either."); }
    }

    // ------------------------------------------------------------------ messages

    private void toast(String t) {
        try { android.widget.Toast.makeText(this, t, android.widget.Toast.LENGTH_SHORT).show(); } catch (Exception ignored) {}
    }

    private TextView button(String label, View.OnClickListener l) {
        TextView b = new TextView(this);
        b.setText(label);
        b.setTextColor(Color.WHITE);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        b.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        b.setPadding(dp(20), dp(12), dp(20), dp(12));
        GradientDrawable g = new GradientDrawable();
        g.setColor(0xFF183A5C);
        g.setCornerRadius(dp(24));
        b.setBackground(g);
        b.setFocusable(true);
        b.setOnClickListener(l);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.setMargins(dp(8), dp(12), dp(8), 0);
        b.setLayoutParams(lp);
        return b;
    }

    private void showMessage(String text, boolean offerOtherApp) {
        message.setText(text);
        buttons.removeAllViews();
        buttons.addView(button("BACK TO LIBRARY", v -> finish()));
        if (offerOtherApp) {
            final Intent other = otherPlayer();
            if (other != null) buttons.addView(button("OPEN IN ANOTHER PLAYER", v -> {
                try { startActivity(other); finish(); } catch (Exception e) { toast("No other video player is installed."); }
            }));
        }
        View box = (View) message.getTag();
        box.setVisibility(View.VISIBLE);
        box.bringToFront();
        if (buttons.getChildCount() > 0) buttons.getChildAt(0).requestFocus();
    }

    private Intent otherPlayer() {
        try {
            String share = getIntent().getStringExtra(EXTRA_SHARE_URI);
            if (share == null) return null;
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(Uri.parse(share), "video/*");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            List<android.content.pm.ResolveInfo> apps = getPackageManager().queryIntentActivities(i, 0);
            for (android.content.pm.ResolveInfo r : apps) {
                if (r.activityInfo != null && !getPackageName().equals(r.activityInfo.packageName)) {
                    return Intent.createChooser(i, "Play with").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    private void fail(String text) {
        stopPlayback();
        showMessage(text, true);
    }

    private void driveGone() {
        if (finishedSafely) return;
        finishedSafely = true;
        stopPlayback();
        showMessage("The movie drive was disconnected.\nYour place in \"" + (title == null ? "this film" : title) + "\" has been saved.", false);
        ui.postDelayed(this::finish, 8000);
    }

    private void finishSoon() { ui.postDelayed(this::finish, 600); }

    private boolean driveAvailable() {
        try {
            if ("file".equals(uri.getScheme())) return new File(uri.getPath()).canRead();
            android.os.ParcelFileDescriptor pfd = getContentResolver().openFileDescriptor(uri, "r");
            if (pfd != null) pfd.close();
            return pfd != null;
        } catch (Exception e) { return false; }
    }

    // ------------------------------------------------------------------ position

    private void readPosition() {
        try {
            if (exo != null) { long p = exo.getCurrentPosition(), d = exo.getDuration(); if (p > 0) lastPos = p; if (d > 0 && d != C.TIME_UNSET) lastDur = d; }
            else if (compat != null) { int p = compat.getCurrentPosition(), d = compat.getDuration(); if (p > 0) lastPos = p; if (d > 0) lastDur = d; }
        } catch (Exception ignored) {}
    }

    private void savePosition(boolean ended) {
        if (key == null) return;
        readPosition();
        if (lastPos <= 0 && !ended) return;
        try {
            JSONObject o = new JSONObject();
            boolean done = ended || (lastDur > 0 && lastPos > lastDur * 0.95);
            o.put("pos", done ? 0 : lastPos);
            o.put("dur", lastDur);
            o.put("done", done);
            o.put("at", System.currentTimeMillis());
            if (title != null) o.put("title", title);
            progress.edit().putString(key, o.toString()).apply();
        } catch (Exception ignored) {}
    }

    private void stopPlayback() {
        savePosition(false);
        ui.removeCallbacks(saver);
        if (exo != null) { try { exo.stop(); exo.release(); } catch (Exception ignored) {} exo = null; }
        if (compat != null) { try { compat.stopPlayback(); } catch (Exception ignored) {} }
    }

    @Override
    protected void onPause() {
        super.onPause();
        savePosition(false);
        if (exo != null) exo.pause();
        if (compat != null && compat.isPlaying()) compat.pause();
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        if (e.getKeyCode() == KeyEvent.KEYCODE_BACK && e.getAction() == KeyEvent.ACTION_UP) { savePosition(false); finish(); return true; }
        if (e.getKeyCode() == KeyEvent.KEYCODE_BACK) return true;
        return super.dispatchKeyEvent(e);
    }

    @Override
    protected void onDestroy() {
        stopPlayback();
        try { unregisterReceiver(unplug); } catch (Exception ignored) {}
        ui.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
