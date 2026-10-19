<img src="assets/icon.svg" width="64" height="64" alt="">

# TwitchCobalt

An Android TV app that runs Twitch's official 10-foot web client and injects ad-blocking
scripts into it — the Twitch counterpart of [TizenTubeCobalt](https://github.com/reisxd/TizenTubeCobalt).
Instead of re-implementing Twitch natively (like [S0undTV](https://github.com/S0und/S0undTV)),
it wraps Twitch's own TV app, so the UI, login, and player stay Twitch's.

Not affiliated with Twitch. Blocking ads may be against Twitch's Terms of Service.

## Architecture

**Shell: Android System WebView, not Cobalt.**
TizenTubeCobalt is a fork of [youtube/cobalt](https://github.com/youtube/cobalt) (a Chromium-based
tree built with GN/Ninja) that adds a Mojo interface (`h5vcc_tizentube`) for its scripts. That
makes sense for YouTube, whose TV app is built for Cobalt. Twitch's TV app is not: Twitch's own
Android TV client hosts it in a regular Android WebView and talks to it through a
`window.androidTvNativeHooks` bridge. This app does the same:

- the page gets the exact environment Twitch designed it for (no Chromium fork to build or keep
  in sync, and the WebView engine updates through the Play Store);
- `NativeHooks` implements the bridge, so Back on the home screen exits the app as in the
  official client.

**Entry point: `https://celadon.tv.twitch.tv/`.**
Twitch's TV web app ("Starshot") picks its platform from the first hostname label, using
platform codenames — `celadon` is Android TV. `android.tv.twitch.tv` also serves Starshot, but as
the generic web build, which ignores the Android TV back/exit handling.

**Script injection.**
Scripts are registered with `WebViewCompat.addDocumentStartJavaScript`, limited to the Starshot
origin, so they run before any page script (TizenTube-style userscript injection). WebViews too
old for that feature fall back to `evaluateJavascript` when the page starts loading.

## Ad blocking

Two scripts are injected when ad blocking is on:

1. **An upstream [TwitchAdSolutions](https://github.com/ryanbr/TwitchAdSolutions) script** —
   `vaft` (default, upstream's recommendation) or `video-swap-new`. Both are bundled in the APK.
   Once a day the app fetches the latest versions from GitHub; a download is kept only if its
   userscript header has the same name and a newer version, and it is used from the next launch.
   *Settings → Check for updates now* runs the check on demand.
2. **`starshot-hls-adblock.js`** (this repo). The TwitchAdSolutions scripts strip ads inside the
   Amazon IVS player's web worker, but Starshot on TV platforms plays streams with hls.js on the
   main thread, so those scripts never see the playlists. This adapter filters Twitch's stitched
   ad segments out of media playlists as hls.js loads them:
   - leading ad segments are dropped and `EXT-X-MEDIA-SEQUENCE` / `EXT-X-DISCONTINUITY-SEQUENCE`
     are advanced so hls.js keeps a consistent timeline;
   - while ads occupy the live edge, the last ad-free playlist is served unchanged, so the
     player waits instead of playing the ad;
   - ad `DATERANGE` tags are removed, so Starshot doesn't show its ad overlay.

   In practice an ad break looks like a pause on the last frame, after which the stream jumps
   back to live. vaft's "watch a backup stream during the ad" trick is not implemented for
   hls.js yet.

## Remote

| Key | Action |
| --- | --- |
| D-pad / OK | Navigate Twitch's UI |
| Back | Back inside Twitch; exits from the home screen |
| Long-press Back, Menu, or Settings | Open TwitchCobalt settings |
| Play/Pause, Play, Pause, Stop, Fast-forward, Rewind | Player controls |

## Settings

- **Block ads** — turns both scripts on or off (reloads the page).
- **Script variant** — `vaft` or `video-swap-new` (reloads the page).
- **Update scripts automatically** — daily check against TwitchAdSolutions on GitHub.
- **Check for updates now** — shows the active script versions and checks immediately.
- **Open-source licenses** — TwitchAdSolutions license.

## Building

Requirements: JDK 17+ and an Android SDK with platform 36 (`ANDROID_HOME` or `local.properties`).
Node.js 22+ is needed for the JavaScript tests.

```sh
./gradlew assembleDebug        # app/build/outputs/apk/debug/app-debug.apk
./gradlew check                # unit tests, JS tests (node --test), lint
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

In debug builds the WebView is inspectable from `chrome://inspect`, and page console output is
logged under the `TwitchCobalt` logcat tag.

## Third-party code and licenses

- **TwitchAdSolutions** (`vaft`, `video-swap-new`) — MIT, © TwitchAdSolutions contributors.
  Bundled unmodified in `app/src/main/assets/scripts/` with its license
  (`LICENSE-TwitchAdSolutions.txt`), which is also shown in the app.
- **TizenTubeCobalt** (BSD-3-Clause, Cobalt/Chromium) and **TizenTube** (GPL-3.0) — used as
  design references only; no code is copied.
- **AdGuard Extra** — not bundled: the repository publishes no license, and its Twitch module
  hooks the same IVS worker as vaft, so it would not help with Starshot's hls.js player.
