package com.nexus.box;

import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Nexus Cinema's movie and TV information: titles, posters, backgrounds, descriptions, genres, runtimes,
 * seasons and episodes, from TMDB (The Movie Database, https://www.themoviedb.org), kept permanently on the box.
 *
 * Storage (all in Nexus's private app storage, never the cache, never on the movie drive):
 *   - databases/cinema_meta.db  SQLite: one row per film or show, keyed by the title and year read from the
 *                                 drive ("m|alien|1979", "t|breaking bad|0"), holding its status, the TMDB id it
 *                                 was matched to and every piece of information as JSON.
 *   - files/cinema-art/          the downloaded posters (342 px wide), backgrounds (780 px) and episode stills
 *                                 (300 px), as JPEG files, named by TMDB id.
 * Files on the drive are linked to their row through that key, which the page works out from the file and folder
 * names, so a renamed copy of the same film or a re-plugged drive finds its information again without downloading.
 *
 * Network: only api.themoviedb.org and image.tmdb.org, one request at a time, only for titles that still need
 * information. Without internet (or without a TMDB key) nothing fails: the work waits and resumes on its own when
 * the box is online again. The TMDB key is stored in app-private preferences and never handed back to the page.
 */
public class CinemaMeta {
    public interface Host { void js(String code); }

    static final String API = "https://api.themoviedb.org/3/";
    static final String IMG = "https://image.tmdb.org/t/p/";

    final Context ctx;
    final Host host;
    final SharedPreferences prefs;
    final Db db;
    final ExecutorService worker = Executors.newSingleThreadExecutor();     // the download run
    final ExecutorService control = Executors.newSingleThreadExecutor();    // the page's requests (key, choices, searches)
    final Object kick = new Object();
    volatile boolean running = false, stopped = false, wake = false;
    volatile String lastError = "";
    final Map<String, JSONObject> outbox = new LinkedHashMap<>();
    long lastFlush = 0, lastRequest = 0;

    public CinemaMeta(Context ctx, Host host) {
        this.ctx = ctx.getApplicationContext();
        this.host = host;
        this.prefs = ctx.getSharedPreferences("cinema_meta", Context.MODE_PRIVATE);
        this.db = new Db(this.ctx);
        watchNetwork();
    }

    // ------------------------------------------------------------------ storage

    static class Db extends SQLiteOpenHelper {
        Db(Context c) { super(c, "cinema_meta.db", null, 1); }
        @Override public void onCreate(SQLiteDatabase d) {
            d.execSQL("CREATE TABLE titles (key TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT, year INTEGER, seasons TEXT, "
                + "status TEXT NOT NULL, tmdb INTEGER, manual INTEGER DEFAULT 0, data TEXT, cands TEXT, tries INTEGER DEFAULT 0, "
                + "next_try INTEGER DEFAULT 0, updated INTEGER)");
        }
        @Override public void onUpgrade(SQLiteDatabase d, int a, int b) {}
    }

    File artDir() {
        File f = new File(ctx.getFilesDir(), "cinema-art");
        if (!f.exists()) f.mkdirs();
        return f;
    }

    boolean hasKey() { return !prefs.getString("tmdb", "").isEmpty(); }

    /** the page tells us every film and show on the connected and remembered drives */
    public synchronized void want(String json) {
        try {
            JSONArray a = new JSONArray(json);
            SQLiteDatabase d = db.getWritableDatabase();
            d.beginTransaction();
            try {
                for (int i = 0; i < a.length(); i++) {
                    JSONObject w = a.getJSONObject(i);
                    String key = w.optString("key");
                    if (key.isEmpty()) continue;
                    JSONArray seasons = w.optJSONArray("seasons");
                    try (Cursor c = d.rawQuery("SELECT seasons FROM titles WHERE key=?", new String[]{key})) {
                        if (c.moveToFirst()) {
                            // a show with a newly added season: remember it, the worker fetches just that season
                            if (seasons != null) {
                                Set<String> s = new HashSet<>(); JSONArray old = new JSONArray(c.isNull(0) ? "[]" : c.getString(0));
                                for (int k = 0; k < old.length(); k++) s.add(String.valueOf(old.optInt(k)));
                                boolean grew = false;
                                for (int k = 0; k < seasons.length(); k++) if (s.add(String.valueOf(seasons.optInt(k)))) { old.put(seasons.optInt(k)); grew = true; }
                                if (grew) { ContentValues v = new ContentValues(); v.put("seasons", old.toString()); v.put("next_try", 0); d.update("titles", v, "key=?", new String[]{key}); }
                            }
                            continue;
                        }
                    }
                    ContentValues v = new ContentValues();
                    v.put("key", key);
                    v.put("kind", "tv".equals(w.optString("kind")) ? "tv" : "movie");
                    v.put("title", w.optString("title"));
                    v.put("year", w.optInt("year"));
                    if (seasons != null) v.put("seasons", seasons.toString());
                    v.put("status", "pending");
                    v.put("updated", System.currentTimeMillis());
                    d.insert("titles", null, v);
                }
                d.setTransactionSuccessful();
            } finally { d.endTransaction(); }
        } catch (Exception e) { lastError = "Library list: " + e.getMessage(); }
        kick();
    }

    JSONObject row(Cursor c) throws Exception {
        JSONObject o = new JSONObject();
        o.put("key", c.getString(0));
        o.put("kind", c.getString(1));
        o.put("status", c.getString(2));
        if (!c.isNull(3)) o.put("data", new JSONObject(c.getString(3)));
        if (!c.isNull(4)) o.put("cands", new JSONArray(c.getString(4)));
        o.put("manual", c.getInt(5) == 1);
        return o;
    }
    static final String COLS = "key, kind, status, data, cands, manual";

    /** everything saved, for the page: works with no internet and no drive */
    public synchronized String allJson() {
        JSONObject out = new JSONObject();
        try (Cursor c = db.getReadableDatabase().rawQuery("SELECT " + COLS + " FROM titles", null)) {
            while (c.moveToNext()) { try { out.put(c.getString(0), row(c)); } catch (Exception ignored) {} }
        } catch (Exception ignored) {}
        return out.toString();
    }

    JSONObject one(String key) {
        try (Cursor c = db.getReadableDatabase().rawQuery("SELECT " + COLS + " FROM titles WHERE key=?", new String[]{key})) {
            if (c.moveToFirst()) return row(c);
        } catch (Exception ignored) {}
        return null;
    }

    public synchronized String statusJson() {
        JSONObject o = new JSONObject();
        try {
            o.put("configured", hasKey());
            o.put("online", online());
            o.put("working", running);
            o.put("error", lastError);
            JSONObject n = new JSONObject();
            try (Cursor c = db.getReadableDatabase().rawQuery("SELECT status, COUNT(*) FROM titles GROUP BY status", null)) {
                while (c.moveToNext()) n.put(c.getString(0), c.getInt(1));
            }
            o.put("counts", n);
            long bytes = 0; File[] fs = artDir().listFiles();
            if (fs != null) for (File f : fs) bytes += f.length();
            o.put("artBytes", bytes);
        } catch (Exception ignored) {}
        return o.toString();
    }

    void update(String key, ContentValues v) {
        v.put("updated", System.currentTimeMillis());
        synchronized (this) { db.getWritableDatabase().update("titles", v, "key=?", new String[]{key}); }
        JSONObject o = one(key);
        if (o != null) post(key, o);
    }

    // ------------------------------------------------------------------ settings and choices from the page

    /** saves the TMDB key (a v3 "API Key" or the longer "API Read Access Token"), checks it, reports back */
    public void setKey(final String raw) {
        control.execute(() -> {
            String k = raw == null ? "" : raw.trim();
            if (k.isEmpty()) { prefs.edit().remove("tmdb").apply(); status("TMDB key removed."); return; }
            String old = prefs.getString("tmdb", "");
            prefs.edit().putString("tmdb", k).apply();
            try {
                get("configuration");
                lastError = "";
                // titles that failed for want of a key are tried again
                ContentValues v = new ContentValues(); v.put("next_try", 0); v.put("tries", 0);
                synchronized (this) { db.getWritableDatabase().update("titles", v, "status IN ('pending','error')", null); }
                status("TMDB key saved. Downloading movie information…");
                kickNow();
            } catch (Http401 e) {
                if (old.isEmpty()) prefs.edit().remove("tmdb").apply(); else prefs.edit().putString("tmdb", old).apply();
                status("TMDB didn't accept that key. Check it and try again.");
            } catch (Exception e) {
                status("Key saved. It will be checked when the box is online.");
            }
        });
    }

    /** the person picked the right film or show for a title (tmdbId 0 = "none of these") */
    public void choose(final String key, final long tmdbId) {
        control.execute(() -> {
            ContentValues v = new ContentValues();
            v.put("manual", 1); v.put("tries", 0); v.put("next_try", 0);
            if (tmdbId <= 0) { v.put("status", "none"); v.putNull("tmdb"); v.putNull("data"); }
            else { v.put("status", "pending"); v.put("tmdb", tmdbId); }
            update(key, v);
            kickNow();
        });
    }

    /** search again with the person's own words, offering the results to choose from */
    public void research(final String key, final String query) {
        control.execute(() -> {
            JSONObject row = one(key);
            if (row == null || query == null || query.trim().isEmpty()) return;
            try {
                boolean tv = "tv".equals(row.optString("kind"));
                CinemaMatch.Result r = search(tv, query.trim(), 0);
                ContentValues v = new ContentValues();
                v.put("cands", candsJson(r).toString());
                if (!"ok".equals(row.optString("status"))) v.put("status", r.candidates.isEmpty() ? "none" : "uncertain");
                update(key, v);
                flush(true);
                if (r.candidates.isEmpty()) status("Nothing found for “" + query.trim() + "”.");
            } catch (Exception e) { status(e instanceof Http401 ? "The TMDB key isn't working." : "Can't search right now (no internet?)."); }
        });
    }

    /** try again for everything without information (after the box was offline, or a new key) */
    public void retryAll() {
        control.execute(() -> {
            ContentValues v = new ContentValues(); v.put("next_try", 0); v.put("tries", 0);
            synchronized (this) { db.getWritableDatabase().update("titles", v, "status IN ('pending','error') OR (status='none' AND manual=0)", null); }
            ContentValues p = new ContentValues(); p.put("status", "pending");
            synchronized (this) { db.getWritableDatabase().update("titles", p, "status IN ('error') OR (status='none' AND manual=0)", null); }
            kickNow();
        });
    }

    // ------------------------------------------------------------------ the worker

    void kick() { if (!stopped && hasKey() && online()) kickNow(); }

    void kickNow() {
        synchronized (kick) { wake = true; if (running) return; running = true; }
        worker.execute(this::work);
    }

    void work() {
        try {
            while (!stopped) {
                synchronized (kick) { wake = false; }
                String key = nextJob();
                if (key == null) break;
                if (!hasKey()) { lastError = "No TMDB key yet."; break; }
                if (!online()) { lastError = "Waiting for internet."; break; }
                try { process(key); lastError = ""; }
                catch (Http401 e) { lastError = "The TMDB key isn't working."; status(lastError); break; }
                catch (java.io.IOException e) {
                    // offline or TMDB unreachable: leave the title waiting, try again later
                    lastError = "Waiting for internet.";
                    ContentValues v = new ContentValues(); v.put("next_try", System.currentTimeMillis() + 60_000);
                    synchronized (this) { db.getWritableDatabase().update("titles", v, "key=?", new String[]{key}); }
                    if (!online()) break;
                } catch (Exception e) {
                    ContentValues v = new ContentValues();
                    int tries = triesOf(key) + 1;
                    v.put("tries", tries);
                    v.put("next_try", System.currentTimeMillis() + Math.min(24L * 3600_000L, 60_000L << Math.min(10, tries)));
                    if (tries >= 4) v.put("status", "error");
                    update(key, v);
                }
                flush(false);
            }
        } finally {
            synchronized (kick) { running = false; }
            flush(true);
            pushStatus();
            synchronized (kick) { if (wake && !stopped && hasKey() && online()) kickNow(); }
        }
    }

    int triesOf(String key) {
        try (Cursor c = db.getReadableDatabase().rawQuery("SELECT tries FROM titles WHERE key=?", new String[]{key})) {
            return c.moveToFirst() ? c.getInt(0) : 0;
        } catch (Exception e) { return 0; }
    }

    /** the next title that needs work: never searched, a chosen match to fetch, a new season, or missing pictures */
    synchronized String nextJob() {
        long now = System.currentTimeMillis();
        SQLiteDatabase d = db.getReadableDatabase();
        try (Cursor c = d.rawQuery("SELECT key FROM titles WHERE status='pending' AND next_try<=? ORDER BY manual DESC, updated LIMIT 1", new String[]{String.valueOf(now)})) {
            if (c.moveToFirst()) return c.getString(0);
        }
        try (Cursor c = d.rawQuery("SELECT key, seasons, data FROM titles WHERE status='ok' AND next_try<=?", new String[]{String.valueOf(now)})) {
            while (c.moveToNext()) {
                try {
                    JSONObject data = new JSONObject(c.getString(2));
                    if (!artComplete(data)) return c.getString(0);
                    if (!c.isNull(1)) {
                        JSONArray want = new JSONArray(c.getString(1)); JSONObject have = data.optJSONObject("seasons");
                        for (int i = 0; i < want.length(); i++) if (have == null || !have.has(String.valueOf(want.optInt(i)))) return c.getString(0);
                    }
                } catch (Exception ignored) {}
            }
        }
        return null;
    }

    boolean artComplete(JSONObject data) {
        for (String f : new String[]{"poster", "posterSmall", "backdrop"}) {
            String n = data.optString(f);
            if (!n.isEmpty() && !new File(artDir(), n).exists()) return false;
        }
        JSONObject ss = data.optJSONObject("seasons");
        if (ss != null) for (java.util.Iterator<String> it = ss.keys(); it.hasNext(); ) {
            JSONObject eps = ss.optJSONObject(it.next()); JSONObject e = eps == null ? null : eps.optJSONObject("episodes");
            if (e != null) for (java.util.Iterator<String> k = e.keys(); k.hasNext(); ) {
                String n = e.optJSONObject(k.next()).optString("still");
                if (!n.isEmpty() && !new File(artDir(), n).exists()) return false;
            }
        }
        return true;
    }

    void process(String key) throws Exception {
        Cursor c = db.getReadableDatabase().rawQuery("SELECT kind, title, year, seasons, status, tmdb, data FROM titles WHERE key=?", new String[]{key});
        String kind, title, seasonsJson, status, dataJson; int year; long tmdb;
        try {
            if (!c.moveToFirst()) return;
            kind = c.getString(0); title = c.getString(1); year = c.getInt(2);
            seasonsJson = c.isNull(3) ? "[]" : c.getString(3); status = c.getString(4);
            tmdb = c.isNull(5) ? 0 : c.getLong(5); dataJson = c.isNull(6) ? null : c.getString(6);
        } finally { c.close(); }
        boolean tv = "tv".equals(kind);
        ContentValues v = new ContentValues();
        if (tmdb == 0) {
            CinemaMatch.Result r = search(tv, title, year);
            v.put("cands", candsJson(r).toString());
            if (!r.certain()) {
                v.put("status", r.candidates.isEmpty() ? "none" : "uncertain");
                update(key, v);
                return;
            }
            tmdb = r.match.id;
        }
        JSONObject data = dataJson != null && "ok".equals(status) ? new JSONObject(dataJson) : details(tv, tmdb);
        if (tv) {
            JSONArray want = new JSONArray(seasonsJson);
            JSONObject have = data.optJSONObject("seasons");
            if (have == null) { have = new JSONObject(); data.put("seasons", have); }
            for (int i = 0; i < want.length(); i++) {
                String s = String.valueOf(want.optInt(i));
                if (!have.has(s)) {
                    JSONObject season = season(tmdb, want.optInt(i));
                    have.put(s, season == null ? new JSONObject().put("missing", true) : season);
                }
            }
        }
        downloadArt(data);
        v.put("status", "ok");
        v.put("tmdb", tmdb);
        v.put("data", data.toString());
        v.put("tries", 0);
        v.put("next_try", 0);
        update(key, v);
    }

    // ------------------------------------------------------------------ TMDB

    static class Http401 extends java.io.IOException { Http401() { super("unauthorised"); } }

    JSONObject get(String pathAndQuery) throws Exception {
        String k = prefs.getString("tmdb", "");
        boolean bearer = k.startsWith("eyJ");   // the "API Read Access Token" is a long JWT; the v3 "API Key" is 32 characters
        String url = API + pathAndQuery + (bearer ? "" : (pathAndQuery.contains("?") ? "&" : "?") + "api_key=" + URLEncoder.encode(k, "UTF-8"));
        for (int attempt = 0; attempt < 3; attempt++) {
            pace();
            HttpURLConnection h = (HttpURLConnection) new URL(url).openConnection();
            h.setConnectTimeout(10000); h.setReadTimeout(15000);
            h.setRequestProperty("Accept", "application/json");
            if (bearer) h.setRequestProperty("Authorization", "Bearer " + k);
            try {
                int code = h.getResponseCode();
                if (code == 401) throw new Http401();
                if (code == 429) { Thread.sleep(1000L * Math.max(1, Math.min(10, parseInt(h.getHeaderField("Retry-After"), 2)))); continue; }
                if (code == 404) return null;
                if (code >= 500) { Thread.sleep(2000); continue; }
                if (code != 200) throw new Exception("TMDB answered " + code);
                return new JSONObject(new String(readAll(h.getInputStream()), "UTF-8"));
            } finally { h.disconnect(); }
        }
        throw new java.io.IOException("TMDB is busy");
    }

    final Object paceLock = new Object();
    void pace() throws InterruptedException {
        synchronized (paceLock) {
            long wait = lastRequest + 260 - System.currentTimeMillis();   // about 4 requests a second, well under TMDB's limit
            if (wait > 0) Thread.sleep(wait);
            lastRequest = System.currentTimeMillis();
        }
    }

    static int parseInt(String s, int d) { try { return Integer.parseInt(s.trim()); } catch (Exception e) { return d; } }

    static String enc(String s) { try { return URLEncoder.encode(s, "UTF-8"); } catch (Exception e) { return ""; } }

    CinemaMatch.Result search(boolean tv, String title, int year) throws Exception {
        List<CinemaMatch.Candidate> all = new ArrayList<>();
        Set<Long> seen = new HashSet<>();
        String base = (tv ? "search/tv" : "search/movie") + "?include_adult=false&language=en-US&page=1&query=" + enc(title);
        List<String> queries = new ArrayList<>();
        if (year > 0) queries.add(base + (tv ? "&first_air_date_year=" : "&year=") + year);
        queries.add(base);
        for (String q : queries) {
            JSONObject res = get(q);
            JSONArray rs = res == null ? null : res.optJSONArray("results");
            for (int i = 0; rs != null && i < rs.length(); i++) {
                JSONObject o = rs.getJSONObject(i);
                long id = o.optLong("id");
                if (!seen.add(id)) continue;
                CinemaMatch.Candidate c = new CinemaMatch.Candidate(id,
                    o.optString(tv ? "name" : "title"), o.optString(tv ? "original_name" : "original_title"),
                    CinemaMatch.yearOf(o.optString(tv ? "first_air_date" : "release_date")), o.optDouble("popularity", 0));
                all.add(c);
                extra.put(id, o.optString("overview"));
            }
        }
        return CinemaMatch.pick(title, year, all);
    }
    final Map<Long, String> extra = new java.util.concurrent.ConcurrentHashMap<>();

    JSONArray candsJson(CinemaMatch.Result r) throws Exception {
        JSONArray a = new JSONArray();
        for (CinemaMatch.Candidate c : r.candidates) {
            String ov = extra.get(c.id); if (ov == null) ov = "";
            if (ov.length() > 220) ov = ov.substring(0, 217) + "…";
            a.put(new JSONObject().put("id", c.id).put("title", c.title).put("year", c.year).put("overview", ov));
        }
        extra.clear();
        return a;
    }

    JSONObject details(boolean tv, long id) throws Exception {
        JSONObject o = get((tv ? "tv/" : "movie/") + id + "?language=en-US");
        if (o == null) throw new Exception("TMDB has no entry " + id);
        JSONObject d = new JSONObject();
        d.put("id", id);
        d.put("title", o.optString(tv ? "name" : "title"));
        d.put("year", CinemaMatch.yearOf(o.optString(tv ? "first_air_date" : "release_date")));
        d.put("overview", o.optString("overview"));
        String tag = o.optString("tagline"); if (!tag.isEmpty()) d.put("tagline", tag);
        JSONArray g = new JSONArray(), gs = o.optJSONArray("genres");
        for (int i = 0; gs != null && i < gs.length(); i++) g.put(gs.getJSONObject(i).optString("name"));
        d.put("genres", g);
        if (tv) {
            JSONArray rt = o.optJSONArray("episode_run_time");
            if (rt != null && rt.length() > 0) d.put("runtime", rt.optInt(0));
            d.put("seasonCount", o.optInt("number_of_seasons"));
            d.put("episodeCount", o.optInt("number_of_episodes"));
            JSONArray nets = o.optJSONArray("networks");
            if (nets != null && nets.length() > 0) d.put("network", nets.getJSONObject(0).optString("name"));
        } else {
            if (o.optInt("runtime") > 0) d.put("runtime", o.optInt("runtime"));
        }
        double vote = o.optDouble("vote_average", 0);
        if (vote > 0) d.put("rating", Math.round(vote * 10) / 10.0);
        String cert = o.optString("original_language"); if (!cert.isEmpty()) d.put("lang", cert);
        String p = o.optString("poster_path"), b = o.optString("backdrop_path");
        String pre = (tv ? "t" : "m") + id;
        if (p.startsWith("/")) { d.put("posterPath", p); d.put("poster", pre + "_p.jpg"); d.put("posterSmall", pre + "_ps.jpg"); }
        if (b.startsWith("/")) { d.put("backdropPath", b); d.put("backdrop", pre + "_b.jpg"); }
        return d;
    }

    JSONObject season(long id, int n) throws Exception {
        JSONObject o = get("tv/" + id + "/season/" + n + "?language=en-US");
        if (o == null) return null;
        JSONObject s = new JSONObject();
        s.put("name", o.optString("name"));
        String ov = o.optString("overview"); if (!ov.isEmpty()) s.put("overview", ov);
        JSONObject eps = new JSONObject();
        JSONArray es = o.optJSONArray("episodes");
        for (int i = 0; es != null && i < es.length(); i++) {
            JSONObject e = es.getJSONObject(i), x = new JSONObject();
            int num = e.optInt("episode_number");
            x.put("name", e.optString("name"));
            x.put("overview", e.optString("overview"));
            if (e.optInt("runtime") > 0) x.put("runtime", e.optInt("runtime"));
            String air = e.optString("air_date"); if (!air.isEmpty() && !"null".equals(air)) x.put("air", air);
            String st = e.optString("still_path");
            if (st.startsWith("/")) { x.put("stillPath", st); x.put("still", "t" + id + "_s" + n + "e" + num + ".jpg"); }
            eps.put(String.valueOf(num), x);
        }
        s.put("episodes", eps);
        return s;
    }

    /** the box's screen is 1024x600: posters at 185 px (library wall) and 342 px (details), backgrounds at 780 px and
     *  episode stills at 300 px are sharp there and small to store and to decode (TMDB's own standard sizes) */
    void downloadArt(JSONObject d) throws Exception {
        if (!fetchImage(d.optString("posterPath"), "w185", d.optString("posterSmall"))) d.remove("posterSmall");   // the library wall
        if (!fetchImage(d.optString("posterPath"), "w342", d.optString("poster"))) d.remove("poster");           // the details screen
        if (!fetchImage(d.optString("backdropPath"), "w780", d.optString("backdrop"))) d.remove("backdrop");
        JSONObject ss = d.optJSONObject("seasons");
        if (ss != null) for (java.util.Iterator<String> it = ss.keys(); it.hasNext(); ) {
            JSONObject s = ss.optJSONObject(it.next()), eps = s == null ? null : s.optJSONObject("episodes");
            if (eps != null) for (java.util.Iterator<String> k = eps.keys(); k.hasNext(); ) {
                JSONObject e = eps.optJSONObject(k.next());
                if (!fetchImage(e.optString("stillPath"), "w300", e.optString("still"))) e.remove("still");
            }
        }
    }

    /** false when TMDB has no such picture (it is then simply left out); a network failure throws */
    boolean fetchImage(String path, String size, String name) throws Exception {
        if (path.isEmpty() || name.isEmpty() || !name.matches("[a-z0-9_]+\\.jpg")) return false;
        File dst = new File(artDir(), name);
        if (dst.exists() && dst.length() > 0) return true;
        File tmp = new File(artDir(), name + ".part");
        HttpURLConnection h = (HttpURLConnection) new URL(IMG + size + path).openConnection();
        h.setConnectTimeout(10000); h.setReadTimeout(20000);
        try {
            int code = h.getResponseCode();
            if (code == 404 || code == 403) return false;   // a missing picture is skipped, the text information still counts
            if (code != 200) throw new java.io.IOException("image server answered " + code);
            try (InputStream in = h.getInputStream(); OutputStream os = new FileOutputStream(tmp)) {
                byte[] buf = new byte[16384]; int n; long total = 0;
                while ((n = in.read(buf)) > 0) { os.write(buf, 0, n); total += n; if (total > 4_000_000) throw new Exception("image too large"); }
            }
            if (!tmp.renameTo(dst)) { dst.delete(); tmp.renameTo(dst); }
            return true;
        } finally { h.disconnect(); tmp.delete(); }
    }

    /** a saved picture for the page (https://cinema.nexus/art?f=...) */
    public byte[] art(String name) {
        if (name == null || !name.matches("[a-z0-9_]+\\.jpg")) return null;
        File f = new File(artDir(), name);
        if (!f.exists()) return null;
        try { return readAll(new FileInputStream(f)); } catch (Exception e) { return null; }
    }

    static byte[] readAll(InputStream in) throws Exception {
        try (InputStream i = in) {
            java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[16384]; int n;
            while ((n = i.read(buf)) > 0) bo.write(buf, 0, n);
            return bo.toByteArray();
        }
    }

    // ------------------------------------------------------------------ telling the page

    void post(String key, JSONObject o) { synchronized (outbox) { outbox.put(key, o); } }

    void flush(boolean force) {
        JSONObject batch = new JSONObject();
        synchronized (outbox) {
            if (outbox.isEmpty() || (!force && System.currentTimeMillis() - lastFlush < 1500)) return;
            try { for (Map.Entry<String, JSONObject> e : outbox.entrySet()) batch.put(e.getKey(), e.getValue()); } catch (Exception ignored) {}
            outbox.clear(); lastFlush = System.currentTimeMillis();
        }
        host.js("window.NexusCinema && NexusCinema._meta(" + JSONObject.quote(batch.toString()) + ")");
        pushStatus();
    }

    void pushStatus() { host.js("window.NexusCinema && NexusCinema._metaStatus(" + JSONObject.quote(statusJson()) + ")"); }

    void status(String msg) {
        try { host.js("window.NexusCinema && NexusCinema._metaNote(" + JSONObject.quote(msg) + ")"); } catch (Exception ignored) {}
        pushStatus();
    }

    // ------------------------------------------------------------------ internet

    boolean online() {
        try {
            ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (Build.VERSION.SDK_INT >= 23) {
                Network n = cm.getActiveNetwork();
                NetworkCapabilities c = n == null ? null : cm.getNetworkCapabilities(n);
                return c != null && c.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
            }
            android.net.NetworkInfo i = cm.getActiveNetworkInfo();
            return i != null && i.isConnected();
        } catch (Exception e) { return true; }
    }

    ConnectivityManager.NetworkCallback netCb;

    void watchNetwork() {
        try {
            ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
            netCb = new ConnectivityManager.NetworkCallback() {
                @Override public void onAvailable(Network network) {
                    // back online: finish whatever is still waiting (shortly, once the connection has settled)
                    new Thread(() -> { try { Thread.sleep(3000); } catch (InterruptedException ignored) {} kick(); }).start();
                }
            };
            cm.registerDefaultNetworkCallback(netCb);
        } catch (Exception ignored) {}
    }

    public void shutdown() {
        stopped = true;
        try { if (netCb != null) ((ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE)).unregisterNetworkCallback(netCb); } catch (Exception ignored) {}
        worker.shutdownNow();
        control.shutdownNow();
        try { db.close(); } catch (Exception ignored) {}
    }
}
