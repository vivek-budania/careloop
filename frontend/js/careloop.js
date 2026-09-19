/**
 * CareLoop patient shell — demo IA (workflow.md) bound to Dave's coverage APIs.
 * Journey / meds / history stay in-browser until the longitudinal store lands.
 * Cost and network numbers come from /api/careloop/*, not hardcoded money.
 */
const CareLoop = {
  THREAD_KEY: 'careloop-patient-thread-v2',
  COVERAGE_KEY: 'careloop-coverage-v1',
  GOLDEN_PAYER: 'Aetna',
  view: 'Today',
  historyTab: 'visits',
  selectedVisit: null,
  insuranceMode: 'hub',
  insuranceReturn: false,
  payers: [],
  clinicians: [],
  costEstimate: null,
  coverageSnap: { profile: null, eligibility: null },
  demoEnv: null,
  scribeFixture: null,
  encounter: null,
  orders: null,
  extractiveSummary: null,
  thread: null,
  clickBound: false,
  recording: false,
  recordChunks: [],
  recordStream: null,
  mediaRecorder: null,
  sttBusy: false,
  recordStatus: '',
  discardRecording: false,

  paths: {
    loop: 'M17 7c-5-8-15-4-13 3 2 6 8 9 14 6 6-3 6-12 0-13-5-1-8 5-6 11 2 6 10 8 15 2',
    home: 'm3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8',
    history: 'M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2',
    pill: 'm9 5-5 5a6 6 0 0 0 8 8l5-5a6 6 0 0 0-8-8Zm-2 3 8 8',
    test: 'M9 3h6M10 3v6l-6 10a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2L14 9V3M8 14h8',
    shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6',
    user: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2',
    arrow: 'M4 12h16m-6-6 6 6-6 6',
    back: 'M20 12H4m6-6-6 6 6 6',
    calendar: 'M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm2-2v5m10-5v5M3 11h18',
    clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2',
    pin: 'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0ZM14 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
    file: 'M14 3H5v18h14V8l-5-5Zm0 0v6h5M8 13h8m-8 4h5',
    check: 'm5 12 4 4L19 6',
    logout: 'M9 4H4v16h5m-1-8h13m-5-5 5 5-5 5',
    menu: 'M4 6h16M4 12h16M4 18h16',
    bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M10 21h4',
    download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
    plus: 'M12 4v16M4 12h16',
    camera: 'M3 7h5l2-3h4l2 3h5v14H3V7Zm13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
    close: 'm6 6 12 12M6 18 18 6',
    mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Zm7 9a7 7 0 0 1-14 0M12 19v3',
  },

  stepNames: [
    'What brings you in',
    'Find your clinician',
    'Choose a time',
    'Check in',
    'Visit recording',
    'Your visit summary',
    'Estimated costs',
    'Your care plan',
  ],
  RECORD_MAX_MS: 2 * 60 * 1000,
  recordPurpose: 'visit',
  recordTimerId: null,
  recordStartedAt: 0,

  init() {
    if (this._inited) return;
    this._inited = true;
    this.thread = this.loadThread();
    this.bindClicks();
    this.restoreSession();
  },

  icon(n) {
    const box = n === 'loop' ? '30 24' : '24 24';
    return `<svg viewBox="0 0 ${box}" aria-hidden="true"><path d="${this.paths[n] || this.paths.file}"/></svg>`;
  },

  art() {
    return '<div class="hero-art" aria-hidden="true"><div class="orbit"></div><div class="orbit two"></div><div class="leaf"></div><div class="leaf two"></div><div class="spark">✧</div></div>';
  },

  logo() {
    return `<div class="logo">${this.icon('loop')}careloop<span style="color:#a76e50">.</span></div>`;
  },

  esc(s) {
    return App.escapeHTML(s);
  },

  money(n) {
    if (n == null || n === '') return '—';
    const num = Number(n);
    if (Number.isNaN(num)) return '—';
    return `$${Number.isInteger(num) ? num : num.toFixed(2)}`;
  },

  btn(label, action, style = '', attrs = '') {
    return `<button type="button" class="btn ${style}" data-action="${action}" ${attrs}>${label}</button>`;
  },

  link(label, action) {
    return `<button class="link" data-action="${action}">${label} ${this.icon('arrow')}</button>`;
  },

  tag(text, type = '') {
    return `<span class="tag ${type}">${text}</span>`;
  },

  head(title, desc) {
    return `<div class="page-head"><h1>${title}</h1><p>${desc}</p></div>`;
  },

  initials(name) {
    const parts = String(name || 'MC').trim().split(/\s+/);
    return ((parts[0] || 'M')[0] + (parts[1] ? parts[1][0] : (parts[0][1] || ''))).toUpperCase();
  },

  firstName() {
    return (this.thread.patient.name || 'Jane').split(' ')[0];
  },

  seedThread(mode) {
    const name = (App.user && App.user.name) || 'Jane Doe';
    const returning = mode !== 'first';
    return {
      patient: {
        name,
        email: 'jane.doe@example.com',
        zip: '94110',
      },
      journey: null,
      openVisits: [],
      visits: returning ? [{
        id: 'seed',
        date: 'August 20, 2026',
        reason: 'Diabetes follow-up',
        doctor: 'Dr. Priya Shah',
        reviewed: true,
        summary: 'Discussed current metformin routine and planned a follow-up HbA1c test.',
        coverage: 'Aetna',
      }] : [],
      doses: returning
        ? { morning: 'taken', evening: 'upcoming' }
        : { morning: 'upcoming', evening: 'upcoming' },
      refill: false,
    };
  },

  loadThread() {
    try {
      return this.normalizeThread(JSON.parse(localStorage.getItem(this.THREAD_KEY)) || this.seedThread('returning'));
    } catch (err) {
      return this.seedThread('returning');
    }
  },

  normalizeThread(thread) {
    const t = thread || this.seedThread('returning');
    if (!Array.isArray(t.openVisits)) t.openVisits = [];
    if (!Array.isArray(t.visits)) t.visits = [];
    const j = t.journey;
    if (j && !j.completed) {
      if (!j.id) j.id = this.newVisitId();
      if (!t.openVisits.some((row) => row && row.id === j.id)) {
        t.openVisits = [j, ...t.openVisits];
      }
    }
    t.openVisits = t.openVisits.filter((row) => row && row.id && !row.completed);
    return t;
  },

  newVisitId() {
    return `visit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  },

  freshJourney(kind) {
    const golden = kind !== 'blank';
    return {
      id: this.newVisitId(),
      step: 1,
      symptoms: golden ? 'Fatigue, increased thirst, and a diabetes follow-up.' : '',
      doctor: '',
      clinic: '',
      slot: '10:30 AM',
      reviewed: false,
      completed: false,
      prior: false,
      suggested_specialty: '',
      suggested_specialty_label: '',
      live_transcript: '',
      transcript_source: '',
      stt_meta: '',
      checked_in: false,
      demo_transcript: false,
      symptoms_source: '',
      booked: false,
    };
  },

  openJourneys() {
    const list = (this.thread && this.thread.openVisits) || [];
    return list.filter((row) => row && row.id && !row.completed);
  },

  isBookedVisit(row) {
    if (!row || row.completed) return false;
    if (row.booked) return true;
    return Boolean(row.doctor && row.slot && (row.step || 1) >= 3);
  },

  upcomingVisits() {
    return this.openJourneys().filter((row) => this.isBookedVisit(row));
  },

  preparingVisits() {
    return this.openJourneys().filter((row) => !this.isBookedVisit(row));
  },

  visitTitle(j) {
    const text = String((j && j.symptoms) || '').trim();
    if (text) return text.length > 56 ? `${text.slice(0, 53)}…` : text;
    return 'New visit';
  },

  syncActiveJourney() {
    if (!this.thread) return;
    if (!Array.isArray(this.thread.openVisits)) this.thread.openVisits = [];
    const j = this.thread.journey;
    if (!j) return;
    if (!j.id) j.id = this.newVisitId();
    if (j.completed) {
      this.thread.openVisits = this.thread.openVisits.filter((row) => row && row.id !== j.id);
      return;
    }
    const i = this.thread.openVisits.findIndex((row) => row && row.id === j.id);
    if (i >= 0) this.thread.openVisits[i] = j;
    else this.thread.openVisits.unshift(j);
  },

  saveThread(patch) {
    if (patch) Object.assign(this.thread, patch);
    this.syncActiveJourney();
    localStorage.setItem(this.THREAD_KEY, JSON.stringify(this.thread));
    return this.thread;
  },

  clearVisitRuntime() {
    if (typeof this.cancelRecording === 'function') this.cancelRecording();
    this.clearRecordTimer();
    this.encounter = null;
    this.orders = null;
    this.extractiveSummary = null;
    this.scribeFixture = null;
    this.costEstimate = null;
  },

  visitHeroActions() {
    const j = this.thread.journey;
    const preparing = this.preparingVisits();
    const upcoming = this.upcomingVisits();
    const active = j && !j.completed && !this.isBookedVisit(j);
    let primary;
    if (j && this.isBookedVisit(j) && !j.completed) {
      primary = this.btn('Check in for your visit', 'open-upcoming');
    } else if (j && j.completed && !preparing.length && !upcoming.length) {
      primary = this.btn('View visit summary', 'latest-visit');
    } else {
      primary = this.btn(active ? 'Continue your visit' : 'Prepare for your visit', 'start');
    }
    return `<div class="visit-hero-actions">${primary}${this.btn(`${this.icon('plus')} New visit`, 'new-visit', 'secondary')}</div>`;
  },

  openVisitsPanel() {
    const open = this.preparingVisits();
    const upcoming = this.upcomingVisits();
    const activeId = this.thread.journey && !this.thread.journey.completed ? this.thread.journey.id : '';
    const rows = open.length
      ? open.map((row) => {
        const current = row.id === activeId;
        return `<button class="visit-row" data-open-visit="${this.esc(row.id)}" type="button"><div class="tile-icon">${this.icon('file')}</div><div><small>Preparing · step ${row.step || 1} of 3</small><h3>${this.esc(this.visitTitle(row))}</h3><small>${this.esc(row.doctor || 'Clinician not chosen yet')}</small></div>${current ? this.tag('This visit') : this.icon('arrow')}</button>`;
      }).join('')
      : `<p style="font-size:12px">No visits in progress. Start a new one anytime. Confirmed appointments live under Upcoming visits.</p>`;
    const upcomingNote = upcoming.length
      ? `<p class="mt" style="font-size:12px">${upcoming.length} confirmed appointment${upcoming.length === 1 ? '' : 's'} ${upcoming.length === 1 ? 'is' : 'are'} in Upcoming visits.</p>${this.btn('Upcoming visits', 'upcoming', 'secondary')}`
      : '';
    return `<section class="card"><div class="section-heading"><h2>Open visits</h2><small>${open.length ? `${open.length} preparing` : 'None preparing'}</small></div>${rows}${upcomingNote}<div class="mt">${this.btn(`${this.icon('plus')} New visit`, 'new-visit', 'secondary')}</div></section>`;
  },

  historyOpenVisits() {
    const open = this.preparingVisits();
    if (!open.length) return '';
    const activeId = this.thread.journey && !this.thread.journey.completed ? this.thread.journey.id : '';
    const rows = open.map((row) => {
      const current = row.id === activeId;
      return `<button class="visit-row" data-open-visit="${this.esc(row.id)}" type="button"><div class="tile-icon">${this.icon('file')}</div><div><small>Preparing · step ${row.step || 1} of 3</small><h3>${this.esc(this.visitTitle(row))}</h3><small>${this.esc(row.doctor || 'Clinician not chosen yet')}</small></div>${current ? this.tag('This visit') : this.icon('arrow')}</button>`;
    }).join('');
    return `<div class="section-heading"><h2>In progress</h2>${this.btn(`${this.icon('plus')} New visit`, 'new-visit', 'secondary')}</div>${rows}<div class="rule"></div>`;
  },

  persistCoverage() {
    try {
      localStorage.setItem(this.COVERAGE_KEY, JSON.stringify(this.coverageSnap || {}));
    } catch (err) {
      /* private mode */
    }
  },

  loadPersistedCoverage() {
    try {
      const raw = localStorage.getItem(this.COVERAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  },

  rememberCoverage(snap) {
    if (snap && typeof snap === 'object') {
      this.coverageSnap = snap;
      if (snap.visit_cost_estimate) this.costEstimate = snap.visit_cost_estimate;
      this.persistCoverage();
    }
    return this.coverageSnap;
  },

  coverageOnFile() {
    return Boolean(this.coverageSnap && this.coverageSnap.profile);
  },

  eligibilityOnFile() {
    return Boolean(this.coverageSnap && this.coverageSnap.eligibility);
  },

  coverageLabel() {
    const p = this.coverageSnap.profile;
    const e = this.coverageSnap.eligibility;
    if (!p) return null;
    return {
      payer: p.payer_name,
      member: p.member_id,
      group: p.group_number,
      zip: p.zip,
      plan: e?.plan_type || p.plan_type,
      status: e?.status || 'saved',
      copay: e?.estimated_copay_pcp,
      deductible: e?.deductible_remaining,
      source: e?.source === 'stedi' ? 'sandbox' : 'mock',
      dob: p.date_of_birth,
    };
  },

  coverageSource() {
    const c = this.coverageLabel();
    return (c && c.source) || 'mock';
  },

  confirmFromProfile(profile) {
    const p = profile || this.coverageSnap.profile || {};
    return API.confirmCoverage({
      payer_name: p.payer_name || this.GOLDEN_PAYER,
      member_id: p.member_id || '',
      member_name: p.member_name || '',
      date_of_birth: p.date_of_birth || '',
    });
  },

  eligibilityNote() {
    const e = this.coverageSnap.eligibility || {};
    const live = e.live_api || {};
    const stedi = this.coverageSnap.stedi || (this.demoEnv && this.demoEnv.stedi) || {};
    const sub = live.subscriber || {};
    const who = [sub.firstName, sub.lastName, sub.memberId, sub.dateOfBirth]
      .filter(Boolean)
      .join(' · ');
    let note;
    if (e.source === 'stedi') {
      note = live.message || stedi.message || 'Sandbox 271 from Stedi. Estimates only — not a coverage decision.';
    } else if (stedi.test_mode) {
      note = live.message || 'A Stedi test key is loaded. Refresh coverage if this card still shows mock numbers.';
    } else {
      note = (
        'Jane Doe matches Stedi’s canned Aetna member. Add STEDI_API_KEY on this host '
        + 'or in Vercel (then Redeploy) to run a live sandbox 271. Until then, matching mock numbers are shown.'
      );
    }
    if (who) note += ` Checked ${who}.`;
    if (e.status && e.status !== 'active') {
      note += ' This sample plan is inactive. Do not rely on in-network estimates.';
    }
    return note;
  },

  setupNotice() {
    const gemini = (this.demoEnv && this.demoEnv.gemini) || {};
    const ocr = gemini.configured
      ? 'Read uploaded images is available on this form. It copies printed fields only and does not invent missing copays.'
      : 'Read uploaded images needs GEMINI_API_KEY on this host or in Vercel. Use the sample card until then.';
    return (
      'Demo eligibility only. This does not verify real coverage or decide benefits. '
      + `Estimates are not a bill. ${ocr}`
    );
  },

  envRows() {
    const env = this.demoEnv || {};
    const session = env.session || {};
    const supabase = env.supabase || session.supabase || {};
    const stedi = env.stedi || {};
    const gemini = env.gemini || {};
    const groq = env.groq || {};
    const xai = env.xai || {};
    const vercel = env.vercel || {};
    return [
      {
        name: 'Supabase login',
        tag: supabase.configured ? 'loaded' : 'not set',
        tagType: supabase.configured ? '' : 'peach',
        detail: supabase.message || session.message || 'Add SUPABASE_URL and keys on this host or in Vercel. Login-only; no insurance tables.',
      },
      {
        name: 'Stedi eligibility',
        tag: stedi.test_mode ? 'loaded' : (stedi.configured ? 'blocked' : 'not set'),
        tagType: stedi.test_mode ? '' : 'peach',
        detail: stedi.message || 'STEDI_API_KEY is not loaded on this host yet.',
      },
      {
        name: 'Gemini OCR + letters',
        tag: gemini.configured ? 'loaded' : 'not set',
        tagType: gemini.configured ? '' : 'peach',
        detail: gemini.message || 'GEMINI_API_KEY is not loaded on this host yet.',
      },
      {
        name: 'Groq fallback',
        tag: groq.configured ? 'loaded' : 'optional',
        tagType: groq.configured ? '' : 'gray',
        detail: groq.message || 'Add GROQ_API_KEY the same way when you have it.',
      },
      {
        name: 'xAI visit STT',
        tag: xai.configured ? 'loaded' : 'optional',
        tagType: xai.configured ? '' : 'gray',
        detail: xai.message || 'Add XAI_API_KEY the same way when you have it. Record on the visit transcript step, or keep the sample conversation.',
      },
      {
        name: 'Vercel',
        tag: 'slots',
        tagType: 'gray',
        detail: vercel.message || (
          'Add SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, STEDI_API_KEY, GEMINI_API_KEY in Vercel Project Settings, then Redeploy. Never put service_role in frontend JS.'
        ),
      },
    ];
  },

  envPanel() {
    const list = this.envRows().map((row) => (
      `<div class="task-row"><div style="flex:1"><div class="row" style="justify-content:space-between;gap:12px"><h3>${this.esc(row.name)}</h3>${this.tag(row.tag, row.tagType)}</div><small>${this.esc(row.detail)}</small></div></div>`
    )).join('');
    return `<div class="rule"></div><h3>Demo keys on this host</h3><p style="font-size:12px;margin:10px 0 16px">Values stay in process or Vercel env. This page only shows whether a slot is loaded. Extra keys can be added the same way.</p>${list}`;
  },

  async loadDemoEnv() {
    try {
      this.demoEnv = await API.demoEnv();
    } catch (err) {
      this.demoEnv = null;
    }
  },

  readBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(new Error('Could not read that file.'));
      reader.readAsDataURL(file);
    });
  },

  async filePayload(inputId) {
    const input = document.getElementById(inputId);
    const file = input && input.files && input.files[0];
    if (!file) return null;
    if (file.size > 8 * 1024 * 1024) {
      throw new Error(`${file.name} is larger than 8MB.`);
    }
    return {
      filename: file.name,
      mime: file.type || 'application/octet-stream',
      b64: await this.readBase64(file),
    };
  },

  historyPacket() {
    const s = this.thread;
    const c = this.coverageLabel();
    const coverageLine = c
      ? `${c.payer} — ${c.status} (mock estimate)`
      : 'Not on file';
    const visits = (s.visits || []).map((v) => (
      `\n### ${v.date} · ${v.doctor}\nReason: ${v.reason}\n${v.summary}\nReview status: ${
        v.reviewed ? 'Clinician review simulated' : 'Awaiting clinician review'
      }\nCoverage at visit: ${v.coverage}\n`
    )).join('');
    return [
      '# CareLoop · Patient history packet',
      '',
      'FICTIONAL DEMO — not a clinical record or insurance submission.',
      '',
      `Patient: ${s.patient.name}`,
      `Coverage: ${coverageLine}`,
      '',
      '## Visits',
      visits || '\n(No visits saved yet.)\n',
      '## Current medicine (fixture)',
      'Metformin 1000 mg twice daily, 8 AM / 8 PM. No dose changes.',
      `Today: morning ${s.doses.morning}, evening ${s.doses.evening}.`,
      `Refill: ${s.refill ? 'Draft prepared for clinic; not sent' : 'No draft request'}`,
      '',
      '## Tests',
      `HbA1c: ${s.journey?.reviewed ? 'Mock order ready; result not available' : 'Suggested; awaiting clinician review'}.`,
      '',
      '## Authorization and claims',
      'Add-on therapy: PA may be required; not submitted. Claim: not submitted. PA and claim are separate.',
      '',
      '## Follow-up',
      'Discuss a follow-up visit in 3 months with the clinic.',
      '',
    ].join('\n');
  },

  toast(t) {
    App.notify(t);
  },

  modal(title, content, actions = '') {
    const el = document.getElementById('modal');
    el.innerHTML = `<button class="icon-btn close" data-action="close" aria-label="Close dialog">${this.icon('close')}</button><h2>${title}</h2>${content}<div class="actions">${actions || this.btn('Close', 'close', 'secondary')}</div>`;
    el.showModal();
  },

  closeModal() {
    const el = document.getElementById('modal');
    if (el.open) el.close();
  },

  navigate(next) {
    if (next !== this.view) this.cancelRecording();
    this.view = next;
    this.selectedVisit = null;
    this.render();
    window.scrollTo(0, 0);
  },

  async restoreSession() {
    if (!API.getToken()) {
      this.renderLogin();
      return;
    }
    try {
      App.user = await API.me();
      await Promise.all([this.refreshCoverage(), this.loadDemoEnv()]);
      if (this.thread.patient && App.user?.name) {
        this.thread.patient.name = this.thread.patient.name || App.user.name;
      }
      this.render();
    } catch (err) {
      API.setToken('');
      this.renderLogin();
    }
  },

  async refreshCoverage() {
    try {
      const snap = await API.getCoverage();
      if (snap && snap.profile) {
        this.rememberCoverage(snap);
      } else {
        this.coverageSnap = this.loadPersistedCoverage() || snap || { profile: null, eligibility: null };
      }
      if (this.coverageSnap?.profile?.zip) {
        this.thread.patient.zip = this.coverageSnap.profile.zip;
        this.saveThread();
      }
      this.costEstimate = this.coverageSnap.visit_cost_estimate || this.costEstimate;
    } catch (err) {
      this.coverageSnap = this.loadPersistedCoverage() || { profile: null, eligibility: null };
    }
  },

  async loadPayers() {
    try {
      this.payers = await API.listPayers();
    } catch (err) {
      this.payers = [];
      this.toast(err.message);
    }
  },

  async login(username, password, mode) {
    const result = await API.login(username, password);
    API.setToken(result.token);
    App.user = result.user;
    if (mode === 'first') {
      this.thread = this.seedThread('first');
      this.saveThread();
      await Promise.all([API.resetCoverage(), this.loadDemoEnv()]);
      this.rememberCoverage({ profile: null, eligibility: null });
      this.costEstimate = null;
      this.scribeFixture = null;
      this.encounter = null;
      this.orders = null;
      this.cancelRecording();
      this.insuranceMode = 'hub';
      this.insuranceReturn = false;
      this.view = 'Setup';
    } else {
      this.thread = this.loadThread();
      if (!this.thread.visits) this.thread = this.seedThread('returning');
      this.thread.patient.name = result.user.name || this.thread.patient.name;
      this.saveThread();
      await Promise.all([this.refreshCoverage(), this.loadDemoEnv()]);
      if (!this.coverageOnFile()) {
        const snap = await API.scanCoverage({
          payer_name: this.GOLDEN_PAYER,
          image_note: 'fixture:returning-seed',
        });
        this.rememberCoverage(await this.confirmFromProfile(snap.profile));
      } else if (!this.eligibilityOnFile()) {
        this.rememberCoverage(await this.confirmFromProfile(this.coverageSnap.profile));
      } else {
        this.persistCoverage();
      }
      this.view = 'Today';
    }
    this.render();
  },

  async logout() {
    try {
      await API.logout();
    } catch (err) {
      /* still clear local session */
    }
    API.setToken('');
    App.user = null;
    try {
      localStorage.removeItem(this.COVERAGE_KEY);
    } catch (err) {
      /* ignore */
    }
    this.coverageSnap = { profile: null, eligibility: null };
    this.view = 'Today';
    this.renderLogin();
  },

  renderLogin() {
    const app = document.getElementById('app');
    app.innerHTML = `<div class="login"><section class="login-story">${this.logo()}<h1>Your health.<br>Your story.<br><em>All together.</em></h1><p>A little less to keep track of.<br>A little more peace of mind.</p>${this.art()}<small>One connected journey. From your first visit to what’s next.</small></section><section class="login-form"><form id="login-form"><span class="eyebrow">A little clarity, every day</span><h2>Welcome to your care.</h2><p>Keep your visits, medicines, and next steps in one place.</p><label class="field">Username<input name="username" autocomplete="username" value="jane" required></label><label class="field">Password<input name="password" type="password" autocomplete="current-password" value="demo" required></label><div class="error" id="login-error" role="alert"></div><button class="btn" type="submit" name="mode" value="returning">I’m returning ${this.icon('arrow')}</button><button class="btn secondary" type="submit" name="mode" value="first">Start my first visit</button><div class="hint">Seeded demo: <strong>jane</strong> / <strong>demo</strong></div><p style="text-align:center;margin:22px 0 0;font-size:10px">Interactive demo · Fictional patient data<br>Care drafts are always for clinician review.</p></form></section></div>`;
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const username = form.username.value.trim();
      const password = form.password.value;
      const mode = (e.submitter && e.submitter.value) || 'returning';
      const errBox = document.getElementById('login-error');
      errBox.textContent = '';
      try {
        await this.login(username, password, mode);
      } catch (err) {
        errBox.textContent = err.message;
      }
    });
  },

  shell(content) {
    const destinations = [
      ['Today', 'home'],
      ['History', 'history'],
      ['Upcoming visits', 'calendar'],
      ['Medicines', 'pill'],
      ['Tests', 'test'],
      ['Insurance', 'shield'],
      ['Profile', 'user'],
    ];
    const name = this.thread.patient.name;
    const crumb = this.view === 'Journey'
      ? ((this.thread.journey && this.thread.journey.step >= 4) ? 'Visit day' : 'Your visit')
      : this.view === 'Setup' ? 'Getting started' : this.view === 'Followups' ? 'Follow-ups' : this.view;
    const navActive = ['Today', 'History', 'Upcoming visits', 'Medicines', 'Tests', 'Insurance', 'Profile'].includes(this.view)
      ? this.view
      : '';
    document.getElementById('app').innerHTML = `<button class="overlay" data-action="menu" aria-label="Close navigation"></button><aside class="sidebar">${this.logo()}<span class="eyebrow">Your space</span><nav class="nav" aria-label="Main navigation">${destinations.map(([n, i]) => `<button type="button" data-nav="${n}" class="${navActive === n ? 'active' : ''}" ${navActive === n ? 'aria-current="page"' : ''}>${this.icon(i)}${n}</button>`).join('')}</nav><div class="sidebar-bottom"><div class="help"><span class="eyebrow" style="padding:0">Made for your next visit</span><p>Your story, ready to share.<br>No starting from scratch.</p>${this.link('Prepare your packet', 'packet')}</div><div class="profile-mini"><div class="avatar">${this.esc(this.initials(name))}</div><div><strong style="font-size:12px">${this.esc(name)}</strong><small>My personal care space</small></div><button class="logout" data-action="logout" aria-label="Log out">${this.icon('logout')}</button></div></div></aside><div class="shell"><header class="topbar"><button class="icon-btn mobile-menu" data-action="menu" aria-label="Open navigation">${this.icon('menu')}</button><span class="mobile-brand">careloop.</span><div class="breadcrumb">My care <span>/</span><strong>${this.esc(crumb)}</strong></div><div class="topright"><span class="demo-badge"><span class="dot"></span> DEMO MODE</span><button class="icon-btn" aria-label="Notifications" data-action="notifications">${this.icon('bell')}</button><button class="avatar" data-nav="Profile" aria-label="Open profile">${this.esc(this.initials(name))}</button></div></header><main>${content}<footer class="footer"><span>Your care, connected. &nbsp; ♡</span><span>Fictional data · No live care or insurance actions</span></footer></main></div>`;
  },

  today() {
    const j = this.thread.journey;
    const complete = j?.completed;
    const c = this.coverageLabel();
    const first = this.firstName();
    return `<section class="greeting"><div><div class="eyebrow">Thursday, September 24</div><h1>A little clarity, ${this.esc(first)}.</h1><p>Here’s where things stand — and what comes next.</p></div><div class="date">${this.icon('calendar')} Your personal care space</div></section><div class="grid"><div class="stack"><section class="card hero"><div class="eyebrow">${complete ? 'One step forward' : 'Your next step'}</div><h2>${complete ? 'Your visit, all in one place.' : j ? 'Let’s pick up where you left off.' : 'Let’s make your next visit easier.'}</h2><p>${complete ? 'Your summary and next steps are saved. Take your story with you to the next visit.' : 'A few details now. A clearer conversation with your doctor later.'}</p>${this.visitHeroActions()}${this.art()}</section>${this.openVisitsPanel()}<section class="card"><div class="section-heading"><h2>${j?.slot ? 'Your requested appointment' : 'Your upcoming visit'}</h2>${this.tag(j?.slot ? 'Request saved' : 'Demo appointment', 'peach')}</div><div class="appointment"><div class="day-box"><small>SEP</small><strong>24</strong></div><div><small>${this.esc((j?.suggested_specialty_label || 'PRIMARY CARE').toUpperCase())} · FOLLOW-UP</small><h3>${this.esc(j?.doctor || 'Dr. Priya Shah')}</h3><small>${this.esc(j?.clinic || 'Mission Family Clinic')}</small></div>${this.tag(c?.status === 'active' ? `In network · ${this.coverageSource()}` : 'Confirm network', c?.status === 'active' ? '' : 'peach')}</div><div class="rule"></div><div class="details"><span>${this.icon('clock')}${this.esc(j?.slot || '10:30 AM')} · 30 min</span><span>${this.icon('pin')}San Francisco, CA</span></div></section><section class="card"><div class="section-heading"><h2>A few things for today</h2><small>Small steps count.</small></div><div class="task-row"><div class="tile-icon peach">${this.icon('pill')}</div><div><h3>Your evening medicine</h3><small>Metformin · 8:00 PM · ${this.esc(this.thread.doses.evening)}</small></div>${this.link('View', 'medicines')}</div><div class="task-row"><div class="tile-icon lilac">${this.icon('test')}</div><div><h3>HbA1c blood test</h3><small>${j?.reviewed ? 'Mock order ready · no result yet' : 'Waiting for clinic review'}</small></div>${this.link('Details', 'tests')}</div><div class="task-row"><div class="tile-icon">${this.icon('file')}</div><div><h3>Your story, ready for the clinic</h3><small>Visits, medicines, and coverage together</small></div>${this.link('Prepare', 'packet')}</div></section></div><div class="stack"><section class="card"><div class="progress-top"><h2>Your care journey</h2>${this.tag('In progress', 'gray')}</div><ol class="timeline"><li><span class="point">${c ? '✓' : '1'}</span><div><h3>${c ? 'Insurance added' : 'Add insurance, if you like'}</h3><p>${c ? `${this.esc(c.payer)} · ${this.esc(c.status)} (${this.coverageSource()})` : 'Optional. You can still start a visit.'}</p></div></li><li><span class="point ${complete ? '' : 'now'}">${complete ? '✓' : '2'}</span><div><h3>${complete ? 'Your visit is saved' : 'Prepare for your visit'}</h3><p>${complete ? 'Summary available in your history' : 'Share what’s on your mind.'}</p>${this.tag(complete ? 'Saved' : 'Your next step', complete ? '' : 'peach')}</div></li><li><span class="point ${complete ? 'now' : 'empty'}">3</span><div><h3>Visit &amp; care plan</h3><p>${complete ? 'Clinic reviews your next steps.' : 'A clear summary. A plan to review.'}</p></div></li><li><span class="point empty">4</span><div><h3>Keep your care moving</h3><p>Tests, medicines, and follow-ups.</p></div></li></ol></section><section class="card insurance-mini"><div class="row"><span class="eyebrow">Your coverage</span>${this.icon('shield')}</div><h3>${c ? `${this.esc(c.payer)} · ${this.esc(c.plan || '')}` : 'No insurance on file'}</h3><p>${c ? `${this.coverageSource() === 'sandbox' ? 'Sandbox' : 'Mock'} coverage snapshot · estimates only` : 'Add a plan for estimated costs.'}</p>${c ? `<div class="row"><div><span class="money">${c.status === 'active' ? this.money(c.copay) : '—'}</span><small>&nbsp; est. PCP copay</small></div></div><div class="rule"></div>` : ''}${this.link('View insurance', 'insurance')}</section></div></div>`;
  },

  setup() {
    let content = '';
    if (this.insuranceMode === 'hub') {
      content = `<h2>A good place to start.</h2><p>Add your insurance to see estimated costs and mock in-network clinics. You can also skip this for now.</p><div class="split"><button class="card" style="text-align:left" data-action="sample-card" type="button">${this.icon('camera')}<h3 class="mt">Try a sample card</h3><p style="font-size:12px;margin-top:8px">Jane Doe · Aetna · DOB 2004-04-04.<br>Fixture first. You can still read an upload next.</p></button><button class="card" style="text-align:left" data-action="manual-card" type="button">${this.icon('file')}<h3 class="mt">Enter plan details</h3><p style="font-size:12px;margin-top:8px">Choose your insurance company.<br>Date of birth is required.</p></button></div><div class="actions">${this.link('Skip for now', 'skip-insurance')}</div>`;
    } else {
      const p = this.coverageSnap.profile || {};
      const sample = this.insuranceMode === 'sample';
      const selected = p.payer_name || (sample ? this.GOLDEN_PAYER : this.GOLDEN_PAYER);
      const options = (this.payers.length ? this.payers : [{ name: this.GOLDEN_PAYER, plan_type: 'PPO' }])
        .map((row) => `<option value="${this.esc(row.name)}" ${selected === row.name ? 'selected' : ''}>${this.esc(row.name)} (${this.esc(row.plan_type)})</option>`)
        .join('');
      const warnings = (p.warnings || []).map((w) => `<p class="mt" style="font-size:12px">${this.esc(w)}</p>`).join('');
      content = `<h2>${sample ? 'Review your sample card.' : 'A few plan details.'}</h2><p>${sample ? 'These fields come from the Jane Doe Aetna fixture. Date of birth is required so eligibility can match the sandbox member. You can edit them before saving.' : 'Insurance company and date of birth are required. Use fictional details for this demo.'}</p><form id="insurance-form"><label class="field">Insurance company<select name="payer" required><option value="">Select an insurer</option>${options}</select></label><label class="field">Member name (optional)<input name="member_name" value="${this.esc(p.member_name || this.thread.patient.name)}"></label><div class="split"><label class="field">Member ID (optional)<input name="member" value="${this.esc(p.member_id || '')}"></label><label class="field">Group number (optional)<input name="group" value="${this.esc(p.group_number || '')}"></label></div><label class="field">Date of birth<input type="date" name="dob" value="${this.esc(p.date_of_birth || '')}" required></label><label class="field">ZIP code<input name="zip" value="${this.esc(p.zip || this.thread.patient.zip || '94110')}" pattern="[0-9]{5}" maxlength="5"></label><div class="split"><label class="field">Card image (optional)<input type="file" id="card-file" accept="image/*,.pdf"></label><label class="field">SBC / EOB (optional)<input type="file" id="sbc-file" accept="image/*,.pdf"></label></div><p class="mt" style="font-size:12px" id="ocr-status"></p>${warnings}<div class="notice">${this.esc(this.setupNotice())}</div><div class="actions">${this.btn('Back', 'insurance-hub', 'secondary')}<div class="row">${this.btn('Read uploaded images', 'read-images', 'secondary')}<button class="btn" type="submit">Save &amp; review coverage ${this.icon('arrow')}</button></div></div></form>`;
    }
    return `<div class="narrow">${this.head(this.insuranceReturn ? 'Update your insurance.' : 'Let’s bring your care together.', 'Insurance is a starting point. Your story is what connects it all.')}<section class="card journey-panel">${content}</section></div>`;
  },

  startVisit() {
    const j = this.thread.journey;
    if (j && this.isBookedVisit(j) && !j.completed) {
      this.openUpcomingVisit(j.id);
      return;
    }
    if (!j || j.completed) {
      this.clearVisitRuntime();
      this.saveThread({ journey: this.freshJourney('golden') });
    }
    this.navigate('Journey');
    if (this.thread.journey && this.thread.journey.step >= 2) {
      this.loadNetwork();
    }
  },

  startNewVisit() {
    this.clearVisitRuntime();
    this.saveThread({ journey: this.freshJourney('blank') });
    this.navigate('Journey');
    this.toast('New visit started. Your other open visits stay on Today.');
  },

  resumeOpenVisit(id) {
    const found = this.openJourneys().find((row) => row.id === id);
    if (!found) {
      this.toast('That visit is no longer open.');
      return;
    }
    if (this.isBookedVisit(found)) {
      this.openUpcomingVisit(found.id);
      return;
    }
    if (this.thread.journey && this.thread.journey.id === found.id && !this.thread.journey.completed) {
      this.startVisit();
      return;
    }
    this.clearVisitRuntime();
    this.saveThread({ journey: { ...found } });
    this.navigate('Journey');
    if (found.step >= 2) this.loadNetwork();
  },

  openUpcomingVisit(id) {
    const found = this.upcomingVisits().find((row) => row.id === id)
      || this.openJourneys().find((row) => row.id === id);
    if (!found) {
      this.toast('That appointment is no longer open.');
      return;
    }
    this.clearVisitRuntime();
    const step = (found.step || 3) >= 4 ? found.step : 4;
    this.saveThread({ journey: { ...found, booked: true, step } });
    this.navigate('Journey');
    if (step >= 5 && found.demo_transcript) this.loadScribeFixture();
    if (step >= 6) this.draftScribeEncounter();
  },

  upcoming() {
    const rows = this.upcomingVisits();
    let list;
    if (!rows.length) {
      list = `<div class="empty">${this.icon('calendar')}<h2>No upcoming visits yet.</h2><p>Book a time with Save request and the appointment will show up here for check-in.</p>${this.btn(`${this.icon('plus')} New visit`, 'new-visit')}</div>`;
    } else {
      list = rows.map((row) => {
        const when = `${row.slot || 'Time TBD'} · Thursday, September 24, 2026`;
        const status = (row.step || 1) >= 4
          ? (row.checked_in ? 'Checked in · continue recording' : 'Ready to check in')
          : 'Confirmed · tap to check in';
        return `<button class="visit-row" data-upcoming-visit="${this.esc(row.id)}" type="button"><div class="tile-icon">${this.icon('calendar')}</div><div><small>${this.esc(when)}</small><h3>${this.esc(this.visitTitle(row))}</h3><small>${this.esc(row.doctor || 'Clinician')} · ${this.esc(status)}</small></div>${this.icon('arrow')}</button>`;
      }).join('');
    }
    return `<div class="narrow">${this.head('Upcoming visits.', 'Confirmed appointments after you save a request. Check in here when you arrive.')}<section class="card journey-panel">${list}</section></div>`;
  },

  suggestedSpecialty() {
    const j = this.thread.journey || {};
    return j.suggested_specialty
      || this.coverageSnap.intake?.suggested_specialty
      || 'pcp';
  },

  async loadNetwork() {
    const zip = this.coverageSnap.profile?.zip || this.thread.patient.zip || '94110';
    const specialty = this.suggestedSpecialty();
    try {
      const payload = await API.searchNetwork(specialty, zip);
      this.clinicians = payload.clinicians || [];
      if (payload.specialty_label) {
        this.saveThread({
          journey: {
            ...this.thread.journey,
            suggested_specialty: payload.specialty || specialty,
            suggested_specialty_label: payload.specialty_label,
          },
        });
      }
    } catch (err) {
      this.clinicians = [];
      this.toast(err.message);
    }
  },

  journey() {
    const j = this.thread.journey;
    if (!j) return this.today();
    let body = '';
    switch (j.step) {
      case 1:
        body = this.symptomsBody();
        break;
      case 2:
        body = this.clinicianBody();
        break;
      case 3:
        body = `<h2>Make room for your health.</h2><p>${this.esc(j.doctor)} · ${this.esc(j.clinic || 'Clinic')}<br>Choose a sample time for Thursday, September 24, 2026.</p><div class="chips">${['9:00 AM', '10:30 AM', '2:00 PM', '3:30 PM'].map((t) => `<button type="button" class="chip ${j.slot === t ? 'selected' : ''}" data-slot="${t}">${t}</button>`).join('')}</div><div class="notice">This saves an appointment request in the demo. No clinic is contacted. Cost estimates come after SOAP, not here.</div>`;
        break;
      case 4:
        body = this.checkInBody();
        break;
      case 5:
        body = this.transcriptBody();
        break;
      case 6:
        body = this.soapBody();
        break;
      case 7:
        body = this.costBody();
        break;
      case 8:
        body = `<h2>Your next steps, together.</h2><p>${j.reviewed ? 'Clinician review simulated. These mock plan items are ready for the next step.' : 'Draft plan · waiting for clinician review. No orders have been created.'}</p>${[['pill', 'Current medicine', 'Metformin stays on the existing fixture schedule. No dose changes.'], ['test', 'HbA1c blood test', j.reviewed ? 'Mock order ready. Result not available. Typically not PA-gated on this mock plan — still an estimate.' : 'Suggested test. Clinic needs to review.'], ['shield', 'Possible add-on therapy', 'Clinician may consider a GLP-1 class add-on. Prior authorization may be required — not an approval, denial, or price.'], ['calendar', 'Follow-up visit', 'Discuss a follow-up in 3 months with your clinic.']].map(([i, t, p]) => `<div class="task-row"><span class="tile-icon">${this.icon(i)}</span><div><h3>${t}</h3><p style="font-size:12px">${p}</p></div></div>`).join('')}`;
        break;
      default:
        body = '<p>Unknown step.</p>';
    }
    const skip = j.step === 7 ? this.btn('Skip estimates', 'next', 'secondary') : '';
    const nextLabel = j.step === 3 ? 'Save request' : j.step === 4 ? 'Continue to recording' : j.step === 5 ? 'See draft summary' : j.step === 6 && !this.eligibilityOnFile() ? 'Continue to plan' : j.step === 6 ? 'Continue to estimated costs' : j.step === 8 ? 'See follow-ups' : 'Continue';
    const visitDay = j.step >= 4;
    const dayNames = ['Check in', 'Visit recording', 'Your visit summary', 'Estimated costs', 'Your care plan'];
    const dayIndex = j.step - 4;
    const stepper = visitDay
      ? dayNames.map((_, i) => `<span class="${i < dayIndex ? 'done' : ''}"></span>`).join('')
      : this.stepNames.slice(0, 3).map((_, i) => `<span class="${i < j.step ? 'done' : ''}"></span>`).join('');
    const label = visitDay
      ? `Visit day · step ${dayIndex + 1} of 5 &nbsp; / &nbsp; ${dayNames[dayIndex]}`
      : `Step ${j.step} of 3 &nbsp; / &nbsp; ${this.stepNames[j.step - 1]}`;
    const title = visitDay ? 'Your appointment is today.' : 'One visit. A connected story.';
    const backLabel = j.step === 1 ? 'Save & exit' : (j.step === 4 ? 'Upcoming visits' : 'Back');
    return `<div class="narrow">${this.head(title, 'Your progress is saved as you go.')}<div class="stepper">${stepper}</div><div class="step-label">${label}</div><section class="card journey-panel">${body}<div class="actions">${this.btn(backLabel, 'previous', 'secondary')}<div class="row">${skip}${this.btn(nextLabel, 'next')}</div></div></section></div>`;
  },

  visitZip() {
    return this.coverageSnap.profile?.zip || this.thread.patient.zip || '94110';
  },

  audioDisclaimer() {
    return 'Anything you record or upload is sent to Grok speech-to-text. Recordings stop at 2 minutes. This is a demo — not a clinical recording or a diagnosis.';
  },

  recordControls(purpose) {
    const visit = purpose === 'visit';
    const label = this.recording
      ? `${this.icon('mic')} Stop & transcribe`
      : this.sttBusy
        ? 'Transcribing…'
        : (visit ? `${this.icon('mic')} Record this visit` : `${this.icon('mic')} Record your reason`);
    const recordClass = this.recording ? 'coral' : 'secondary';
    const recordDisabled = this.sttBusy && !this.recording ? 'disabled' : '';
    const action = visit ? 'record-visit' : 'record-symptoms';
    const upload = visit ? 'pick-visit-audio' : 'pick-symptoms-audio';
    const status = this.recordStatus
      ? `<div class="notice ${this.recording ? '' : 'green'}" id="scribe-record-status">${this.recording ? '<span class="record-pulse" aria-hidden="true"></span>' : ''}${this.esc(this.recordStatus)}</div>`
      : '';
    return `<div class="visit-record">${this.btn(label, action, recordClass, recordDisabled)}${this.btn('Upload audio', upload, 'secondary', this.sttBusy ? 'disabled' : '')}<input type="file" id="visit-audio" accept="audio/*,.webm,.m4a,.mp3,.wav,.ogg"></div>${status}`;
  },

  symptomsBody() {
    const j = this.thread.journey || {};
    const source = j.symptoms_source === 'stt'
      ? `<div class="notice green">Transcribed from your audio. You can edit the text before continuing.</div>`
      : '';
    return `<h2>What’s on your mind?</h2><p>Type a few words, or record a short sample. We transcribe what you say so your clinician can start with what matters to you.</p><div class="chips">${['Fatigue', 'Increased thirst', 'Diabetes follow-up', 'Something else'].map((n) => `<button type="button" class="chip ${j.symptoms.toLowerCase().includes(n.toLowerCase()) ? 'selected' : ''}" data-symptom="${n}" aria-pressed="${j.symptoms.toLowerCase().includes(n.toLowerCase())}">${n}</button>`).join('')}</div><label class="field">In your own words<textarea id="symptoms">${this.esc(j.symptoms)}</textarea></label>${this.recordControls('symptoms')}${source}<div class="document">${this.icon('file')}<div><h3 style="font-size:12px">Bring your previous visit along</h3><small>${j.prior ? 'Sample note added · metformin history' : 'Optional · sample visit summary'}</small></div>${this.btn(j.prior ? 'Added ✓' : 'Add sample', 'prior-note', 'secondary')}</div><div class="notice">${this.esc(this.audioDisclaimer())}</div>`;
  },

  clinicianBody() {
    const j = this.thread.journey || {};
    const zip = this.visitZip();
    const spec = j.suggested_specialty_label || 'that specialty';
    const list = this.clinicians.length ? this.clinicians.slice(0, 4) : [];
    const rows = list.length
      ? list.map((doc) => {
        const selected = j.doctor === doc.name;
        const inNet = doc.in_network;
        return `<div class="doctor"><div class="avatar">${this.esc(this.initials(doc.name))}</div><div><h3>${this.esc(doc.name)}</h3><p>${this.esc(doc.specialty_label)} · ${doc.miles} mi<br>${this.esc(doc.address)}</p>${this.tag(inNet ? `In network · ${this.coverageSource()}` : 'Confirm network', inNet ? '' : 'peach')}</div>${this.btn(selected ? 'Selected ✓' : 'Choose', 'choose-doctor', selected ? '' : 'secondary', `data-npi="${this.esc(doc.npi)}"`)}</div>`;
      }).join('')
      : `<p>No demo alternatives are loaded. You can still continue and book a sample time.</p>`;
    return `<h2>A familiar face. Or a fresh start.</h2><div class="notice">We couldn’t find nearby doctors for ZIP ${this.esc(zip)}${j.suggested_specialty_label ? ` · ${this.esc(spec)}` : ''}. The local directory search returned no matches in that area.</div><h3 class="mt">Alternatives from the demo directory</h3><p>These are sample clinicians, not a result of the ZIP search. Directory filter only — not a diagnosis. The clinic still confirms availability and network status.</p>${rows}`;
  },

  appointmentDate() {
    const j = this.thread.journey || {};
    const slot = String(j.slot || '10:30 AM');
    const m = slot.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    let hours = 10;
    let mins = 30;
    if (m) {
      hours = Number(m[1]);
      mins = Number(m[2]);
      const ap = m[3].toUpperCase();
      if (ap === 'PM' && hours !== 12) hours += 12;
      if (ap === 'AM' && hours === 12) hours = 0;
    }
    return new Date(2026, 8, 24, hours, mins, 0);
  },

  appointmentLabel() {
    const j = this.thread.journey || {};
    return `Thursday, September 24, 2026 at ${j.slot || '10:30 AM'}`;
  },

  withinCheckInWindow(now = new Date()) {
    return Math.abs(now.getTime() - this.appointmentDate().getTime()) <= 15 * 60 * 1000;
  },

  usesDemoTranscript() {
    const j = this.thread.journey || {};
    return Boolean(j.demo_transcript) && !this.liveTranscript();
  },

  checkInBody() {
    const j = this.thread.journey || {};
    const booked = this.openJourneys().filter((row) => row.slot && (row.doctor || (row.step || 1) >= 3));
    const choices = booked.length > 1
      ? `<div class="chips">${booked.map((row) => `<button type="button" class="chip ${row.id === j.id ? 'selected' : ''}" data-checkin-visit="${this.esc(row.id)}">${this.esc(this.visitTitle(row))}</button>`).join('')}</div><p>Choose which open visit to check in for.</p>`
      : '';
    const onTime = this.withinCheckInWindow();
    const warn = onTime
      ? `<div class="notice green">You’re within 15 minutes of ${this.esc(this.appointmentLabel())}.</div>`
      : `<div class="notice">This check-in is not within 15 minutes of the appointment (${this.esc(this.appointmentLabel())}). You can still continue in this demo. A real clinic would ask you to wait or reschedule.</div>`;
    return `<div class="eyebrow">Visit day</div><h2 class="mt">Check in for this visit.</h2><p>${this.esc(j.doctor || 'Your clinician')} · ${this.esc(this.appointmentLabel())}<br>${this.esc(j.clinic || 'Clinic')}</p>${choices}${warn}<div class="document">${this.icon('check')}<div><h3>${j.checked_in ? 'Checked in' : 'Ready when you are'}</h3><small>${j.checked_in ? 'Next: record the visit, upload audio, or use the demo conversation.' : 'Confirm check-in to start the visit recording flow.'}</small></div></div>${this.btn(j.checked_in ? 'Checked in ✓' : 'Check in', 'check-in', j.checked_in ? '' : '')}`;
  },

  liveTranscript() {
    return String((this.thread.journey && this.thread.journey.live_transcript) || '').trim();
  },

  transcriptText() {
    if (this.liveTranscript()) return this.liveTranscript();
    if (this.usesDemoTranscript()) {
      return (this.scribeFixture && this.scribeFixture.transcript) || '';
    }
    return '';
  },

  renderTranscriptParas(text) {
    if (!text) {
      return `<p>No conversation yet. Record or upload audio to transcribe this visit, or tap Demo conversation to use the sample.</p>`;
    }
    return text.split(/\n\n+/).map((block) => {
      const line = block.replace(/\n/g, ' ').trim();
      const m = line.match(/^([^:]{2,48}):\s*(.*)$/);
      if (m) return `<p><strong>${this.esc(m[1])}</strong> “${this.esc(m[2])}”</p>`;
      return `<p>${this.esc(line)}</p>`;
    }).join('');
  },

  transcriptBody() {
    const live = this.liveTranscript();
    const demo = this.usesDemoTranscript();
    const text = this.transcriptText();
    const tag = live
      ? this.tag('Live transcript', '')
      : demo
        ? this.tag('Demo conversation', 'gray')
        : this.tag('No transcript yet', 'peach');
    const hint = live
      ? 'This came from Grok speech-to-text. Speaker labels are a heuristic — a clinician still reviews before anything becomes an order.'
      : demo
        ? 'Demo conversation selected. Draft summary and cost estimates will use the sample (boilerplate) numbers.'
        : this.audioDisclaimer();
    return `<div class="row" style="justify-content:space-between"><h2>Capture this visit.</h2>${tag}</div><p>Record or upload the conversation. We transcribe it and draft a summary. The sample conversation stays hidden unless you choose Demo conversation.</p>${this.recordControls('visit')}<div class="mt">${this.btn(demo ? 'Demo conversation ✓' : 'Demo conversation', 'toggle-demo-transcript', demo ? '' : 'secondary')}</div><div class="transcript">${this.renderTranscriptParas(text)}</div><div class="notice">${this.esc(hint)}</div>`;
  },

  soapBody() {
    const j = this.thread.journey || {};
    const soap = (this.encounter && this.encounter.soap) || {};
    const source = (this.encounter && this.encounter.source) || 'seeded';
    const live = this.liveTranscript();
    const sum = this.extractiveSummary || {};
    const bullets = (sum.bullets || []).map((b) => `<li style="margin:6px 0;font-size:12px">${this.esc(b)}</li>`).join('');
    const sumBlock = bullets
      ? `<div class="notice green" style="margin-bottom:22px"><strong style="display:block;margin-bottom:8px">Extractive summary (Sumy LexRank)</strong><ul style="margin:0;padding-left:18px">${bullets}</ul><small style="display:block;margin-top:10px">${this.esc(sum.note || 'Draft only — clinician must review.')}</small></div>`
      : `<div class="notice" style="margin-bottom:22px">Sumy extractive summary unavailable. SOAP/Plan below still uses the scribe draft.</div>`;
    const intro = this.usesDemoTranscript()
      ? 'Demo conversation: sample SOAP/Plan and boilerplate cost estimates. Nothing becomes an order without clinician review.'
      : live && source === 'llm'
        ? 'Drafted from your transcribed visit. Nothing becomes an order without clinician review.'
        : live
          ? 'Your recording was transcribed. Sumy summarizes it; SOAP may still use the sample note until Gemini can draft from the live text.'
          : 'Draft summary from this visit. Nothing becomes an order without clinician review.';
    const rows = [
      ['S', 'What you shared', soap.subjective || 'Fatigue and increased thirst; taking metformin twice daily.'],
      ['O', 'What’s on file', soap.objective || 'Current metformin routine. No new lab result is available in this demo.'],
      ['A', 'What to review', soap.assessment || 'Diabetes follow-up. Any change in assessment needs clinician verification.'],
      ['P', 'Suggested next steps', soap.plan_summary || 'Review HbA1c testing, current medicines, possible add-on therapy, and a follow-up visit.'],
    ];
    return `<h2>Your visit, in plain language.</h2><p>${intro}</p>${sumBlock}${rows.map(([l, t, p]) => `<div class="soap"><span class="letter">${l}</span><div><h3>${t}</h3><p>${this.esc(p)}</p></div></div>`).join('')}<label class="check"><input type="checkbox" id="reviewed" ${j.reviewed ? 'checked' : ''}>Simulate clinician review of this sample summary and plan.</label><small>Demo role simulation only. This is not a signed clinical note. The app does not finalize a diagnosis. Prior authorization, if needed, is separate from any later claim.</small>`;
  },

  async loadScribeFixture() {
    try {
      this.scribeFixture = await API.getScribeFixture();
    } catch (err) {
      this.scribeFixture = null;
      this.toast(err.message);
    }
  },

  async draftScribeEncounter() {
    const live = this.liveTranscript();
    const demo = this.usesDemoTranscript();
    if (demo && !this.scribeFixture) await this.loadScribeFixture();
    const fixture = (this.scribeFixture && this.scribeFixture.transcript) || '';
    const transcript = live || (demo ? fixture : '');
    if (!transcript) {
      this.encounter = null;
      this.extractiveSummary = null;
      this.toast('Record, upload, or choose Demo conversation first.');
      return;
    }
    try {
      if (live && !demo) {
        try {
          const result = await API.draftScribe({ transcript, use_seeded: false });
          this.encounter = result.encounter || result;
        } catch (err) {
          this.toast(`${err.message} Using the sample SOAP until Gemini can draft from your recording.`);
          const result = await API.draftScribe({ transcript, use_seeded: true });
          this.encounter = result.encounter || result;
        }
      } else {
        const result = await API.draftScribe({ transcript, use_seeded: true });
        this.encounter = result.encounter || result;
      }
      try {
        this.extractiveSummary = await API.summarizeScribe({ transcript, sentence_count: 5 });
      } catch (sumErr) {
        this.extractiveSummary = null;
        this.toast(sumErr.message || 'Sumy summary failed');
      }
    } catch (err) {
      this.encounter = null;
      this.toast(err.message);
    }
  },

  pickRecordMime() {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
    ];
    for (const type of candidates) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(type)) return type;
    }
    return '';
  },

  stopRecordTracks() {
    if (this.recordStream) {
      this.recordStream.getTracks().forEach((track) => track.stop());
      this.recordStream = null;
    }
  },

  clearRecordTimer() {
    if (this.recordTimerId) {
      clearInterval(this.recordTimerId);
      this.recordTimerId = null;
    }
  },

  startRecordTimer() {
    this.recordStartedAt = Date.now();
    this.clearRecordTimer();
    this.recordTimerId = setInterval(() => {
      const leftMs = this.RECORD_MAX_MS - (Date.now() - this.recordStartedAt);
      const left = Math.max(0, Math.ceil(leftMs / 1000));
      const el = document.getElementById('scribe-record-status');
      const label = `Listening… ${left}s left (max 2 minutes). Keep the mic close, then tap Stop & transcribe.`;
      this.recordStatus = label;
      if (el) {
        const pulse = el.querySelector('.record-pulse');
        el.textContent = '';
        if (pulse) el.appendChild(pulse);
        el.appendChild(document.createTextNode(label));
      }
      if (leftMs <= 0) {
        this.clearRecordTimer();
        this.toast('Reached the 2-minute limit. Transcribing…');
        this.stopVisitRecord();
      }
    }, 250);
  },

  cancelRecording() {
    this.discardRecording = this.recording || Boolean(this.mediaRecorder);
    this.recording = false;
    this.sttBusy = false;
    this.clearRecordTimer();
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try { this.mediaRecorder.stop(); } catch (_) { /* ignore */ }
    }
    this.stopRecordTracks();
    this.recordChunks = [];
    this.recordStatus = '';
  },

  async toggleVisitRecord(purpose) {
    this.recordPurpose = purpose === 'symptoms' ? 'symptoms' : 'visit';
    if (this.sttBusy && !this.recording) return;
    if (this.recording) {
      this.stopVisitRecord();
      return;
    }
    await this.startVisitRecord();
  },

  async startVisitRecord() {
    if (!window.isSecureContext) {
      this.toast('Mic needs http://localhost (or HTTPS).');
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.toast('Mic not available. Upload an audio file instead.');
      return;
    }
    if (!window.MediaRecorder) {
      this.toast('This browser cannot record audio. Upload a file instead.');
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
        this.recordStatus = 'Mic blocked — allow Microphone in the address bar.';
        this.toast('Allow microphone access, then tap Record this visit again.');
      } else if (name === 'NotFoundError') {
        this.toast('No microphone found. Upload an audio file instead.');
      } else {
        this.toast(err.message || 'Could not access the microphone.');
      }
      this.render();
      return;
    }

    try {
      this.discardRecording = false;
      this.recordChunks = [];
      const mime = this.pickRecordMime();
      this.mediaRecorder = mime
        ? new MediaRecorder(this.recordStream, { mimeType: mime })
        : new MediaRecorder(this.recordStream);

      this.mediaRecorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) this.recordChunks.push(ev.data);
      };
      this.mediaRecorder.onerror = () => {
        this.toast('Recording error. Try again.');
        this.cancelRecording();
        this.render();
      };
      this.mediaRecorder.onstop = async () => {
        const mimeType = (this.mediaRecorder && this.mediaRecorder.mimeType) || mime || 'audio/webm';
        const ext = mimeType.includes('mp4') ? 'm4a' : (mimeType.includes('ogg') ? 'ogg' : 'webm');
        this.stopRecordTracks();
        const blob = new Blob(this.recordChunks, { type: mimeType });
        this.recordChunks = [];
        if (this.discardRecording) {
          this.discardRecording = false;
          this.sttBusy = false;
          this.recordStatus = '';
          return;
        }
        if (!blob.size) {
          this.sttBusy = false;
          this.recordStatus = 'No audio captured. Tap Record this visit again.';
          this.toast('Recording was empty — speak for a few seconds.');
          this.render();
          return;
        }
        const file = new File([blob], `visit-recording.${ext}`, { type: mimeType });
        await this.transcribeVisitFile(file);
      };

      this.mediaRecorder.start(250);
      this.recording = true;
      this.recordStatus = 'Listening… 120s left (max 2 minutes). Keep the mic close, then tap Stop & transcribe.';
      this.startRecordTimer();
      this.render();
      this.toast('Listening — max 2 minutes. Tap Stop & transcribe when done.');
    } catch (err) {
      this.stopRecordTracks();
      this.recording = false;
      this.toast(err.message || 'Could not start the recorder.');
      this.render();
    }
  },

  stopVisitRecord() {
    if (!this.mediaRecorder || !this.recording) return;
    this.recording = false;
    this.sttBusy = true;
    this.clearRecordTimer();
    this.recordStatus = 'Sending the recording to Grok…';
    this.render();
    try {
      if (this.mediaRecorder.state !== 'inactive') this.mediaRecorder.stop();
    } catch (err) {
      this.sttBusy = false;
      this.toast(err.message || 'Failed to stop recording.');
      this.render();
    }
  },

  pickVisitAudio() {
    const input = document.getElementById('visit-audio');
    if (input) input.click();
  },

  async toggleDemoTranscript() {
    this.cancelRecording();
    if (this.thread.journey?.demo_transcript && !this.liveTranscript()) {
      this.saveThread({
        journey: {
          ...this.thread.journey,
          demo_transcript: false,
          transcript_source: '',
          stt_meta: '',
        },
      });
      this.recordStatus = '';
      this.render();
      this.toast('Demo conversation cleared.');
      return;
    }
    await this.loadScribeFixture();
    this.saveThread({
      journey: {
        ...this.thread.journey,
        demo_transcript: true,
        live_transcript: '',
        transcript_source: 'fixture',
        stt_meta: 'Demo conversation',
      },
    });
    this.recordStatus = 'Demo conversation selected. Continue to draft the sample summary.';
    this.render();
    this.toast('Demo conversation selected.');
  },

  async transcribeVisitFile(file) {
    if (!file) {
      this.toast('Choose an audio file first, or tap Record this visit.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      this.toast(`${file.name} is larger than 8MB. Keep the demo recording short.`);
      return;
    }
    this.sttBusy = true;
    this.recordStatus = `Grok is transcribing ${file.name}…`;
    this.render();
    try {
      const result = await API.transcribeScribeAudio(file);
      const labeled = (result.text || '').trim();
      const plain = (result.text_plain || labeled).trim();
      if (!labeled && !plain) throw new Error('Grok returned an empty transcript.');
      const n = result.speaker_count || 0;
      const roles = (result.speakers || [])
        .map((row) => row.label || row.role)
        .filter(Boolean)
        .join(' + ');
      if (this.recordPurpose === 'symptoms') {
        this.saveThread({
          journey: {
            ...this.thread.journey,
            symptoms: plain,
            symptoms_source: 'stt',
          },
        });
        this.recordStatus = 'Transcribed your reason. Edit the text if needed, then continue.';
        this.toast('Visit reason transcribed.');
      } else {
        this.saveThread({
          journey: {
            ...this.thread.journey,
            live_transcript: labeled || plain,
            transcript_source: 'live',
            demo_transcript: false,
            stt_meta: result.diarized
              ? `Grok · ${n} voices → ${roles || 'Doctor / Patient'}`
              : `Grok · ${n || 1} voice`,
          },
        });
        this.recordStatus = result.diarized
          ? `Ready — ${roles || 'Doctor / Patient'}. Continue to draft the summary.`
          : ((result.warnings && result.warnings[0]) || 'Transcribed. Continue to draft the summary.');
        this.toast(result.diarized ? `Split ${n} speakers (${roles}).` : 'Transcribed. Continue for a draft summary.');
      }
    } catch (err) {
      this.recordStatus = 'Transcription failed — try again or keep the sample transcript.';
      this.toast(err.message);
    } finally {
      this.sttBusy = false;
      this.recording = false;
      this.render();
    }
  },

  async approveScribeEncounter(reviewed) {
    this.saveThread({ journey: { ...this.thread.journey, reviewed } });
    if (!reviewed || !this.encounter) return;
    try {
      const result = await API.approveScribe(this.encounter);
      this.encounter = result.encounter || this.encounter;
      this.orders = result.orders || [];
    } catch (err) {
      this.toast(err.message);
    }
  },

  costBody() {
    const estimate = this.costEstimate || this.coverageSnap.visit_cost_estimate;
    const e = this.coverageSnap.eligibility;
    if (!estimate) {
      return `<h2>A little visibility into costs.</h2><p>Loading mock amounts from your saved plan…</p><div class="notice">Guess only — not a bill or a coverage decision. PA-may-be-required is not a price.</div>`;
    }
    const lines = estimate.likely_visits || [];
    const rows = lines.map((line) => {
      const allowed = line.allowed;
      const you = line.patient_owes_low;
      const planPays = (allowed != null && you != null) ? Math.max(0, Number(allowed) - Number(you)) : null;
      return `<tr><td>${this.esc(line.description)} <small>(${this.esc(line.code)})</small><br><small>${this.esc(line.basis || '')}</small></td><td>${this.money(allowed)}</td><td>${this.money(planPays)}</td><td>${this.money(you)}</td></tr>`;
    }).join('');
    return `<h2>A little visibility into costs.</h2><p>Mock amounts from Dave’s visit/cost guess for this saved plan. An estimate, not a bill or a coverage decision.</p><table class="cost-table"><thead><tr><th>SUGGESTED SERVICE</th><th>MOCK ALLOWED</th><th>PLAN PAYS</th><th>YOU PAY</th></tr></thead><tbody>${rows}<tr><td>Add-on medicine</td><td colspan="3">${this.tag('PA may be required', 'peach')} — not priced as if it were allowed</td></tr></tbody></table><div class="cost-total">${this.money(estimate.patient_owes_low)}${estimate.patient_owes_high !== estimate.patient_owes_low ? `–${this.money(estimate.patient_owes_high)}` : ''} <small>estimated you-pay · medicine excluded</small></div><p>${this.esc(estimate.disclaimer || '')}</p><p>Coverage status: ${this.esc(e?.status || 'unknown')} · ${this.esc(e?.network_name || '')}. Add-on therapy is a PA flag, not a claim.</p>`;
  },

  followups() {
    const j = this.thread.journey || {};
    return `<div class="narrow">${this.head('You don’t have to hold it all.', 'Your visit is saved. Here’s who takes the next step.')}<section class="card">${[['Clinic', 'Review your visit summary', j.reviewed ? 'Review was simulated in this demo.' : 'Your draft is waiting for clinician review.'], ['You', 'Plan your lab visit', j.reviewed ? 'Mock HbA1c order is ready.' : 'Wait for the clinic to confirm the order.'], ['Clinic + insurance', 'Review any add-on medicine', 'A prior authorization, if needed, is a separate step from any later insurance claim.'], ['You + clinic', 'Keep the conversation going', 'Discuss a follow-up appointment in about 3 months.']].map(([who, t, d]) => `<div class="task-row"><div style="flex:1"><span class="eyebrow">${who}</span><h3 style="margin-top:9px">${t}</h3><p style="font-size:12px">${d}</p></div>${this.icon('arrow')}</div>`).join('')}<div class="actions">${this.btn('Prepare clinic packet', 'packet', 'secondary')}${this.btn('Back to Today', 'today')}</div></section></div>`;
  },

  history() {
    let content = '';
    if (this.selectedVisit) {
      const v = this.thread.visits.find((x) => x.id === this.selectedVisit);
      if (!v) {
        this.selectedVisit = null;
        return this.history();
      }
      content = `<button class="back" data-action="history-back" type="button">${this.icon('back')}My visits</button><h2>${this.esc(v.reason)}</h2><p class="mt">${this.esc(v.date)} · ${this.esc(v.doctor)}</p><div class="rule"></div>${[['What happened', v.summary], ['What’s waiting', v.reviewed ? 'HbA1c result not available. Follow-up to be discussed.' : 'Clinic review of this draft summary and plan.'], ['Who acts', 'Clinic reviews the plan; you arrange tests once orders are ready.'], ['Evidence', 'Sample visit conversation and existing metformin fixture.'], ['Coverage at this visit', `${v.coverage} · mock snapshot`]].map(([t, p]) => `<h3 class="mt">${t}</h3><p style="font-size:12px;margin-top:7px">${this.esc(p)}</p>`).join('')}<div class="notice">Prior authorization: not submitted. Claim: not submitted. These are separate insurance events. PA ≠ claim.</div>${this.btn('View in clinic packet', 'packet')}`;
    } else {
      content = `<div class="tabs"><button type="button" class="${this.historyTab === 'visits' ? 'active' : ''}" data-tab="visits">My visits</button><button type="button" class="${this.historyTab === 'packet' ? 'active' : ''}" data-tab="packet">For the clinic</button></div>`;
      if (this.historyTab === 'visits') {
        const past = this.thread.visits.length
          ? this.thread.visits.map((v) => `<button class="visit-row" data-visit="${v.id}" type="button"><div class="tile-icon">${this.icon('file')}</div><div><small>${this.esc(v.date)}</small><h3>${this.esc(v.reason)}</h3><small>${this.esc(v.doctor)} · ${v.reviewed ? 'Review simulated' : 'Draft — awaiting review'}</small></div>${this.icon('arrow')}</button>`).join('')
          : `<div class="empty">${this.icon('history')}<h2>Your story starts here.</h2><p>Complete a demo visit and it will appear in your history. You can also start another visit without finishing this one.</p>${this.btn(`${this.icon('plus')} New visit`, 'new-visit')}</div>`;
        content += `${this.historyOpenVisits()}${this.thread.visits.length ? `<div class="section-heading"><h2>Past visits</h2></div>${past}` : (this.openJourneys().length ? `<div class="section-heading"><h2>Past visits</h2></div><p style="font-size:12px">None saved yet.</p>` : past)}`;
      } else {
        content += `<h2>Don’t start from scratch.</h2><p class="mt">A patient history packet from the same saved care record. This is a record export — not an appeal or PA letter. Generated letters still need human review before download.</p><div class="notice green">Record export only. This is not a prescription, appeal letter, or verified medical record.</div><pre class="packet">${this.esc(this.historyPacket())}</pre><div class="actions"><small>Includes visits, medicines, tests, and coverage.</small><div class="row">${this.btn(`${this.icon('download')} Download .md`, 'export', 'secondary')}${this.btn(`${this.icon('download')} Download PDF`, 'export-pdf')}</div></div>`;
      }
    }
    return `<div class="narrow">${this.head('Your story stays with you.', 'Every visit adds a little more context for the next one.')}<section class="card journey-panel">${content}</section></div>`;
  },

  medicines() {
    return `${this.head('Small routines. Better continuity.', 'Your existing medicines, today’s doses, and a little help planning ahead.')}<div class="grid"><section class="card"><div class="section-heading"><h2>Today’s medicines</h2>${this.tag('September 24', 'gray')}</div><div class="row"><div class="tile-icon peach">${this.icon('pill')}</div><div><h3>Metformin</h3><p style="font-size:12px">1000 mg · twice daily · 8:00 AM / 8:00 PM · fixture schedule</p></div></div><div class="rule"></div>${[['morning', '8:00 AM', 'Morning dose'], ['evening', '8:00 PM', 'Evening dose']].map(([key, time, title]) => `<div class="task-row" style="flex-wrap:wrap"><div style="flex:1"><small>${time}</small><h3 style="margin-top:6px">${title}</h3>${this.tag(this.thread.doses[key], this.thread.doses[key] === 'missed' ? 'peach' : '')}</div>${this.btn('Taken', 'dose', 'secondary', `data-dose="${key}" data-status="taken"`)}${this.btn('Missed', 'dose', 'secondary', `data-dose="${key}" data-status="missed"`)}</div>`).join('')}<p class="mt" style="font-size:11px">Logging a dose only updates this demo. CareLoop does not change your medicine or dose. PA approval ≠ paid claim.</p></section><div class="stack"><section class="card insurance-mini"><div class="eyebrow">A little ahead of time</div><h2 class="mt">12 days left.</h2><p class="mt">Your sample supply is running low. Prepare a refill note for your clinic.</p><div class="mt">${this.btn(this.thread.refill ? 'View refill draft' : 'Draft refill request', 'refill', 'secondary')}</div></section></div></div>`;
  },

  tests() {
    return `<div class="narrow">${this.head('Your tests, without the paper trail.', 'See what’s planned, what’s waiting, and the documents that go with it.')}<section class="card"><div class="section-heading"><h2>HbA1c blood test</h2>${this.tag(this.thread.journey?.reviewed ? 'Mock order ready' : 'Awaiting review', 'peach')}</div><p>No result is available. Your clinician reviews and interprets results. CareLoop does not interpret labs.</p><div class="rule"></div><div class="document">${this.icon('file')}<div style="flex:1"><h3>Sample test document</h3><small>Preview only · not a real requisition</small></div>${this.btn('Preview', 'test-doc', 'secondary')}</div></section></div>`;
  },

  insurance() {
    const c = this.coverageLabel();
    if (!c) {
      return `<div class="narrow">${this.head('Insurance, a little clearer.', 'Your plan details stay alongside your care.')}<section class="card empty">${this.icon('shield')}<h2>No plan on file.</h2><p>You can add a sample plan or continue without estimates. Skipping insurance skips the estimated-costs step on the visit.</p><div class="notice">Sample card is Jane Doe / Aetna / AETNA12345 — Stedi’s canned sandbox member. Demo key slots live under Profile.</div>${this.btn('Add insurance', 'update-insurance')}</section></div>`;
    }
    const e = this.coverageSnap.eligibility || {};
    return `<div class="narrow">${this.head('Insurance, a little clearer.', 'One place for your plan, estimated costs, and what needs a second look.')}<section class="card journey-panel"><div class="insurance-card"><div class="row" style="justify-content:space-between"><span>careloop / coverage</span>${this.icon('shield')}</div><h2>${this.esc(c.payer)}</h2><strong>${this.esc(this.thread.patient.name)}</strong><div class="split"><div><small>MEMBER ID</small><p style="color:white">${this.esc(c.member || 'Not provided')}</p></div><div><small>DOB</small><p style="color:white">${this.esc(c.dob || 'Not provided')}</p></div></div></div><div class="section-heading"><h3>Coverage snapshot</h3>${this.tag(`${c.status} · ${this.coverageSource()}`, c.status === 'active' ? '' : 'peach')}</div><div class="coverage-stats"><div><small>PCP copay</small><strong>${c.status === 'active' ? this.money(c.copay) : '—'}</strong><small>estimated</small></div><div><small>Deductible left</small><strong>${c.status === 'active' ? this.money(c.deductible) : '—'}</strong><small>${this.coverageSource()} remaining</small></div><div><small>Plan type</small><strong>${this.esc(c.plan || '—')}</strong><small>${this.esc(e.network_name || 'demo plan')}</small></div></div><div class="notice">${this.esc(this.eligibilityNote())}</div>${e.disclaimer ? `<p class="mt" style="font-size:12px">${this.esc(e.disclaimer)}</p>` : ''}<div class="actions">${this.btn('Update plan details', 'update-insurance', 'secondary')}${this.btn('Refresh coverage snapshot', 'refresh-eligibility')}${this.link('Start a visit', 'start')}</div><div class="rule"></div><h3>Two different insurance moments</h3><p class="mt" style="font-size:12px">Prior authorization happens before certain care is covered. A claim happens during or after billing. An approved authorization does not mean a claim has been paid.</p><div class="document mt"><div style="flex:1"><h3>Insurance Claims Management</h3><small>Coming soon · no claims are submitted in this demo</small></div></div><p class="mt" style="font-size:11px">PA / appeal letter drafts (watermark + human review) remain on a secondary surface, not in this hamburger.</p><a class="link" href="/letters">Open letter drafts ${this.icon('arrow')}</a></section></div>`;
  },

  profile() {
    const p = this.thread.patient;
    return `<div class="narrow">${this.head('A space that’s yours.', 'General details for your fictional patient profile.')}<section class="card journey-panel"><div class="row"><div class="avatar">${this.esc(this.initials(p.name))}</div><div><h2>${this.esc(p.name)}</h2><small>Fictional demo patient${App.user ? ` · signed in as ${this.esc(App.user.username)}` : ''}</small></div></div><div class="rule"></div><form id="profile-form"><label class="field">Display name<input name="name" value="${this.esc(p.name)}" required maxlength="60"></label><label class="field">Demo email<input type="email" name="email" value="${this.esc(p.email)}" required></label><label class="field">ZIP code<input name="zip" pattern="[0-9]{5}" value="${this.esc(p.zip)}" required></label><button class="btn" type="submit">Save profile</button></form>${this.envPanel()}<div class="rule"></div><h3>Ready for another walkthrough?</h3><p style="font-size:12px;margin:10px 0 20px">Reset only this demo’s saved visits, doses, and insurance to the sample record.</p>${this.btn('Reset demo data', 'reset', 'secondary')}</section></div>`;
  },

  render() {
    if (!API.getToken()) {
      this.renderLogin();
      return;
    }
    const pages = {
      Today: () => this.today(),
      Setup: () => this.setup(),
      Journey: () => this.journey(),
      Followups: () => this.followups(),
      History: () => this.history(),
      'Upcoming visits': () => this.upcoming(),
      Medicines: () => this.medicines(),
      Tests: () => this.tests(),
      Insurance: () => this.insurance(),
      Profile: () => this.profile(),
    };
    const content = (pages[this.view] || pages.Today)();
    this.shell(content);
    this.bindForms();
  },

  bindForms() {
    const insurance = document.getElementById('insurance-form');
    if (insurance) {
      insurance.addEventListener('submit', (e) => {
        e.preventDefault();
        this.saveInsuranceForm(e.currentTarget);
      });
    }
    const profile = document.getElementById('profile-form');
    if (profile) {
      profile.addEventListener('submit', (e) => {
        e.preventDefault();
        const d = new FormData(e.currentTarget);
        this.saveThread({
          patient: {
            name: String(d.get('name') || '').trim() || 'Jane Doe',
            email: d.get('email'),
            zip: d.get('zip'),
          },
        });
        this.render();
        this.toast('Demo profile saved');
      });
    }
    const symptom = document.getElementById('symptoms');
    if (symptom) {
      symptom.addEventListener('input', (e) => {
        this.saveThread({ journey: { ...this.thread.journey, symptoms: e.target.value } });
      });
    }
    const review = document.getElementById('reviewed');
    if (review) {
      review.addEventListener('change', (e) => {
        this.approveScribeEncounter(e.target.checked);
      });
    }
    const visitAudio = document.getElementById('visit-audio');
    if (visitAudio) {
      visitAudio.addEventListener('change', () => {
        const file = visitAudio.files && visitAudio.files[0];
        if (file) this.transcribeVisitFile(file);
      });
    }
  },

  async saveInsuranceForm(form) {
    const d = new FormData(form);
    const payer = String(d.get('payer') || '').trim();
    if (!payer) {
      this.toast('Pick an insurance company first.');
      return;
    }
    const dob = String(d.get('dob') || '').trim();
    if (!dob) {
      this.toast('Date of birth is required.');
      return;
    }
    try {
      await API.saveCoverage({
        payer_name: payer,
        member_name: String(d.get('member_name') || '').trim(),
        member_id: String(d.get('member') || '').trim(),
        group_number: String(d.get('group') || '').trim(),
        date_of_birth: dob,
        zip: String(d.get('zip') || '').trim(),
      });
      this.rememberCoverage(await this.confirmFromProfile({
        payer_name: payer,
        member_id: String(d.get('member') || '').trim(),
        member_name: String(d.get('member_name') || '').trim(),
        date_of_birth: dob,
      }));
      if (this.coverageSnap.profile?.zip) {
        this.thread.patient.zip = this.coverageSnap.profile.zip;
        this.saveThread();
      }
      this.navigate('Insurance');
      this.toast(this.coverageSource() === 'sandbox'
        ? 'Plan saved. Showing sandbox eligibility for review.'
        : 'Plan saved. Showing mock coverage for review.');
      if (!this.insuranceReturn) {
        this.modal(
          'Your record has a starting point.',
          '<p>Your sample coverage is saved. Next, tell us what brings you in.</p>',
          this.btn('Start my visit', 'start') + this.btn('Go to Today', 'today', 'secondary'),
        );
      }
    } catch (err) {
      this.toast(err.message);
    }
  },

  completeVisit() {
    const j = this.thread.journey;
    if (!j || j.completed) return;
    const c = this.coverageLabel();
    const done = {
      id: j.id || Date.now().toString(),
      date: 'September 24, 2026',
      reason: j.symptoms || 'Visit',
      doctor: j.doctor,
      reviewed: j.reviewed,
      summary: 'Draft plan: discuss HbA1c testing, current metformin and possible add-on therapy with the clinician.',
      coverage: c ? c.payer : 'No plan on file',
    };
    const remaining = this.openJourneys().filter((row) => row.id !== done.id);
    this.saveThread({
      visits: [done, ...this.thread.visits],
      openVisits: remaining,
      journey: { ...j, completed: true },
    });
    this.clearVisitRuntime();
  },

  async loadCostGuess() {
    const j = this.thread.journey;
    try {
      const demo = this.usesDemoTranscript();
      const symptoms = demo
        ? 'Fatigue, increased thirst, and a diabetes follow-up.'
        : j.symptoms;
      await API.saveCoverageIntake({
        symptoms,
        use_fixture_prior_visit: Boolean(j.prior) || demo,
      });
      this.rememberCoverage(await API.guessVisitCost({ symptoms }));
      this.costEstimate = this.coverageSnap.visit_cost_estimate;
    } catch (err) {
      this.costEstimate = null;
      this.toast(err.message);
    }
  },

  async goNext() {
    if (this.recording || this.sttBusy) {
      this.toast(this.recording ? 'Tap Stop & transcribe first.' : 'Wait for transcription to finish.');
      return;
    }
    const j = this.thread.journey;
    if (j.step === 1 && !String(j.symptoms || '').trim()) {
      this.toast('Add a few words about the reason for your visit.');
      return;
    }
    if (j.step === 1) {
      try {
        const snap = await API.saveCoverageIntake({
          symptoms: j.symptoms,
          use_fixture_prior_visit: Boolean(j.prior),
        });
        this.coverageSnap = snap;
        this.saveThread({
          journey: {
            ...this.thread.journey,
            suggested_specialty: snap.intake?.suggested_specialty || 'pcp',
            suggested_specialty_label: snap.intake?.suggested_specialty_label || 'Primary care',
          },
        });
      } catch (err) {
        this.toast(err.message);
      }
    }
    if (j.step === 2 && !String(j.doctor || '').trim()) {
      this.toast('Choose a clinician to continue.');
      return;
    }
    if (j.step === 3) {
      if (!String(j.slot || '').trim()) {
        this.toast('Choose a time to save this request.');
        return;
      }
      this.saveThread({ journey: { ...this.thread.journey, booked: true, step: 3 } });
      this.navigate('Upcoming visits');
      this.toast('Visit confirmed. Check in from Upcoming visits when you arrive.');
      return;
    }
    if (j.step === 4 && !j.checked_in) {
      this.toast('Check in for this visit first.');
      return;
    }
    if (j.step === 5 && !this.liveTranscript() && !this.usesDemoTranscript()) {
      this.toast('Record, upload, or choose Demo conversation first.');
      return;
    }
    if (j.step === 8) {
      this.completeVisit();
      this.navigate('Followups');
      return;
    }
    let next = j.step + 1;
    if (j.step === 6 && !this.eligibilityOnFile()) next = 8;
    this.saveThread({ journey: { ...this.thread.journey, step: next } });
    if (next === 2) await this.loadNetwork();
    if (next === 6) await this.draftScribeEncounter();
    if (next === 7) await this.loadCostGuess();
    this.render();
    window.scrollTo(0, 0);
  },

  goPrevious() {
    if (this.recording || this.sttBusy) {
      this.toast(this.recording ? 'Tap Stop & transcribe first.' : 'Wait for transcription to finish.');
      return;
    }
    const j = this.thread.journey;
    if (j.step === 1) {
      this.navigate('Today');
      return;
    }
    if (j.step === 4) {
      this.navigate('Upcoming visits');
      return;
    }
    let prev = j.step - 1;
    if (j.step === 8 && !this.eligibilityOnFile()) prev = 6;
    this.saveThread({ journey: { ...j, step: prev } });
    this.render();
  },

  bindClicks() {
    if (this.clickBound) return;
    this.clickBound = true;
    document.addEventListener('click', (e) => {
      const el = e.target.closest('button');
      if (!el) return;
      const d = el.dataset;
      if (d.nav) {
        this.navigate(d.nav);
        return;
      }
      if (d.tab) {
        this.historyTab = d.tab;
        this.selectedVisit = null;
        this.render();
        return;
      }
      if (d.visit) {
        this.selectedVisit = d.visit;
        this.render();
        return;
      }
      if (d.openVisit) {
        this.resumeOpenVisit(d.openVisit);
        return;
      }
      if (d.checkinVisit) {
        this.openUpcomingVisit(d.checkinVisit);
        return;
      }
      if (d.upcomingVisit) {
        this.openUpcomingVisit(d.upcomingVisit);
        return;
      }
      if (d.symptom) {
        const s = this.thread.journey.symptoms;
        const next = s.toLowerCase().includes(d.symptom.toLowerCase())
          ? s.replace(new RegExp(d.symptom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), '').replace(/,\s*,/g, ',').replace(/^,\s*|,\s*$/g, '')
          : (s ? `${s}, ` : '') + d.symptom;
        this.saveThread({ journey: { ...this.thread.journey, symptoms: next } });
        this.render();
        return;
      }
      if (d.slot) {
        this.saveThread({ journey: { ...this.thread.journey, slot: d.slot } });
        this.render();
        return;
      }
      if (!d.action) return;
      this.handleAction(d, el);
    });
  },

  async handleAction(d) {
    switch (d.action) {
      case 'close':
        this.closeModal();
        break;
      case 'menu': {
        document.querySelector('.sidebar')?.classList.toggle('open');
        document.querySelector('.overlay')?.classList.toggle('open');
        break;
      }
      case 'logout':
        this.closeModal();
        await this.logout();
        break;
      case 'notifications':
        this.modal(
          'Nothing lost in the shuffle.',
          `<p>Your evening metformin dose is ${this.esc(this.thread.doses.evening)}. Your clinic packet is ready to prepare.</p>`,
          this.btn('View medicines', 'medicines'),
        );
        break;
      case 'today':
        this.closeModal();
        this.navigate('Today');
        break;
      case 'start':
        this.closeModal();
        this.startVisit();
        break;
      case 'new-visit':
        this.closeModal();
        this.startNewVisit();
        break;
      case 'upcoming':
      case 'open-upcoming':
        this.closeModal();
        if (d.action === 'open-upcoming' && this.thread.journey && this.isBookedVisit(this.thread.journey)) {
          this.openUpcomingVisit(this.thread.journey.id);
        } else {
          this.navigate('Upcoming visits');
        }
        break;
      case 'medicines':
        this.closeModal();
        this.navigate('Medicines');
        break;
      case 'tests':
        this.navigate('Tests');
        break;
      case 'insurance':
        this.navigate('Insurance');
        break;
      case 'packet':
        this.closeModal();
        this.historyTab = 'packet';
        this.navigate('History');
        break;
      case 'latest-visit':
        this.view = 'History';
        this.historyTab = 'visits';
        this.selectedVisit = this.thread.visits[0]?.id;
        this.render();
        break;
      case 'history-back':
        this.selectedVisit = null;
        this.historyTab = 'visits';
        this.render();
        break;
      case 'update-insurance':
        this.insuranceReturn = true;
        this.insuranceMode = 'hub';
        await this.loadPayers();
        this.navigate('Setup');
        break;
      case 'insurance-hub':
        this.insuranceMode = 'hub';
        this.render();
        break;
      case 'sample-card':
        try {
          this.rememberCoverage(await API.scanCoverage({
            payer_name: this.GOLDEN_PAYER,
            image_note: 'fixture:front-of-card',
          }));
          await this.loadPayers();
          this.insuranceMode = 'sample';
          this.render();
        } catch (err) {
          this.toast(err.message);
        }
        break;
      case 'manual-card':
        await this.loadPayers();
        this.insuranceMode = 'manual';
        this.render();
        break;
      case 'read-images':
        try {
          const card = await this.filePayload('card-file');
          const sbc = await this.filePayload('sbc-file');
          if (!card && !sbc) {
            this.toast('Choose a card or SBC file first, or use the sample card.');
            return;
          }
          const form = document.getElementById('insurance-form');
          const payer = form ? String(new FormData(form).get('payer') || '').trim() : this.GOLDEN_PAYER;
          this.rememberCoverage(await API.scanCoverage({
            payer_name: payer,
            card_image_b64: card ? card.b64 : '',
            card_mime: card ? card.mime : '',
            card_filename: card ? card.filename : '',
            sbc_image_b64: sbc ? sbc.b64 : '',
            sbc_mime: sbc ? sbc.mime : '',
            sbc_filename: sbc ? sbc.filename : '',
          }));
          await this.loadPayers();
          this.insuranceMode = 'sample';
          this.render();
          const unread = (this.coverageSnap.profile?.unreadable || []).join(', ');
          this.toast(unread ? `Read upload. Check: ${unread}.` : 'Read the upload. Confirm the fields, especially date of birth.');
        } catch (err) {
          this.toast(err.message);
        }
        break;
      case 'refresh-eligibility':
        try {
          this.rememberCoverage(await this.confirmFromProfile());
          this.render();
          this.toast(this.coverageSource() === 'sandbox'
            ? 'Sandbox eligibility refreshed.'
            : 'Mock coverage refreshed. Add STEDI_API_KEY to run a live 271.');
        } catch (err) {
          this.toast(err.message);
        }
        break;
      case 'skip-insurance':
        this.navigate('Today');
        break;
      case 'prior-note':
        this.saveThread({ journey: { ...this.thread.journey, prior: true } });
        this.render();
        this.toast('Sample prior-visit note attached');
        break;
      case 'record-visit':
        await this.toggleVisitRecord('visit');
        break;
      case 'record-symptoms':
        await this.toggleVisitRecord('symptoms');
        break;
      case 'pick-visit-audio':
        this.recordPurpose = 'visit';
        this.pickVisitAudio();
        break;
      case 'pick-symptoms-audio':
        this.recordPurpose = 'symptoms';
        this.pickVisitAudio();
        break;
      case 'toggle-demo-transcript':
        await this.toggleDemoTranscript();
        break;
      case 'check-in':
        this.saveThread({ journey: { ...this.thread.journey, checked_in: true } });
        this.render();
        this.toast('Checked in. Continue to record the visit.');
        break;
      case 'choose-doctor': {
        const doc = this.clinicians.find((row) => row.npi === d.npi) || {};
        this.saveThread({
          journey: {
            ...this.thread.journey,
            doctor: doc.name || d.doctor,
            clinic: doc.address || '',
            suggested_specialty: doc.specialty || this.thread.journey.suggested_specialty,
            suggested_specialty_label: doc.specialty_label || this.thread.journey.suggested_specialty_label,
          },
        });
        this.render();
        break;
      }
      case 'previous':
        this.goPrevious();
        break;
      case 'next':
        await this.goNext();
        break;
      case 'dose':
        this.saveThread({ doses: { ...this.thread.doses, [d.dose]: d.status } });
        this.render();
        this.toast(`Dose marked ${d.status}. Saved to your demo record.`);
        break;
      case 'refill':
        this.saveThread({ refill: true });
        this.modal(
          'A note for your clinic.',
          `<div class="notice">DRAFT · Fictional demo · Not sent</div><p>For ${this.esc(this.thread.patient.name)}: Please review a refill of the existing metformin prescription. The sample record shows approximately 12 days of supply remaining. No dose change requested.</p><p class="mt">A clinician needs to review and authorize any refill. This is not e-prescribing.</p>`,
        );
        break;
      case 'test-doc':
        this.modal(
          'HbA1c · sample document',
          `<div class="notice">DEMO DOCUMENT · Not a valid lab requisition</div><p>Patient: ${this.esc(this.thread.patient.name)}<br>Status: ${this.thread.journey?.reviewed ? 'Mock order ready' : 'Awaiting clinician review'}<br>Result: not available<br>Ordering clinician: review required</p>`,
        );
        break;
      case 'export': {
        const blob = new Blob([this.historyPacket()], { type: 'text/markdown;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'careloop-history.md';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        this.toast('Your demo history packet was downloaded.');
        break;
      }
      case 'export-pdf':
        try {
          await API.downloadHistoryPdf(this.historyPacket(), 'CareLoop history packet');
          this.toast('PDF packet downloaded.');
        } catch (err) {
          this.toast(err.message);
        }
        break;
      case 'reset':
        this.modal(
          'Start with a fresh sample record?',
          '<p>This resets saved visits in this browser and Dave’s in-memory coverage snapshot. Your real records are not connected.</p>',
          this.btn('Keep my demo', 'close', 'secondary') + this.btn('Reset sample data', 'confirm-reset'),
        );
        break;
      case 'confirm-reset':
        try {
          this.thread = this.seedThread('returning');
          this.saveThread();
          const snap = await API.scanCoverage({
            payer_name: this.GOLDEN_PAYER,
            image_note: 'fixture:reset',
          });
          this.rememberCoverage(await this.confirmFromProfile(snap.profile));
          this.closeModal();
          this.navigate('Today');
          this.toast('Sample record restored');
        } catch (err) {
          this.toast(err.message);
        }
        break;
      default:
        break;
    }
  },
};

if (document.body && document.body.dataset.page === 'careloop') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => CareLoop.init());
  } else {
    CareLoop.init();
  }
}
