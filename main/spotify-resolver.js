'use strict';

function parseSpotifyUrl(inputUrl) {
  if (!inputUrl || typeof inputUrl !== 'string') return null;
  const trimmed = inputUrl.trim();

  // Handle URI format: spotify:playlist:ID, spotify:album:ID, spotify:track:ID
  const uriMatch = trimmed.match(/^spotify:(playlist|album|track):([a-zA-Z0-9]+)/i);
  if (uriMatch) {
    return { type: uriMatch[1].toLowerCase(), id: uriMatch[2] };
  }

  // Handle URL format: https://open.spotify.com/playlist/ID?si=...
  try {
    const parsed = new URL(trimmed);
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const type = parts[0].toLowerCase();
      const id = parts[1];
      if (['playlist', 'album', 'track'].includes(type) && /^[a-zA-Z0-9]+$/.test(id)) {
        return { type, id };
      }
    }
  } catch {}

  return null;
}

async function resolveSpotifyUrl(inputUrl) {
  const parsed = parseSpotifyUrl(inputUrl);
  if (!parsed) {
    throw new Error('Invalid Spotify URL. Please paste a valid playlist, album, or track link.');
  }

  const embedUrl = `https://open.spotify.com/embed/${parsed.type}/${parsed.id}`;
  const response = await fetch(embedUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to load Spotify content (status ${response.status})`);
  }

  const html = await response.text();
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/);
  if (!match || !match[1]) {
    throw new Error('Could not parse Spotify data from page. Please verify the playlist is public.');
  }

  let data;
  try {
    data = JSON.parse(match[1]);
  } catch (err) {
    throw new Error('Malformed Spotify response data: ' + err.message);
  }

  const entity = data.props?.pageProps?.state?.data?.entity;
  if (!entity) {
    throw new Error('Spotify playlist or album not found. It may be private or deleted.');
  }

  const title = (entity.title || entity.name || 'Spotify Import').replace(/\u00a0/g, ' ').trim();
  const subtitle = (entity.subtitle || '').replace(/\u00a0/g, ' ').trim();
  const coverArt = entity.coverArt?.sources?.[0]?.url || null;

  const tracks = [];
  if (Array.isArray(entity.trackList) && entity.trackList.length > 0) {
    entity.trackList.forEach((t, index) => {
      const trackTitle = (t.title || `Track ${index + 1}`).replace(/\u00a0/g, ' ').trim();
      const artists = (t.subtitle || subtitle || '').replace(/\u00a0/g, ' ').trim();
      const durationMs = typeof t.duration === 'number' ? t.duration : 0;
      tracks.push({
        id: t.uri || t.uid || `${parsed.id}_${index}`,
        index: index + 1,
        title: trackTitle,
        artists,
        durationMs,
        durationSec: Math.round(durationMs / 1000),
        previewUrl: t.audioPreview?.url || null,
      });
    });
  } else if (parsed.type === 'track') {
    tracks.push({
      id: entity.uri || entity.id || parsed.id,
      index: 1,
      title,
      artists: subtitle,
      durationMs: entity.duration || 0,
      durationSec: Math.round((entity.duration || 0) / 1000),
      previewUrl: entity.audioPreview?.url || null,
    });
  }

  return {
    type: parsed.type,
    id: parsed.id,
    title,
    subtitle,
    coverArt,
    tracks,
  };
}

module.exports = {
  parseSpotifyUrl,
  resolveSpotifyUrl,
};
