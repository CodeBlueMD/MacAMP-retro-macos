# Retrowamp

A retro Winamp-style desktop music player for macOS, built with Electron.
Classic-skin look (LCD display, chunky bevel buttons, marquee track name,
green LED-style spectrum visualizer), a real 10-band + preamp equalizer,
playlist with drag-and-drop, shuffle/repeat, and a real audio engine
(plays your own local MP3/WAV/M4A/AAC/OGG/FLAC files — this does not
connect to any streaming service).

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
3. This produces `release/Retrowamp-1.0.0-mac.dmg` (and a `.zip`). Open the
   `.dmg` and drag **Retrowamp** into **Applications**, same as installing VLC.
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

- **⏏ (eject) button** or **PL → ADD**: add audio files to the playlist.
- Drag & drop audio files onto the window to add them.
- Double-click a playlist entry to play it.
- **EQ** button: opens a 10-band equalizer + preamp (real Web Audio filters).
- **SHUF** / **REP**: shuffle and repeat toggles.
- 📌 in the title bar: keep the window always-on-top.
- Click the time display to toggle elapsed / remaining time.

## Notes

- This is an original UI *inspired by* the classic Winamp look — it does not
  use Nullsoft's copyrighted skin graphics or the Winamp trademark/brand.
- Real Winamp itself never shipped for macOS; this is a native-feeling
  Electron re-creation you can install and run locally like any Mac app.
