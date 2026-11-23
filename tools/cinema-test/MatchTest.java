// Tests the rules that decide which TMDB result belongs to a film or show on the drive.
// Run: javac -d /tmp/mt app/src/main/java/com/nexus/box/CinemaMatch.java tools/cinema-test/MatchTest.java && java -cp /tmp/mt MatchTest
import com.nexus.box.CinemaMatch;
import com.nexus.box.CinemaMatch.Candidate;
import java.util.*;

public class MatchTest {
    static int fails = 0, n = 0;
    static Candidate c(long id, String t, int y, double pop) { return new Candidate(id, t, t, y, pop); }
    static void expect(String what, CinemaMatch.Result r, Long id) {
        n++;
        Long got = r.match == null ? null : r.match.id;
        if (!Objects.equals(got, id)) { fails++; System.out.println("FAIL " + what + ": expected " + id + ", got " + got); }
    }
    public static void main(String[] a) {
        // similar titles, told apart by the name and the year
        List<Candidate> alien = Arrays.asList(c(348, "Alien", 1979, 60), c(679, "Aliens", 1986, 50), c(8077, "Alien³", 1992, 30), c(126889, "Alien: Covenant", 2017, 40), c(1, "Alien", 2023, 1));
        expect("Alien (1979)", CinemaMatch.pick("Alien", 1979, alien), 348L);
        expect("Aliens (1986)", CinemaMatch.pick("Aliens", 1986, alien), 679L);
        List<Candidate> thing = Arrays.asList(c(60935, "The Thing", 2011, 40), c(1091, "The Thing", 1982, 55), c(10785, "The Thing from Another World", 1951, 10));
        expect("The Thing (1982), not the 2011 one", CinemaMatch.pick("The Thing", 1982, thing), 1091L);
        expect("The Thing (2011)", CinemaMatch.pick("The Thing", 2011, thing), 60935L);
        List<Candidate> br = Arrays.asList(c(335984, "Blade Runner 2049", 2017, 90), c(78, "Blade Runner", 1982, 60));
        expect("Blade Runner (1982), not 2049", CinemaMatch.pick("Blade Runner", 1982, br), 78L);
        expect("Blade Runner 2049 (2017)", CinemaMatch.pick("Blade Runner 2049", 2017, br), 335984L);
        // one year off is accepted only when nothing matches exactly
        expect("festival year one off", CinemaMatch.pick("Shaun of the Dead", 2003, Arrays.asList(c(747, "Shaun of the Dead", 2004, 30))), 747L);
        expect("one year off loses to an exact year", CinemaMatch.pick("Dune", 2021, Arrays.asList(c(1, "Dune", 2020, 5), c(438631, "Dune", 2021, 200))), 438631L);
        // a wrong year is never accepted
        expect("wrong year -> uncertain", CinemaMatch.pick("The Matrix", 2005, Arrays.asList(c(603, "The Matrix", 1999, 80))), null);
        // no year: only a clear exact title
        expect("no year, single exact title", CinemaMatch.pick("Some Film", 0, Arrays.asList(c(5, "Some Film", 2015, 3), c(6, "Some Film Returns", 2018, 2))), 5L);
        expect("no year, two equally known same titles -> uncertain", CinemaMatch.pick("Crash", 0, Arrays.asList(c(1640, "Crash", 2004, 20), c(884, "Crash", 1996, 15))), null);
        expect("no year, different title -> uncertain", CinemaMatch.pick("Some Film", 0, Arrays.asList(c(7, "Another Movie", 2015, 30))), null);
        // punctuation, accents, '&', articles
        expect("Amélie", CinemaMatch.pick("Amelie", 2001, Arrays.asList(new Candidate(194, "Amélie", "Le Fabuleux Destin d'Amélie Poulain", 2001, 30))), 194L);
        expect("Your Friends & Neighbors", CinemaMatch.pick("Your Friends & Neighbors", 2025, Arrays.asList(c(1, "Your Friends and Neighbors", 2025, 20))), 1L);
        expect("Spider-Man: No Way Home", CinemaMatch.pick("Spider Man No Way Home", 2021, Arrays.asList(c(634649, "Spider-Man: No Way Home", 2021, 300), c(315635, "Spider-Man: Homecoming", 2017, 100))), 634649L);
        expect("Top Gun Maverick vs Top Gun", CinemaMatch.pick("Top Gun Maverick", 2022, Arrays.asList(c(744, "Top Gun", 1986, 50), c(361743, "Top Gun: Maverick", 2022, 150))), 361743L);
        expect("Top Gun (1986) not Maverick", CinemaMatch.pick("Top Gun", 1986, Arrays.asList(c(361743, "Top Gun: Maverick", 2022, 150), c(744, "Top Gun", 1986, 50))), 744L);
        // TV: Breaking Bad has no year in the folder
        expect("Breaking Bad", CinemaMatch.pick("Breaking Bad", 0, Arrays.asList(c(1396, "Breaking Bad", 2008, 400), c(2, "Breaking Bad Wolf", 2015, 1))), 1396L);
        expect("nothing found", CinemaMatch.pick("Unknown Home Video", 0, new ArrayList<>()), null);
        if (CinemaMatch.yearOf("2009-05-28") != 2009 || CinemaMatch.yearOf("") != 0) { fails++; System.out.println("FAIL yearOf"); }
        System.out.println((fails == 0 ? "Cinema matching: all " : "Cinema matching: " + fails + " of ") + n + " cases " + (fails == 0 ? "pass" : "FAILED"));
        if (fails > 0) System.exit(1);
    }
}
