# Changelog

## Unreleased (0.2.5)

#### **🐞 Bug Fixes**
- Fixes "Oh bummer... An error occurred while playing this content" after watching for a while. When an ad break ended, Twitch's stream came back on segments cut a fraction of a second apart from the ad-free backup CeladonTV had been playing, and CeladonTV handed the player both under the same numbers, which broke playback on TVs. The switch back is now marked as a fresh start for the player, each quality level gets a backup at its own resolution, and a backup at the exact quality playing is preferred.
- If Twitch's error screen does appear, CeladonTV reopens the channel by itself (at most 3 times in 10 minutes).
- The "Blocking ads" notice only appears over the full-screen video during an ad break CeladonTV is blocking. It no longer shows on the home or browse screens, it hides while any of the player's controls or info are up, and it clears as soon as you leave the player. It can't take focus.

## v0.2.4 (10/20/2026)

#### **🐞 Bug Fixes**
- The "Blocking ads" notice no longer covers the player controls. When the controls come up (for example the Go Back button in the top-left corner), the notice fades out of the way and comes back once they hide. It can never take focus or get in the way of the remote.

## v0.2.3 (10/20/2026)

#### **✨ Features**
- Keeps the stream playing through ad breaks. When Twitch starts an ad break, CeladonTV switches to the same broadcast from another of Twitch's players that isn't showing ads, picking the same quality where it can (sometimes a lower one), and switches back when the break ends. A small "Blocking ads" notice shows in the top-left corner while it does.
- Adds "Record playback diagnostics" under Troubleshooting in CeladonTV settings. While on, CeladonTV keeps a small log on the TV of how it handled each ad break, and "Save diagnostics to Downloads" saves it as a text file to share. Off by default; nothing is sent anywhere.

#### **🐞 Bug Fixes**
- If the player stops for 20 seconds outside an ad break, CeladonTV reopens the channel instead of leaving the loading spinner up. It does this at most once every 3 minutes.

#### **⚠️ Known Limitations**
- During some ad breaks Twitch shows ads on all of its players, so there's no ad-free stream to switch to. CeladonTV then holds the last frame of the stream, with a "Blocking ads · back after the break" notice, until the break ends.

## v0.2.2 (10/20/2026)

#### **🐞 Bug Fixes**
- Streams no longer freeze on the loading spinner after a mid-roll ad. Twitch only tags an ad on its first segment, so once that segment left the playlist the rest of a long ad (30 seconds or more) slipped past CeladonTV's ad filter, and Twitch's player lost its place in the stream. This happened with either script variant.
- An ad break shorter than about 30 seconds no longer freezes the picture for longer than the break itself; playback resumes as soon as the stream comes back.
- A preroll that starts playing when joining a channel now always plays through into the stream, instead of occasionally stalling at the switch to live.
- Joining a channel during a preroll ad no longer ends in "An error occurred while playing this content". CeladonTV's ad filter left the player with nothing to play until the preroll ended, and Twitch's player gave up first. The preroll now plays, and ad breaks after the stream has started are still filtered.
- The large gray play button that Android's WebView shows before a video starts no longer appears.

#### **⚠️ Known Limitations**
- Prerolls when joining a channel are shown rather than blocked.
- During a mid-roll ad break the picture holds on the last frame of the stream until the break ends.

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
