'use strict';

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function findBinary(name) {
  const candidates = [
    path.join('/opt/homebrew/bin', name),
    path.join('/usr/local/bin', name),
    path.join('/usr/bin', name),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  try {
    const p = execSync(`which ${name}`, { encoding: 'utf8' }).trim();
    if (p && fs.existsSync(p)) return p;
  } catch {}
  return null;
}

function getMusicDir() {
  const home = os.homedir();
  const music = path.join(home, 'Music');
  const base = fs.existsSync(music) ? music : path.join(home, 'Downloads');
  const dir = path.join(base, 'MacAMP');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

let activeChild = null;

function checkStatus() {
  const ytdlp = findBinary('yt-dlp');
  const ffmpeg = findBinary('ffmpeg');
  const node = findBinary('node');
  const musicDir = getMusicDir();
  return {
    available: Boolean(ytdlp),
    hasFfmpeg: Boolean(ffmpeg),
    ytdlpPath: ytdlp,
    ffmpegPath: ffmpeg,
    nodePath: node,
    musicDir,
  };
}

function cancel() {
  if (activeChild) {
    try {
      activeChild.kill('SIGTERM');
    } catch {}
    activeChild = null;
    return true;
  }
  return false;
}

function download(url, onProgress, onTrack) {
  return new Promise((resolve, reject) => {
    const status = checkStatus();
    if (!status.available) {
      return reject(new Error('yt-dlp is not installed. Install via: brew install yt-dlp ffmpeg'));
    }

    if (activeChild) {
      cancel();
    }

    const destDir = status.musicDir;
    const outputTemplate = path.join(destDir, '%(title)s.%(ext)s');

    const args = [
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '--add-metadata',
      '--newline',
      '--no-warnings',
      '--ignore-errors',
      '--progress',
      '-o', outputTemplate,
      '--exec', 'echo MACAMP_SAVED:{}',
    ];

    if (status.nodePath) {
      args.push('--js-runtimes', `node:${status.nodePath}`);
    }
    if (status.ffmpegPath) {
      args.push('--ffmpeg-location', path.dirname(status.ffmpegPath));
    }

    args.push(url.trim());

    const env = {
      ...process.env,
      PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}`,
    };

    const child = spawn(status.ytdlpPath, args, { env });
    activeChild = child;

    const downloadedTracks = [];
    let stdoutBuffer = '';

    function handleLine(line) {
      const trimmed = line.trim();
      if (!trimmed) return;

      // File finished and moved
      if (trimmed.startsWith('MACAMP_SAVED:')) {
        const filePath = trimmed.replace(/^MACAMP_SAVED:/, '').trim();
        if (filePath && fs.existsSync(filePath) && !downloadedTracks.includes(filePath)) {
          downloadedTracks.push(filePath);
          if (onTrack) onTrack(filePath);
        }
        return;
      }

      // Check destination reported by ExtractAudio
      const extractMatch = trimmed.match(/^\[ExtractAudio\] Destination:\s*(.+)$/);
      if (extractMatch) {
        const candidate = extractMatch[1].trim();
        if (candidate.endsWith('.mp3') && fs.existsSync(candidate) && !downloadedTracks.includes(candidate)) {
          downloadedTracks.push(candidate);
          if (onTrack) onTrack(candidate);
        }
        return;
      }

      // Progress reporting
      if (trimmed.startsWith('[download]')) {
        const percentMatch = trimmed.match(/(\d+(?:\.\d+)?%)/);
        const percent = percentMatch ? percentMatch[1] : null;
        if (onProgress) {
          onProgress({ text: trimmed, percent });
        }
        return;
      }

      if (trimmed.startsWith('[ExtractAudio]') || trimmed.startsWith('[Metadata]')) {
        if (onProgress) {
          onProgress({ text: trimmed });
        }
      }
    }

    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop();
      for (const line of lines) {
        handleLine(line);
      }
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes('ERROR:')) {
        if (onProgress) onProgress({ text: text.trim(), isError: true });
      }
    });

    child.on('close', (code, signal) => {
      activeChild = null;
      if (stdoutBuffer) {
        handleLine(stdoutBuffer);
      }

      if (signal === 'SIGTERM') {
        return reject(new Error('Download cancelled.'));
      }

      if (code === 0 || downloadedTracks.length > 0) {
        resolve({ count: downloadedTracks.length, tracks: downloadedTracks });
      } else {
        reject(new Error(`Download finished with exit code ${code}`));
      }
    });

    child.on('error', (err) => {
      activeChild = null;
      reject(err);
    });
  });
}

let batchCancelled = false;

function cancelBatch() {
  batchCancelled = true;
  cancel();
}

function downloadSingleTrack({ query, destDir, filename, metadata }, onProgress) {
  return new Promise((resolve) => {
    const status = checkStatus();
    if (!status.available) {
      return resolve({ success: false, error: 'yt-dlp not available' });
    }

    const outputTemplate = path.join(destDir, `${filename}.%(ext)s`);
    const args = [
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '--newline',
      '--no-warnings',
      '--ignore-errors',
      '--progress',
      '--max-downloads', '1',
      '-o', outputTemplate,
      '--exec', 'echo MACAMP_SAVED:{}',
    ];

    if (metadata) {
      const metaArgs = [];
      if (metadata.title) metaArgs.push(`-metadata title="${metadata.title.replace(/"/g, '\\"')}"`);
      if (metadata.artist) metaArgs.push(`-metadata artist="${metadata.artist.replace(/"/g, '\\"')}"`);
      if (metadata.album) metaArgs.push(`-metadata album="${metadata.album.replace(/"/g, '\\"')}"`);
      if (metaArgs.length > 0) {
        args.push('--postprocessor-args', `ExtractAudio:${metaArgs.join(' ')}`);
      }
    }

    if (status.nodePath) {
      args.push('--js-runtimes', `node:${status.nodePath}`);
    }
    if (status.ffmpegPath) {
      args.push('--ffmpeg-location', path.dirname(status.ffmpegPath));
    }

    args.push(query);

    const env = {
      ...process.env,
      PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}`,
    };

    let savedPath = null;
    const child = spawn(status.ytdlpPath, args, { env });
    activeChild = child;

    let stdoutBuffer = '';
    function handleLine(line) {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (trimmed.startsWith('MACAMP_SAVED:')) {
        const p = trimmed.replace(/^MACAMP_SAVED:/, '').trim();
        if (p && fs.existsSync(p)) savedPath = p;
        return;
      }
      const extractMatch = trimmed.match(/^\[ExtractAudio\] Destination:\s*(.+)$/);
      if (extractMatch) {
        const c = extractMatch[1].trim();
        if (c.endsWith('.mp3') && fs.existsSync(c)) savedPath = c;
        return;
      }
      if (trimmed.startsWith('[download]')) {
        const percentMatch = trimmed.match(/(\d+(?:\.\d+)?%)/);
        const percent = percentMatch ? percentMatch[1] : null;
        if (onProgress) onProgress({ text: trimmed, percent });
      }
    }

    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop();
      for (const line of lines) handleLine(line);
    });

    child.on('close', (code, signal) => {
      activeChild = null;
      if (stdoutBuffer) handleLine(stdoutBuffer);
      if (signal === 'SIGTERM') {
        return resolve({ success: false, cancelled: true });
      }
      if (savedPath && fs.existsSync(savedPath)) {
        return resolve({ success: true, filePath: savedPath });
      }
      const expectedFile = path.join(destDir, `${filename}.mp3`);
      if (fs.existsSync(expectedFile)) {
        return resolve({ success: true, filePath: expectedFile });
      }
      resolve({ success: false, error: `yt-dlp exited with code ${code}` });
    });

    child.on('error', (err) => {
      activeChild = null;
      resolve({ success: false, error: err.message });
    });
  });
}

async function downloadTrackBatch({ tracks, folderName, albumName, coverArtUrl }, onProgress, onTrack) {
  const status = checkStatus();
  if (!status.available) {
    throw new Error('yt-dlp is not installed. Install via: brew install yt-dlp ffmpeg');
  }

  batchCancelled = false;
  const baseMusicDir = getMusicDir();
  const safeFolderName = (folderName || 'Spotify Imports').replace(/[/\\:]/g, '-').trim();
  const destDir = path.join(baseMusicDir, safeFolderName);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  // Save cover image to folder
  if (coverArtUrl) {
    try {
      const imgRes = await fetch(coverArtUrl);
      if (imgRes.ok) {
        const buf = Buffer.from(await imgRes.arrayBuffer());
        fs.writeFileSync(path.join(destDir, 'cover.jpg'), buf);
        fs.writeFileSync(path.join(destDir, 'folder.jpg'), buf);
      }
    } catch {}
  }

  const downloaded = [];
  for (let i = 0; i < tracks.length; i++) {
    if (batchCancelled) break;
    const t = tracks[i];
    const query = `ytsearch1:${t.artists ? t.artists + ' - ' : ''}${t.title} audio`;
    const cleanTitle = t.title.replace(/[/\\:?*"<>|]/g, '_').trim();
    const cleanArtist = (t.artists || '').split(',')[0].replace(/[/\\:?*"<>|]/g, '_').trim();
    const filename = cleanArtist ? `${cleanArtist} - ${cleanTitle}` : cleanTitle;

    if (onProgress) {
      onProgress({
        index: i + 1,
        total: tracks.length,
        title: t.title,
        artists: t.artists,
        percent: '0%',
        text: `Starting download (${i + 1}/${tracks.length}): ${t.title}...`,
      });
    }

    const res = await downloadSingleTrack(
      {
        query,
        destDir,
        filename,
        metadata: {
          title: t.title,
          artist: t.artists,
          album: albumName || safeFolderName,
        },
      },
      (p) => {
        if (onProgress) {
          onProgress({
            index: i + 1,
            total: tracks.length,
            title: t.title,
            artists: t.artists,
            percent: p.percent || '0%',
            text: `[${i + 1}/${tracks.length}] ${t.title} (${p.percent || '…'})`,
          });
        }
      }
    );

    if (res.success && res.filePath) {
      downloaded.push(res.filePath);
      if (onTrack) onTrack(res.filePath);
    }
  }

  return {
    total: tracks.length,
    downloadedCount: downloaded.length,
    tracks: downloaded,
    destDir,
    cancelled: batchCancelled,
  };
}

module.exports = {
  checkStatus,
  download,
  cancel,
  downloadTrackBatch,
  cancelBatch,
  getMusicDir,
};
