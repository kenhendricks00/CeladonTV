<p align="center">
  <a href="https://github.com/kenhendricks00/CeladonTV/releases"><img src="assets/banner.png" alt="CeladonTV Banner"></a>
</p>

<div align="center">
  <a href="https://github.com/kenhendricks00/CeladonTV/releases"><img src="https://img.shields.io/github/v/release/kenhendricks00/CeladonTV?include_prereleases&label=Latest%20Release&color=green" alt="Latest Release"></a>
  <a href="https://github.com/kenhendricks00/CeladonTV/commits/master/"><img src="https://img.shields.io/github/last-commit/kenhendricks00/CeladonTV?label=Last%20Commit&color=green" alt="Last Commit"></a>
  <a href="https://github.com/kenhendricks00/CeladonTV/blob/master/LICENSE"><img src="https://img.shields.io/github/license/kenhendricks00/CeladonTV" alt="License"></a>
  <a href="https://github.com/kenhendricks00/CeladonTV/stargazers"><img src="https://img.shields.io/github/stars/kenhendricks00/CeladonTV?style=social" alt="GitHub Stars"></a>
</div>

<h2><div align="center"><b>CeladonTV: Twitch's TV App for Android TV, With Built-in Ad Blocking</b></div></h2>

# 📺 What is CeladonTV?

**CeladonTV** is an Android TV app that runs Twitch's official 10-foot web client and injects
ad-blocking scripts into it, much like [TizenTubeCobalt](https://github.com/reisxd/TizenTubeCobalt)
does for YouTube. Instead of re-implementing Twitch natively (like
[S0undTV](https://github.com/S0und/S0undTV)), it wraps Twitch's own TV app, so the UI, login, and
player stay Twitch's.

The name comes from `celadon`, the codename Twitch uses for its Android TV app (see
[Technical Details](#-technical-details)).

# ⭐ Key Features

- **Twitch's own TV interface**: The same remote-friendly app Twitch ships for Android TV, including sign-in with an activation code
- **Ad blocking**: Stitched ad segments are filtered out of the stream, and during an ad break the stream keeps playing from an ad-free backup when Twitch has one, with an upstream [TwitchAdSolutions](https://github.com/ryanbr/TwitchAdSolutions) script on top
- **Self-updating scripts**: The ad-block script is checked against GitHub once a day
- **Remote-first controls**: D-pad, Back, and media keys work as in the official app
- **Simple settings**: Toggle ad blocking, pick the script variant, and check for updates from the remote

# 📋 Installation Instructions

## Install on Android TV

1. Install **Downloader** by AFTVnews from the Google Play Store or Amazon Appstore.
2. Open Downloader and enter the code **`6719631`**. You can also use https://aftv.news/6719631
   or the full URL `https://github.com/kenhendricks00/CeladonTV/releases/latest/download/CeladonTV.apk`.
3. Allow Downloader to install unknown apps when Android asks, then install the APK.
4. Open **CeladonTV** from your apps row.

The code and URLs above always point to the newest release. Updates install over the previous version as
long as they come from this repository's releases.

## Build from Source

Requirements: JDK 17+ and an Android SDK with platform 36 (`ANDROID_HOME` or `local.properties`).
Node.js 22+ is needed for the JavaScript tests.

```sh
./gradlew assembleDebug        # app/build/outputs/apk/debug/app-debug.apk
./gradlew check                # unit tests, JS tests (node --test), lint
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Release builds are signed when `local.properties` defines `celadontv.release.storeFile`,
`celadontv.release.storePassword`, `celadontv.release.keyAlias`, and
`celadontv.release.keyPassword`; otherwise `assembleRelease` produces an unsigned APK.

# 🎮 How to Use

| Key | Action |
| --- | --- |
| D-pad / OK | Navigate Twitch's UI |
| Back | Back inside Twitch; exits from the home screen |
| Long-press Back, Menu, or Settings | Open CeladonTV settings |
| Play/Pause, Play, Pause, Stop, Fast-forward, Rewind | Player controls |

Settings:

- **Block ads**: Turns both scripts on or off (reloads the page)
- **Script variant**: `vaft` or `video-swap-new` (reloads the page)
- **Update scripts automatically**: Daily check against TwitchAdSolutions on GitHub
- **Check for updates now**: Shows the active script versions and checks immediately
- **Open-source licenses**: TwitchAdSolutions license

# 🔧 Technical Details

**Shell: Android System WebView, not Cobalt.**
TizenTubeCobalt is a fork of [youtube/cobalt](https://github.com/youtube/cobalt) (a Chromium-based
tree built with GN/Ninja) that adds a Mojo interface (`h5vcc_tizentube`) for its scripts. That
makes sense for YouTube, whose TV app is built for Cobalt. Twitch's TV app is not: Twitch's own
Android TV client hosts it in a regular Android WebView and talks to it through a
`window.androidTvNativeHooks` bridge. CeladonTV does the same:

- the page gets the exact environment Twitch designed it for (no Chromium fork to build or keep
  in sync, and the WebView engine updates through the Play Store);
- `NativeHooks` implements the bridge, so Back on the home screen exits the app as in the
  official client.

**Entry point: `https://celadon.tv.twitch.tv/`.**
Twitch's TV web app ("Starshot") picks its platform from the first hostname label, using
platform codenames. `celadon` is Android TV. `android.tv.twitch.tv` also serves Starshot, but as
the generic web build, which ignores the Android TV back/exit handling.

**Script injection.**
Scripts are registered with `WebViewCompat.addDocumentStartJavaScript`, limited to the Starshot
origin, so they run before any page script. WebViews too old for that feature fall back to
`evaluateJavascript` when the page starts loading.

**Ad blocking.** Three scripts are injected when ad blocking is on, in this order:

1. **`starshot-hls-adblock.js`** (this repo). The TwitchAdSolutions scripts strip ads inside the
   Amazon IVS player's web worker, but Starshot on TV platforms plays streams with hls.js on the
   main thread, so those scripts never see the playlists. This adapter filters Twitch's stitched
   ad segments out of media playlists as hls.js loads them:
   - during an ad break it fetches the same broadcast with another player type (`embed`,
     `popout`, `site`, ...), using Starshot's own client ID, and splices that stream's segments in
     place of the ads. Every player type is cut from the same transcode, so at a given
     `PROGRAM-DATE-TIME` the segments are identical; they are numbered on one grid by broadcast
     time so hls.js stays on a single timeline. The first two backup sessions are opened when a
     stream starts, so they are past their own prerolls by the first mid-roll;
   - when no backup is free of ads, the last ad-free playlist is served unchanged while ads
     occupy the live edge, so the player waits on the last frame instead of playing the ad;
   - leading ad segments are dropped and `EXT-X-MEDIA-SEQUENCE` / `EXT-X-DISCONTINUITY-SEQUENCE`
     are advanced so hls.js keeps a consistent timeline; ad `DATERANGE` tags are removed, so
     Starshot doesn't show its ad overlay.

   It goes first so its own requests use the browser's `fetch`: the TwitchAdSolutions scripts
   rewrite access-token requests made through theirs.
2. **`celadontv-playback-guard.js`** (this repo). Shows a small "Blocking ads" notice in the
   top-left corner during a break, and reopens the channel if the player stalls for 20 seconds
   outside a break the adapter is holding (at most once every 3 minutes).
3. **An upstream [TwitchAdSolutions](https://github.com/ryanbr/TwitchAdSolutions) script**:
   `vaft` (default, upstream's recommendation) or `video-swap-new`. Both are bundled in the APK.
   Once a day the app fetches the latest versions from GitHub; a download is kept only if its
   userscript header has the same name and a newer version, and it is used from the next launch.

**Debugging.** In debug builds the WebView is inspectable from `chrome://inspect`, and page
console output is logged under the `CeladonTV` logcat tag.

**Branding.** `branding/generate.py` renders the launcher icon, TV banners, and README artwork
from one emblem definition.

# 🤝 Contributing

We welcome contributions! Here's how you can help:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

# ⚠️ Disclaimer

CeladonTV is not affiliated with Twitch. Blocking ads may be against Twitch's Terms of Service.

# 📜 License

Distributed under the MIT License. See `LICENSE` for more information.

# 🌟 Credits

- [TwitchAdSolutions](https://github.com/ryanbr/TwitchAdSolutions) (`vaft`, `video-swap-new`), MIT, © TwitchAdSolutions contributors. Bundled unmodified in `app/src/main/assets/scripts/` with its license (`LICENSE-TwitchAdSolutions.txt`), which is also shown in the app
- [TizenTubeCobalt](https://github.com/reisxd/TizenTubeCobalt) (BSD-3-Clause) and [TizenTube](https://github.com/reisxd/TizenTube) (GPL-3.0), used as design references only; no code or artwork is copied
- [AdGuard Extra](https://github.com/AdguardTeam/AdGuardExtra) is not bundled: the repository publishes no license, and its Twitch module hooks the same IVS worker as vaft, so it would not help with Starshot's hls.js player
- [Kenneth Hendricks](https://github.com/kenhendricks00), the creator of CeladonTV
