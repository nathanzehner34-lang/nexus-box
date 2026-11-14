package com.nexus.box;

import android.app.Activity;
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

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.Random;
import java.util.TimeZone;

/**
 * LIVE CAM: one tap drops you on a random live camera somewhere in the world.
 * Tap the screen for a new random place; it also hops on its own every few minutes.
 */
public class LiveCamActivity extends Activity {

    // [place, page path on skylinewebcams.com, time zone]
    private static final String[][] CAMS = {
        {"TOKYO · SHIBUYA CROSSING", "japan/kanto/tokyo/tokyo-shibuya-scramble-crossing", "Asia/Tokyo"},
        {"TOKYO · KABUKICHO", "japan/kanto/tokyo/shinjuku-kabukicho", "Asia/Tokyo"},
        {"LAS VEGAS · FREMONT STREET", "united-states/nevada/las-vegas/fremont-street", "America/Los_Angeles"},
        {"LOS ANGELES · VENICE BEACH", "united-states/california/los-angeles/venice-beach", "America/Los_Angeles"},
        {"LOS ANGELES · HOLLYWOOD BLVD", "united-states/california/los-angeles/hollywood-boulevard", "America/Los_Angeles"},
        {"ST. MAARTEN · MAHO BEACH", "sint-maarten/saint-martin/simpson-bay/maho-beach", "America/Lower_Princes"},
        {"FINLAND · NORTHERN LIGHTS", "finland/lapland/rovaniemi/northern-lights", "Europe/Helsinki"},
        {"ICELAND · NORTHERN LIGHTS", "iceland/sueurland/blaskogabygge/apavatn-northern-lights", "Atlantic/Reykjavik"},
        {"HAWAII · KILAUEA VOLCANO", "united-states/hawaii/pahoa/kilauea-volcano", "Pacific/Honolulu"},
        {"MEXICO · POPOCATEPETL VOLCANO", "mexico/puebla/san-pedro-benito-juarez/popocatepetl", "America/Mexico_City"},
        {"KENYA · MASAI MARA", "kenya/rift-valley-province/nakuru/masai-mara", "Africa/Nairobi"},
        {"JAPAN · MOUNT FUJI", "japan/yamanashi-prefecture/fujikawaguchiko/mount-fuji", "Asia/Tokyo"},
        {"TOKYO TOWER", "japan/kanto/tokyo/tokyo-tower", "Asia/Tokyo"},
        {"SEOUL · HONGDAE", "south-korea/seoul-capital/seoul/hongdae", "Asia/Seoul"},
        {"BANGKOK · SUKHUMVIT ROAD", "thailand/central-thailand/bangkok/sukhumvit", "Asia/Bangkok"},
        {"DUBLIN · TEMPLE BAR", "ireland/leinster/dublin/temple-bar", "Europe/Dublin"},
        {"LONDON · ABBEY ROAD", "united-kingdom/england/london/london-abbey-road", "Europe/London"},
        {"RIO · COPACABANA", "brasil/rio-de-janeiro/rio-de-janeiro/copacabana-beach", "America/Sao_Paulo"},
        {"MIAMI · COLLINS AVENUE", "united-states/florida/miami/collins-avenue", "America/New_York"},
        {"NEW YORK · MANHATTAN", "united-states/new-york/new-york/new-york-manhattan", "America/New_York"},
        {"TEXAS · SPACEX STARSHIP", "united-states/texas/south-padre-island/spacex-starship-launch-facility", "America/Chicago"},
        {"VANCOUVER", "canada/british-columbia/vancouver/panorama", "America/Vancouver"},
        {"CALGARY", "canada/alberta/calgary/calgary-skyline", "America/Edmonton"},
        {"REVELSTOKE · RAILWAY", "canada/british-columbia/revelstoke/railfan", "America/Vancouver"},
        {"TOFINO · LONG BEACH", "canada/british-columbia/tofino/long-beach", "America/Vancouver"},
        {"SYDNEY", "australia/new-south-wales/sydney/panorama", "Australia/Sydney"},
        {"AMSTERDAM · DAM SQUARE", "netherlands/north-holland/amsterdam/amsterdam-dam-square", "Europe/Amsterdam"},
        {"VATICAN · ST. PETER'S SQUARE", "citta-del-vaticano/citta-del-vaticano/citta-del-vaticano/vaticano-piazza-san-pietro", "Europe/Rome"},
        {"ISTANBUL · GOLDEN HORN", "turkey/marmara/istanbul/golden-horn", "Europe/Istanbul"},
        {"OSAKA · SHINSAIBASHI", "japan/kansai/osaka/shinsaibashi", "Asia/Tokyo"},
        {"SINGAPORE", "republic-of-singapore/singapore/singapore/singapore", "Asia/Singapore"},
        {"CHICAGO · SKYDECK", "united-states/illinois/chicago/skydeck", "America/Chicago"},
        {"KEY WEST · DUVAL STREET", "united-states/florida/key-west/duval-street", "America/New_York"},
        {"NIAGARA FALLS", "canada/ontario/niagara-falls/streets", "America/Toronto"},
        {"BANFF AREA · CANMORE", "canada/alberta/canmore/canmore", "America/Edmonton"},
        {"NORWAY · TROMSO", "norge/northern-norway/tromso/panorama", "Europe/Oslo"},
        {"ICELAND · VOLCANO", "iceland/sueurland/grindavik/langholl", "Atlantic/Reykjavik"},
        {"SOUTH AFRICA · KRUGER PARK", "south-africa/limpopo/kruger-national-park/nkorho", "Africa/Johannesburg"},
        {"HONG KONG · CONTAINER PORT", "china/hong-kong/hong-kong/kwai-tsing-container-terminal", "Asia/Hong_Kong"},
        {"BUENOS AIRES · OBELISK", "argentina/buenos-aires/buenos-aires/obelisco", "America/Argentina/Buenos_Aires"}
    };

    // Makes the camera's video fill the whole screen and hides everything else on the page.
    private static final String FULLSCREEN_JS =
        "(function(){try{" +
        "if(!document.getElementById('nxs')){var s=document.createElement('style');s.id='nxs';" +
        "s.textContent='html,body{background:#000!important;overflow:hidden!important}" +
        "*{visibility:hidden!important}video,video *{visibility:visible!important}" +
        "video{position:fixed!important;left:0!important;top:0!important;width:100vw!important;height:100vh!important;" +
        "object-fit:cover!important;z-index:2147483647!important;background:#000!important}';" +
        "(document.head||document.documentElement).appendChild(s);}" +
        "var v=document.querySelector('video');if(v){v.muted=false;v.playsInline=true;var p=v.play();if(p&&p.catch)p.catch(function(){v.muted=true;v.play();});}" +
        "return v?'ok':'no';}catch(e){return 'err';}})()";

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Random rnd = new Random();
    private WebView web;
    private TextView label, hint, cover;
    private int current = -1;
    private int tries = 0;

    private final Runnable inject = new Runnable() {
        @Override public void run() {
            if (web == null) return;
            web.evaluateJavascript(FULLSCREEN_JS, v -> {
                if (v != null && v.contains("ok")) {
                    cover.animate().alpha(0f).setDuration(700).start();
                    ui.postDelayed(this, 3000);   // keep it fullscreen if the page re-renders
                } else if (++tries < 25) {
                    ui.postDelayed(this, 800);
                } else {
                    cover.setText("NO SIGNAL · JUMPING TO ANOTHER CAMERA");
                    ui.postDelayed(LiveCamActivity.this::jump, 1500);
                }
            });
        }
    };
    private final Runnable autoHop = this::jump;
    private final Runnable clock = new Runnable() {
        @Override public void run() { updateLabel(); ui.postDelayed(this, 20000); }
    };

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
        web.setBackgroundColor(Color.BLACK);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                String h = u == null ? "" : String.valueOf(u.getHost());
                return !h.endsWith("skylinewebcams.com");   // block ads / pop-ups taking us elsewhere
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
        cover.setTextSize(22);
        cover.setGravity(Gravity.CENTER);
        cover.setLetterSpacing(.2f);
        root.addView(cover, new FrameLayout.LayoutParams(-1, -1));

        label = new TextView(this);
        label.setTextColor(Color.WHITE);
        label.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        label.setTextSize(16);
        label.setShadowLayer(8, 0, 0, Color.BLACK);
        label.setPadding(30, 22, 30, 12);
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
        jump();
        ui.postDelayed(clock, 20000);
    }

    private void jump() {
        int n;
        do { n = rnd.nextInt(CAMS.length); } while (n == current && CAMS.length > 1);
        current = n;
        tries = 0;
        ui.removeCallbacks(inject);
        ui.removeCallbacks(autoHop);
        cover.setAlpha(1f);
        cover.setText("◍  LOCATING A LIVE SIGNAL…");
        label.setText("");
        web.loadUrl("https://www.skylinewebcams.com/en/webcam/" + CAMS[n][1] + ".html");
        ui.postDelayed(this::updateLabel, 2500);
        ui.postDelayed(autoHop, 3 * 60 * 1000);   // hop somewhere new every 3 minutes
    }

    private void updateLabel() {
        if (current < 0) return;
        String t = "";
        try {
            SimpleDateFormat f = new SimpleDateFormat("h:mm a", Locale.US);
            f.setTimeZone(TimeZone.getTimeZone(CAMS[current][2]));
            t = "  ·  " + f.format(new Date());
        } catch (Exception ignored) {}
        label.setText("● LIVE  ·  " + CAMS[current][0] + t);
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
