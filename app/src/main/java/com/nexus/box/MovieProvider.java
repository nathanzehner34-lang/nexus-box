package com.nexus.box;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;
import java.util.Locale;

// Lets another video player (for example VLC) open one film from an external drive when Nexus Cinema's own
// player can't play it. READ ONLY, video and subtitle files on removable drives only, not exported: another
// app can open a film only through a one-off grant Nexus attaches when the user taps "Open in another player".
public class MovieProvider extends ContentProvider {
    static final String AUTHORITY = "com.nexus.box.movies";

    static Uri uriFor(File f) {
        return new Uri.Builder().scheme("content").authority(AUTHORITY).appendPath("f").appendPath(f.getAbsolutePath()).build();
    }

    private File file(Uri uri) throws FileNotFoundException {
        String p = uri.getLastPathSegment();
        if (p == null) throw new FileNotFoundException();
        try {
            File f = new File(p).getCanonicalFile();
            String c = f.getPath();
            boolean removable = (c.startsWith("/storage/") && !c.startsWith("/storage/emulated")) || c.startsWith("/mnt/media_rw/");
            String x = CinemaLibrary.ext(f.getName());
            if (!removable || !(CinemaLibrary.VIDEO.contains(x) || CinemaLibrary.SUBS.contains(x)) || !f.isFile()) throw new FileNotFoundException();
            return f;
        } catch (java.io.IOException e) { throw new FileNotFoundException(); }
    }

    @Override public boolean onCreate() { return true; }

    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (mode != null && !mode.equals("r")) throw new FileNotFoundException("read only");
        return ParcelFileDescriptor.open(file(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override public String getType(Uri uri) {
        String x = CinemaLibrary.ext(String.valueOf(uri.getLastPathSegment()));
        switch (x) {
            case "mp4": case "m4v": return "video/mp4";
            case "mkv": return "video/x-matroska";
            case "webm": return "video/webm";
            case "avi": return "video/x-msvideo";
            case "srt": return "application/x-subrip";
            default: return "video/*";
        }
    }

    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        MatrixCursor c = new MatrixCursor(new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE });
        try { File f = file(uri); c.addRow(new Object[] { f.getName(), f.length() }); } catch (Exception ignored) {}
        return c;
    }

    @Override public Uri insert(Uri uri, ContentValues values) { return null; }
    @Override public int delete(Uri uri, String selection, String[] args) { return 0; }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { return 0; }
}
