# Changelog

## v0.1.0 (10/19/2026)

#### **✨ Features**
- Runs Twitch's Android TV web app (`celadon.tv.twitch.tv`) in a WebView with the native bridge Twitch's own app provides, so Back on the home screen exits the app.
- Filters stitched ad segments out of hls.js playlists; during an ad break the stream pauses on the last frame, then jumps back to live.
- Bundles the TwitchAdSolutions `vaft` and `video-swap-new` scripts and checks GitHub for newer versions once a day.
- Forwards Back and media keys from the remote; long-press Back, Menu, or Settings opens the settings screen.
- Adds settings for ad blocking, the script variant, and script updates.

#### **⚠️ Known Limitations**
- Ad blocking has only been tested against simulated ad breaks, not real Twitch ads.
