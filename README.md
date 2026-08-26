# MacAMP

A retro Winamp-style desktop music player for macOS, built with Electron.
Multi-window layout (Player / Equalizer / Playlist Editor, all draggable),
several switchable color themes, a real 10-band + preamp equalizer,
crossfade, speed/pitch control, a sleep timer, folder import, `.m3u`
playlist save/load, and a real audio engine (plays your own local
MP3/WAV/M4A/AAC/OGG/FLAC files, or your own files pulled from Google Drive
— this does not connect to any streaming service).

## Screenshots

![MacAMP main window](screenshots/macamp-main.png)

## Install on your Mac — no Terminal needed (recommended)

A GitHub Actions workflow builds the `.dmg` on a real macOS machine in the
cloud and attaches it to a GitHub Release.

1. Go to the **Actions** tab of this repo → **Build macOS App** (left sidebar).
2. Click **Run workflow** → **Run workflow** (leave the branch as `main`).
3. Wait ~3–5 minutes for it to finish (green check).
4. Open the finished run → under **Artifacts**, download **MacAMP-macOS**
   (a zip containing the `.dmg`).
   - To also get it on the repo's **Releases** page (a permanent download
     link), instead push a version tag, e.g. `git tag v1.0.0 && git push origin v1.0.0`
     — that triggers the same workflow and publishes the `.dmg` as a Release.
5. Unzip, open the `.dmg`, and drag **MacAMP** into **Applications**,
   same as installing VLC.
6. First launch: since the app isn't signed with an Apple Developer
   certificate, macOS Gatekeeper will block it once. Right-click
   **MacAMP** in Applications → **Open** → **Open**. After that it opens
   normally like any other app.

## Install on your Mac (build the .dmg yourself)

Electron apps for macOS have to be packaged **on a Mac** (the `.dmg` step
uses macOS's own `hdiutil`, which doesn't exist on other platforms) — so
build it once on your MacBook, then drag it into Applications exactly like
any other downloaded app.

1. Install [Node.js](https://nodejs.org) (18+) if you don't have it.
2. Open Terminal in this folder (`winamp-retro-macos/`) and run:
   ```sh
   npm install
   npm run dist
   ```
3. This produces `release/MacAMP-1.0.0.dmg` (and a `.zip`). Open the
   `.dmg` and drag **MacAMP** into **Applications**, same as installing VLC.
4. First launch: since the app isn't signed with an Apple Developer
   certificate, macOS Gatekeeper will block it the first time. Either:
   - Right-click the app → **Open** → **Open** (one-time), or
   - **System Settings → Privacy & Security** → **Open Anyway**.

   After that first confirmed launch it opens normally like any other app.

## Development

```sh
npm install
npm start        # run it directly with Electron, no packaging
```

## Using it

- **Player window**: transport controls, seek, volume/balance, LCD track
  display with a mini spectrum visualizer (click it to cycle Bars → Dots →
  Oscilloscope → off).
- **Playlist Editor**: drag files/folders in, or use **ADD FILE** / **ADD
  DIR** in its toolbar (or the Library card below). **Jump to…** filters the
  list live. **SORT** sorts alphabetically. Double-click a track to play it.
- **Equalizer**: 10-band + preamp, **ON** to bypass, presets dropdown.
  **AUTO** is a visual toggle only — genre-based auto-EQ isn't implemented.
- The Player, Equalizer, and Playlist Editor windows can each be dragged by
  their title bar independently; **Reset layout** (Look card) puts them back.
- **Library** card: Add files/folder, Save/Load `.m3u` playlists, Clear.
- **Playback** card: Crossfade (real overlapping fade between tracks),
  Speed (real `playbackRate`) with **keep pitch** toggle, a Sleep timer, and
  **auto-level** (a dynamics-compressor based leveler — not full multi-pass
  loudness normalization, but a real, audible effect).
- **Look** card: 6 real color themes, a compact/large size toggle, best-effort
  album art (MP3 ID3v2 `APIC` tag only — other formats won't show art),
  and a fullscreen player toggle.
- **Visualiser** card: 3 render modes, sensitivity, and a fullscreen overlay.
- **Shortcuts**: Space play/pause, ←/→ seek, ↑/↓ volume, N/P next/prev,
  S shuffle, R repeat, J jump-to search, Esc exits fullscreen.

## Playing music from Google Drive

You can also pull your own music files straight from a Google Drive folder,
instead of (or alongside) local files. This only ever touches files you
already own in your own Drive — it's not a streaming service integration.

**One-time setup (you do this once):**

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and
   create a new project (any name).
2. Under **APIs & Services → Library**, enable the **Google Drive API**.
3. Under **APIs & Services → OAuth consent screen**: choose **External**,
   fill in the required fields, and add your own Google account under
   **Test users**. Leaving it in "Testing" mode is fine — it's just for you.
4. Under **APIs & Services → Credentials → Create Credentials → OAuth client
   ID**: choose **Desktop app**, give it any name, and create it.
5. Copy the **Client ID** and **Client secret** it gives you.

**In the app:**

1. In the Playlist Editor window, click **Setup**. This opens the folder
   containing `google-oauth-config.json` — edit that file and paste in your
   Client ID and Client secret, then save.
2. Restart MacAMP and click **Connect**. Your browser opens Google's
   sign-in — approve access, then return to the app.
3. Paste a Google Drive **folder link** (or just the folder ID) into the box
   that appears, and click **Load**. Every audio file in that folder gets
   added to the playlist.

Tracks play by downloading the file's bytes over the Drive API each time
(not a persistent sync) — fine for normal song sizes, but very large files
will take a moment to start playing.

## Notes

- This is an original UI *inspired by* the classic Winamp look — it does not
  use Nullsoft's copyrighted skin graphics or the Winamp trademark/brand.
- Real Winamp itself never shipped for macOS; this is a native-feeling
  Electron re-creation you can install and run locally like any Mac app.
