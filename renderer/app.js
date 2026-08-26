(() => {
  'use strict';

  // ---------- State ----------
  const playlist = []; // { path, name }
  let currentIndex = -1;
  let selectedIndex = -1;
  let shuffleOn = false;
  let repeatOn = false;
  let seeking = false;
  let showRemaining = false;
  let eqEnabled = true;

  // ---------- Elements ----------
  const audio = new Audio();
  audio.preload = 'auto';

  const el = (id) => document.getElementById(id);
  const trackName = el('trackName');
  const trackScroll = el('trackScroll');
  const timeDisplay = el('timeDisplay');
  const kbps = el('kbps');
  const khz = el('khz');
  const seek = el('seek');
  const volume = el('volume');
  const balance = el('balance');
  const plList = el('plList');
  const eqPanel = el('eqPanel');
  const plPanel = el('plPanel');
  const btnPlay = el('btnPlay');
  const btnShuffle = el('btnShuffle');
  const btnRepeat = el('btnRepeat');
  const btnEQ = el('btnEQ');
  const btnPL = el('btnPL');
  const vizCanvas = el('viz');
  const vizCtx = vizCanvas.getContext('2d');

  // ---------- Title bar ----------
  el('btnMin').addEventListener('click', () => window.retro.minimize());
  el('btnClose').addEventListener('click', () => window.retro.close());
  el('btnPin').addEventListener('click', async () => {
    const on = await window.retro.toggleAlwaysOnTop();
    el('btnPin').classList.toggle('on', on);
  });

  // ---------- Web Audio graph: source -> preamp -> EQ bands -> panner -> analyser -> destination ----------
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const sourceNode = audioCtx.createMediaElementSource(audio);
  const preampGain = audioCtx.createGain();
  const panner = audioCtx.createStereoPanner();
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 128;

  const eqFreqs = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
  const eqFilters = eqFreqs.map((freq) => {
    const f = audioCtx.createBiquadFilter();
    f.type = 'peaking';
    f.frequency.value = freq;
    f.Q.value = 1.4;
    f.gain.value = 0;
    return f;
  });

  function dbToGain(db) { return Math.pow(10, db / 20); }

  // wire the chain
  let node = sourceNode;
  node.connect(preampGain);
  node = preampGain;
  for (const f of eqFilters) { node.connect(f); node = f; }
  node.connect(panner);
  panner.connect(analyser);
  analyser.connect(audioCtx.destination);

  function resumeAudioCtx() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }

  // ---------- Formatting ----------
  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function baseName(p) {
    const parts = p.split(/[\\/]/);
    return parts[parts.length - 1];
  }

  // ---------- Playlist rendering ----------
  function renderPlaylist() {
    plList.innerHTML = '';
    playlist.forEach((track, i) => {
      const li = document.createElement('li');
      if (i === currentIndex) li.classList.add('playing');
      if (i === selectedIndex) li.classList.add('selected');
      li.innerHTML = `<span class="idx">${i + 1}.</span><span class="name">${track.name}</span><span class="rm">✕</span>`;
      li.addEventListener('click', () => { selectedIndex = i; renderPlaylist(); });
      li.addEventListener('dblclick', () => loadAndPlay(i));
      li.querySelector('.rm').addEventListener('click', (ev) => {
        ev.stopPropagation();
        removeTrack(i);
      });
      plList.appendChild(li);
    });
  }

  function removeTrack(i) {
    playlist.splice(i, 1);
    if (i === currentIndex) {
      stop();
      currentIndex = -1;
    } else if (i < currentIndex) {
      currentIndex--;
    }
    if (i === selectedIndex) selectedIndex = -1;
    else if (i < selectedIndex) selectedIndex--;
    renderPlaylist();
  }

  function addFiles(paths) {
    let added = false;
    for (const p of paths) {
      if (!p) continue;
      playlist.push({ source: 'local', path: p, name: baseName(p) });
      added = true;
    }
    if (added) renderPlaylist();
    if (currentIndex === -1 && playlist.length > 0) {
      loadAndPlay(0);
    }
  }

  function addDriveFiles(files) {
    let added = false;
    for (const f of files) {
      playlist.push({ source: 'drive', fileId: f.id, name: f.name });
      added = true;
    }
    if (added) renderPlaylist();
    if (currentIndex === -1 && playlist.length > 0) {
      loadAndPlay(0);
    }
  }

  const MIME_BY_EXT = {
    mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac',
    ogg: 'audio/ogg', flac: 'audio/flac',
  };
  function guessMime(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    return MIME_BY_EXT[ext] || 'audio/mpeg';
  }

  let currentBlobUrl = null;
  function revokeCurrentBlobUrl() {
    if (currentBlobUrl) { URL.revokeObjectURL(currentBlobUrl); currentBlobUrl = null; }
  }

  // ---------- Playback ----------
  let loadToken = 0;
  async function loadAndPlay(index) {
    if (index < 0 || index >= playlist.length) return;
    currentIndex = index;
    const token = ++loadToken;
    const track = playlist[index];
    trackName.textContent = track.source === 'drive' ? `${track.name} (loading…)` : track.name;
    checkMarquee();
    renderPlaylist();

    if (track.source === 'drive') {
      try {
        const base64 = await window.retro.googleGetTrack(track.fileId);
        if (token !== loadToken) return; // a newer load superseded this one
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        revokeCurrentBlobUrl();
        currentBlobUrl = URL.createObjectURL(new Blob([bytes], { type: guessMime(track.name) }));
        audio.src = currentBlobUrl;
      } catch (err) {
        trackName.textContent = `${track.name} (failed to load)`;
        console.error(err);
        return;
      }
    } else {
      revokeCurrentBlobUrl();
      audio.src = 'file://' + encodeURI(track.path).replace(/#/g, '%23');
    }

    if (token !== loadToken) return;
    trackName.textContent = track.name;
    checkMarquee();
    resumeAudioCtx();
    audio.play().catch(() => {});
    probeMeta(track.name);
  }

  function checkMarquee() {
    trackName.classList.remove('scrolling');
    requestAnimationFrame(() => {
      if (trackName.scrollWidth > trackScroll.clientWidth) {
        trackName.classList.add('scrolling');
      }
    });
  }

  function probeMeta(path) {
    const ext = (path.split('.').pop() || '').toLowerCase();
    kbps.textContent = '--- kbps';
    khz.textContent = '-- kHz';
    audio.addEventListener('loadedmetadata', function onMeta() {
      audio.removeEventListener('loadedmetadata', onMeta);
    }, { once: true });
  }

  function play() {
    if (currentIndex === -1 && playlist.length > 0) { loadAndPlay(0); return; }
    resumeAudioCtx();
    audio.play().catch(() => {});
  }
  function pause() { audio.pause(); }
  function stop() { audio.pause(); audio.currentTime = 0; }
  function next() {
    if (playlist.length === 0) return;
    let i;
    if (shuffleOn) {
      i = Math.floor(Math.random() * playlist.length);
    } else {
      i = currentIndex + 1;
      if (i >= playlist.length) { i = repeatOn ? 0 : -1; }
    }
    if (i === -1) { stop(); return; }
    loadAndPlay(i);
  }
  function prev() {
    if (playlist.length === 0) return;
    let i = currentIndex - 1;
    if (i < 0) i = repeatOn ? playlist.length - 1 : 0;
    loadAndPlay(i);
  }

  audio.addEventListener('ended', () => next());
  audio.addEventListener('play', () => { btnPlay.classList.add('active'); el('pwrDot').style.background = '#39ff6a'; });
  audio.addEventListener('pause', () => { btnPlay.classList.remove('active'); });

  el('btnPlay').addEventListener('click', play);
  el('btnPause').addEventListener('click', pause);
  el('btnStop').addEventListener('click', stop);
  el('btnNext').addEventListener('click', next);
  el('btnPrev').addEventListener('click', prev);
  el('btnOpen').addEventListener('click', async () => {
    const paths = await window.retro.openFileDialog();
    addFiles(paths);
  });
  el('btnAdd').addEventListener('click', async () => {
    const paths = await window.retro.openFileDialog();
    addFiles(paths);
  });
  el('btnClear').addEventListener('click', () => {
    playlist.length = 0;
    currentIndex = -1;
    selectedIndex = -1;
    stop();
    renderPlaylist();
  });
  el('btnRem').addEventListener('click', () => {
    if (selectedIndex !== -1) removeTrack(selectedIndex);
  });

  // ---------- Google Drive ----------
  const gdriveStatus = el('gdriveStatus');
  const btnGdriveConnect = el('btnGdriveConnect');
  const gdriveFolderRow = el('gdriveFolderRow');
  const gdriveFolderInput = el('gdriveFolderInput');

  async function refreshGdriveStatus() {
    const s = await window.retro.googleStatus();
    if (!s.configured) {
      gdriveStatus.textContent = 'Google Drive: not set up yet (click Setup)';
      gdriveStatus.classList.remove('connected');
      btnGdriveConnect.textContent = 'Connect';
      gdriveFolderRow.classList.add('hidden');
    } else if (!s.connected) {
      gdriveStatus.textContent = 'Google Drive: not connected';
      gdriveStatus.classList.remove('connected');
      btnGdriveConnect.textContent = 'Connect';
      gdriveFolderRow.classList.add('hidden');
    } else {
      gdriveStatus.textContent = 'Google Drive: connected';
      gdriveStatus.classList.add('connected');
      btnGdriveConnect.textContent = 'Disconnect';
      gdriveFolderRow.classList.remove('hidden');
    }
    return s;
  }
  refreshGdriveStatus();

  btnGdriveConnect.addEventListener('click', async () => {
    const s = await window.retro.googleStatus();
    if (s.connected) {
      await window.retro.googleDisconnect();
    } else {
      btnGdriveConnect.disabled = true;
      gdriveStatus.textContent = 'Google Drive: sign in from the browser tab that just opened…';
      try {
        await window.retro.googleConnect();
      } catch (err) {
        gdriveStatus.textContent = `Google Drive: ${err.message || 'connection failed'}`;
        btnGdriveConnect.disabled = false;
        return;
      }
      btnGdriveConnect.disabled = false;
    }
    refreshGdriveStatus();
  });

  el('btnGdriveConfig').addEventListener('click', () => window.retro.googleOpenConfig());

  el('btnGdriveLoad').addEventListener('click', async () => {
    const input = gdriveFolderInput.value.trim();
    if (!input) return;
    const btnLoad = el('btnGdriveLoad');
    btnLoad.disabled = true;
    btnLoad.textContent = 'Loading…';
    try {
      const files = await window.retro.googleListFolder(input);
      addDriveFiles(files);
    } catch (err) {
      gdriveStatus.textContent = `Google Drive: ${err.message || 'load failed'}`;
    }
    btnLoad.disabled = false;
    btnLoad.textContent = 'Load';
  });

  btnShuffle.addEventListener('click', () => {
    shuffleOn = !shuffleOn;
    btnShuffle.classList.toggle('on', shuffleOn);
  });
  btnRepeat.addEventListener('click', () => {
    repeatOn = !repeatOn;
    btnRepeat.classList.toggle('on', repeatOn);
  });
  btnEQ.addEventListener('click', () => {
    const willShow = eqPanel.classList.contains('hidden');
    eqPanel.classList.toggle('hidden', !willShow);
    btnEQ.classList.toggle('on', willShow);
  });
  btnPL.addEventListener('click', () => {
    const willShow = plPanel.classList.contains('hidden');
    plPanel.classList.toggle('hidden', !willShow);
    btnPL.classList.toggle('on', willShow);
  });

  // ---------- Seek ----------
  seek.addEventListener('input', () => { seeking = true; });
  seek.addEventListener('change', () => {
    if (audio.duration) audio.currentTime = (seek.value / 1000) * audio.duration;
    seeking = false;
  });
  timeDisplay.addEventListener('click', () => { showRemaining = !showRemaining; });

  audio.addEventListener('timeupdate', () => {
    if (!seeking && audio.duration) {
      seek.value = Math.floor((audio.currentTime / audio.duration) * 1000);
    }
    const shown = showRemaining && audio.duration
      ? -(audio.duration - audio.currentTime)
      : audio.currentTime;
    const sign = shown < 0 ? '-' : '';
    timeDisplay.textContent = sign + fmtTime(Math.abs(shown));
  });

  // ---------- Volume / balance ----------
  volume.addEventListener('input', () => { audio.volume = volume.value / 100; });
  audio.volume = volume.value / 100;
  balance.addEventListener('input', () => { panner.pan.value = balance.value / 100; });

  // ---------- Equalizer ----------
  const preampSlider = el('preamp');
  const bandSliders = Array.from(document.querySelectorAll('.eqBandSlider'));

  function applyEqFromSliders() {
    if (!eqEnabled) return;
    preampGain.gain.value = dbToGain(parseFloat(preampSlider.value));
    bandSliders.forEach((s, i) => { eqFilters[i].gain.value = parseFloat(s.value); });
  }
  function bypassEq() {
    preampGain.gain.value = 1;
    eqFilters.forEach((f) => { f.gain.value = 0; });
  }

  preampSlider.addEventListener('input', applyEqFromSliders);
  bandSliders.forEach((sliderEl) => sliderEl.addEventListener('input', applyEqFromSliders));

  const eqOnToggle = el('eqOnToggle');
  const eqAutoToggle = el('eqAutoToggle');
  eqOnToggle.classList.add('on');
  eqOnToggle.addEventListener('click', () => {
    eqEnabled = !eqEnabled;
    eqOnToggle.classList.toggle('on', eqEnabled);
    if (eqEnabled) applyEqFromSliders(); else bypassEq();
  });
  eqAutoToggle.addEventListener('click', () => {
    eqAutoToggle.classList.toggle('on');
  });

  const eqPresets = {
    flat:      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    rock:      [4, 4, 3, 1, -1, -1, 0, 2, 3, 3, 3],
    pop:       [2, -1, -2, -1, 1, 3, 4, 4, 3, 2, 2],
    bass:      [6, 8, 7, 5, 2, 0, -1, -1, -1, -1, -1],
    treble:    [-3, -3, -2, -1, 0, 1, 3, 5, 6, 7, 7],
    classical: [0, 3, 3, 3, 2, 0, -2, -2, -2, -3, -4],
    dance:     [5, 6, 3, 0, 0, -2, -3, -3, 0, 2, 2],
  };
  el('eqPresets').addEventListener('change', (e) => {
    const vals = eqPresets[e.target.value] || eqPresets.flat;
    preampSlider.value = vals[0];
    bandSliders.forEach((s, i) => { s.value = vals[i + 1]; });
    applyEqFromSliders();
  });

  // ---------- Visualizer ----------
  const freqData = new Uint8Array(analyser.frequencyBinCount);
  function drawViz() {
    requestAnimationFrame(drawViz);
    analyser.getByteFrequencyData(freqData);
    const w = vizCanvas.width, h = vizCanvas.height;
    vizCtx.clearRect(0, 0, w, h);
    vizCtx.fillStyle = '#04140a';
    vizCtx.fillRect(0, 0, w, h);
    const bars = 19;
    const barW = Math.floor(w / bars);
    for (let i = 0; i < bars; i++) {
      const v = freqData[i * 2] || 0;
      const barH = Math.max(1, Math.floor((v / 255) * h));
      const x = i * barW + 1;
      const grad = vizCtx.createLinearGradient(0, h, 0, h - barH);
      grad.addColorStop(0, '#1f7a3a');
      grad.addColorStop(0.6, '#39ff6a');
      grad.addColorStop(1, '#c8ffb0');
      vizCtx.fillStyle = grad;
      vizCtx.fillRect(x, h - barH, barW - 1, barH);
    }
  }
  drawViz();

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
