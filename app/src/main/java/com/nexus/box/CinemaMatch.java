package com.nexus.box;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * Picks the right TMDB search result for a title parsed from a file or folder name.
 *
 * Plain Java on purpose (no Android classes), so the rules can be tested on any computer
 * (tools/cinema-test/MatchTest.java). A match is only accepted when it is clearly right:
 * the title must match after normalising, and when the file names a year it must agree
 * (TMDB release dates can differ from a festival or local date by a year, so one year either
 * way is allowed only when nothing matches exactly). Anything less is returned as "uncertain"
 * with the best candidates, so the person picks the right one instead of getting wrong artwork.
 */
public final class CinemaMatch {
    private CinemaMatch() {}

    public static final class Candidate {
        public final long id;
        public final String title, originalTitle;
        public final int year;
        public final double popularity;
        public double score;
        public Candidate(long id, String title, String originalTitle, int year, double popularity) {
            this.id = id; this.title = title == null ? "" : title; this.originalTitle = originalTitle == null ? "" : originalTitle;
            this.year = year; this.popularity = popularity;
        }
    }

    public static final class Result {
        /** the accepted match, or null */
        public Candidate match;
        /** best candidates, best first (for the "choose the right one" list) */
        public List<Candidate> candidates = new ArrayList<>();
        public boolean certain() { return match != null; }
    }

    /** lower case, accents removed, "&" as "and", punctuation dropped, leading article dropped */
    public static String norm(String s) {
        if (s == null) return "";
        String t = Normalizer.normalize(s, Normalizer.Form.NFD).replaceAll("\\p{M}+", "");
        t = t.toLowerCase(Locale.ROOT).replace("&", " and ");
        t = t.replaceAll("[’'`]", "").replaceAll("[^a-z0-9]+", " ").trim().replaceAll("\\s+", " ");
        t = t.replaceAll("^(the|a|an) ", "");
        return t;
    }

    /** similarity of two normalised titles, 0..1 (word overlap, order-insensitive, plus a prefix bonus) */
    static double similarity(String a, String b) {
        if (a.isEmpty() || b.isEmpty()) return 0;
        if (a.equals(b)) return 1;
        String[] wa = a.split(" "), wb = b.split(" ");
        List<String> lb = new ArrayList<>();
        Collections.addAll(lb, wb);
        int common = 0;
        for (String w : wa) if (lb.remove(w)) common++;
        double dice = 2.0 * common / (wa.length + wb.length);
        // "Blade Runner" vs "Blade Runner 2049" must not count as the same film: numbers that differ count against it
        if (hasNumberDifference(a, b)) dice *= 0.5;
        return dice;
    }

    static boolean hasNumberDifference(String a, String b) {
        List<String> na = numbers(a), nb = numbers(b);
        return !na.equals(nb);
    }

    static List<String> numbers(String s) {
        List<String> out = new ArrayList<>();
        for (String w : s.split(" ")) if (w.matches("\\d+")) out.add(w);
        return out;
    }

    /**
     * @param title  the title read from the file or folder name
     * @param year   the year read from the name, or 0 when there is none
     * @param found  the provider's search results (in the provider's own order)
     */
    public static Result pick(String title, int year, List<Candidate> found) {
        Result r = new Result();
        String want = norm(title);
        for (Candidate c : found) {
            double sim = Math.max(similarity(want, norm(c.title)), similarity(want, norm(c.originalTitle)));
            double s = sim * 100;
            if (year > 0 && c.year > 0) {
                int dy = Math.abs(c.year - year);
                s += dy == 0 ? 30 : dy == 1 ? 8 : -40;
            }
            s += Math.min(6, Math.log10(1 + Math.max(0, c.popularity)) * 3);   // a tie-breaker only
            c.score = s;
            r.candidates.add(c);
        }
        Collections.sort(r.candidates, (x, y) -> Double.compare(y.score, x.score));
        if (r.candidates.size() > 6) r.candidates = new ArrayList<>(r.candidates.subList(0, 6));
        if (r.candidates.isEmpty()) return r;

        Candidate best = r.candidates.get(0);
        boolean exactTitle = norm(best.title).equals(want) || norm(best.originalTitle).equals(want);
        boolean strongTitle = exactTitle || similarity(want, norm(best.title)) >= 0.86;
        if (year > 0) {
            // the year is the strongest signal: same title, same year (or one year off when nothing else fits)
            boolean yearOk = best.year == year || (Math.abs(best.year - year) == 1 && !anyExactYear(r.candidates, year, want));
            if (strongTitle && yearOk) r.match = best;
        } else {
            // no year in the name: accept only an exact title that clearly stands out from any same-named title
            if (exactTitle) {
                Candidate second = null;
                for (int i = 1; i < r.candidates.size(); i++) {
                    Candidate c = r.candidates.get(i);
                    if (norm(c.title).equals(want) || norm(c.originalTitle).equals(want)) { second = c; break; }
                }
                if (second == null || best.popularity > 4 * Math.max(0.5, second.popularity)) r.match = best;
            }
        }
        return r;
    }

    static boolean anyExactYear(List<Candidate> cs, int year, String want) {
        for (Candidate c : cs) if (c.year == year && similarity(want, norm(c.title)) >= 0.86) return true;
        return false;
    }

    /** "2009-05-28" -> 2009 */
    public static int yearOf(String date) {
        if (date == null || date.length() < 4) return 0;
        try { return Integer.parseInt(date.substring(0, 4)); } catch (Exception e) { return 0; }
    }
}
