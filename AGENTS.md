# Nexus — instructions for coding agents (Codex, Claude, etc.)

Nexus is an Android app (a WebView home screen) for an AI box in Nathan's truck ("Nexus Truck Box").
The owner is not technical: explain results in plain words and keep changes small and safe.

## Branch rules (important)
- Work ONLY on the `nexus-23` branch. Open pull requests INTO `nexus-23`.
- Never commit to, merge into, or open PRs against `main` (that is Nexus 22, the version in daily use).
- Never touch the `latest` GitHub release (Nexus 22's update download).
- Never put API keys or secrets in the repo. The AI key is entered on the box (Settings, or the
  phone page: PHONES screen -> scan QR -> "AI KEY" box).

## How a change reaches the truck
- Every push to `nexus-23` automatically runs `.github/workflows/nexus-23-development.yml`.
- It builds the separate test app (`com.nexus.box.nexus23`, installs next to Nexus 22) and publishes it to
  https://github.com/nathanzehner34-lang/nexus-box/releases/download/nexus-23-dev/nexus23.apk
- In the truck: Nexus 23 -> Settings -> UPDATE NEXUS -> Install.
- After pushing, check that the "Nexus 23 Development APK" run in GitHub Actions is green. If it fails, fix it.

## Where things are
- `app/src/main/assets/app.js` — almost all behaviour (voice, alter egos, music, party mode, settings UI).
- `app/src/main/assets/experiences.js` — visuals/holograms/screens.
- `app/src/main/assets/personas.js` (+ `personas.json`) — the 7 personalities' AI prompts.
- `app/src/main/assets/sayings.js` — 30 sayings per personality + instant small-talk answers.
  GENERATED: edit `tools/sayings_src.py`, then run `python3 tools/sayings_src.py`.
- `app/src/main/java/com/nexus/box/MainActivity.java` — Android side: TTS speech queue, speech recognition,
  audio focus, HTTP, phone server, updates.
- `app/build.gradle` — has the `nexus23` build type (separate app id).

## Must keep working
Music/Spotify control, Party Mode, sound effects, TTS voices, the 7 personalities (each with its own voice),
tap-to-talk and optional "Hey Nexus", screen visuals, phone/passenger features, Settings -> UPDATE NEXUS.

## Hardware limits
Current box: FXER X3, 2 GB RAM, Android, weak CPU. Avoid heavy background work, big libraries, constant
timers, frequent TTS voice switching (each switch loads a voice model), and anything running while another
app (Spotify) is in front. Must also run on a planned 8 GB Snapdragon box.

## Checks before every push
```
node --check app/src/main/assets/app.js
node --check app/src/main/assets/experiences.js
node tools/voice-test/test.js
node tools/voice-test/smalltalk.test.js
```
The Android build itself runs in GitHub Actions (there is no local Gradle setup needed).
