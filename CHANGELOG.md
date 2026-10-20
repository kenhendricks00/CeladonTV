# Changelog

## Unreleased (0.2.1)

#### **🐞 Bug Fixes**
- Joining a channel during a preroll ad no longer ends in "An error occurred while playing this content". CeladonTV's ad filter left the player with nothing to play until the preroll ended, and Twitch's player gave up first. The preroll now plays, and ad breaks after the stream has started are still filtered.
- The large gray play button that Android's WebView shows before a video starts no longer appears.

#### **⚠️ Known Limitations**
- Prerolls when joining a channel are shown rather than blocked.

## v0.2.0 (10/20/2026)

#### **✨ Features**
- Adds a CeladonTV row at the top of Twitch's own settings page (the gear icon). It looks and moves like Twitch's rows, works whether ad blocking is on or off, and opens CeladonTV settings.
- Adds an in-app updater. CeladonTV checks GitHub for a newer release once a day (with a toggle to turn this off) and from a new "Check for app updates" setting. Updates are downloaded over HTTPS, checked against the release's size and SHA-256 and the installed app's signing key, then handed to Android's installer.
- Shows a loading screen with the CeladonTV banner while Twitch's page loads.
- Shows an offline screen with a Retry button when Twitch can't load, and retries on its own when the connection comes back.

#### **🔧 Enhancements**
- Restyles CeladonTV settings to match Twitch's TV settings page: dark cards, Twitch purple, and Twitch's light focus highlight, including the Script variant list.

#### **🐞 Bug Fixes**
- On Android 15 and later, the settings list no longer starts underneath the title bar, so the first section header is visible again.

#### **⚙️ Maintenance**
- Updates the CI workflow's actions, including actions/setup-java to v6.
- CI builds pushes only on master, so tags and Dependabot branches no longer build twice.

#### **📝 Documentation**
- Added the Downloader (AFTVnews) code `6719631` to the install instructions.

#### **⚠️ Known Limitations**
- Ad blocking has still only been tested against simulated ad breaks, not real Twitch ads.

## v0.1.0 (10/19/2026)

#### **✨ Features**
- Runs Twitch's Android TV web app (`celadon.tv.twitch.tv`) in a WebView with the native bridge Twitch's own app provides, so Back on the home screen exits the app.
- Filters stitched ad segments out of hls.js playlists; during an ad break the stream pauses on the last frame, then jumps back to live.
- Bundles the TwitchAdSolutions `vaft` and `video-swap-new` scripts and checks GitHub for newer versions once a day.
- Forwards Back and media keys from the remote; long-press Back, Menu, or Settings opens the settings screen.
- Adds settings for ad blocking, the script variant, and script updates.

#### **📜 License**
- Released under the MIT License.

#### **⚠️ Known Limitations**
- Ad blocking has only been tested against simulated ad breaks, not real Twitch ads.
