/**
 * Visit Scribe (Stream C) — voice-first visit room (Ask Expert–style).
 * CareLoop steps 7–8. Grok STT + doctor/patient diarization.
 */

const Scribe = {
  encounter: null,
  orders: null,
  mediaRecorder: null,
  recordChunks: [],
  recording: false,
  recordStream: null,
  audioCtx: null,
  analyser: null,
  rafId: null,
  particles: [],
  voiceLevel: 0,

  init() {
    const loadBtn = document.getElementById('btn-load-fixture');
    const draftBtn = document.getElementById('btn-draft-soap');
    const approveBtn = document.getElementById('btn-approve-encounter');
    const transcribeBtn = document.getElementById('btn-transcribe-audio');
    const recordBtn = document.getElementById('btn-record-visit');
    const pickAudio = document.getElementById('btn-pick-audio');
    const audioInput = document.getElementById('scribe-audio');

    if (!loadBtn) return;

    loadBtn.addEventListener('click', () => this.loadFixture());
    draftBtn.addEventListener('click', () => this.draftSoap());
    approveBtn.addEventListener('click', () => this.approveEncounter());
    if (transcribeBtn) {
      transcribeBtn.addEventListener('click', () => this.transcribeUpload());
    }
    if (recordBtn) {
      recordBtn.addEventListener('click', () => this.toggleRecord());
    }
    if (pickAudio && audioInput) {
      pickAudio.addEventListener('click', () => audioInput.click());
      audioInput.addEventListener('change', () => {
        if (audioInput.files && audioInput.files[0]) {
          this.setRecordStatus(`Selected: ${App.escapeHTML(audioInput.files[0].name)} — tap Transcribe upload.`);
        }
      });
    }

    this.initParticles();
    this.setVoiceState('idle');
    window.addEventListener('resize', () => this.resizeParticles());
  },

  onShow() {
    // Step 7 was often hidden at init — canvas had 0 size. Rebuild when visible.
    requestAnimationFrame(() => {
      this.resizeParticles();
      if (!this.particles || !this.particles.length) this.initParticles();
      this.drawParticles(this.voiceMetrics || { bass: 0, mid: 0, treble: 0, pitch: 0, level: 0 });
      if (!this.recording) this.startIdleViz();
    });
  },

  applyMicMotion(metrics) {
    const btn = document.getElementById('btn-record-visit');
    const wrap = document.querySelector('.voice-viz-wrap');
    if (!btn) return;
    const bass = metrics.bass || 0;
    const mid = metrics.mid || 0;
    const level = metrics.level || 0;
    const pitch = metrics.pitch || 0;
    if (!this.recording) {
      btn.style.transform = '';
      if (wrap) wrap.style.setProperty('--voice-bounce', '0px');
      return;
    }
    // Obvious bounce: bass pulls up hard, level scales the mic
    const y = -(12 + bass * 48 + level * 22);
    const scale = 1 + level * 0.4 + bass * 0.25;
    btn.style.transform = `translateY(${y.toFixed(1)}px) scale(${scale.toFixed(3)})`;
    if (wrap) {
      wrap.style.setProperty('--voice-bounce', `${(-(bass * 36 + mid * 14)).toFixed(1)}px`);
      wrap.style.setProperty('--voice-glow', String(0.4 + level * 0.6 + bass * 0.4));
      wrap.style.setProperty('--voice-pitch', String(pitch));
    }
  },

  setRecordStatus(text) {
    const el = document.getElementById('scribe-record-status');
    if (el) el.innerHTML = text;
  },

  setSttBusy(busy) {
    const banner = document.getElementById('scribe-stt-loading');
    if (banner) banner.hidden = !busy;
    const loading = document.getElementById('scribe-loading');
    if (loading) loading.classList.toggle('visible', !!busy);
    if (busy) this.setVoiceState('transcribing');
  },

  setVoiceState(state) {
    const panel = document.getElementById('voice-panel');
    if (panel) panel.dataset.state = state;

    const cta = document.getElementById('voice-cta');
    const prompt = document.getElementById('voice-prompt');
    const journey = document.getElementById('voice-journey-label');
    const micIcon = document.getElementById('voice-mic-icon');
    const pauseIcon = document.getElementById('voice-pause-icon');
    const btn = document.getElementById('btn-record-visit');

    if (state === 'listening') {
      if (cta) cta.textContent = 'Listening… tap to stop';
      if (prompt) prompt.textContent = 'Keep talking — doctor and patient';
      if (journey) journey.textContent = 'RECORDING VISIT';
      if (micIcon) micIcon.hidden = true;
      if (pauseIcon) pauseIcon.hidden = false;
      if (btn) {
        btn.classList.add('is-listening');
        btn.setAttribute('aria-label', 'Stop and transcribe');
      }
    } else if (state === 'transcribing') {
      if (cta) cta.textContent = 'Transcribing with Grok…';
      if (prompt) prompt.textContent = 'Splitting Doctor / Patient voices';
      if (journey) journey.textContent = 'ALMOST DONE';
      if (micIcon) micIcon.hidden = false;
      if (pauseIcon) pauseIcon.hidden = true;
      if (btn) btn.classList.remove('is-listening');
    } else {
      if (cta) cta.textContent = 'Tap to speak';
      if (prompt) prompt.textContent = 'What’s being said in the visit?';
      if (journey) journey.textContent = 'KEEP NEAR DOCTOR & PATIENT';
      if (micIcon) micIcon.hidden = false;
      if (pauseIcon) pauseIcon.hidden = true;
      if (btn) {
        btn.classList.remove('is-listening');
        btn.setAttribute('aria-label', 'Tap to speak');
      }
    }
  },

  initParticles() {
    const canvas = document.getElementById('voice-particles');
    if (!canvas) return;
    this.resizeParticles();
    this.voiceMetrics = { bass: 0, mid: 0, treble: 0, pitch: 0, level: 0 };
    const count = 220;
    this.particles = [];
    for (let i = 0; i < count; i++) {
      // Spherical cloud in 3D (x,y,z) — projected to 2D each frame
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const radius = 38 + Math.random() * 72;
      this.particles.push({
        x: radius * Math.sin(phi) * Math.cos(theta),
        y: radius * Math.sin(phi) * Math.sin(theta) * 0.85,
        z: radius * Math.cos(phi),
        baseR: radius,
        size: 1.1 + Math.random() * 2.4,
        phase: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.018,
        band: i % 3, // 0 bass, 1 mid, 2 treble — which frequency drives jump
        hueBias: Math.random(),
      });
    }
    this.drawParticles(this.voiceMetrics);
  },

  resizeParticles() {
    const canvas = document.getElementById('voice-particles');
    if (!canvas) return;
    const wrap = canvas.parentElement;
    const w = Math.min(640, wrap ? wrap.clientWidth : 640);
    const h = Math.round(w * 0.55);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    this._dpr = dpr;
  },

  analyzeVoice() {
    const m = { bass: 0, mid: 0, treble: 0, pitch: 0, level: 0 };
    if (!this.analyser) return m;

    const freq = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(freq);

    // Approximate Hz bins: sampleRate/fftSize
    const sr = (this.audioCtx && this.audioCtx.sampleRate) || 44100;
    const binHz = sr / this.analyser.fftSize;
    let bassSum = 0; let bassN = 0;
    let midSum = 0; let midN = 0;
    let trebleSum = 0; let trebleN = 0;
    let weightedPitch = 0;
    let pitchWeight = 0;
    let energy = 0;

    for (let i = 1; i < freq.length; i++) {
      const hz = i * binHz;
      const v = freq[i] / 255;
      energy += v * v;
      if (hz < 180) { bassSum += v; bassN++; }
      else if (hz < 1400) {
        midSum += v; midN++;
        weightedPitch += hz * v;
        pitchWeight += v;
      } else if (hz < 6000) { trebleSum += v; trebleN++; }
    }

    m.bass = bassN ? Math.min(1, (bassSum / bassN) * 2.4) : 0;
    m.mid = midN ? Math.min(1, (midSum / midN) * 2.2) : 0;
    m.treble = trebleN ? Math.min(1, (trebleSum / trebleN) * 2.4) : 0;
    m.level = Math.min(1, Math.sqrt(energy / freq.length) * 4.2);
    // Normalize pitch ~80–600Hz speech into 0–1
    const hz = pitchWeight > 0.02 ? weightedPitch / pitchWeight : 180;
    m.pitch = Math.min(1, Math.max(0, (hz - 80) / 520));
    return m;
  },

  drawParticles(metrics) {
    const canvas = document.getElementById('voice-particles');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = this._dpr || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    if (w < 40 || h < 40) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2 + 6;
    const t = performance.now() / 1000;
    const listening = this.recording;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const bass = metrics.bass || 0;
    const mid = metrics.mid || 0;
    const treble = metrics.treble || 0;
    const pitch = metrics.pitch || 0;
    const level = metrics.level || 0;

    this.applyMicMotion(metrics);

    const breathe = listening ? 1 : 0.58;
    const jump = listening ? (bass * 70 + mid * 28 + level * 18) : Math.sin(t * 1.5) * 3;
    const stretch = listening ? (1 + treble * 0.45 + pitch * 0.28) : 1;
    const fov = 280;

    const glowR = (100 + bass * 95 + level * 55) * breathe;
    const grd = ctx.createRadialGradient(cx, cy - jump * 0.35, 6, cx, cy - jump * 0.2, glowR * 1.4);
    const warm = Math.floor(70 + pitch * 60);
    grd.addColorStop(0, `rgba(255, ${warm}, 48, ${listening ? 0.5 : 0.18})`);
    grd.addColorStop(0.4, `rgba(255, ${100 + Math.floor(treble * 50)}, 80, ${listening ? 0.2 : 0.08})`);
    grd.addColorStop(1, 'rgba(255, 170, 130, 0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.ellipse(cx, cy - jump * 0.35, glowR * 1.2 * stretch, glowR * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();

    if (listening) {
      for (let i = 0; i < 3; i++) {
        const pulse = (t * 1.8 + i * 0.55) % 1;
        const rr = 34 + pulse * (50 + bass * 70 + level * 40);
        ctx.beginPath();
        ctx.strokeStyle = `rgba(255, 90, 55, ${(1 - pulse) * (0.45 + level * 0.4)})`;
        ctx.lineWidth = 2 + bass * 3;
        ctx.ellipse(cx, cy - jump * 0.15, rr * stretch, rr * 0.62, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    const projected = [];
    for (const p of this.particles) {
      if (!reduceMotion) {
        const speed = listening ? 2.4 : 0.7;
        const c = Math.cos(p.spin * speed);
        const s = Math.sin(p.spin * speed);
        const nx = p.x * c - p.z * s;
        const nz = p.x * s + p.z * c;
        p.x = nx;
        p.z = nz;
      }

      const bandEnergy = p.band === 0 ? bass : (p.band === 1 ? mid : treble);
      const idleFloat = Math.sin(t * 1.6 + p.phase) * 5;
      const voiceJump = listening
        ? (-bandEnergy * (48 + p.size * 10) - bass * 22 - level * 10)
        : idleFloat * 0.5;
      const y3 = p.y * stretch + voiceJump - pitch * 14 - jump * 0.15;

      const z = p.z + 160;
      const scale = fov / Math.max(40, z);
      const x2 = cx + p.x * scale * (1 + mid * 0.12);
      const y2 = cy + y3 * scale;
      const size = p.size * scale * (listening ? 1.1 + bandEnergy * 2.2 + level * 0.6 : 0.95);
      const depthAlpha = Math.min(1, Math.max(0.12, (220 - p.z) / 260));
      projected.push({ x2, y2, size, depthAlpha, bandEnergy, z });
    }

    projected.sort((a, b) => b.z - a.z);

    for (const d of projected) {
      const alpha = (listening ? 0.32 + d.bandEnergy * 0.6 : 0.2) * d.depthAlpha;
      const g = Math.floor(85 + pitch * 55 + d.bandEnergy * 50);
      const bcol = Math.floor(40 + treble * 55);
      ctx.beginPath();
      ctx.fillStyle = `rgba(255, ${g}, ${bcol}, ${alpha})`;
      ctx.arc(d.x2, d.y2, Math.max(0.7, d.size), 0, Math.PI * 2);
      ctx.fill();
      if (d.z < 50 && listening && d.bandEnergy > 0.15) {
        ctx.beginPath();
        ctx.fillStyle = `rgba(255, 245, 230, ${0.3 + d.bandEnergy * 0.45})`;
        ctx.arc(d.x2 - d.size * 0.2, d.y2 - d.size * 0.2, d.size * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.beginPath();
    ctx.fillStyle = `rgba(255, 90, 55, ${listening ? 0.1 + bass * 0.14 : 0.05})`;
    ctx.ellipse(cx, cy + 82 - jump * 0.05, 72 + bass * 55 + level * 20, 14 + bass * 8, 0, 0, Math.PI * 2);
    ctx.fill();
  },

  startIdleViz() {
    if (this.recording) return;
    const tick = () => {
      if (this.recording) return;
      this.drawParticles(this.voiceMetrics || { bass: 0, mid: 0, treble: 0, pitch: 0, level: 0 });
      this.rafId = requestAnimationFrame(tick);
    };
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = requestAnimationFrame(tick);
  },

  startVizLoop() {
    const smooth = { bass: 0, mid: 0, treble: 0, pitch: 0, level: 0 };
    const tick = () => {
      if (!this.recording) return;
      const raw = this.analyzeVoice();
      const attack = 0.55;
      const release = 0.16;
      for (const k of Object.keys(smooth)) {
        const target = raw[k] || 0;
        const a = target > smooth[k] ? attack : release;
        smooth[k] = smooth[k] + (target - smooth[k]) * a;
      }
      this.voiceMetrics = { ...smooth };
      this.voiceLevel = smooth.level;
      this.drawParticles(smooth);
      this.rafId = requestAnimationFrame(tick);
    };
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = requestAnimationFrame(tick);
  },

  stopVizLoop() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.voiceLevel = 0;
    this.voiceMetrics = { bass: 0, mid: 0, treble: 0, pitch: 0, level: 0 };
    this.startIdleViz();
  },

  async loadFixture() {
    try {
      const fixture = await API.getScribeFixture();
      document.getElementById('scribe-transcript').value = fixture.transcript || '';
      document.getElementById('scribe-meta').textContent =
        `${fixture.patient_name || 'Patient'} · ${fixture.visit_date || ''} · ${fixture.clinician || ''}`;
      this.setVoiceState('idle');
      App.notify('Mock visit transcript loaded.', 'success');
    } catch (err) {
      App.notify(err.message, 'error');
    }
  },

  async toggleRecord() {
    if (this.recording) {
      this.stopRecording();
      return;
    }
    await this.startRecording();
  },

  pickMimeType() {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
    ];
    for (const t of candidates) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return t;
    }
    return '';
  },

  async startRecording() {
    if (!window.isSecureContext) {
      App.notify('Mic needs http://localhost (or HTTPS).', 'error');
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      App.notify('Mic not available. Use Chrome/Edge, or upload audio.', 'error');
      return;
    }
    if (!window.MediaRecorder) {
      App.notify('This browser cannot record audio. Upload a file instead.', 'error');
      return;
    }

    try {
      this.recordStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      });
    } catch (err) {
      const name = err && err.name;
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        App.notify('Allow microphone access, then tap to speak again.', 'error');
        this.setRecordStatus('Mic blocked — allow Microphone in the address bar.');
      } else if (name === 'NotFoundError') {
        App.notify('No microphone found.', 'error');
      } else {
        App.notify(err.message || 'Could not access microphone.', 'error');
      }
      return;
    }

    try {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }
      const source = this.audioCtx.createMediaStreamSource(this.recordStream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.5;
      this.analyser.minDecibels = -90;
      this.analyser.maxDecibels = -20;
      source.connect(this.analyser);

      this.recordChunks = [];
      const mime = this.pickMimeType();
      this.mediaRecorder = mime
        ? new MediaRecorder(this.recordStream, { mimeType: mime })
        : new MediaRecorder(this.recordStream);

      this.mediaRecorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) this.recordChunks.push(ev.data);
      };

      this.mediaRecorder.onerror = () => {
        App.notify('Recording error. Try again.', 'error');
        this.resetRecordUi();
      };

      this.mediaRecorder.onstop = async () => {
        this.stopVizLoop();
        if (this.audioCtx) {
          try { await this.audioCtx.close(); } catch (_) { /* ignore */ }
          this.audioCtx = null;
          this.analyser = null;
        }
        const mimeType = (this.mediaRecorder && this.mediaRecorder.mimeType) || mime || 'audio/webm';
        const ext = mimeType.includes('mp4') ? 'm4a' : (mimeType.includes('ogg') ? 'ogg' : 'webm');
        if (this.recordStream) {
          this.recordStream.getTracks().forEach((t) => t.stop());
          this.recordStream = null;
        }
        const blob = new Blob(this.recordChunks, { type: mimeType });
        this.recordChunks = [];
        if (!blob.size) {
          this.resetRecordUi();
          App.notify('Recording was empty — speak for a few seconds.', 'error');
          this.setRecordStatus('No audio captured. Tap to speak again.');
          return;
        }
        const file = new File([blob], `visit-recording.${ext}`, { type: mimeType });
        await this.sendAudioForTranscription(file, 'Live visit');
      };

      this.mediaRecorder.start(250);
      this.recording = true;
      this.setVoiceState('listening');
      this.startVizLoop();
      this.setRecordStatus('Listening… keep both voices near the mic, then tap pause to transcribe.');
      App.notify('Listening — tap the pause button when done.', 'success');
    } catch (err) {
      if (this.recordStream) {
        this.recordStream.getTracks().forEach((t) => t.stop());
        this.recordStream = null;
      }
      App.notify(err.message || 'Could not start recorder.', 'error');
      this.resetRecordUi();
    }
  },

  stopRecording() {
    if (!this.mediaRecorder || !this.recording) return;
    this.recording = false;
    this.setRecordStatus('Stopping… sending to Grok…');
    this.setVoiceState('transcribing');
    try {
      if (this.mediaRecorder.state !== 'inactive') this.mediaRecorder.stop();
    } catch (err) {
      App.notify(err.message || 'Failed to stop recording.', 'error');
      this.resetRecordUi();
    }
  },

  resetRecordUi() {
    this.recording = false;
    this.stopVizLoop();
    this.setVoiceState('idle');
    this.setSttBusy(false);
    this.applyMicMotion({ bass: 0, mid: 0, treble: 0, pitch: 0, level: 0 });
  },

  async transcribeUpload() {
    const input = document.getElementById('scribe-audio');
    const file = input && input.files && input.files[0];
    if (!file) {
      App.notify('Choose an audio file first, or tap to speak.', 'error');
      return;
    }
    await this.sendAudioForTranscription(file, 'Upload');
  },

  async sendAudioForTranscription(file, label) {
    this.setSttBusy(true);
    this.setRecordStatus(`${label}: Grok is transcribing & splitting voices…`);
    try {
      const result = await API.transcribeScribeAudio(file);
      const box = document.getElementById('scribe-transcript');
      box.value = result.text || '';
      box.focus();

      const n = result.speaker_count || 0;
      const roles = (result.speakers || [])
        .map((s) => s.label || s.role)
        .filter(Boolean)
        .join(' + ');
      document.getElementById('scribe-meta').textContent = result.diarized
        ? `Grok · ${n} voices → ${roles || 'Doctor / Patient'}`
        : `Grok · ${n || 1} voice — record doctor + patient for labels`;

      if (result.diarized) {
        this.setRecordStatus(
          `<strong>Ready</strong> — ${App.escapeHTML(roles)}. Review DOCTOR / PATIENT lines, then Draft SOAP.`
        );
        App.notify(`Split ${n} speakers (${roles}).`, 'success');
      } else {
        const warn = (result.warnings && result.warnings[0]) || 'One voice detected.';
        this.setRecordStatus(App.escapeHTML(warn));
        App.notify('Transcribed. For Doctor/Patient labels, record both voices.', 'success');
      }
    } catch (err) {
      this.setRecordStatus('Transcription failed — try again or Load mock visit.');
      App.notify(err.message, 'error');
    } finally {
      this.setSttBusy(false);
      this.setVoiceState('idle');
    }
  },

  async draftSoap() {
    const transcript = document.getElementById('scribe-transcript').value.trim();
    const useSeeded = document.getElementById('scribe-use-seeded').checked;
    const loading = document.getElementById('scribe-loading');
    const approveBtn = document.getElementById('btn-approve-encounter');

    if (!transcript) {
      App.notify('Tap to speak, upload audio, or load mock visit first.', 'error');
      return;
    }

    if (window.CareLoop && typeof CareLoop.showStep === 'function') {
      CareLoop.showStep(8);
    }

    loading.classList.add('visible');
    approveBtn.style.display = 'none';
    this.orders = null;
    document.getElementById('scribe-orders').innerHTML = '';

    try {
      const result = await API.draftScribe({ transcript, use_seeded: useSeeded });
      this.encounter = result.encounter;
      this.renderEncounter(this.encounter);
      approveBtn.style.display = 'inline-flex';
      App.notify(
        useSeeded
          ? 'Seeded SOAP/Plan drafted — clinician review required.'
          : 'LLM SOAP/Plan drafted — clinician review required.',
        'success'
      );
    } catch (err) {
      App.notify(err.message, 'error');
    } finally {
      loading.classList.remove('visible');
    }
  },

  async approveEncounter() {
    if (!this.encounter) {
      App.notify('Draft a SOAP/Plan first.', 'error');
      return;
    }

    const ok = window.confirm(
      "Confirm you have reviewed this SOAP and Plan. Approving will create Orders from the Plan. The model does not auto-finalize therapy."
    );
    if (!ok) return;

    try {
      const result = await API.approveScribe(this.encounter);
      this.encounter = result.encounter;
      this.orders = result.orders;
      this.renderEncounter(this.encounter);
      this.renderOrders(this.orders);
      document.getElementById('btn-approve-encounter').style.display = 'none';
      App.notify(`Encounter reviewed. ${result.orders.length} order(s) created.`, 'success');
    } catch (err) {
      App.notify(err.message, 'error');
    }
  },

  renderEncounter(enc) {
    const el = document.getElementById('scribe-soap');
    if (!enc) {
      el.innerHTML = '<p class="empty-hint">No draft yet.</p>';
      return;
    }

    const soap = enc.soap || {};
    const plan = enc.plan || [];
    const badge = enc.clinician_reviewed
      ? '<span class="card-badge" style="background:rgba(34,197,94,0.15);color:var(--success)">Reviewed</span>'
      : '<span class="card-badge">Draft — needs review</span>';

    const warnings = (enc.warnings || [])
      .map((w) => `<div class="warning-banner">${App.escapeHTML(w)}</div>`)
      .join('');

    el.innerHTML = `
      <div class="card-header" style="padding:0 0 var(--space-md);border:none;">
        <div class="card-title">
          <div class="card-title-icon cyan">📝</div>
          <h2>SOAP + Plan</h2>
        </div>
        ${badge}
      </div>
      ${warnings}
      <p class="empty-hint" style="margin-bottom:var(--space-md)">
        ${App.escapeHTML(enc.patient_name || '')} · source: ${App.escapeHTML(enc.source || '')} · status: ${App.escapeHTML(enc.status || '')}
      </p>
      <div class="soap-block"><h3>S — Subjective</h3><p>${App.escapeHTML(soap.subjective || '')}</p></div>
      <div class="soap-block"><h3>O — Objective</h3><p>${App.escapeHTML(soap.objective || '')}</p></div>
      <div class="soap-block"><h3>A — Assessment</h3><p>${App.escapeHTML(soap.assessment || '')}</p></div>
      <div class="soap-block"><h3>P — Plan summary</h3><p>${App.escapeHTML(soap.plan_summary || '')}</p></div>
      <h3 style="margin-top:var(--space-lg)">Structured Plan</h3>
      <ul class="plan-list">
        ${plan.map((item) => `
          <li>
            <strong>${App.escapeHTML(item.type || '')}</strong>
            — ${App.escapeHTML(item.description || '')}
            ${item.code ? `<code>${App.escapeHTML(item.code)}</code>` : ''}
            ${item.pa_required ? '<span class="pa-flag">PA required</span>' : ''}
            ${item.notes ? `<div class="empty-hint">${App.escapeHTML(item.notes)}</div>` : ''}
          </li>
        `).join('')}
      </ul>
    `;
  },

  renderOrders(orders) {
    const el = document.getElementById('scribe-orders');
    if (!orders || !orders.length) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = `
      <div style="margin-top:var(--space-lg)">
        <h3>Orders (from approved Plan)</h3>
        <ul class="plan-list">
          ${orders.map((o) => `
            <li>
              <strong>${App.escapeHTML(o.type || '')}</strong>
              — ${App.escapeHTML(o.description || '')}
              ${o.pa_required ? '<span class="pa-flag">PA required</span>' : ''}
              <div class="empty-hint">status: ${App.escapeHTML(o.status)} · id: ${App.escapeHTML(o.id)}</div>
            </li>
          `).join('')}
        </ul>
      </div>
    `;
  },
};
