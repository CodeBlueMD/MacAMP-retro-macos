(() => {
  'use strict';

  // ---------- State ----------
  const playlist = []; // { path, name }
  let currentIndex = -1;
  let shuffleOn = false;
  let repeatOn = false;
  let seeking = false;
  let showRemaining = false;

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
      li.innerHTML = `<span class="idx">${i + 1}.</span><span class="name">${track.name}</span><span class="rm">✕</span>`;
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
    renderPlaylist();
  }

  function addFiles(paths) {
    let added = false;
    for (const p of paths) {
      if (!p) continue;
      playlist.push({ path: p, name: baseName(p) });
      added = true;
    }
    if (added) renderPlaylist();
    if (currentIndex === -1 && playlist.length > 0) {
      loadAndPlay(0);
    }
  }

  // ---------- Playback ----------
  function loadAndPlay(index) {
    if (index < 0 || index >= playlist.length) return;
    currentIndex = index;
    const track = playlist[index];
    audio.src = 'file://' + encodeURI(track.path).replace(/#/g, '%23');
    trackName.textContent = track.name;
    checkMarquee();
    resumeAudioCtx();
    audio.play().catch(() => {});
    renderPlaylist();
    probeMeta(track.path);
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
    stop();
    renderPlaylist();
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
  el('preamp').addEventListener('input', (e) => {
    preampGain.gain.value = dbToGain(parseFloat(e.target.value));
  });
  document.querySelectorAll('.eqBandSlider').forEach((sliderEl, i) => {
    sliderEl.addEventListener('input', () => {
      eqFilters[i].gain.value = parseFloat(sliderEl.value);
    });
  });
  el('btnEqReset').addEventListener('click', () => {
    el('preamp').value = 0;
    preampGain.gain.value = 1;
    document.querySelectorAll('.eqBandSlider').forEach((s, i) => {
      s.value = 0;
      eqFilters[i].gain.value = 0;
    });
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
