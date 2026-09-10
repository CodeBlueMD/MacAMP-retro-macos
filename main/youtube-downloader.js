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

module.exports = {
  checkStatus,
  download,
  cancel,
  getMusicDir,
};
