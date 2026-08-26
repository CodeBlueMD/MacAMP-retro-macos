(() => {
  'use strict';

  const el = (id) => document.getElementById(id);

  // ---------- State ----------
  const playlist = []; // { source, path|fileId, name, duration? }
  let currentIndex = -1;
  let selectedIndex = -1;
  let shuffleOn = false;
  let repeatOn = false;
  let seeking = false;
  let showRemaining = false;
  let eqEnabled = true;
  let keepPitch = true;
  let sleepTimeout = null;
  let miniVizMode = 'bars';

  // ---------- Dual audio elements (for crossfade) ----------
  const audioA = new Audio(); audioA.preload = 'auto';
  const audioB = new Audio(); audioB.preload = 'auto';
  const slotAudios = [audioA, audioB];
  const blobUrls = [null, null];
  let activeSlot = 0;
  const activeAudio = () => slotAudios[activeSlot];

  // ---------- Web Audio graph ----------
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const sourceA = audioCtx.createMediaElementSource(audioA);
  const sourceB = audioCtx.createMediaElementSource(audioB);
  const gainA = audioCtx.createGain();
  const gainB = audioCtx.createGain();
  gainA.gain.value = 1; gainB.gain.value = 0;
  const preampGain = audioCtx.createGain();
  const compressor = audioCtx.createDynamicsCompressor();
  const panner = audioCtx.createStereoPanner();
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;

  const eqFreqs = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
  const eqFilters = eqFreqs.map((freq) => {
    const f = audioCtx.createBiquadFilter();
    f.type = 'peaking'; f.frequency.value = freq; f.Q.value = 1.4; f.gain.value = 0;
    return f;
  });
  function dbToGain(db) { return Math.pow(10, db / 20); }

  sourceA.connect(gainA); gainA.connect(preampGain);
  sourceB.connect(gainB); gainB.connect(preampGain);
  let node = preampGain;
  for (const f of eqFilters) { node.connect(f); node = f; }
  node.connect(compressor);
  compressor.connect(panner);
  panner.connect(analyser);
  analyser.connect(audioCtx.destination);
  setAutoLevel(false);

  function setAutoLevel(on) {
    if (on) {
      compressor.threshold.value = -24; compressor.knee.value = 12;
      compressor.ratio.value = 4; compressor.attack.value = 0.02; compressor.release.value = 0.3;
    } else {
      compressor.threshold.value = 0; compressor.knee.value = 0;
      compressor.ratio.value = 1; compressor.attack.value = 0.003; compressor.release.value = 0.25;
    }
  }
  function resumeAudioCtx() { if (audioCtx.state === 'suspended') audioCtx.resume(); }

  // ---------- Formatting ----------
  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60); const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  function baseName(p) { const parts = p.split(/[\\/]/); return parts[parts.length - 1]; }

  // ---------- Elements ----------
  const trackName = el('trackName');
  const trackScroll = el('trackScroll');
  const timeDisplay = el('timeDisplay');
  const seek = el('seek');
  const volume = el('volume');
  const balance = el('balance');
  const plList = el('plList');
  const playerWin = el('playerWin');
  const eqWin = el('eqWin');
  const plWin = el('plWin');
  const libWin = el('libWin');
  const stage = el('stage');
  const btnPlay = el('btnPlay');
  const btnShuffle = el('btnShuffle');
  const btnRepeat = el('btnRepeat');
  const btnEQ = el('btnEQ');
  const btnPL = el('btnPL');
  const btnLib = el('btnLib');
  const vizCanvas = el('viz');
  const vizCtx = vizCanvas.getContext('2d');
  const albumArt = el('albumArt');
  const plFooter = el('plFooter');

  // ---------- Title bar / window controls ----------
  el('btnMin').addEventListener('click', () => window.retro.minimize());
  el('btnClose').addEventListener('click', () => window.retro.close());
  el('btnPin').addEventListener('click', async () => {
    const on = await window.retro.toggleAlwaysOnTop();
    el('btnPin').classList.toggle('on', on);
  });
  async function toggleFullscreenPlayer() { await window.retro.toggleFullscreen(); }
  el('btnFullscreen').addEventListener('click', toggleFullscreenPlayer);
  el('btnFullscreenPlayer').addEventListener('click', toggleFullscreenPlayer);

  document.querySelectorAll('.winMinBtn, .winCloseBtn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.target);
      target.classList.add('hidden');
      if (btn.dataset.target === 'eqWin') btnEQ.classList.remove('on');
      if (btn.dataset.target === 'plWin') btnPL.classList.remove('on');
      if (btn.dataset.target === 'libWin') btnLib.classList.remove('on');
    });
  });

  // ---------- Layout: Player -> Playlist -> Equalizer stacked on the left,
  // Library filling the full-height column on the right (computed from the
  // actual rendered panel heights, so it holds up across themes/sizes). ----
  const GAP = 14;
  function computeDefaultPositions() {
    playerWin.style.left = '0px'; playerWin.style.top = '0px';
    const playerH = playerWin.offsetHeight;
    const plH = plWin.offsetHeight;
    const eqH = eqWin.offsetHeight;
    const leftW = playerWin.offsetWidth;
    const totalH = playerH + GAP + plH + GAP + eqH;
    stage.style.height = totalH + 'px';
    libWin.style.height = totalH + 'px';
    return {
      plWin: { left: 0, top: playerH + GAP },
      eqWin: { left: 0, top: playerH + GAP + plH + GAP },
      libWin: { left: leftW + GAP, top: 0 },
    };
  }

  function makeDraggable(panel, handle, storageKey, defaultPos) {
    let startX, startY, startLeft, startTop, dragging = false;
    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      startLeft = panel.offsetLeft; startTop = panel.offsetTop;
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const left = startLeft + (e.clientX - startX);
      const top = Math.max(0, startTop + (e.clientY - startY));
      panel.style.left = left + 'px';
      panel.style.top = top + 'px';
    });
    handle.addEventListener('pointerup', () => {
      if (!dragging) return;
      dragging = false;
      localStorage.setItem(storageKey, JSON.stringify({ left: panel.offsetLeft, top: panel.offsetTop }));
    });
    const saved = localStorage.getItem(storageKey);
    const pos = saved ? JSON.parse(saved) : defaultPos;
    panel.style.left = pos.left + 'px'; panel.style.top = pos.top + 'px';
  }

  const defaults = computeDefaultPositions();
  makeDraggable(plWin, plWin.querySelector('.wintitle'), 'macamp.pos.plWin', defaults.plWin);
  makeDraggable(eqWin, eqWin.querySelector('.wintitle'), 'macamp.pos.eqWin', defaults.eqWin);
  makeDraggable(libWin, libWin.querySelector('.wintitle'), 'macamp.pos.libWin', defaults.libWin);

  el('btnResetLayout').addEventListener('click', () => {
    localStorage.removeItem('macamp.pos.plWin');
    localStorage.removeItem('macamp.pos.eqWin');
    localStorage.removeItem('macamp.pos.libWin');
    const d = computeDefaultPositions();
    plWin.style.left = d.plWin.left + 'px'; plWin.style.top = d.plWin.top + 'px';
    eqWin.style.left = d.eqWin.left + 'px'; eqWin.style.top = d.eqWin.top + 'px';
    libWin.style.left = d.libWin.left + 'px'; libWin.style.top = d.libWin.top + 'px';
  });

  // ---------- Theme + size ----------
  const app = el('app');
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('on', s.dataset.theme === theme));
    localStorage.setItem('macamp.theme', theme);
  }
  document.querySelectorAll('.swatch').forEach((s) => s.addEventListener('click', () => applyTheme(s.dataset.theme)));
  applyTheme(localStorage.getItem('macamp.theme') || 'cyber');

  const sizeSelect = el('sizeSelect');
  function applySize(size) {
    app.classList.remove('size-compact', 'size-large');
    if (size === 'compact') app.classList.add('size-compact');
    if (size === 'large') app.classList.add('size-large');
    localStorage.setItem('macamp.size', size);
  }
  sizeSelect.addEventListener('change', () => applySize(sizeSelect.value));
  const savedSize = localStorage.getItem('macamp.size') || 'fit';
  sizeSelect.value = savedSize; applySize(savedSize);

  // ---------- Playlist rendering ----------
  function renderPlaylist() {
    plList.innerHTML = '';
    playlist.forEach((track, i) => {
      const li = document.createElement('li');
      if (i === currentIndex) li.classList.add('playing');
      if (i === selectedIndex) li.classList.add('selected');
      const dur = track.duration ? fmtTime(track.duration) : '';
      li.innerHTML = `<span class="idx">${i + 1}.</span><span class="name">${track.name}</span><span class="dur">${dur}</span><span class="rm">✕</span>`;
      li.addEventListener('click', () => { selectedIndex = i; renderPlaylist(); });
      li.addEventListener('dblclick', () => loadAndPlay(i));
      li.querySelector('.rm').addEventListener('click', (ev) => { ev.stopPropagation(); removeTrack(i); });
      plList.appendChild(li);
    });
    updateFooter();
    applyJumpFilter();
  }

  function updateFooter() {
    const total = playlist.reduce((sum, t) => sum + (t.duration || 0), 0);
    plFooter.textContent = `${playlist.length} track${playlist.length === 1 ? '' : 's'} · ${fmtTime(total)}`;
  }

  function probeDuration(track) {
    if (track.source !== 'local') return;
    const probe = new Audio();
    probe.preload = 'metadata';
    probe.src = 'file://' + encodeURI(track.path).replace(/#/g, '%23');
    probe.addEventListener('loadedmetadata', () => {
      track.duration = probe.duration;
      updateFooter();
      renderPlaylist();
    }, { once: true });
  }

  function removeTrack(i) {
    playlist.splice(i, 1);
    if (i === currentIndex) { stop(); currentIndex = -1; }
    else if (i < currentIndex) currentIndex--;
    if (i === selectedIndex) selectedIndex = -1;
    else if (i < selectedIndex) selectedIndex--;
    renderPlaylist();
  }

  function addFiles(paths) {
    let added = false;
    for (const p of paths) {
      if (!p) continue;
      const track = { source: 'local', path: p, name: baseName(p) };
      playlist.push(track);
      probeDuration(track);
      added = true;
    }
    if (added) renderPlaylist();
    if (currentIndex === -1 && playlist.length > 0) loadAndPlay(0);
  }

  function addDriveFiles(files) {
    let added = false;
    for (const f of files) { playlist.push({ source: 'drive', fileId: f.id, name: f.name }); added = true; }
    if (added) renderPlaylist();
    if (currentIndex === -1 && playlist.length > 0) loadAndPlay(0);
  }

  const MIME_BY_EXT = { mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', flac: 'audio/flac' };
  function guessMime(name) { const ext = (name.split('.').pop() || '').toLowerCase(); return MIME_BY_EXT[ext] || 'audio/mpeg'; }

  // ---------- Playback ----------
  function getCrossfadeSeconds() { return parseInt(el('crossfade').value, 10) || 0; }

  let loadToken = 0;
  async function loadAndPlay(index) {
    if (index < 0 || index >= playlist.length) return;
    const track = playlist[index];
    const token = ++loadToken;
    const crossfadeSec = getCrossfadeSeconds();
    const doCrossfade = crossfadeSec > 0 && !activeAudio().paused && currentIndex !== -1;
    const targetSlot = doCrossfade ? 1 - activeSlot : activeSlot;
    const targetAudio = slotAudios[targetSlot];
    const targetGain = targetSlot === 0 ? gainA : gainB;
    const otherGain = targetSlot === 0 ? gainB : gainA;

    currentIndex = index;
    trackName.textContent = track.source === 'drive' ? `${track.name} (loading…)` : track.name;
    checkMarquee(); renderPlaylist(); hideAlbumArt();

    if (track.source === 'drive') {
      try {
        const base64 = await window.retro.googleGetTrack(track.fileId);
        if (token !== loadToken) return;
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        if (blobUrls[targetSlot]) URL.revokeObjectURL(blobUrls[targetSlot]);
        blobUrls[targetSlot] = URL.createObjectURL(new Blob([bytes], { type: guessMime(track.name) }));
        targetAudio.src = blobUrls[targetSlot];
      } catch (err) {
        trackName.textContent = `${track.name} (failed to load)`; console.error(err); return;
      }
    } else {
      if (blobUrls[targetSlot]) { URL.revokeObjectURL(blobUrls[targetSlot]); blobUrls[targetSlot] = null; }
      targetAudio.src = 'file://' + encodeURI(track.path).replace(/#/g, '%23');
    }
    if (token !== loadToken) return;

    targetAudio.volume = volume.value / 100;
    targetAudio.playbackRate = parseFloat(el('speed').value);
    targetAudio.preservesPitch = keepPitch;

    resumeAudioCtx();
    if (doCrossfade) {
      const now = audioCtx.currentTime;
      targetGain.gain.cancelScheduledValues(now); targetGain.gain.setValueAtTime(0, now);
      targetAudio.play().catch(() => {});
      targetGain.gain.linearRampToValueAtTime(1, now + crossfadeSec);
      otherGain.gain.cancelScheduledValues(now); otherGain.gain.setValueAtTime(otherGain.gain.value, now);
      otherGain.gain.linearRampToValueAtTime(0, now + crossfadeSec);
      const oldAudio = slotAudios[activeSlot];
      setTimeout(() => { if (oldAudio !== targetAudio) { oldAudio.pause(); oldAudio.currentTime = 0; } }, crossfadeSec * 1000 + 60);
    } else {
      slotAudios.forEach((a, i) => { if (i !== targetSlot) { a.pause(); a.currentTime = 0; } });
      const now = audioCtx.currentTime;
      targetGain.gain.cancelScheduledValues(now); targetGain.gain.setValueAtTime(1, now);
      otherGain.gain.cancelScheduledValues(now); otherGain.gain.setValueAtTime(0, now);
      targetAudio.play().catch(() => {});
    }
    activeSlot = targetSlot;

    trackName.textContent = track.name; checkMarquee();
    probeMeta(track); tryLoadAlbumArt(track);
  }

  function checkMarquee() {
    trackName.classList.remove('scrolling');
    requestAnimationFrame(() => { if (trackName.scrollWidth > trackScroll.clientWidth) trackName.classList.add('scrolling'); });
  }

  function probeMeta() { /* kbps/khz not exposed by HTMLMediaElement; left as placeholders */ }

  function play() {
    if (currentIndex === -1 && playlist.length > 0) { loadAndPlay(0); return; }
    resumeAudioCtx(); activeAudio().play().catch(() => {});
  }
  function pause() { activeAudio().pause(); }
  function stop() { slotAudios.forEach((a) => { a.pause(); a.currentTime = 0; }); clearTimeout(sleepTimeout); }
  function next() {
    if (playlist.length === 0) return;
    let i;
    if (shuffleOn) i = Math.floor(Math.random() * playlist.length);
    else { i = currentIndex + 1; if (i >= playlist.length) i = repeatOn ? 0 : -1; }
    if (i === -1) { stop(); return; }
    loadAndPlay(i);
  }
  function prev() {
    if (playlist.length === 0) return;
    let i = currentIndex - 1;
    if (i < 0) i = repeatOn ? playlist.length - 1 : 0;
    loadAndPlay(i);
  }

  slotAudios.forEach((a) => {
    a.addEventListener('ended', () => { if (a === activeAudio()) next(); });
    a.addEventListener('play', () => { if (a === activeAudio()) { btnPlay.classList.add('active'); el('pwrDot').style.background = 'var(--accent)'; } });
    a.addEventListener('pause', () => { if (a === activeAudio() && a.paused) btnPlay.classList.remove('active'); });
  });

  el('btnPlay').addEventListener('click', play);
  el('btnPause').addEventListener('click', pause);
  el('btnStop').addEventListener('click', stop);
  el('btnNext').addEventListener('click', next);
  el('btnPrev').addEventListener('click', prev);

  async function pickFiles() { addFiles(await window.retro.openFileDialog()); }
  async function pickFolder() { addFiles(await window.retro.openFolderDialog()); }
  el('btnOpen').addEventListener('click', pickFiles);
  el('btnAddFile').addEventListener('click', pickFiles);
  el('dashAddFile').addEventListener('click', pickFiles);
  el('btnAddDir').addEventListener('click', pickFolder);
  el('dashAddDir').addEventListener('click', pickFolder);

  function clearPlaylist() { playlist.length = 0; currentIndex = -1; selectedIndex = -1; stop(); renderPlaylist(); }
  el('btnClear').addEventListener('click', clearPlaylist);
  el('dashClear').addEventListener('click', clearPlaylist);

  el('btnRem').addEventListener('click', () => { if (selectedIndex !== -1) removeTrack(selectedIndex); });

  el('btnSort').addEventListener('click', () => {
    const current = playlist[currentIndex];
    playlist.sort((a, b) => a.name.localeCompare(b.name));
    currentIndex = current ? playlist.indexOf(current) : -1;
    renderPlaylist();
  });

  async function saveM3u() {
    const paths = playlist.filter((t) => t.source === 'local').map((t) => t.path);
    await window.retro.saveM3u(paths);
  }
  async function loadM3u() { addFiles(await window.retro.openM3u()); }
  el('dashSaveM3u').addEventListener('click', saveM3u);
  el('dashLoadM3u').addEventListener('click', loadM3u);

  // ---------- Jump-to filter ----------
  const jumpTo = el('jumpTo');
  function applyJumpFilter() {
    const q = jumpTo.value.trim().toLowerCase();
    Array.from(plList.children).forEach((li, i) => {
      const match = !q || playlist[i].name.toLowerCase().includes(q);
      li.classList.toggle('hiddenByFilter', !match);
    });
  }
  jumpTo.addEventListener('input', applyJumpFilter);

  // ---------- Google Drive ----------
  const gdriveStatus = el('gdriveStatus');
  const btnGdriveConnect = el('btnGdriveConnect');
  const gdriveFolderRow = el('gdriveFolderRow');
  const gdriveFolderInput = el('gdriveFolderInput');

  async function refreshGdriveStatus() {
    const s = await window.retro.googleStatus();
    if (!s.configured) {
      gdriveStatus.textContent = 'Google Drive: not set up yet (click Setup)';
      gdriveStatus.classList.remove('connected'); btnGdriveConnect.textContent = 'Connect'; gdriveFolderRow.classList.add('hidden');
    } else if (!s.connected) {
      gdriveStatus.textContent = 'Google Drive: not connected';
      gdriveStatus.classList.remove('connected'); btnGdriveConnect.textContent = 'Connect'; gdriveFolderRow.classList.add('hidden');
    } else {
      gdriveStatus.textContent = 'Google Drive: connected';
      gdriveStatus.classList.add('connected'); btnGdriveConnect.textContent = 'Disconnect'; gdriveFolderRow.classList.remove('hidden');
    }
    return s;
  }
  refreshGdriveStatus();
  btnGdriveConnect.addEventListener('click', async () => {
    const s = await window.retro.googleStatus();
    if (s.connected) { await window.retro.googleDisconnect(); }
    else {
      btnGdriveConnect.disabled = true;
      gdriveStatus.textContent = 'Google Drive: sign in from the browser tab that just opened…';
      try { await window.retro.googleConnect(); }
      catch (err) { gdriveStatus.textContent = `Google Drive: ${err.message || 'connection failed'}`; btnGdriveConnect.disabled = false; return; }
      btnGdriveConnect.disabled = false;
    }
    refreshGdriveStatus();
  });
  el('btnGdriveConfig').addEventListener('click', () => window.retro.googleOpenConfig());
  el('btnGdriveLoad').addEventListener('click', async () => {
    const input = gdriveFolderInput.value.trim(); if (!input) return;
    const btnLoad = el('btnGdriveLoad'); btnLoad.disabled = true; btnLoad.textContent = 'Loading…';
    try { addDriveFiles(await window.retro.googleListFolder(input)); }
    catch (err) { gdriveStatus.textContent = `Google Drive: ${err.message || 'load failed'}`; }
    btnLoad.disabled = false; btnLoad.textContent = 'Load';
  });

  // ---------- Shuffle / repeat / EQ / PL toggles ----------
  btnShuffle.addEventListener('click', () => { shuffleOn = !shuffleOn; btnShuffle.classList.toggle('on', shuffleOn); });
  btnRepeat.addEventListener('click', () => { repeatOn = !repeatOn; btnRepeat.classList.toggle('on', repeatOn); });
  btnEQ.addEventListener('click', () => {
    const willShow = eqWin.classList.contains('hidden');
    eqWin.classList.toggle('hidden', !willShow); btnEQ.classList.toggle('on', willShow);
  });
  btnPL.addEventListener('click', () => {
    const willShow = plWin.classList.contains('hidden');
    plWin.classList.toggle('hidden', !willShow); btnPL.classList.toggle('on', willShow);
  });
  btnLib.addEventListener('click', () => {
    const willShow = libWin.classList.contains('hidden');
    libWin.classList.toggle('hidden', !willShow); btnLib.classList.toggle('on', willShow);
  });

  // ---------- Seek ----------
  seek.addEventListener('input', () => { seeking = true; });
  seek.addEventListener('change', () => { if (activeAudio().duration) activeAudio().currentTime = (seek.value / 1000) * activeAudio().duration; seeking = false; });
  timeDisplay.addEventListener('click', () => { showRemaining = !showRemaining; });

  setInterval(() => {
    const a = activeAudio();
    if (!seeking && a.duration) seek.value = Math.floor((a.currentTime / a.duration) * 1000);
    const shown = showRemaining && a.duration ? -(a.duration - a.currentTime) : a.currentTime;
    timeDisplay.textContent = (shown < 0 ? '-' : '') + fmtTime(Math.abs(shown));
  }, 250);

  // ---------- Volume / balance ----------
  volume.addEventListener('input', () => { slotAudios.forEach((a) => { a.volume = volume.value / 100; }); });
  slotAudios.forEach((a) => { a.volume = volume.value / 100; });
  balance.addEventListener('input', () => { panner.pan.value = balance.value / 100; });

  // ---------- Playback card: crossfade / speed / sleep / pitch / auto-level ----------
  el('crossfade').addEventListener('input', (e) => {
    el('crossfadeVal').textContent = e.target.value === '0' ? 'off' : `${e.target.value}s`;
  });
  el('speed').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    el('speedVal').textContent = v.toFixed(2) + '×';
    slotAudios.forEach((a) => { a.playbackRate = v; });
  });
  el('keepPitch').addEventListener('change', (e) => {
    keepPitch = e.target.checked;
    slotAudios.forEach((a) => { a.preservesPitch = keepPitch; });
  });
  slotAudios.forEach((a) => { a.preservesPitch = true; });
  el('autoLevel').addEventListener('change', (e) => setAutoLevel(e.target.checked));
  el('sleepSelect').addEventListener('change', (e) => {
    clearTimeout(sleepTimeout);
    const minutes = parseInt(e.target.value, 10);
    if (minutes > 0) {
      el('sleepVal').textContent = `${minutes}m`;
      sleepTimeout = setTimeout(() => { stop(); el('sleepVal').textContent = '—'; el('sleepSelect').value = '0'; }, minutes * 60000);
    } else {
      el('sleepVal').textContent = '—';
    }
  });

  // ---------- Equalizer ----------
  const preampSlider = el('preamp');
  const bandSliders = Array.from(document.querySelectorAll('.eqBandSlider'));
  function applyEqFromSliders() {
    if (!eqEnabled) return;
    preampGain.gain.value = dbToGain(parseFloat(preampSlider.value));
    bandSliders.forEach((s, i) => { eqFilters[i].gain.value = parseFloat(s.value); });
  }
  function bypassEq() { preampGain.gain.value = 1; eqFilters.forEach((f) => { f.gain.value = 0; }); }
  preampSlider.addEventListener('input', applyEqFromSliders);
  bandSliders.forEach((s) => s.addEventListener('input', applyEqFromSliders));

  const eqOnToggle = el('eqOnToggle');
  const eqAutoToggle = el('eqAutoToggle');
  eqOnToggle.classList.add('on');
  eqOnToggle.addEventListener('click', () => {
    eqEnabled = !eqEnabled; eqOnToggle.classList.toggle('on', eqEnabled);
    if (eqEnabled) applyEqFromSliders(); else bypassEq();
  });
  eqAutoToggle.addEventListener('click', () => eqAutoToggle.classList.toggle('on'));

  const eqPresets = {
    flat: [0,0,0,0,0,0,0,0,0,0,0], rock: [4,4,3,1,-1,-1,0,2,3,3,3], pop: [2,-1,-2,-1,1,3,4,4,3,2,2],
    bass: [6,8,7,5,2,0,-1,-1,-1,-1,-1], treble: [-3,-3,-2,-1,0,1,3,5,6,7,7],
    classical: [0,3,3,3,2,0,-2,-2,-2,-3,-4], dance: [5,6,3,0,0,-2,-3,-3,0,2,2],
  };
  el('eqPresets').addEventListener('change', (e) => {
    const vals = eqPresets[e.target.value] || eqPresets.flat;
    preampSlider.value = vals[0]; bandSliders.forEach((s, i) => { s.value = vals[i + 1]; });
    applyEqFromSliders();
  });

  // ---------- Visualizer ----------
  const freqData = new Uint8Array(analyser.frequencyBinCount);
  const timeData = new Uint8Array(analyser.fftSize);

  function renderViz(ctx, w, h, mode, sensitivity) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--lcd-bg') || '#04140a';
    ctx.fillRect(0, 0, w, h);
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#39ff6a';
    if (mode === 'off') return;
    if (mode === 'scope') {
      analyser.getByteTimeDomainData(timeData);
      ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.beginPath();
      const step = w / timeData.length;
      for (let i = 0; i < timeData.length; i++) {
        const v = ((timeData[i] - 128) / 128) * (sensitivity / 100);
        const y = h / 2 + v * (h / 2);
        i === 0 ? ctx.moveTo(0, y) : ctx.lineTo(i * step, y);
      }
      ctx.stroke();
      return;
    }
    analyser.getByteFrequencyData(freqData);
    const bars = mode === 'dots' ? 24 : 19;
    const barW = w / bars;
    for (let i = 0; i < bars; i++) {
      const v = (freqData[Math.floor(i * (freqData.length / bars))] || 0) * (sensitivity / 100);
      const barH = Math.max(1, Math.min(h, (v / 255) * h));
      const x = i * barW + 1;
      if (mode === 'dots') {
        const dots = Math.round(barH / 4);
        for (let d = 0; d < dots; d++) ctx.fillStyle = accent, ctx.fillRect(x, h - d * 4 - 3, barW - 3, 2);
      } else {
        const grad = ctx.createLinearGradient(0, h, 0, h - barH);
        grad.addColorStop(0, accent); grad.addColorStop(1, '#ffffff');
        ctx.fillStyle = grad; ctx.fillRect(x, h - barH, barW - 1, barH);
      }
    }
  }

  function drawMini() {
    requestAnimationFrame(drawMini);
    renderViz(vizCtx, vizCanvas.width, vizCanvas.height, miniVizMode, 100);
  }
  drawMini();
  vizCanvas.addEventListener('click', () => {
    miniVizMode = miniVizMode === 'bars' ? 'dots' : miniVizMode === 'dots' ? 'scope' : miniVizMode === 'scope' ? 'off' : 'bars';
  });

  const vizOverlay = el('vizOverlay');
  const vizFullCanvas = el('vizFull');
  const vizFullCtx = vizFullCanvas.getContext('2d');
  let fullVizRunning = false;
  function drawFull() {
    if (!fullVizRunning) return;
    requestAnimationFrame(drawFull);
    renderViz(vizFullCtx, vizFullCanvas.width, vizFullCanvas.height, el('vizPreset').value, parseFloat(el('vizSensitivity').value));
  }
  el('btnFullscreenViz').addEventListener('click', () => {
    vizOverlay.classList.remove('hidden');
    vizFullCanvas.width = window.innerWidth; vizFullCanvas.height = window.innerHeight;
    fullVizRunning = true; drawFull();
  });
  el('btnExitViz').addEventListener('click', () => { vizOverlay.classList.add('hidden'); fullVizRunning = false; });
  el('vizSensitivity').addEventListener('input', (e) => { el('vizSensVal').textContent = e.target.value; });

  // ---------- Shortcuts overlay ----------
  const shortcutsOverlay = el('shortcutsOverlay');
  el('btnShortcuts').addEventListener('click', () => shortcutsOverlay.classList.remove('hidden'));
  el('btnCloseShortcuts').addEventListener('click', () => shortcutsOverlay.classList.add('hidden'));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!vizOverlay.classList.contains('hidden')) { vizOverlay.classList.add('hidden'); fullVizRunning = false; }
      if (!shortcutsOverlay.classList.contains('hidden')) shortcutsOverlay.classList.add('hidden');
      return;
    }
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    switch (e.key) {
      case ' ': e.preventDefault(); activeAudio().paused ? play() : pause(); break;
      case 'ArrowLeft': activeAudio().currentTime = Math.max(0, activeAudio().currentTime - 5); break;
      case 'ArrowRight': activeAudio().currentTime += 5; break;
      case 'ArrowUp': volume.value = Math.min(100, +volume.value + 5); volume.dispatchEvent(new Event('input')); break;
      case 'ArrowDown': volume.value = Math.max(0, +volume.value - 5); volume.dispatchEvent(new Event('input')); break;
      case 'n': case 'N': next(); break;
      case 'p': case 'P': prev(); break;
      case 's': case 'S': btnShuffle.click(); break;
      case 'r': case 'R': btnRepeat.click(); break;
      case 'j': case 'J': e.preventDefault(); jumpTo.focus(); break;
    }
  });

  // ---------- Album art (best-effort, MP3 ID3v2 APIC only) ----------
  function hideAlbumArt() { albumArt.classList.remove('show'); albumArt.src = ''; }

  function base64ToBytes(b64) { return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); }

  function synchsafe(bytes, offset) {
    return ((bytes[offset] & 0x7f) << 21) | ((bytes[offset + 1] & 0x7f) << 14) | ((bytes[offset + 2] & 0x7f) << 7) | (bytes[offset + 3] & 0x7f);
  }

  function findNull(bytes, start, wide) {
    for (let i = start; i < bytes.length - (wide ? 1 : 0); i += wide ? 2 : 1) {
      if (bytes[i] === 0 && (!wide || bytes[i + 1] === 0)) return i;
    }
    return bytes.length;
  }

  function extractApic(bytes) {
    if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return null; // "ID3"
    const tagSize = synchsafe(bytes, 6);
    const version = bytes[3];
    let offset = 10;
    const end = Math.min(bytes.length, 10 + tagSize);
    while (offset + 10 <= end) {
      const id = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
      let frameSize;
      if (version >= 4) frameSize = synchsafe(bytes, offset + 4);
      else frameSize = (bytes[offset + 4] << 24) | (bytes[offset + 5] << 16) | (bytes[offset + 6] << 8) | bytes[offset + 7];
      const frameStart = offset + 10;
      if (!/^[A-Z0-9]{4}$/.test(id) || frameSize <= 0 || frameStart + frameSize > bytes.length) break;
      if (id === 'APIC') {
        let p = frameStart;
        const encoding = bytes[p]; p += 1;
        const mimeEnd = findNull(bytes, p, false);
        const mime = String.fromCharCode(...bytes.subarray(p, mimeEnd)) || 'image/jpeg';
        p = mimeEnd + 1;
        p += 1; // picture type byte
        const wide = encoding === 1 || encoding === 2;
        const descEnd = findNull(bytes, p, wide);
        p = descEnd + (wide ? 2 : 1);
        const imgBytes = bytes.subarray(p, frameStart + frameSize);
        return { mime, imgBytes };
      }
      offset = frameStart + frameSize;
    }
    return null;
  }

  async function tryLoadAlbumArt(track) {
    if (!el('albumArtToggle').checked) { hideAlbumArt(); return; }
    if (track.source !== 'local' || !track.path.toLowerCase().endsWith('.mp3')) { hideAlbumArt(); return; }
    try {
      const base64 = await window.retro.readTagBytes(track.path, 3 * 1024 * 1024);
      if (!base64) { hideAlbumArt(); return; }
      const bytes = base64ToBytes(base64);
      const apic = extractApic(bytes);
      if (!apic) { hideAlbumArt(); return; }
      let binary = ''; const CHUNK = 0x8000;
      for (let i = 0; i < apic.imgBytes.length; i += CHUNK) binary += String.fromCharCode(...apic.imgBytes.subarray(i, i + CHUNK));
      albumArt.src = `data:${apic.mime};base64,${btoa(binary)}`;
      albumArt.classList.add('show');
    } catch { hideAlbumArt(); }
  }
  el('albumArtToggle').addEventListener('change', () => { if (currentIndex !== -1) tryLoadAlbumArt(playlist[currentIndex]); else hideAlbumArt(); });

  // ---------- Library browser (navigate your own folders to pick audio) ----------
  const libList = el('libList');
  const libPathEl = el('libPath');
  const libQuickLinks = el('libQuickLinks');
  const libSearch = el('libSearch');
  const libAddSelectedBtn = el('libAddSelected');
  let libCurrentPath = null;
  let libEntries = { dirs: [], files: [] };
  const librarySelected = new Set();

  function libRenderList() {
    libList.innerHTML = '';
    for (const dirPath of libEntries.dirs) {
      const li = document.createElement('li');
      li.className = 'dir';
      li.innerHTML = `<span>📁</span><span class="name">${window.retro.basename(dirPath)}</span>`;
      li.addEventListener('click', () => libNavigate(dirPath));
      libList.appendChild(li);
    }
    for (const filePath of libEntries.files) {
      const li = document.createElement('li');
      li.className = 'file' + (librarySelected.has(filePath) ? ' selected' : '');
      li.innerHTML = `<span>🎵</span><span class="name">${window.retro.basename(filePath)}</span>`;
      li.addEventListener('click', () => {
        if (librarySelected.has(filePath)) librarySelected.delete(filePath);
        else librarySelected.add(filePath);
        libRenderList();
      });
      li.addEventListener('dblclick', () => { addFiles([filePath]); });
      libList.appendChild(li);
    }
    libAddSelectedBtn.textContent = `Add Selected (${librarySelected.size})`;
    libApplySearchFilter();
  }

  function libApplySearchFilter() {
    const q = libSearch.value.trim().toLowerCase();
    Array.from(libList.children).forEach((li) => {
      const match = !q || li.textContent.toLowerCase().includes(q);
      li.classList.toggle('hiddenByFilter', !match);
    });
  }
  libSearch.addEventListener('input', libApplySearchFilter);

  async function libNavigate(dirPath) {
    const result = await window.retro.listDir(dirPath);
    libCurrentPath = result.path;
    libEntries = { dirs: result.dirs || [], files: result.files || [] };
    librarySelected.clear();
    libPathEl.textContent = libCurrentPath;
    libPathEl.title = libCurrentPath;
    libRenderList();
  }

  el('libUp').addEventListener('click', () => {
    if (!libCurrentPath) return;
    const parent = window.retro.dirname(libCurrentPath);
    if (parent && parent !== libCurrentPath) libNavigate(parent);
  });
  libAddSelectedBtn.addEventListener('click', () => {
    if (librarySelected.size) addFiles(Array.from(librarySelected));
    librarySelected.clear();
    libRenderList();
  });
  el('libAddFolder').addEventListener('click', async () => {
    if (!libCurrentPath) return;
    addFiles(await window.retro.scanAudioDir(libCurrentPath));
  });

  (async () => {
    const homes = await window.retro.homeDirs();
    const labels = { music: '🎵 Music', desktop: '🖥 Desktop', downloads: '⬇ Downloads', home: '🏠 Home' };
    libQuickLinks.innerHTML = '';
    for (const [key, dirPath] of Object.entries(homes)) {
      const btn = document.createElement('button');
      btn.className = 'smallbtn';
      btn.textContent = labels[key] || key;
      btn.addEventListener('click', () => libNavigate(dirPath));
      libQuickLinks.appendChild(btn);
    }
    libNavigate(homes.music || homes.home);
  })();

  // ---------- Drag & drop ----------
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files || []);
    const paths = files.map((f) => window.retro.pathForFile(f)).filter(Boolean);
    if (paths.length) addFiles(paths);
  });

  renderPlaylist();
})();
