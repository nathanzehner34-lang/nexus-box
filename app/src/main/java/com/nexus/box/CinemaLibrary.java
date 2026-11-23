package com.nexus.box;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.os.storage.StorageManager;
import android.os.storage.StorageVolume;
import android.provider.DocumentsContract;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Nexus Cinema's movie library on external USB drives.
 *
 * READ ONLY. Nothing in here ever writes to, renames, moves or deletes anything on a drive: drives are
 * listed and files are opened for reading, nothing else. Everything Cinema keeps (the library index,
 * thumbnails, playback positions) lives in Nexus's own app storage.
 *
 * Access: a drive is read directly when Android's storage permission covers it, and otherwise through
 * the Storage Access Framework (the user picks the drive once; Android remembers the grant). Drives are
 * identified by their volume UUID, never by a fixed mount path. Every file is identified by its path
 * relative to the drive's root, which is the same in both access modes, so the library, thumbnails and
 * resume positions survive a change of mode.
 */
public class CinemaLibrary {
    public interface Host { void js(String code); }

    static final Set<String> VIDEO = new HashSet<>(Arrays.asList(
        "mkv", "mp4", "m4v", "avi", "mov", "wmv", "ts", "m2ts", "mts", "webm", "mpg", "mpeg", "flv", "3gp", "vob", "divx", "ogv"));
    static final Set<String> SUBS = new HashSet<>(Arrays.asList("srt", "ass", "ssa", "vtt"));
    static final Set<String> IMAGES = new HashSet<>(Arrays.asList("jpg", "jpeg", "png", "webp"));
    static final Set<String> POSTER_NAMES = new HashSet<>(Arrays.asList("poster", "folder", "cover", "movie", "default"));
    // system and housekeeping folders that never hold the user's movies
    static final Set<String> SKIP_DIRS = new HashSet<>(Arrays.asList(
        "$recycle.bin", "system volume information", "lost.dir", "android", ".trashes", ".spotlight-v100", ".fseventsd",
        ".thumbnails", "x3a_log", "found.000", "recycler", "$recycle"));
    static final long MIN_VIDEO_BYTES = 2L * 1024 * 1024;

    final Activity act;
    final Host host;
    final SharedPreferences prefs;
    final ExecutorService scanPool = Executors.newSingleThreadExecutor();
    final ExecutorService infoPool = Executors.newSingleThreadExecutor();
    final Object retrieverLock = new Object();
    final Map<String, Long> scannedAt = new HashMap<>();   // uuid -> last scan finished during this connection
    volatile String scanning = null;
    volatile boolean cancel = false;

    public CinemaLibrary(Activity act, Host host) {
        this.act = act;
        this.host = host;
        this.prefs = act.getSharedPreferences("cinema", Context.MODE_PRIVATE);
    }

    // ------------------------------------------------------------------ drives

    static class Drive {
        String uuid, label, state, path;
        boolean removable;
        StorageVolume volume;
    }

    List<Drive> volumes() {
        List<Drive> out = new ArrayList<>();
        try {
            StorageManager sm = (StorageManager) act.getSystemService(Context.STORAGE_SERVICE);
            for (StorageVolume v : sm.getStorageVolumes()) {
                if (v.isPrimary() || !v.isRemovable()) continue;
                Drive d = new Drive();
                d.volume = v;
                d.uuid = v.getUuid();
                if (d.uuid == null) continue;
                d.label = v.getDescription(act);
                d.state = v.getState();
                d.removable = true;
                d.path = volumePath(v, d.uuid);
                out.add(d);
            }
        } catch (Exception ignored) {}
        return out;
    }

    static String volumePath(StorageVolume v, String uuid) {
        try {
            if (Build.VERSION.SDK_INT >= 30 && v.getDirectory() != null) return v.getDirectory().getAbsolutePath();
        } catch (Exception ignored) {}
        try {
            Object p = StorageVolume.class.getMethod("getPath").invoke(v);
            if (p != null) return p.toString();
        } catch (Exception ignored) {}
        return "/storage/" + uuid;
    }

    Drive drive(String uuid) {
        for (Drive d : volumes()) if (d.uuid.equals(uuid)) return d;
        return null;
    }

    static boolean mounted(Drive d) {
        return d != null && ("mounted".equals(d.state) || "mounted_ro".equals(d.state));
    }

    boolean fileAccess(Drive d) {
        try {
            if (Build.VERSION.SDK_INT >= 23 && act.checkSelfPermission(android.Manifest.permission.READ_EXTERNAL_STORAGE)
                    != android.content.pm.PackageManager.PERMISSION_GRANTED) return false;
            File root = new File(d.path);
            String[] names = root.list();
            return names != null;
        } catch (Exception e) { return false; }
    }

    Uri treeFor(String uuid) {
        try {
            for (UriPermission p : act.getContentResolver().getPersistedUriPermissions()) {
                if (!p.isReadPermission()) continue;
                Uri u = p.getUri();
                if (!"com.android.externalstorage.documents".equals(u.getAuthority())) continue;
                String id = DocumentsContract.getTreeDocumentId(u);
                if (id != null && id.startsWith(uuid + ":")) return u;
            }
        } catch (Exception ignored) {}
        return null;
    }

    /** "files", "saf" or "none" */
    String access(Drive d) {
        if (!mounted(d)) return "none";
        if (fileAccess(d)) return "files";
        if (treeFor(d.uuid) != null) return "saf";
        return "none";
    }

    public String drivesJson() {
        JSONArray a = new JSONArray();
        for (Drive d : volumes()) {
            try {
                JSONObject o = new JSONObject();
                o.put("uuid", d.uuid);
                o.put("label", d.label == null ? "USB drive" : d.label);
                o.put("state", d.state);
                o.put("mounted", mounted(d));
                o.put("access", access(d));
                o.put("scanning", d.uuid.equals(scanning));
                o.put("scannedThisConnection", scannedAt.containsKey(d.uuid));
                a.put(o);
            } catch (Exception ignored) {}
        }
        return a.toString();
    }

    /** a drive was connected or disconnected: tell the page, and scan a newly connected authorised drive */
    public void volumesChanged() {
        Set<String> present = new HashSet<>();
        for (Drive d : volumes()) if (mounted(d)) present.add(d.uuid);
        for (String u : new ArrayList<>(scannedAt.keySet())) if (!present.contains(u)) scannedAt.remove(u);
        if (scanning != null && !present.contains(scanning)) cancel = true;
        host.js("window.NexusCinema && NexusCinema._drives(" + JSONObject.quote(drivesJson()) + ")");
        for (Drive d : volumes()) {
            if (mounted(d) && !scannedAt.containsKey(d.uuid) && !"none".equals(access(d)) && !d.uuid.equals(scanning)) { scan(d.uuid); break; }
        }
    }

    // ------------------------------------------------------------------ access requests

    static final int REQ_PERMISSION = 3101, REQ_TREE = 3102;
    String pendingGrant = null;

    public void grant(String uuid) {
        Drive d = drive(uuid);
        if (!mounted(d)) { host.js("window.NexusCinema && NexusCinema._error(" + JSONObject.quote("That drive isn't connected any more.") + ")"); return; }
        pendingGrant = uuid;
        if (Build.VERSION.SDK_INT >= 23 && act.checkSelfPermission(android.Manifest.permission.READ_EXTERNAL_STORAGE)
                != android.content.pm.PackageManager.PERMISSION_GRANTED && !prefs.getBoolean("askedStorage", false)) {
            prefs.edit().putBoolean("askedStorage", true).apply();
            act.requestPermissions(new String[]{android.Manifest.permission.READ_EXTERNAL_STORAGE}, REQ_PERMISSION);
            return;
        }
        afterPermission();
    }

    public void onPermissionResult() { afterPermission(); }

    void afterPermission() {
        String uuid = pendingGrant;
        if (uuid == null) return;
        Drive d = drive(uuid);
        if (d == null) { pendingGrant = null; return; }
        if (fileAccess(d)) { pendingGrant = null; granted(uuid); return; }
        // the permission doesn't reach this drive: ask Android's drive picker for it instead (once)
        try {
            Intent i = Build.VERSION.SDK_INT >= 29 ? d.volume.createOpenDocumentTreeIntent() : new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
            act.startActivityForResult(i, REQ_TREE);
        } catch (Exception e) {
            pendingGrant = null;
            host.js("window.NexusCinema && NexusCinema._error(" + JSONObject.quote("This box has no drive access screen, so Nexus can't open the drive.") + ")");
        }
    }

    public void onTreeResult(int resultCode, Intent data) {
        String uuid = pendingGrant;
        pendingGrant = null;
        if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
            host.js("window.NexusCinema && NexusCinema._error(" + JSONObject.quote("Drive access wasn't allowed. Tap Connect drive to try again.") + ")");
            return;
        }
        Uri tree = data.getData();
        try {
            act.getContentResolver().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception ignored) {}
        String id = DocumentsContract.getTreeDocumentId(tree);
        String treeUuid = id != null && id.indexOf(':') > 0 ? id.substring(0, id.indexOf(':')) : uuid;
        granted(treeUuid != null ? treeUuid : uuid);
    }

    void granted(String uuid) {
        host.js("window.NexusCinema && NexusCinema._drives(" + JSONObject.quote(drivesJson()) + ")");
        scan(uuid);
    }

    // ------------------------------------------------------------------ scanning

    static class Entry {
        String rel, name, poster;
        long size, mtime;
        List<String> subs = new ArrayList<>();
    }

    interface Lister {
        /** children of a folder, given relative to the drive root ("" = root) */
        List<Object[]> list(String rel) throws Exception;   // {name, isDir, size, mtime}
    }

    Lister fileLister(final Drive d) {
        return rel -> {
            File dir = rel.isEmpty() ? new File(d.path) : new File(d.path, rel);
            File[] kids = dir.listFiles();
            List<Object[]> out = new ArrayList<>();
            if (kids == null) throw new java.io.IOException("unreadable " + rel);
            for (File f : kids) out.add(new Object[]{f.getName(), f.isDirectory(), f.isDirectory() ? 0L : f.length(), f.lastModified()});
            return out;
        };
    }

    Lister safLister(final Drive d, final Uri tree) {
        final ContentResolver cr = act.getContentResolver();
        final String[] cols = {DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED};
        return rel -> {
            Uri kids = DocumentsContract.buildChildDocumentsUriUsingTree(tree, d.uuid + ":" + rel);
            List<Object[]> out = new ArrayList<>();
            try (Cursor c = cr.query(kids, cols, null, null, null)) {
                if (c == null) throw new java.io.IOException("unreadable " + rel);
                while (c.moveToNext()) {
                    boolean dir = DocumentsContract.Document.MIME_TYPE_DIR.equals(c.getString(1));
                    out.add(new Object[]{c.getString(0), dir, c.isNull(2) ? 0L : c.getLong(2), c.isNull(3) ? 0L : c.getLong(3)});
                }
            }
            return out;
        };
    }

    /** the part of the drive the user allowed (SAF can be granted for a folder rather than the whole drive) */
    String safBase(Uri tree, String uuid) {
        String id = DocumentsContract.getTreeDocumentId(tree);
        return id == null || !id.startsWith(uuid + ":") ? "" : id.substring(uuid.length() + 1);
    }

    static String ext(String name) {
        int i = name.lastIndexOf('.');
        return i < 0 ? "" : name.substring(i + 1).toLowerCase(Locale.ROOT);
    }

    static String stem(String name) {
        int i = name.lastIndexOf('.');
        return (i < 0 ? name : name.substring(0, i)).toLowerCase(Locale.ROOT);
    }

    public void scan(final String uuid) {
        if (uuid.equals(scanning)) return;
        scanPool.execute(() -> doScan(uuid));
    }

    void doScan(String uuid) {
        Drive d = drive(uuid);
        String mode = access(d);
        if ("none".equals(mode)) {
            host.js("window.NexusCinema && NexusCinema._drives(" + JSONObject.quote(drivesJson()) + ")");
            return;
        }
        scanning = uuid;
        cancel = false;
        long started = System.currentTimeMillis();
        int[] counts = {0, 0, 0};   // folders, files, videos
        List<Entry> found = new ArrayList<>();
        String failure = null;
        try {
            Lister lister;
            String base = "";
            if ("files".equals(mode)) lister = fileLister(d);
            else { Uri tree = treeFor(uuid); lister = safLister(d, tree); base = safBase(tree, uuid); }
            progress(uuid, counts, "", false);
            walk(lister, uuid, base, 0, counts, found, new long[]{0});
        } catch (Exception e) {
            failure = e.getMessage();
        }
        boolean stillThere = mounted(drive(uuid));
        if (cancel || !stillThere) {
            scanning = null;
            host.js("window.NexusCinema && NexusCinema._scanAborted(" + JSONObject.quote(uuid) + "," + JSONObject.quote("The drive was disconnected during the scan. The library will update when it's plugged back in.") + ")");
            host.js("window.NexusCinema && NexusCinema._drives(" + JSONObject.quote(drivesJson()) + ")");
            return;
        }
        if (failure != null && found.isEmpty()) {
            scanning = null;
            host.js("window.NexusCinema && NexusCinema._scanAborted(" + JSONObject.quote(uuid) + "," + JSONObject.quote("Nexus couldn't read this drive (" + failure + ").") + ")");
            return;
        }
        try {
            JSONObject prev = readIndex(uuid);
            Set<String> before = new HashSet<>();
            if (prev != null) {
                JSONArray pe = prev.optJSONArray("entries");
                for (int i = 0; pe != null && i < pe.length(); i++) before.add(pe.getJSONObject(i).optString("rel"));
            }
            JSONArray arr = new JSONArray();
            Set<String> now = new HashSet<>();
            for (Entry e : found) {
                if (!now.add(e.rel)) continue;   // never the same file twice
                JSONObject o = new JSONObject();
                o.put("rel", e.rel);
                o.put("name", e.name);
                o.put("size", e.size);
                o.put("mtime", e.mtime);
                if (e.poster != null) o.put("poster", e.poster);
                if (!e.subs.isEmpty()) o.put("subs", new JSONArray(e.subs));
                arr.put(o);
            }
            int added = 0, removed = 0;
            for (String r : now) if (!before.contains(r)) added++;
            for (String r : before) if (!now.contains(r)) removed++;
            JSONObject idx = new JSONObject();
            idx.put("uuid", uuid);
            idx.put("label", d.label == null ? "USB drive" : d.label);
            idx.put("scannedAt", System.currentTimeMillis());
            idx.put("scanMs", System.currentTimeMillis() - started);
            idx.put("mode", mode);
            idx.put("entries", arr);
            writeIndex(uuid, idx);
            scannedAt.put(uuid, System.currentTimeMillis());
            JSONObject sum = new JSONObject();
            sum.put("uuid", uuid);
            sum.put("videos", arr.length());
            sum.put("added", prev == null ? arr.length() : added);
            sum.put("removed", prev == null ? 0 : removed);
            sum.put("folders", counts[0]);
            sum.put("first", prev == null);
            sum.put("partial", failure != null);
            scanning = null;
            host.js("window.NexusCinema && NexusCinema._scanned(" + JSONObject.quote(sum.toString()) + ")");
        } catch (Exception e) {
            scanning = null;
            host.js("window.NexusCinema && NexusCinema._scanAborted(" + JSONObject.quote(uuid) + "," + JSONObject.quote("The library couldn't be saved (" + e.getMessage() + ").") + ")");
        }
    }

    void walk(Lister lister, String uuid, String rel, int depth, int[] counts, List<Entry> out, long[] lastProgress) throws Exception {
        if (cancel || depth > 12) return;
        List<Object[]> kids;
        try { kids = lister.list(rel); }
        catch (Exception e) { if (depth == 0) throw e; return; }   // an unreadable sub-folder is skipped
        counts[0]++;
        List<Object[]> files = new ArrayList<>();
        List<String> dirs = new ArrayList<>();
        for (Object[] k : kids) {
            String name = (String) k[0];
            if (name == null || name.startsWith(".")) continue;   // hidden files, macOS "._" leftovers
            if ((Boolean) k[1]) { if (!SKIP_DIRS.contains(name.toLowerCase(Locale.ROOT))) dirs.add(name); }
            else files.add(k);
        }
        // pictures and subtitles that sit beside the films in this folder
        Map<String, String> images = new HashMap<>();
        List<String> subs = new ArrayList<>();
        int videosHere = 0;
        for (Object[] f : files) {
            String n = (String) f[0], x = ext(n);
            if (IMAGES.contains(x)) images.put(stem(n), n);
            else if (SUBS.contains(x)) subs.add(n);
            else if (VIDEO.contains(x)) videosHere++;
        }
        String folderPoster = null;
        for (String p : POSTER_NAMES) if (images.containsKey(p)) { folderPoster = images.get(p); break; }
        for (Object[] f : files) {
            String n = (String) f[0];
            counts[1]++;
            if (!VIDEO.contains(ext(n))) continue;
            long size = (Long) f[2];
            if (size > 0 && size < MIN_VIDEO_BYTES) continue;
            String s = stem(n);
            if ((s.contains("sample") || s.endsWith("-trailer")) && size < 400L * 1024 * 1024) continue;
            Entry e = new Entry();
            e.name = n;
            e.rel = rel.isEmpty() ? n : rel + "/" + n;
            e.size = size;
            e.mtime = (Long) f[3];
            String poster = images.containsKey(s) ? images.get(s) : images.get(s + "-poster");
            if (poster == null && videosHere == 1) poster = folderPoster;
            if (poster != null) e.poster = rel.isEmpty() ? poster : rel + "/" + poster;
            for (String sub : subs) {
                String ss = stem(sub);
                if (ss.equals(s) || ss.startsWith(s + ".") || (videosHere == 1)) e.subs.add(rel.isEmpty() ? sub : rel + "/" + sub);
            }
            out.add(e);
            counts[2]++;
        }
        long now = System.currentTimeMillis();
        if (now - lastProgress[0] > 250) { lastProgress[0] = now; progress(uuid, counts, rel, false); }
        java.util.Collections.sort(dirs, String.CASE_INSENSITIVE_ORDER);
        for (String dn : dirs) walk(lister, uuid, rel.isEmpty() ? dn : rel + "/" + dn, depth + 1, counts, out, lastProgress);
    }

    void progress(String uuid, int[] counts, String folder, boolean done) {
        try {
            JSONObject o = new JSONObject();
            o.put("uuid", uuid);
            o.put("folders", counts[0]);
            o.put("files", counts[1]);
            o.put("videos", counts[2]);
            o.put("folder", folder);
            host.js("window.NexusCinema && NexusCinema._progress(" + JSONObject.quote(o.toString()) + ")");
        } catch (Exception ignored) {}
    }

    // ------------------------------------------------------------------ the saved library

    File indexDir() {
        File f = new File(act.getFilesDir(), "cinema");
        if (!f.exists()) f.mkdirs();
        return f;
    }

    static String safeName(String uuid) { return uuid.replaceAll("[^A-Za-z0-9_-]", "_"); }

    JSONObject readIndex(String uuid) {
        try {
            File f = new File(indexDir(), safeName(uuid) + ".json");
            if (!f.exists()) return null;
            byte[] b = readAll(new FileInputStream(f));
            return new JSONObject(new String(b, "UTF-8"));
        } catch (Exception e) { return null; }
    }

    void writeIndex(String uuid, JSONObject o) throws Exception {
        File tmp = new File(indexDir(), safeName(uuid) + ".json.tmp");
        try (OutputStream os = new FileOutputStream(tmp)) { os.write(o.toString().getBytes("UTF-8")); }
        File dst = new File(indexDir(), safeName(uuid) + ".json");
        if (!tmp.renameTo(dst)) { dst.delete(); tmp.renameTo(dst); }
    }

    static byte[] readAll(InputStream in) throws Exception {
        try (InputStream i = in) {
            java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = i.read(buf)) > 0) bo.write(buf, 0, n);
            return bo.toByteArray();
        }
    }

    /** every saved drive library, including drives that are not connected right now */
    public String libraryJson() {
        JSONArray out = new JSONArray();
        File[] fs = indexDir().listFiles();
        if (fs != null) for (File f : fs) {
            if (!f.getName().endsWith(".json")) continue;
            try { out.put(new JSONObject(new String(readAll(new FileInputStream(f)), "UTF-8"))); } catch (Exception ignored) {}
        }
        return out.toString();
    }

    // ------------------------------------------------------------------ opening files (read only)

    /** a readable Uri for a file on a drive, or null when the drive is not available */
    public Uri uriFor(String uuid, String rel) {
        Drive d = drive(uuid);
        if (!mounted(d) || rel == null || rel.contains("..")) return null;
        if (fileAccess(d)) return Uri.fromFile(new File(d.path, rel));
        Uri tree = treeFor(uuid);
        if (tree == null) return null;
        return DocumentsContract.buildDocumentUriUsingTree(tree, uuid + ":" + rel);
    }

    public String pathFor(String uuid) {
        Drive d = drive(uuid);
        return d == null ? null : d.path;
    }

    // ------------------------------------------------------------------ thumbnails and details

    File thumbDir() {
        File f = new File(act.getCacheDir(), "cinema-thumbs");
        if (!f.exists()) f.mkdirs();
        return f;
    }

    static String hash(String s) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-1");
            byte[] h = md.digest(s.getBytes("UTF-8"));
            StringBuilder b = new StringBuilder();
            for (byte x : h) b.append(String.format(Locale.ROOT, "%02x", x));
            return b.toString();
        } catch (Exception e) { return Integer.toHexString(s.hashCode()); }
    }

    /**
     * A small JPEG still for a film: its own poster picture when the folder has one, otherwise a frame from
     * about a tenth of the way in. Made once, kept in the cache, one at a time so the box stays responsive.
     * Returns null when the drive is not connected (the page then shows its own title card).
     */
    public byte[] thumb(String uuid, String rel, String poster) {
        File cached = new File(thumbDir(), hash(uuid + "|" + rel) + ".jpg");
        File none = new File(thumbDir(), hash(uuid + "|" + rel) + ".none");
        try {
            if (cached.exists()) return readAll(new FileInputStream(cached));
            if (none.exists() && System.currentTimeMillis() - none.lastModified() < 7L * 86400000L) return null;
        } catch (Exception ignored) {}
        Uri u = uriFor(uuid, poster != null && !poster.isEmpty() ? poster : rel);
        if (u == null) return null;
        synchronized (retrieverLock) {
            if (cached.exists()) { try { return readAll(new FileInputStream(cached)); } catch (Exception ignored) {} }
            Bitmap bm = null;
            try {
                if (poster != null && !poster.isEmpty()) bm = decodeImage(u);
                else bm = frame(u, uuid, rel);
                if (bm == null) { try { new FileOutputStream(none).close(); } catch (Exception ignored) {} return null; }
                java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
                bm.compress(Bitmap.CompressFormat.JPEG, 80, bo);
                byte[] jpg = bo.toByteArray();
                try (OutputStream os = new FileOutputStream(cached)) { os.write(jpg); }
                return jpg;
            } catch (Throwable t) {
                return null;
            } finally {
                if (bm != null) bm.recycle();
            }
        }
    }

    Bitmap decodeImage(Uri u) throws Exception {
        ContentResolver cr = act.getContentResolver();
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inJustDecodeBounds = true;
        try (InputStream in = cr.openInputStream(u)) { BitmapFactory.decodeStream(in, null, o); }
        int s = 1;
        while (o.outWidth / (s * 2) >= 360 && o.outHeight / (s * 2) >= 200) s *= 2;
        BitmapFactory.Options o2 = new BitmapFactory.Options();
        o2.inSampleSize = s;
        o2.inPreferredConfig = Bitmap.Config.RGB_565;
        try (InputStream in = cr.openInputStream(u)) { return BitmapFactory.decodeStream(in, null, o2); }
    }

    Bitmap frame(Uri u, String uuid, String rel) {
        MediaMetadataRetriever r = new MediaMetadataRetriever();
        try {
            if ("file".equals(u.getScheme())) r.setDataSource(u.getPath());
            else r.setDataSource(act, u);
            long durMs = parseLong(r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));
            saveInfo(uuid, rel, r, durMs);
            long at = durMs > 0 ? Math.min(durMs / 10, 10 * 60 * 1000L) * 1000L : 30_000_000L;
            Bitmap b;
            if (Build.VERSION.SDK_INT >= 27) b = r.getScaledFrameAtTime(at, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, 384, 216);
            else b = r.getFrameAtTime(at, MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
            if (b == null) return null;
            if (b.getWidth() > 400) {
                Bitmap s = Bitmap.createScaledBitmap(b, 384, Math.max(1, Math.round(384f * b.getHeight() / b.getWidth())), true);
                if (s != b) b.recycle();
                b = s;
            }
            return b;
        } catch (Throwable t) {
            return null;
        } finally {
            try { r.release(); } catch (Exception ignored) {}
        }
    }

    static long parseLong(String s) { try { return s == null ? 0 : Long.parseLong(s.trim()); } catch (Exception e) { return 0; } }

    void saveInfo(String uuid, String rel, MediaMetadataRetriever r, long durMs) {
        try {
            JSONObject o = new JSONObject();
            o.put("duration", durMs);
            o.put("width", parseLong(r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)));
            o.put("height", parseLong(r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)));
            String mime = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_MIMETYPE);
            if (mime != null) o.put("mime", mime);
            String bitrate = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_BITRATE);
            if (bitrate != null) o.put("bitrate", parseLong(bitrate));
            try (OutputStream os = new FileOutputStream(new File(thumbDir(), hash(uuid + "|" + rel) + ".info"))) {
                os.write(o.toString().getBytes("UTF-8"));
            }
        } catch (Exception ignored) {}
    }

    /** length, picture size and format of one film, answered later through NexusCinema._info */
    public void info(final String uuid, final String rel) {
        infoPool.execute(() -> {
            JSONObject o = null;
            File f = new File(thumbDir(), hash(uuid + "|" + rel) + ".info");
            try { if (f.exists()) o = new JSONObject(new String(readAll(new FileInputStream(f)), "UTF-8")); } catch (Exception ignored) {}
            if (o == null) {
                Uri u = uriFor(uuid, rel);
                if (u != null) synchronized (retrieverLock) {
                    MediaMetadataRetriever r = new MediaMetadataRetriever();
                    try {
                        if ("file".equals(u.getScheme())) r.setDataSource(u.getPath()); else r.setDataSource(act, u);
                        saveInfo(uuid, rel, r, parseLong(r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)));
                        o = new JSONObject(new String(readAll(new FileInputStream(f)), "UTF-8"));
                    } catch (Throwable ignored) {
                    } finally { try { r.release(); } catch (Exception ignored) {} }
                }
            }
            try {
                if (o == null) o = new JSONObject();
                o.put("uuid", uuid);
                o.put("rel", rel);
                host.js("window.NexusCinema && NexusCinema._info(" + JSONObject.quote(o.toString()) + ")");
            } catch (Exception ignored) {}
        });
    }

    // ------------------------------------------------------------------ playback positions

    public String progressJson() {
        SharedPreferences p = act.getSharedPreferences("cinema_progress", Context.MODE_PRIVATE);
        JSONObject o = new JSONObject();
        for (Map.Entry<String, ?> e : p.getAll().entrySet()) {
            try { o.put(e.getKey(), new JSONObject(String.valueOf(e.getValue()))); } catch (Exception ignored) {}
        }
        return o.toString();
    }

    public void shutdown() {
        cancel = true;
        scanPool.shutdownNow();
        infoPool.shutdownNow();
    }
}
