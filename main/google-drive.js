const { app, shell } = require('electron');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REDIRECT_PORT = 53682;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`;

function configPath() {
  return path.join(app.getPath('userData'), 'google-oauth-config.json');
}
function tokensPath() {
  return path.join(app.getPath('userData'), 'google-tokens.json');
}

function ensureConfigTemplate() {
  const p = configPath();
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, JSON.stringify({ client_id: '', client_secret: '' }, null, 2));
  }
  return p;
}

function readConfig() {
  const p = ensureConfigTemplate();
  try {
    const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
    return cfg.client_id && cfg.client_secret ? cfg : null;
  } catch {
    return null;
  }
}

function readTokens() {
  try {
    return JSON.parse(fs.readFileSync(tokensPath(), 'utf8'));
  } catch {
    return null;
  }
}

function writeTokens(tokens) {
  fs.writeFileSync(tokensPath(), JSON.stringify(tokens, null, 2));
}

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function status() {
  const configured = !!readConfig();
  const tokens = readTokens();
  return { configured, connected: !!tokens?.refresh_token, configPath: configPath() };
}

function disconnect() {
  try { fs.unlinkSync(tokensPath()); } catch {}
}

async function connect() {
  const cfg = readConfig();
  if (!cfg) {
    throw new Error(`Not configured. Fill in client_id and client_secret in:\n${configPath()}`);
  }

  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
  const state = base64url(crypto.randomBytes(16));

  const authUrl = new URL(AUTH_ENDPOINT);
  authUrl.searchParams.set('client_id', cfg.client_id);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPE);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', state);

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      if (url.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
      const returnedState = url.searchParams.get('state');
      const err = url.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      if (err) {
        res.end('<html><body style="font-family:sans-serif">Google sign-in was cancelled. You can close this tab.</body></html>');
        server.close();
        reject(new Error(`Google OAuth error: ${err}`));
        return;
      }
      if (returnedState !== state) {
        res.end('<html><body style="font-family:sans-serif">Sign-in failed (state mismatch). Close this tab and try again.</body></html>');
        server.close();
        reject(new Error('OAuth state mismatch'));
        return;
      }
      res.end('<html><body style="font-family:sans-serif">MacAMP is connected to Google Drive. You can close this tab.</body></html>');
      server.close();
      resolve(url.searchParams.get('code'));
    });
    server.listen(REDIRECT_PORT, '127.0.0.1', () => {
      shell.openExternal(authUrl.toString());
    });
    server.on('error', reject);
  });

  const tokenRes = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.client_id,
      client_secret: cfg.client_secret,
      code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    }),
  });
  if (!tokenRes.ok) throw new Error(`Token exchange failed: ${await tokenRes.text()}`);
  const tokens = await tokenRes.json();
  tokens.obtained_at = Date.now();
  writeTokens(tokens);
  return status();
}

async function getAccessToken() {
  const cfg = readConfig();
  if (!cfg) throw new Error('Not configured');
  let tokens = readTokens();
  if (!tokens?.refresh_token) throw new Error('Not connected to Google Drive');

  const age = Date.now() - (tokens.obtained_at || 0);
  const expiresInMs = (tokens.expires_in || 3600) * 1000;
  if (age < expiresInMs - 60000) return tokens.access_token;

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.client_id,
      client_secret: cfg.client_secret,
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  const refreshed = await res.json();
  tokens = { ...tokens, ...refreshed, obtained_at: Date.now() };
  writeTokens(tokens);
  return tokens.access_token;
}

function extractFolderId(input) {
  const trimmed = input.trim();
  const match = trimmed.match(/[-\w]{25,}/);
  return match ? match[0] : trimmed;
}

async function listAudioInFolder(folderIdOrUrl) {
  const folderId = extractFolderId(folderIdOrUrl);
  const accessToken = await getAccessToken();
  const q = encodeURIComponent(`'${folderId}' in parents and mimeType contains 'audio/' and trashed = false`);
  const fields = encodeURIComponent('files(id,name,mimeType,size)');
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=200`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Drive list failed: ${await res.text()}`);
  const data = await res.json();
  return data.files || [];
}

async function getFileBytesBase64(fileId) {
  const accessToken = await getAccessToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Drive download failed: ${await res.text()}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString('base64');
}

module.exports = { status, connect, disconnect, listAudioInFolder, getFileBytesBase64, configPath };
