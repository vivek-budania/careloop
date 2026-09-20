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
  insuranceFromVisit: false,
  payers: [],
  clinicians: [],
  costEstimate: null,
  claimAcceptance: null,
  coverageSnap: { profile: null, eligibility: null },
  demoEnv: null,
  scribeFixture: null,
  demoTranscripts: [],
  pendingDeleteId: null,
  networkMeta: null,
  encounter: null,
  orders: null,
  extractiveSummary: null,
  attachTestId: null,
  thread: null,
  packetPdf: { key: '', url: '' },
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
    trash: 'M5 7h14M9 7V5h6v2m-7 0 1 14h8l1-14',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    'eye-off': 'M3 3l18 18M10.58 10.58a3 3 0 0 0 4.24 4.24M9.88 4.24A10.94 10.94 0 0 1 12 5c6 0 10 7 10 7a17.9 17.9 0 0 1-3.14 4.06M6.1 6.1C3.51 7.86 2 10.5 2 10.5S6 17.5 12 17.5c1.13 0 2.19-.2 3.17-.55',
    stop: 'M8 8h8v8H8z',
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
  LOCAL_FILE_MAX: 2 * 1024 * 1024,
  UPLOAD_MAX: 8 * 1024 * 1024,
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

  displayName() {
    const fromLogin = App.user && String(App.user.name || '').trim();
    const fromThread = this.thread && this.thread.patient && String(this.thread.patient.name || '').trim();
    return fromLogin || fromThread || 'Jane Doe';
  },

  firstName() {
    return this.displayName().split(/\s+/)[0] || 'Jane';
  },

  syncPatientName() {
    if (!this.thread || !this.thread.patient) return;
    const threadName = String(this.thread.patient.name || '').trim();
    const loginName = App.user && String(App.user.name || '').trim();
    const source = this.thread.patient.identity_source;
    const localWins = (source === 'signup' || source === 'profile' || this.thread.patient.dateOfBirth) && threadName;
    if (localWins) {
      if (App.user && App.user.name !== threadName) App.user.name = threadName;
      return;
    }
    if (loginName && this.thread.patient.name !== loginName) {
      this.thread.patient.name = loginName;
      this.thread.patient.identity_source = 'login';
      this.saveThread();
    }
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
        new_symptoms: '',
        new_symptoms_log: [],
        care: {
          prescriptions: this.seedPrescriptions(),
          tests: this.seedTestRecords(),
        },
      }] : [],
      doses: returning
        ? { morning: 'taken', evening: 'upcoming' }
        : { morning: 'upcoming', evening: 'upcoming' },
      refill: false,
      prescriptions: returning ? this.seedPrescriptions() : [],
      testRecords: returning ? this.seedTestRecords() : [],
      pendingCare: null,
      reminders: [],
    };
  },

  seedPrescriptions() {
    return [{
      id: 'rx-seed-metformin',
      name: 'Metformin',
      notes: '1000 mg twice daily · 8:00 AM / 8:00 PM',
      status: 'active',
      source: 'seed',
      schedule: true,
    }];
  },

  seedTestRecords() {
    return [{
      id: 'test-seed-hba1c',
      name: 'HbA1c',
      date: 'August 20, 2026',
      kind: 'result',
      status: 'result on file',
      source: 'seed',
      preview: 'sample',
      notes: 'Sample result document.',
    }];
  },

  reminderId() {
    return `rem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  },

  remindersList() {
    return Array.isArray(this.thread.reminders) ? this.thread.reminders : [];
  },

  reminderForSource(kind, sourceId) {
    return this.remindersList().find((row) => row.kind === kind && row.source_id === sourceId && row.status !== 'removed') || null;
  },

  reminderKindLabel(kind) {
    return ({
      visit: 'Upcoming visit',
      dose: 'Medicine dose',
      refill: 'Refill',
      test: 'Lab / test',
    })[kind] || 'Reminder';
  },

  reminderDefaultWhen(kind) {
    const d = new Date();
    if (kind === 'dose') {
      d.setDate(d.getDate() + 1);
      d.setHours(8, 0, 0, 0);
    } else if (kind === 'refill') {
      d.setDate(d.getDate() + 7);
      d.setHours(9, 0, 0, 0);
    } else if (kind === 'test') {
      d.setDate(d.getDate() + 3);
      d.setHours(10, 0, 0, 0);
    } else {
      d.setDate(d.getDate() + 1);
      d.setHours(9, 30, 0, 0);
    }
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },

  formatReminderWhen(value) {
    if (!value) return 'Time not set';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  },

  reminderChannelsLabel(row) {
    const parts = [];
    if (row.channels && row.channels.email) parts.push('Email');
    if (row.channels && row.channels.calendar) parts.push('Calendar');
    return parts.length ? parts.join(' · ') : 'No channel';
  },

  reminderPingButton(kind, sourceId, title, detail = '', when = '') {
    const existing = this.reminderForSource(kind, sourceId);
    const label = existing ? 'Edit reminder' : 'Set reminder';
    const attrs = [
      `data-rem-kind="${this.esc(kind)}"`,
      `data-rem-source="${this.esc(sourceId)}"`,
      `data-rem-title="${this.esc(title)}"`,
      `data-rem-detail="${this.esc(detail || '')}"`,
      `data-rem-when="${this.esc(when || this.reminderDefaultWhen(kind))}"`,
    ].join(' ');
    return `${this.btn(`${this.icon('bell')} ${label}`, 'reminder-setup', 'secondary', attrs)}${existing ? `<small style="display:block;margin-top:6px">${this.esc(this.reminderChannelsLabel(existing))} · ${this.esc(this.formatReminderWhen(existing.when))}</small>` : ''}`;
  },

  openReminderSetup({ kind, sourceId, title, detail, when }) {
    const existing = this.reminderForSource(kind, sourceId);
    const email = existing?.email || this.thread.patient?.email || 'jane.doe@example.com';
    const whenValue = existing?.when || when || this.reminderDefaultWhen(kind);
    const emailOn = existing ? Boolean(existing.channels?.email) : true;
    const calOn = existing ? Boolean(existing.channels?.calendar) : true;
    this.modal(
      existing ? 'Update this reminder' : 'Set a reminder',
      `<p>${this.esc(title)}</p>
      <p style="font-size:12px;margin-top:8px">${this.esc(this.reminderKindLabel(kind))}${detail ? ` · ${this.esc(detail)}` : ''}</p>
      <form id="reminder-form" class="mt">
        <input type="hidden" name="kind" value="${this.esc(kind)}">
        <input type="hidden" name="source_id" value="${this.esc(sourceId)}">
        <input type="hidden" name="title" value="${this.esc(title)}">
        <input type="hidden" name="detail" value="${this.esc(detail || '')}">
        <label class="field">When<input type="datetime-local" name="when" value="${this.esc(whenValue)}" required></label>
        <label class="field">Email for pings<input type="email" name="email" value="${this.esc(email)}" required></label>
        <div class="reminder-channels">
          <label class="check"><input type="checkbox" name="channel_email" ${emailOn ? 'checked' : ''}> Email ping</label>
          <label class="check"><input type="checkbox" name="channel_calendar" ${calOn ? 'checked' : ''}> Add to calendar (.ics)</label>
        </div>
        <p style="font-size:11px;margin-top:12px">Demo only. CareLoop stores the reminder here and can open a calendar file or mailto draft — it does not send live email.</p>
      </form>`,
      this.btn('Cancel', 'close', 'secondary')
        + (existing ? this.btn('Remove', 'reminder-remove', 'coral', `data-rem-id="${this.esc(existing.id)}"`) : '')
        + this.btn(existing ? 'Save reminder' : 'Save reminder', 'reminder-save'),
    );
  },

  saveReminderFromForm() {
    const form = document.getElementById('reminder-form');
    if (!form) {
      this.toast('Reminder form not found.');
      return;
    }
    const data = new FormData(form);
    const kind = String(data.get('kind') || '').trim();
    const sourceId = String(data.get('source_id') || '').trim();
    const title = String(data.get('title') || '').trim();
    const detail = String(data.get('detail') || '').trim();
    const when = String(data.get('when') || '').trim();
    const email = String(data.get('email') || '').trim();
    const channelEmail = form.querySelector('[name="channel_email"]')?.checked;
    const channelCalendar = form.querySelector('[name="channel_calendar"]')?.checked;
    if (!kind || !sourceId || !title || !when) {
      this.toast('Add a time for this reminder.');
      return;
    }
    if (!channelEmail && !channelCalendar) {
      this.toast('Pick email, calendar, or both.');
      return;
    }
    if (channelEmail && !email) {
      this.toast('Add an email for pings.');
      return;
    }
    const existing = this.reminderForSource(kind, sourceId);
    const row = {
      id: existing?.id || this.reminderId(),
      kind,
      source_id: sourceId,
      title,
      detail,
      when,
      email,
      channels: { email: Boolean(channelEmail), calendar: Boolean(channelCalendar) },
      status: 'active',
      created_at: existing?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const others = this.remindersList().filter((item) => !(item.kind === kind && item.source_id === sourceId));
    this.saveThread({ reminders: [row, ...others] });
    this.closeModal();
    if (channelCalendar) this.downloadReminderIcs(row);
    if (channelEmail) {
      this.toast(`Reminder saved · email ping queued for ${email}`);
    } else {
      this.toast('Reminder saved · calendar file ready');
    }
    this.render();
  },

  removeReminder(id) {
    const next = this.remindersList().filter((row) => row.id !== id);
    this.saveThread({ reminders: next });
    this.closeModal();
    this.toast('Reminder removed.');
    this.render();
  },

  icsStamp(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  },

  downloadReminderIcs(row) {
    const start = this.icsStamp(row.when);
    if (!start) return;
    const endDate = new Date(row.when);
    endDate.setMinutes(endDate.getMinutes() + 30);
    const end = this.icsStamp(endDate.toISOString());
    const summary = String(row.title || 'CareLoop reminder').replace(/\n/g, ' ');
    const description = [
      row.detail || '',
      `CareLoop ${this.reminderKindLabel(row.kind)} reminder.`,
      'Demo calendar file — not a live clinic notification.',
    ].filter(Boolean).join('\\n');
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//CareLoop//Reminders//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${row.id}@careloop.local`,
      `DTSTAMP:${this.icsStamp(new Date().toISOString())}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${summary}`,
      `DESCRIPTION:${description}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `careloop-${row.kind}-${row.source_id}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },

  openReminderMailto(row) {
    if (!row?.email) {
      this.toast('No email on this reminder.');
      return;
    }
    const subject = encodeURIComponent(`CareLoop reminder: ${row.title}`);
    const body = encodeURIComponent(
      `${row.title}\n${this.formatReminderWhen(row.when)}\n${row.detail || ''}\n\nDemo draft only — CareLoop does not send live email.`,
    );
    window.location.href = `mailto:${encodeURIComponent(row.email)}?subject=${subject}&body=${body}`;
  },

  reminders() {
    const list = this.remindersList()
      .filter((row) => row.status !== 'removed')
      .slice()
      .sort((a, b) => String(a.when || '').localeCompare(String(b.when || '')));
    const rows = list.length
      ? list.map((row) => {
        const actions = [
          this.btn('Edit', 'reminder-setup', 'secondary', [
            `data-rem-kind="${this.esc(row.kind)}"`,
            `data-rem-source="${this.esc(row.source_id)}"`,
            `data-rem-title="${this.esc(row.title)}"`,
            `data-rem-detail="${this.esc(row.detail || '')}"`,
            `data-rem-when="${this.esc(row.when || '')}"`,
          ].join(' ')),
          row.channels?.calendar ? this.btn('Calendar', 'reminder-calendar', 'secondary', `data-rem-id="${this.esc(row.id)}"`) : '',
          row.channels?.email ? this.btn('Email draft', 'reminder-email', 'secondary', `data-rem-id="${this.esc(row.id)}"`) : '',
          this.btn('Remove', 'reminder-remove', 'secondary', `data-rem-id="${this.esc(row.id)}"`),
        ].filter(Boolean).join('');
        return `<div class="task-row" style="flex-wrap:wrap;align-items:flex-start"><span class="tile-icon">${this.icon(row.kind === 'visit' || row.kind === 'test' ? 'calendar' : (row.kind === 'refill' ? 'file' : 'pill'))}</span><div style="flex:1;min-width:180px"><small>${this.esc(this.reminderKindLabel(row.kind))} · ${this.esc(this.reminderChannelsLabel(row))}</small><h3 style="margin-top:6px">${this.esc(row.title)}</h3><p style="font-size:12px">${this.esc(this.formatReminderWhen(row.when))}${row.detail ? ` · ${this.esc(row.detail)}` : ''}</p>${row.channels?.email ? `<small>Email · ${this.esc(row.email || '')}</small>` : ''}</div><div class="row" style="flex-wrap:wrap">${actions}</div></div>`;
      }).join('')
      : `<div class="empty">${this.icon('bell')}<h2>No reminders yet.</h2><p>Set a ping from Upcoming visits, Prescriptions, Test records, or a refill note. Email and calendar stay in one place here.</p></div>`;
    return `<div class="narrow">${this.head('Reminders.', 'One list for visit, medicine, refill, and lab pings — email and calendar.')}<section class="card journey-panel"><div class="section-heading"><h2>Your pings</h2>${this.tag(`${list.length} active`, list.length ? '' : 'gray')}</div><p style="font-size:12px;margin-bottom:18px">Set reminders on the care screens. Everything you save shows up here.</p>${rows}<div class="rule"></div><div class="row" style="flex-wrap:wrap">${this.btn('Upcoming visits', 'upcoming', 'secondary')}${this.btn('Prescriptions', 'prescriptions', 'secondary')}${this.btn('Test records', 'test-records', 'secondary')}</div></section></div>`;
  },

  careKey(name) {
    return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  },

  parseCareName(description) {
    const raw = String(description || '').trim();
    let text = raw.replace(/^(continue|start|begin|add|take|buy)\s+/i, '').trim();
    let leftover = '';
    const cut = text.search(/\s+\d|\s+\(|\s+once\b|\s+twice\b|\s+daily\b|\s+weekly\b/i);
    if (cut > 0) {
      leftover = text.slice(cut).trim().replace(/^[·,\-–]+\s*/, '');
      text = text.slice(0, cut).trim();
    }
    let name = text || raw;
    if (name && !/[A-Z].*[A-Z0-9]/.test(name) && !/[a-z][A-Z]/.test(name)) {
      name = name.replace(/\b([a-z])/g, (ch) => ch.toUpperCase());
    }
    return { name, leftover };
  },

  careName(description) {
    return this.parseCareName(description).name;
  },

  tidyCareItem(item) {
    const parsed = this.parseCareName(item.name || item.description);
    const notes = [parsed.leftover, item.notes].filter(Boolean).filter((note, i, all) => all.indexOf(note) === i).join(' · ');
    return { ...item, name: parsed.name || item.name, notes };
  },

  demoFallbackCare() {
    return {
      prescriptions: [
        {
          id: 'rx-metformin',
          name: 'Metformin',
          notes: '1000 mg twice daily · keep taking',
          status: 'To take',
          source: 'visit',
          schedule: true,
        },
        {
          id: 'rx-semaglutide',
          name: 'Semaglutide',
          notes: 'Once weekly · pick up after clinician review · may need insurance approval first',
          status: 'To buy',
          source: 'visit',
          schedule: false,
        },
      ],
      tests: [
        {
          id: 'test-hba1c',
          name: 'HbA1c',
          notes: 'Blood test · schedule with a lab',
          status: 'To schedule',
          source: 'visit',
          kind: 'order',
        },
      ],
    };
  },

  careFromEncounter() {
    const items = (this.orders && this.orders.length)
      ? this.orders
      : ((this.encounter && this.encounter.plan) || []);
    if (!items.length && !this.encounter && !this.orders) {
      if (this.usesDemoTranscript()) return { ...this.demoFallbackCare(), applied: false };
      return { prescriptions: [], tests: [], applied: false };
    }
    const prescriptions = [];
    const tests = [];
    items.forEach((item) => {
      const type = String(item.type || '').toLowerCase();
      const parsed = this.parseCareName(item.description);
      const name = parsed.name;
      if (!name) return;
      const notes = [parsed.leftover, item.notes, item.pa_required ? 'May need insurance approval first' : '']
        .filter(Boolean)
        .filter((note, i, all) => all.indexOf(note) === i)
        .join(' · ');
      if (type === 'rx') {
        prescriptions.push({
          id: item.id || item.plan_item_id || `rx-${this.careKey(name)}`,
          name,
          notes,
          status: /start|add|begin/i.test(item.description || '') ? 'To buy' : 'To take',
          source: 'visit',
          schedule: /metformin/i.test(name),
        });
      } else if (type === 'lab' || type === 'imaging') {
        tests.push({
          id: item.id || item.plan_item_id || `test-${this.careKey(name)}`,
          name,
          notes,
          status: 'To schedule',
          source: 'visit',
          kind: 'order',
        });
      }
    });
    return { prescriptions, tests, applied: false };
  },

  visitCareSummary(care) {
    const rx = (care.prescriptions || []).map((item) => item.name).join(', ');
    const labs = (care.tests || []).map((item) => item.name).join(', ');
    const parts = [];
    if (rx) parts.push(`Medicines to take or buy: ${rx}`);
    if (labs) parts.push(`Tests to complete: ${labs}`);
    return parts.join('. ') || 'Draft plan from this visit.';
  },

  mergeCareItems(existing, incoming, opts = {}) {
    const out = (existing || []).slice();
    const keyOf = (row) => (opts.byKind ? `${row.kind || ''}:` : '') + this.careKey(row.name);
    (incoming || []).forEach((item) => {
      const key = keyOf(item);
      if (!this.careKey(item.name)) return;
      const i = out.findIndex((row) => keyOf(row) === key);
      if (i >= 0) {
        out[i] = {
          ...out[i],
          ...item,
          id: out[i].id,
          schedule: Boolean(out[i].schedule || item.schedule),
          preview: out[i].preview,
          dataUrl: out[i].dataUrl || item.dataUrl,
          filename: out[i].filename || item.filename,
          mime: out[i].mime || item.mime,
        };
      } else {
        out.push({ ...item, id: item.id || this.newVisitId() });
      }
    });
    return out;
  },

  applyVisitCare() {
    const pending = this.thread.pendingCare || this.careFromEncounter();
    const incomingRx = (pending.prescriptions || []).map((item) => this.tidyCareItem(item));
    const prescriptions = this.mergeCareItems(this.thread.prescriptions, incomingRx);
    const incomingTests = (pending.tests || []).map((item) => ({
      ...item,
      kind: item.kind || 'order',
    }));
    const testRecords = this.mergeCareItems(this.thread.testRecords, incomingTests, { byKind: true });
    this.saveThread({
      prescriptions,
      testRecords,
      pendingCare: { ...pending, applied: true },
    });
    this.navigate('Prescriptions');
    this.toast('Prescriptions and test records updated from this visit.');
  },

  linesFromText(text) {
    return String(text || '').split(/\n+/).map((row) => row.trim()).filter(Boolean);
  },

  updatePastVisit(visitId, patch) {
    const visits = (this.thread.visits || []).map((row) => (
      row.id === visitId ? { ...row, ...patch } : row
    ));
    this.saveThread({ visits });
    return visits.find((row) => row.id === visitId);
  },

  mergeVisitCareIntoLists(visit) {
    const care = (visit && visit.care) || {};
    const prescriptions = this.mergeCareItems(
      this.thread.prescriptions,
      (care.prescriptions || []).map((item) => this.tidyCareItem(item)),
    );
    const testRecords = this.mergeCareItems(
      this.thread.testRecords,
      (care.tests || []).map((item) => ({ ...item, kind: item.kind || 'order' })),
      { byKind: true },
    );
    this.saveThread({ prescriptions, testRecords });
  },

  updateVisitCareItem(visitId, kind, itemId, patch) {
    const visit = (this.thread.visits || []).find((row) => row.id === visitId);
    if (!visit) {
      this.toast('That past visit was not found.');
      return;
    }
    const care = {
      prescriptions: [...((visit.care && visit.care.prescriptions) || [])],
      tests: [...((visit.care && visit.care.tests) || [])],
    };
    const list = kind === 'rx' ? care.prescriptions : care.tests;
    const i = list.findIndex((row) => row.id === itemId);
    if (i < 0) {
      this.toast('That item is no longer on this visit.');
      return;
    }
    list[i] = { ...list[i], ...patch };
    const next = this.updatePastVisit(visitId, { care });
    this.mergeVisitCareIntoLists(next);
    this.render();
    this.toast(kind === 'rx' ? 'Prescription updated from after the visit.' : 'Test updated from after the visit.');
  },

  extractedPartsBlock(extracted) {
    if (!extracted || typeof extracted !== 'object') return '';
    const parts = Array.isArray(extracted.parts) ? extracted.parts.filter((row) => row && (row.label || row.value)) : [];
    if (!parts.length) return '';
    const rows = parts.slice(0, 12).map((row) => `<li><strong>${this.esc(row.label || 'Field')}</strong> ${this.esc(row.value || '')}</li>`).join('');
    return `<ul class="extract-parts mt">${rows}</ul>`;
  },

  async applyDoctorScript(visitId, form) {
    const visit = (this.thread.visits || []).find((row) => row.id === visitId);
    if (!visit) {
      this.toast('That past visit was not found.');
      return;
    }
    const d = new FormData(form);
    const rxLines = this.linesFromText(d.get('rx'));
    const testLines = this.linesFromText(d.get('tests'));
    const notes = String(d.get('notes') || '').trim();
    const input = document.getElementById('visit-script-file');
    const file = input && input.files && input.files[0];
    if (!rxLines.length && !testLines.length && !file) {
      this.toast('Add a doctor’s page or at least one prescription or test.');
      return;
    }
    let script = visit.script || null;
    let extracted = null;
    if (file) {
      try {
        const payload = await this.readDataUrl(file);
        script = {
          filename: payload.filename,
          mime: payload.mime,
          dataUrl: payload.dataUrl,
          notes,
          at: new Date().toISOString(),
        };
      } catch (err) {
        this.toast(err.message);
        return;
      }
      extracted = await this.tryExtractImage(file, 'Could not read that page. You can still type the items.');
      if (extracted) script.extracted = extracted;
    } else if (notes) {
      script = { ...(script || {}), notes, at: new Date().toISOString() };
    }
    const fromJsonRx = (extracted && extracted.prescriptions) || [];
    const fromJsonTests = (extracted && extracted.tests) || [];
    const incomingRx = (rxLines.length ? rxLines : fromJsonRx.map((row) => [row.name, row.notes].filter(Boolean).join(' '))).map((line) => {
      const parsed = this.parseCareName(typeof line === 'string' ? line : (line && line.name) || '');
      const extra = typeof line === 'string' ? '' : (line && line.notes) || '';
      return this.tidyCareItem({
        id: `rx-${this.careKey(parsed.name || line)}`,
        name: parsed.name || String(line || ''),
        notes: [parsed.leftover, extra, notes].filter(Boolean).join(' · '),
        status: 'Updated after visit',
        source: 'doctor-script',
        schedule: /metformin/i.test(parsed.name || String(line || '')),
      });
    }).filter((item) => item.name);
    const incomingTests = (testLines.length ? testLines : fromJsonTests.map((row) => [row.name, row.notes].filter(Boolean).join(' '))).map((line) => {
      const parsed = this.parseCareName(typeof line === 'string' ? line : (line && line.name) || '');
      const extra = typeof line === 'string' ? '' : (line && line.notes) || '';
      return {
        id: `test-${this.careKey(parsed.name || line)}`,
        name: parsed.name || String(line || ''),
        notes: [parsed.leftover, extra, notes].filter(Boolean).join(' · '),
        status: 'Updated after visit',
        source: 'doctor-script',
        kind: 'order',
      };
    }).filter((item) => item.name);
    const care = {
      prescriptions: this.mergeCareItems((visit.care && visit.care.prescriptions) || [], incomingRx),
      tests: this.mergeCareItems((visit.care && visit.care.tests) || [], incomingTests, { byKind: true }),
    };
    const next = this.updatePastVisit(visitId, { care, script });
    this.mergeVisitCareIntoLists(next);
    this.render();
    this.toast('Past visit updated from the doctor’s page.');
  },

  viewTestRecord(id) {
    const row = (this.thread.testRecords || []).find((item) => item.id === id);
    if (!row) {
      this.toast('That test record was not found.');
      return;
    }
    if (row.preview === 'sample' && !row.dataUrl) {
      this.modal(
        `${this.esc(row.name)} · sample document`,
        `<p>Patient: ${this.esc(this.displayName())}<br>Date: ${this.esc(row.date || 'Not listed')}<br>Status: ${this.esc(row.status || 'result on file')}<br>${this.esc(row.notes || '')}</p>`,
      );
      return;
    }
    if (!row.dataUrl) {
      this.modal(
        this.esc(row.name),
        `<p>No PDF or picture is attached yet. Use Attach result to add one.</p><p style="font-size:12px">${this.esc(row.notes || row.status || '')}</p>`,
      );
      return;
    }
    const pdf = (row.mime || '').includes('pdf') || (row.filename || '').toLowerCase().endsWith('.pdf');
    const preview = pdf
      ? `<iframe class="test-preview-frame" title="${this.esc(row.name)}" src="${row.dataUrl}"></iframe>`
      : `<img class="test-preview-img" alt="${this.esc(row.name)}" src="${row.dataUrl}">`;
    this.modal(
      this.esc(row.name),
      `<div class="test-preview">${preview}</div><p style="font-size:12px">${this.esc(row.filename || '')}${row.date ? ` · ${this.esc(row.date)}` : ''}${row.extracted && row.extracted.document_type ? ` · read as ${this.esc(row.extracted.document_type)}` : ''}</p>${this.extractedPartsBlock(row.extracted)}`,
    );
  },

  async tryExtractImage(file, failToast) {
    try {
      return await API.extractImage(file);
    } catch (err) {
      this.toast(err.message || failToast || 'Could not read that page.');
      return null;
    }
  },

  async readDataUrl(file) {
    if (file.size > this.LOCAL_FILE_MAX) {
      throw new Error('That file is too large to save here. Try a smaller picture or PDF.');
    }
    const b64 = await this.readBase64(file);
    const mime = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
    return {
      filename: file.name,
      mime,
      dataUrl: `data:${mime};base64,${b64}`,
    };
  },

  async attachTestResult(id, file) {
    if (!file) {
      this.toast('Choose a PDF or picture first.');
      return;
    }
    try {
      const payload = await this.readDataUrl(file);
      const extracted = await this.tryExtractImage(file, 'Could not read printed parts. The file is still saved.');
      const list = (this.thread.testRecords || []).slice();
      const i = list.findIndex((row) => row.id === id);
      const next = {
        id: id || this.newVisitId(),
        name: i >= 0 ? list[i].name : (file.name.replace(/\.[^.]+$/, '') || 'Lab result'),
        date: i >= 0 && list[i].date ? list[i].date : 'September 24, 2026',
        kind: 'result',
        status: 'result on file',
        source: i >= 0 ? list[i].source : 'upload',
        notes: i >= 0 ? (list[i].notes || 'Uploaded result') : 'Uploaded result',
        lab: i >= 0 ? list[i].lab : '',
        filename: payload.filename,
        mime: payload.mime,
        dataUrl: payload.dataUrl,
        extracted: extracted || null,
      };
      if (i >= 0) list[i] = { ...list[i], ...next };
      else list.unshift(next);
      this.saveThread({ testRecords: list });
      this.render();
      this.toast('Result saved to Test records.');
    } catch (err) {
      this.toast(err.message);
    }
  },

  addLabAppointment(form) {
    const d = new FormData(form);
    const name = String(d.get('name') || '').trim();
    if (!name) {
      this.toast('Add a test name.');
      return;
    }
    const date = String(d.get('date') || '').trim();
    const time = String(d.get('time') || '').trim();
    const row = {
      id: this.newVisitId(),
      name,
      lab: String(d.get('lab') || '').trim(),
      date,
      time,
      notes: String(d.get('notes') || '').trim(),
      kind: 'appointment',
      status: 'scheduled',
      source: 'lab',
    };
    this.saveThread({ testRecords: [row, ...(this.thread.testRecords || [])] });
    this.render();
    this.toast('Lab appointment saved as a potential test.');
  },

  async addTestResult(form) {
    const d = new FormData(form);
    const name = String(d.get('name') || '').trim();
    const input = document.getElementById('test-result-file');
    const file = input && input.files && input.files[0];
    if (!name) {
      this.toast('Add a test name.');
      return;
    }
    if (!file) {
      this.toast('Choose a PDF or picture first.');
      return;
    }
    try {
      const payload = await this.readDataUrl(file);
      const extracted = await this.tryExtractImage(file, 'Could not read printed parts. The file is still saved.');
      this.saveThread({
        testRecords: [{
          id: this.newVisitId(),
          name,
          date: 'September 24, 2026',
          kind: 'result',
          status: 'result on file',
          source: 'upload',
          notes: 'Uploaded result',
          filename: payload.filename,
          mime: payload.mime,
          dataUrl: payload.dataUrl,
          extracted: extracted || null,
        }, ...(this.thread.testRecords || [])],
      });
      this.render();
      this.toast('Result saved to Test records.');
    } catch (err) {
      this.toast(err.message);
    }
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
    const withLog = (row) => {
      if (!row || typeof row !== 'object') return row;
      if (!Array.isArray(row.new_symptoms_log)) row.new_symptoms_log = [];
      return row;
    };
    if (t.journey) withLog(t.journey);
    t.openVisits = t.openVisits.map(withLog);
    t.visits = (t.visits || []).map((visit) => {
      const row = withLog(visit) || {};
      if (!row.care || typeof row.care !== 'object') row.care = { prescriptions: [], tests: [] };
      if (!Array.isArray(row.care.prescriptions)) row.care.prescriptions = [];
      if (!Array.isArray(row.care.tests)) row.care.tests = [];
      return row;
    });
    if (!Array.isArray(t.prescriptions)) {
      t.prescriptions = (t.visits || []).some((v) => v.id === 'seed') ? this.seedPrescriptions() : [];
    }
    if (!Array.isArray(t.testRecords)) {
      t.testRecords = (t.visits || []).some((v) => v.id === 'seed') ? this.seedTestRecords() : [];
    }
    if (!Array.isArray(t.reminders)) t.reminders = [];
    if (t.pendingCare === undefined) t.pendingCare = null;
    if (Array.isArray(t.prescriptions)) {
      t.prescriptions = this.mergeCareItems([], t.prescriptions.map((item) => this.tidyCareItem(item)));
    }
    if (t.pendingCare && Array.isArray(t.pendingCare.prescriptions)) {
      t.pendingCare = {
        ...t.pendingCare,
        prescriptions: t.pendingCare.prescriptions.map((item) => this.tidyCareItem(item)),
      };
    }
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
      demo_id: null,
      search_zip: '',
      network_specialty: '',
      symptoms_source: '',
      new_symptoms: '',
      new_symptoms_source: '',
      new_symptoms_log: [],
      checkin_tab: 'symptoms',
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

  visitReasonText(j) {
    const booked = String((j && j.symptoms) || '').trim();
    const extra = this.newSymptomsText(j);
    if (booked && extra) return `${booked} New since booking: ${extra}`;
    return booked || extra || '';
  },

  symptomLog(j) {
    const row = j || {};
    const log = Array.isArray(row.new_symptoms_log) ? row.new_symptoms_log : [];
    return log.filter((entry) => entry && String(entry.text || '').trim());
  },

  newSymptomsText(j) {
    const row = j || {};
    const fromLog = this.symptomLog(row).map((entry) => String(entry.text || '').trim()).filter(Boolean);
    const draft = String(row.new_symptoms || '').trim();
    return [...fromLog, draft].filter(Boolean).join(' ');
  },

  formatStamp(iso) {
    if (!iso) return 'Noted';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  },

  appendNewSymptom(text, source) {
    const trimmed = String(text || '').trim();
    const j = this.thread.journey || {};
    const log = this.symptomLog(j);
    if (trimmed) {
      const last = log[log.length - 1];
      if (!last || last.text !== trimmed || last.source !== (source || 'typed')) {
        log.push({
          text: trimmed,
          at: new Date().toISOString(),
          source: source || 'typed',
        });
      }
    }
    this.saveThread({
      journey: {
        ...j,
        new_symptoms: '',
        new_symptoms_log: log,
        new_symptoms_source: source || j.new_symptoms_source,
      },
    });
    return log;
  },

  empathyForSymptoms(text) {
    const s = String(text || '').trim();
    if (!s) {
      return 'I’m sorry you’re not feeling like yourself. That deserves care, not a rushed form.';
    }
    const short = s.length > 180 ? `${s.slice(0, 177)}…` : s;
    return `I’m sorry you’re going through this — “${short}” That’s a lot to carry, and you shouldn’t have to jump straight into logistics.`;
  },

  checkinTab() {
    const j = this.thread.journey || {};
    if (j.checkin_tab === 'checkin' || j.checkin_tab === 'symptoms') return j.checkin_tab;
    return j.checked_in ? 'checkin' : 'symptoms';
  },

  toggleChipValue(current, chip) {
    const s = String(current || '');
    const escaped = String(chip || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!escaped) return s;
    return s.toLowerCase().includes(String(chip).toLowerCase())
      ? s.replace(new RegExp(escaped, 'ig'), '').replace(/,\s*,/g, ',').replace(/^,\s*|,\s*$/g, '').trim()
      : (s ? `${s}, ` : '') + chip;
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
    this.claimAcceptance = null;
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
      primary = this.thread.pendingCare
        ? this.btn('View follow-ups', 'followups')
        : this.btn('View visit summary', 'latest-visit');
    } else {
      primary = this.btn(active ? 'Continue your visit' : 'Prepare for your visit', 'start');
    }
    return `<div class="visit-hero-actions">${primary}${this.btn(`${this.icon('plus')} New visit`, 'new-visit', 'secondary')}</div>`;
  },

  visitRowCard(row, kind) {
    const current = this.thread.journey && !this.thread.journey.completed && this.thread.journey.id === row.id;
    const openAttr = kind === 'upcoming' ? 'data-upcoming-visit' : 'data-open-visit';
    const preparing = kind !== 'upcoming';
    const when = kind === 'upcoming'
      ? `${row.slot || 'Time TBD'} · Thursday, September 24, 2026`
      : `Preparing · step ${row.step || 1} of 3`;
    const status = kind === 'upcoming'
      ? ((row.step || 1) >= 4
        ? (row.checked_in ? 'Checked in · continue recording' : (this.newSymptomsText(row) ? 'New symptoms noted · ready to check in' : 'Ready to check in'))
        : 'Confirmed · tap to check in')
      : (row.doctor || 'Clinician not chosen yet');
    const title = this.visitTitle(row);
    return `<div class="visit-row-wrap"><button class="visit-row" ${openAttr}="${this.esc(row.id)}" type="button"><div class="tile-icon">${this.icon(kind === 'upcoming' ? 'calendar' : 'file')}</div><div><small>${this.esc(when)}</small><h3>${this.esc(title)}</h3><small>${this.esc(kind === 'upcoming' ? `${row.doctor || 'Clinician'} · ${status}` : status)}</small></div>${current ? this.tag('This visit') : this.icon('arrow')}</button><div class="visit-row-actions">${kind === 'upcoming' ? this.reminderPingButton('visit', row.id, title, `${row.doctor || 'Clinician'} · ${row.slot || 'Time TBD'}`, this.reminderDefaultWhen('visit')) : ''}<button type="button" class="icon-btn visit-delete" data-action="ask-delete-visit" data-visit-id="${this.esc(row.id)}" aria-label="Delete ${this.esc(title)}">${this.icon('trash')}</button></div></div>`;
  },

  askDeleteVisit(id) {
    const row = this.openJourneys().find((item) => item.id === id);
    if (!row) {
      this.toast('That visit is no longer open.');
      return;
    }
    this.pendingDeleteId = id;
    this.modal(
      'Remove this open visit?',
      `<p>This deletes <strong>${this.esc(this.visitTitle(row))}</strong> from this demo. Past visits stay put.</p>`,
      this.btn('Keep visit', 'close', 'secondary') + this.btn('Delete visit', 'confirm-delete-visit', 'coral'),
    );
  },

  deleteOpenVisit(id) {
    const remaining = this.openJourneys().filter((row) => row.id !== id);
    const active = this.thread.journey;
    const patch = {
      openVisits: remaining,
      reminders: this.remindersList().filter((row) => !(row.kind === 'visit' && row.source_id === id)),
    };
    if (active && active.id === id) {
      this.clearVisitRuntime();
      patch.journey = remaining[0] ? { ...remaining[0] } : null;
    }
    this.saveThread(patch);
    this.pendingDeleteId = null;
    this.closeModal();
    if (this.view === 'Journey' && !this.thread.journey) {
      this.navigate(remaining.some((row) => this.isBookedVisit(row)) ? 'Upcoming visits' : 'Today');
    } else {
      this.render();
    }
    this.toast('Open visit deleted.');
  },

  openVisitsPanel() {
    const open = this.preparingVisits();
    const upcoming = this.upcomingVisits();
    const rows = open.length
      ? open.map((row) => this.visitRowCard(row, 'preparing')).join('')
      : `<p style="font-size:12px">No visits in progress. Start a new one anytime. Confirmed appointments live under Upcoming visits.</p>`;
    const upcomingNote = upcoming.length
      ? `<p class="mt" style="font-size:12px">${upcoming.length} confirmed appointment${upcoming.length === 1 ? '' : 's'} ${upcoming.length === 1 ? 'is' : 'are'} in Upcoming visits.</p>${this.btn('Upcoming visits', 'upcoming', 'secondary')}`
      : '';
    return `<section class="card"><div class="section-heading"><h2>Open visits</h2><small>${open.length ? `${open.length} preparing` : 'None preparing'}</small></div>${rows}${upcomingNote}<div class="mt">${this.btn(`${this.icon('plus')} New visit`, 'new-visit', 'secondary')}</div></section>`;
  },

  historyOpenVisits() {
    const open = this.preparingVisits();
    if (!open.length) return '';
    const rows = open.map((row) => this.visitRowCard(row, 'preparing')).join('');
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
    if (e.status && e.status !== 'active') return 'This plan is inactive.';
    return '';
  },

  quietUserCopy(text) {
    return String(text || '')
      .replace(/\s*(Code guess only|Code estimate only|Suggestion only|Directory filter only)\s*[—\-]\s*not a diagnosis\.?/gi, '')
      .replace(/\s*This is not a payer directory\.?/gi, '')
      .replace(/\s*This is not a coverage (decision|determination)\.?/gi, '')
      .replace(/\s*\[NEEDS VERIFICATION\][^.!]*[.!]?/gi, '')
      .replace(/\s*\(mock\)/gi, '')
      .replace(/\bmock\s+/gi, '')
      .replace(/\bMock\s+/g, '')
      .trim();
  },

  quietCostBasis(text) {
    const raw = this.quietUserCopy(text);
    if (!raw) return '';
    if (/PA may be required|prior auth/i.test(raw)) return 'May need approval first.';
    if (/no .*match|no retail copay|not priced/i.test(raw)) return 'No estimated amount on file yet.';
    if (/coverage inactive|plan looks inactive/i.test(raw) && /cash/i.test(raw)) {
      return 'This plan looks inactive, so a cash-pay amount is shown.';
    }
    if (/coverage inactive|plan looks inactive/i.test(raw)) {
      return 'This plan looks inactive, so the full amount is shown.';
    }
    return raw;
  },

  quietClaimFactor(text) {
    const t = String(text || '');
    if (!t.trim()) return '';
    if (/not in our database|CPT code|ICD-10/i.test(t)) return '';
    if (/High-denial category/i.test(t)) return 'This kind of visit is often reviewed more closely.';
    if (/unspecified/i.test(t)) return 'A more specific visit reason can help.';
    if (/High-risk combination/i.test(t)) return 'This mix of visit details is often reviewed more closely.';
    if (/No prior authorization/i.test(t)) return 'Some items may need approval first.';
    if (/No clinical notes/i.test(t)) return 'A visit summary on file can help.';
    if (/Emergency service/i.test(t)) return 'Emergency visits are often reviewed differently.';
    return this.quietUserCopy(t);
  },

  friendlyError(err) {
    const raw = String((err && err.message) || err || '').trim();
    if (!raw) return 'Something didn’t work. Try again.';
    if (/cannot connect|failed to fetch|backend running|networkerror/i.test(raw)) {
      return 'Couldn’t reach CareLoop. Try again in a moment.';
    }
    if (/XAI_API_KEY|GEMINI_API_KEY|GROQ_API_KEY|STEDI_API_KEY|API_KEY|\.env/i.test(raw)) {
      return 'That step isn’t available on this host right now. Try a sample, or continue.';
    }
    if (/supabase/i.test(raw)) {
      return 'Couldn’t finish that account step. Try again, or use the sample login.';
    }
    if (/confirm coverage first/i.test(raw)) {
      return 'Add your insurance first to see estimated costs.';
    }
    if (/llm|json parse|scribe draft|transcription failed|image extract|pdf export|sumy|soap|grok|http \d|traceback|internal server|use_seeded/i.test(raw)) {
      return 'Couldn’t finish that just now. Try again, or use a sample.';
    }
    if (/[A-Z]{3,}_[A-Z0-9_]+/.test(raw) || /[{[]".*:/.test(raw) || raw.length > 180) {
      return 'Couldn’t finish that just now. Try again.';
    }
    return raw;
  },

  revokePacketPdf() {
    if (this.packetPdf && this.packetPdf.url) {
      URL.revokeObjectURL(this.packetPdf.url);
    }
    this.packetPdf = { key: '', url: '' };
  },

  async refreshPacketPreview() {
    const frame = document.getElementById('packet-preview-frame');
    const status = document.getElementById('packet-preview-status');
    if (!frame) return;
    const markdown = this.historyPacket();
    if (this.packetPdf.key === markdown && this.packetPdf.url) {
      if (frame.src !== this.packetPdf.url) frame.src = this.packetPdf.url;
      frame.hidden = false;
      if (status) status.hidden = true;
      return;
    }
    frame.removeAttribute('src');
    frame.hidden = true;
    if (status) {
      status.hidden = false;
      status.textContent = 'Preparing your packet…';
    }
    try {
      const blob = await API.fetchHistoryPdf(markdown, 'CareLoop history packet');
      if (this.packetPdf.url) URL.revokeObjectURL(this.packetPdf.url);
      const url = URL.createObjectURL(blob);
      this.packetPdf = { key: markdown, url };
      const still = document.getElementById('packet-preview-frame');
      const stillStatus = document.getElementById('packet-preview-status');
      if (still) {
        still.src = url;
        still.hidden = false;
      }
      if (stillStatus) stillStatus.hidden = true;
    } catch (err) {
      const fail = document.getElementById('packet-preview-status');
      if (fail) {
        fail.hidden = false;
        fail.textContent = 'Couldn’t show the packet preview. You can still download a PDF.';
      }
      this.toast('Couldn’t show the packet preview. You can still download a PDF.');
    }
  },

  envRows() {
    const env = this.demoEnv || {};
    const session = env.session || {};
    const supabase = env.supabase || session.supabase || {};
    const stedi = env.stedi || {};
    const xai = env.xai || {};
    return [
      {
        name: 'Sign-in',
        tag: supabase.configured ? 'ready' : 'sample login',
        tagType: supabase.configured ? '' : 'gray',
        detail: supabase.configured
          ? 'Accounts can sign in on this host.'
          : 'The sample login still works for this walkthrough.',
      },
      {
        name: 'Coverage lookup',
        tag: stedi.test_mode ? 'ready' : (stedi.configured ? 'limited' : 'sample'),
        tagType: stedi.test_mode ? '' : 'gray',
        detail: stedi.test_mode
          ? 'Plan checks are available.'
          : 'Using sample coverage for this walkthrough.',
      },
      {
        name: 'Letter drafts',
        tag: xai.configured ? 'ready' : 'not available',
        tagType: xai.configured ? '' : 'peach',
        detail: xai.configured
          ? 'Letter drafts can be prepared.'
          : 'Letter drafts are not available on this host yet.',
      },
      {
        name: 'Photos and voice',
        tag: xai.configured ? 'ready' : 'not available',
        tagType: xai.configured ? '' : 'peach',
        detail: xai.configured
          ? 'Uploaded cards and visit recordings can be read.'
          : 'Use a sample card or a demo visit transcript.',
      },
    ];
  },

  envPanel() {
    const list = this.envRows().map((row) => (
      `<div class="task-row"><div style="flex:1"><div class="row" style="justify-content:space-between;gap:12px"><h3>${this.esc(row.name)}</h3>${this.tag(row.tag, row.tagType)}</div><small>${this.esc(row.detail)}</small></div></div>`
    )).join('');
    return `<div class="rule"></div><details class="env-panel"><summary>Host setup</summary><p>Whether sign-in, coverage, letters, and recording are available on this host.</p>${list}</details>`;
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
    if (file.size > this.UPLOAD_MAX) {
      throw new Error('That file is too large. Try a smaller picture or PDF.');
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
      ? `${c.payer} — ${c.status}`
      : 'Not on file';
    const visits = (s.visits || []).map((v) => (
      `\n### ${v.date} · ${v.doctor}\nReason: ${v.reason}${this.newSymptomsText(v) ? `\nNew symptoms at check-in: ${this.newSymptomsText(v)}` : ''}\n${v.summary}\nReview status: ${
        v.reviewed ? 'Reviewed' : 'Awaiting review'
      }\nCoverage at visit: ${v.coverage}\n`
    )).join('');
    return [
      '# CareLoop · Patient history packet',
      '',
      `Patient: ${this.displayName()}`,
      `Coverage: ${coverageLine}`,
      '',
      '## Visits',
      visits || '\n(No visits saved yet.)\n',
      '## Prescriptions',
      (s.prescriptions || []).length
        ? (s.prescriptions || []).map((rx) => `- ${rx.name}${rx.notes ? ` — ${rx.notes}` : ''} (${rx.status || 'active'})`).join('\n')
        : 'None on file.',
      `Today: morning ${s.doses.morning}, evening ${s.doses.evening}.`,
      `Refill: ${s.refill ? 'Draft prepared for clinic' : 'No draft request'}`,
      '',
      '## Test records',
      (s.testRecords || []).length
        ? (s.testRecords || []).map((row) => `- ${row.name} · ${row.kind || 'record'} · ${row.status || ''}${row.date ? ` · ${row.date}` : ''}${row.notes ? ` — ${row.notes}` : ''}`).join('\n')
        : 'None on file.',
      '',
      '## Reminders',
      this.remindersList().filter((row) => row.status !== 'removed').length
        ? this.remindersList()
          .filter((row) => row.status !== 'removed')
          .map((row) => `- ${this.reminderKindLabel(row.kind)} · ${row.title} · ${this.formatReminderWhen(row.when)} · ${this.reminderChannelsLabel(row)}${row.channels?.email && row.email ? ` (${row.email})` : ''}`)
          .join('\n')
        : 'None on file.',
      '',
      '## Follow-up',
      'Discuss a follow-up visit in 3 months with the clinic.',
      '',
    ].join('\n');
  },

  toast(t) {
    App.notify(this.friendlyError(t));
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
    if (next === 'History') next = 'Past visits';
    if (next !== this.view) this.cancelRecording();
    this.view = next;
    this.selectedVisit = null;
    this.render();
    window.scrollTo(0, 0);
  },

  async restoreSession() {
    try {
      App.user = await API.me();
      await Promise.all([this.refreshCoverage(), this.loadDemoEnv()]);
      this.syncPatientName();
      this.render();
    } catch (err) {
      App.user = null;
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
    return this.startSession(result, mode);
  },

  async startSession(result, mode, profile = null) {
    App.user = result.user;
    if (mode === 'first') {
      this.thread = this.seedThread('first');
      if (profile) {
        this.thread.patient.name = profile.name;
        this.thread.patient.email = profile.email;
        this.thread.patient.dateOfBirth = profile.dateOfBirth;
        this.thread.patient.identity_source = 'signup';
        if (App.user && profile.name) App.user.name = profile.name;
      }
      this.saveThread();
      this.syncPatientName();
      await Promise.all([API.resetCoverage(), this.loadDemoEnv()]);
      this.rememberCoverage({ profile: null, eligibility: null });
      this.costEstimate = null;
      this.scribeFixture = null;
      this.encounter = null;
      this.orders = null;
      this.cancelRecording();
      this.insuranceMode = 'hub';
      this.insuranceReturn = false;
      this.insuranceFromVisit = false;
      this.view = 'Setup';
    } else {
      this.thread = this.loadThread();
      if (!this.thread.visits) this.thread = this.seedThread('returning');
      if (App.user && App.user.name) {
        this.thread.patient.name = App.user.name;
        this.thread.patient.identity_source = 'login';
        this.saveThread();
      }
      this.syncPatientName();
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
    app.innerHTML = `<div class="login"><section class="login-story">${this.logo()}<h1>Your health.<br>Your story.<br><em>All together.</em></h1><p>A little less to keep track of.<br>A little more peace of mind.</p>${this.art()}<small>One connected journey. From your first visit to what’s next.</small></section><section class="login-form"><form id="login-form"><span class="eyebrow">A little clarity, every day</span><h2>Welcome to your care.</h2><p>Keep your visits, prescriptions, and test records together on one health journey.</p><label class="field">Username<input name="username" autocomplete="username" value="jane" required></label><label class="field">Password<div class="password-wrap"><input name="password" type="password" autocomplete="current-password" value="demo" required><button type="button" class="toggle-password" aria-label="Show password">${this.icon('eye')}</button></div></label><div class="field-row"><button type="button" class="link forgot-link">Forgot Password?</button></div><div class="error" id="login-error" role="alert"></div><button class="btn pill full" type="submit" name="mode" value="returning">LOGIN</button><p class="signup-line">New here? <button type="button" class="open-signup">Start my first visit</button></p><p class="fine-print">Care drafts are always for clinician review.</p></form></section></div>`;
    const form = document.getElementById('login-form');
    const passwordInput = form.password;
    form.querySelector('.toggle-password').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      const shown = passwordInput.type === 'text';
      passwordInput.type = shown ? 'password' : 'text';
      btn.innerHTML = this.icon(shown ? 'eye' : 'eye-off');
      btn.setAttribute('aria-label', shown ? 'Show password' : 'Hide password');
    });
    form.querySelector('.forgot-link').addEventListener('click', () => {
      this.toast('Use jane / demo to continue.');
    });
    form.querySelector('.open-signup').addEventListener('click', () => this.renderSignup());
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = form.username.value.trim();
      const password = passwordInput.value;
      const mode = (e.submitter && e.submitter.value) || 'returning';
      const errBox = document.getElementById('login-error');
      errBox.textContent = '';
      try {
        await this.login(username, password, mode);
      } catch (err) {
        errBox.textContent = this.friendlyError(err);
      }
    });
  },

  renderSignup() {
    const app = document.getElementById('app');
    app.innerHTML = `<div class="login signup"><section class="login-story">${this.logo()}<h1>Let’s begin<br>with <em>you.</em></h1><p>A few details now help keep your first visit organized from the start.</p>${this.art()}<small>A few details now. A clearer first visit later.</small></section><section class="login-form signup-form"><form id="signup-form"><button type="button" class="back signup-back">${this.icon('back')} Back to login</button><span class="eyebrow">Start your care journey</span><h2>Create your care space.</h2><p>Tell us who you are, then we’ll help you prepare for your first visit.</p><div class="signup-grid"><label class="field">Full name<input name="name" autocomplete="name" placeholder="Your full name" required></label><label class="field">Date of birth<input name="dateOfBirth" type="date" autocomplete="bday" required></label></div><div class="signup-grid"><label class="field">Email address<input name="email" type="email" autocomplete="email" placeholder="you@example.com" required></label><label class="field">Username<input name="username" autocomplete="username" placeholder="yourname" maxlength="30" required></label></div><label class="field">Create password<div class="password-wrap"><input name="password" type="password" autocomplete="new-password" minlength="8" placeholder="At least 8 characters" required><button type="button" class="toggle-password" aria-label="Show password">${this.icon('eye')}</button></div></label><label class="field">Confirm password<input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required></label><label class="signup-consent"><input name="consent" type="checkbox" required><span>I agree to use fictional information for this interactive demo.</span></label><div class="error" id="signup-error" role="alert"></div><button class="btn pill full" type="submit">CREATE MY CARE SPACE ${this.icon('arrow')}</button><p class="fine-print">Creates a CareLoop demo account · Never use real medical information.</p></form></section></div>`;
    const form = document.getElementById('signup-form');
    const passwordInput = form.password;
    const errBox = document.getElementById('signup-error');
    const today = new Date();
    form.noValidate = true;
    form.dateOfBirth.max = today.toISOString().slice(0, 10);
    form.querySelectorAll('input').forEach((input) => {
      input.addEventListener('input', () => {
        input.removeAttribute('aria-invalid');
        errBox.textContent = '';
      });
    });
    const showSignupError = (message, input) => {
      errBox.textContent = message;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
    };
    form.querySelector('.signup-back').addEventListener('click', () => this.renderLogin());
    form.querySelector('.toggle-password').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      const shown = passwordInput.type === 'text';
      passwordInput.type = shown ? 'password' : 'text';
      btn.innerHTML = this.icon(shown ? 'eye' : 'eye-off');
      btn.setAttribute('aria-label', shown ? 'Show password' : 'Hide password');
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errBox.textContent = '';
      form.querySelectorAll('[aria-invalid="true"]').forEach((input) => input.removeAttribute('aria-invalid'));
      const fullName = form.name.value.trim().replace(/\s+/g, ' ');
      const nameParts = fullName.split(' ').filter(Boolean);
      if (fullName.length < 2 || /\d/.test(fullName) || nameParts.some((part) => !/\p{L}/u.test(part))) {
        showSignupError('Enter your name without numbers.', form.name);
        return;
      }
      const birthDate = new Date(`${form.dateOfBirth.value}T00:00:00`);
      const oldestDate = new Date(today.getFullYear() - 120, today.getMonth(), today.getDate());
      if (!form.dateOfBirth.value || Number.isNaN(birthDate.getTime())) {
        showSignupError('Enter a valid date of birth.', form.dateOfBirth);
        return;
      }
      if (birthDate >= today) {
        showSignupError('Date of birth must be in the past.', form.dateOfBirth);
        return;
      }
      if (birthDate < oldestDate) {
        showSignupError('Check the year in your date of birth.', form.dateOfBirth);
        return;
      }
      const email = form.email.value.trim().toLowerCase();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        showSignupError('Enter a valid email address, like name@example.com.', form.email);
        return;
      }
      const username = form.username.value.trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(username)) {
        showSignupError('Use 3–30 letters, numbers, dots, dashes, or underscores.', form.username);
        return;
      }
      if (form.password.value.length < 8) {
        showSignupError('Password must be at least 8 characters.', form.password);
        return;
      }
      if (form.password.value !== form.confirmPassword.value) {
        showSignupError('Passwords do not match.', form.confirmPassword);
        return;
      }
      if (!form.consent.checked) {
        showSignupError('Please confirm you will use fictional information only.', form.consent);
        return;
      }
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      submit.textContent = 'CREATING YOUR CARE SPACE…';
      try {
        const result = await API.signup({
          username,
          full_name: fullName,
          email,
          password: form.password.value,
          date_of_birth: form.dateOfBirth.value,
        });
        this.renderSignupSuccess(result, {
          name: fullName,
          email,
          dateOfBirth: form.dateOfBirth.value,
        });
        this.toast('Your care space is ready');
      } catch (err) {
        errBox.textContent = this.friendlyError(err);
        submit.disabled = false;
        submit.innerHTML = `CREATE MY CARE SPACE ${this.icon('arrow')}`;
      }
    });
  },

  renderSignupSuccess(result, profile) {
    const app = document.getElementById('app');
    const needsEmail = Boolean(result.requires_email_confirmation);
    const username = result.user?.username || '';
    app.innerHTML = `<div class="login signup"><section class="login-story">${this.logo()}<h1>Your care space<br>is <em>ready.</em></h1><p>${needsEmail ? 'One quick email check, then your journey can begin.' : 'Your account is created. Continue when you’re ready.'}</p>${this.art()}<small>Your password stays with your account, not in your care profile.</small></section><section class="login-form signup-form"><div class="signup-success"><span class="signup-success-icon">${this.icon('check')}</span><span class="eyebrow">Account created</span><h2>${needsEmail ? 'Check your email.' : 'Welcome to CareLoop.'}</h2><p>${needsEmail ? `We sent a verification link to <strong>${this.esc(profile.email)}</strong>. After verifying, return and log in with <strong>${this.esc(username)}</strong>.` : `Your username is <strong>${this.esc(username)}</strong>. Your first-visit setup is ready.`}</p>${needsEmail ? '<button type="button" class="btn pill full" data-signup-action="login">BACK TO LOGIN</button>' : `<button type="button" class="btn pill full" data-signup-action="continue">CONTINUE TO MY CARE ${this.icon('arrow')}</button>`}<p class="fine-print">Your password stays with your account.</p></div></section></div>`;
    const button = app.querySelector('[data-signup-action]');
    button.addEventListener('click', async () => {
      if (button.dataset.signupAction === 'login') {
        this.renderLogin();
        return;
      }
      button.disabled = true;
      await this.startSession(result, 'first', profile);
    });
  },

  shell(content) {
    const destinations = [
      ['Today', 'home'],
      ['Past visits', 'history'],
      ['Upcoming visits', 'calendar'],
      ['Reminders', 'bell'],
      ['Prescriptions', 'pill'],
      ['Test records', 'test'],
      ['Insurance', 'shield'],
      ['Profile', 'user'],
    ];
    const name = this.displayName();
    const crumb = this.view === 'Journey'
      ? ((this.thread.journey && this.thread.journey.step >= 4) ? 'Visit day' : 'Your visit')
      : this.view === 'Setup' ? 'Getting started' : this.view === 'Followups' ? 'Follow-ups' : this.view === 'History' ? 'Past visits' : this.view;
    const navActive = ['Today', 'Past visits', 'History', 'Upcoming visits', 'Reminders', 'Prescriptions', 'Test records', 'Insurance', 'Profile'].includes(this.view)
      ? (this.view === 'History' ? 'Past visits' : this.view)
      : '';
    document.getElementById('app').innerHTML = `<button class="overlay" data-action="menu" aria-label="Close navigation"></button><aside class="sidebar">${this.logo()}<span class="eyebrow">Your space</span><nav class="nav" aria-label="Main navigation">${destinations.map(([n, i]) => `<button type="button" data-nav="${n}" class="${navActive === n ? 'active' : ''}" ${navActive === n ? 'aria-current="page"' : ''}>${this.icon(i)}${n}</button>`).join('')}</nav><div class="sidebar-bottom"><div class="profile-mini"><button type="button" class="profile-mini-main" data-nav="Profile" aria-label="Open profile"><div class="avatar">${this.esc(this.initials(name))}</div><div><strong style="font-size:12px">${this.esc(name)}</strong><small>My personal care space</small></div></button><button type="button" class="logout" data-action="logout" aria-label="Log out" title="Log out">${this.icon('logout')}<span>Log out</span></button></div></div></aside><div class="shell"><header class="topbar"><button class="icon-btn mobile-menu" data-action="menu" aria-label="Open navigation">${this.icon('menu')}</button><span class="mobile-brand">careloop.</span><div class="breadcrumb">My care <span>/</span><strong>${this.esc(crumb)}</strong></div><div class="topright"><span class="demo-badge"><span class="dot"></span> DEMO MODE</span><button class="icon-btn" aria-label="Notifications" data-action="notifications">${this.icon('bell')}</button><div class="account-chip"><button class="avatar" data-nav="Profile" aria-label="Open profile">${this.esc(this.initials(name))}</button><button type="button" class="logout topbar-logout" data-action="logout" aria-label="Log out" title="Log out">${this.icon('logout')}<span>Log out</span></button></div></div></header><main>${content}<footer class="footer"><span>Your care, connected. &nbsp; ♡</span><span>Fictional data · No live care or insurance actions</span></footer></main></div>`;
  },

  upcomingVisitCard(j, c) {
    if (!j?.slot) {
      return `<section class="card"><div class="section-heading"><h2>Your upcoming visit</h2></div><p style="font-size:12px">No upcoming visit yet. ${this.link('Prepare for your visit', 'start')}</p></section>`;
    }
    return `<section class="card"><div class="section-heading"><h2>Your requested appointment</h2>${this.tag('Request saved', 'peach')}</div><div class="appointment"><div class="day-box"><small>SEP</small><strong>24</strong></div><div><small>${this.esc((j.suggested_specialty_label || 'PRIMARY CARE').toUpperCase())} · FOLLOW-UP</small><h3>${this.esc(j.doctor || 'Your clinician')}</h3><small>${this.esc(j.clinic || '')}</small></div>${this.tag(c?.status === 'active' ? 'In network' : 'Confirm network', c?.status === 'active' ? '' : 'peach')}</div><div class="rule"></div><div class="details"><span>${this.icon('clock')}${this.esc(j.slot)} · 30 min</span><span>${this.icon('pin')}San Francisco, CA</span></div></section>`;
  },

  todayTaskRows(j) {
    const rx = (this.thread.prescriptions || []).find((item) => item.schedule);
    const rxRow = rx
      ? `<div class="task-row"><div class="tile-icon peach">${this.icon('pill')}</div><div><h3>Your evening medicine</h3><small>${this.esc(rx.name)} · 8:00 PM · ${this.esc(this.thread.doses.evening)}</small></div>${this.link('View', 'prescriptions')}</div>`
      : '';
    const tests = this.thread.testRecords || [];
    const testRow = tests.length
      ? `<div class="task-row"><div class="tile-icon lilac">${this.icon('test')}</div><div><h3>${this.esc(tests[0].name)}</h3><small>${tests[0].status === 'result on file' ? 'Result on file' : j?.reviewed ? 'Ready to book · no result yet' : 'Waiting for clinic review'}</small></div>${this.link('Details', 'test-records')}</div>`
      : '';
    return `${rxRow}${testRow}<div class="task-row"><div class="tile-icon">${this.icon('file')}</div><div><h3>Your story, ready for the clinic</h3><small>Visits, prescriptions, and coverage together</small></div>${this.link('Prepare', 'packet')}</div>`;
  },

  today() {
    const j = this.thread.journey;
    const complete = j?.completed;
    const c = this.coverageLabel();
    const first = this.firstName();
    return `<section class="greeting"><div><div class="eyebrow">Thursday, September 24</div><h1>A little clarity, ${this.esc(first)}.</h1><p>Here’s where things stand — and what comes next.</p></div><div class="date">${this.icon('calendar')} Your personal care space</div></section><div class="grid"><div class="stack"><section class="card hero"><div class="eyebrow">${complete ? 'One step forward' : 'Your next step'}</div><h2>${complete ? 'Your visit, all in one place.' : j ? 'Let’s pick up where you left off.' : 'Let’s make your next visit easier.'}</h2><p>${complete ? 'Your summary and next steps are saved. Take your story with you to the next visit.' : 'A few details now. A clearer conversation with your doctor later.'}</p>${this.visitHeroActions()}${this.art()}</section>${this.openVisitsPanel()}${this.upcomingVisitCard(j, c)}<section class="card"><div class="section-heading"><h2>A few things for today</h2><small>Small steps count.</small></div>${this.todayTaskRows(j)}</section></div><div class="stack"><section class="card"><div class="progress-top"><h2>Your care journey</h2>${this.tag('In progress', 'gray')}</div><ol class="timeline"><li><span class="point">${c ? '✓' : '1'}</span><div><h3>${c ? 'Insurance added' : 'Add insurance, if you like'}</h3><p>${c ? `${this.esc(c.payer)} · ${this.esc(c.status)}` : 'Optional. You can still start a visit.'}</p></div></li><li><span class="point ${complete ? '' : 'now'}">${complete ? '✓' : '2'}</span><div><h3>${complete ? 'Your visit is saved' : 'Prepare for your visit'}</h3><p>${complete ? 'Summary available in your history' : 'Share what’s on your mind.'}</p>${this.tag(complete ? 'Saved' : 'Your next step', complete ? '' : 'peach')}</div></li><li><span class="point ${complete ? 'now' : 'empty'}">3</span><div><h3>Visit &amp; care plan</h3><p>${complete ? 'Clinic reviews your next steps.' : 'A clear summary. A plan to review.'}</p></div></li><li><span class="point empty">4</span><div><h3>Keep your care moving</h3><p>Tests, medicines, and follow-ups.</p></div></li></ol></section><section class="card insurance-mini"><div class="row"><span class="eyebrow">Your coverage</span>${this.icon('shield')}</div><h3>${c ? `${this.esc(c.payer)} · ${this.esc(c.plan || '')}` : 'No insurance on file'}</h3><p>${c ? 'Coverage on file.' : 'Add a plan for estimated costs.'}</p>${c ? `<div class="row"><div><span class="money">${c.status === 'active' ? this.money(c.copay) : '—'}</span><small>&nbsp; est. PCP copay</small></div></div><div class="rule"></div>` : ''}${this.link('View insurance', 'insurance')}</section></div></div>`;
  },

  setup() {
    let content = '';
    if (this.insuranceMode === 'hub') {
      const fromVisit = this.insuranceFromVisit;
      content = `<h2>${fromVisit ? 'Let’s add your insurance.' : 'A good place to start.'}</h2><p>${fromVisit ? 'Upload your insurance card or enter your plan details, then we’ll return to finding a clinician. You can also skip and keep searching nearby.' : 'Add your insurance to see estimated costs and nearby clinics. You can also skip this for now.'}</p><div class="split"><button class="card" style="text-align:left" data-action="sample-card" type="button">${this.icon('camera')}<h3 class="mt">${fromVisit ? 'Upload a card' : 'Try a sample card'}</h3><p style="font-size:12px;margin-top:8px">${fromVisit ? 'Read a card image, or start from the Jane Doe Aetna sample and replace it with yours.' : 'Jane Doe · Aetna · DOB 2004-04-04.<br>You can still read an upload next.'}</p></button><button class="card" style="text-align:left" data-action="manual-card" type="button">${this.icon('file')}<h3 class="mt">${fromVisit ? 'Enter insurance details' : 'Enter plan details'}</h3><p style="font-size:12px;margin-top:8px">Choose your insurance company.<br>Date of birth is required.</p></button></div><div class="actions">${this.link(fromVisit ? 'Skip and return to your visit' : 'Skip for now', 'skip-insurance')}</div>`;
    } else {
      const p = this.coverageSnap.profile || {};
      const sample = this.insuranceMode === 'sample';
      const selected = p.payer_name || (sample ? this.GOLDEN_PAYER : this.GOLDEN_PAYER);
      const options = (this.payers.length ? this.payers : [{ name: this.GOLDEN_PAYER, plan_type: 'PPO' }])
        .map((row) => `<option value="${this.esc(row.name)}" ${selected === row.name ? 'selected' : ''}>${this.esc(row.name)} (${this.esc(row.plan_type)})</option>`)
        .join('');
      const warnings = (p.warnings || []).map((w) => `<p class="mt" style="font-size:12px">${this.esc(w)}</p>`).join('');
      content = `<h2>${sample ? 'Review your sample card.' : 'A few plan details.'}</h2><p>${sample ? 'These fields come from the Jane Doe Aetna sample. You can edit them before saving.' : 'Insurance company and date of birth are required.'}</p><form id="insurance-form"><label class="field">Insurance company<select name="payer" required><option value="">Select an insurer</option>${options}</select></label><label class="field">Member name (optional)<input name="member_name" value="${this.esc(p.member_name || this.thread.patient.name)}"></label><div class="split"><label class="field">Member ID (optional)<input name="member" value="${this.esc(p.member_id || '')}"></label><label class="field">Group number (optional)<input name="group" value="${this.esc(p.group_number || '')}"></label></div><label class="field">Date of birth<input type="date" name="dob" value="${this.esc(p.date_of_birth || '')}" required></label><label class="field">ZIP code<input name="zip" value="${this.esc(p.zip || this.thread.patient.zip || '94110')}" pattern="[0-9]{5}" maxlength="5"></label><div class="split"><label class="field">Card image (optional)<input type="file" id="card-file" accept="image/*,.pdf"></label><label class="field">SBC / EOB (optional)<input type="file" id="sbc-file" accept="image/*,.pdf"></label></div><p class="mt" style="font-size:12px" id="ocr-status"></p>${warnings}<div class="actions">${this.btn('Back', 'insurance-hub', 'secondary')}<div class="row">${this.btn('Read uploaded images', 'read-images', 'secondary')}<button class="btn" type="submit">Save &amp; review coverage ${this.icon('arrow')}</button></div></div></form>`;
    }
    return `<div class="narrow">${this.head(this.insuranceFromVisit ? 'Add insurance for this visit.' : this.insuranceReturn ? 'Update your insurance.' : 'Let’s bring your care together.', 'Upload a card or enter your plan details.')}<section class="card journey-panel">${content}</section></div>`;
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
    const checkin_tab = found.checked_in
      ? (found.checkin_tab || 'checkin')
      : (found.checkin_tab || 'symptoms');
    this.saveThread({ journey: { ...found, booked: true, step, checkin_tab } });
    this.navigate('Journey');
    if (step >= 5) {
      this.loadScribeDemos().then(() => {
        if (found.demo_id) this.loadScribeDemo(found.demo_id);
        if (this.view === 'Journey' && (this.thread.journey || {}).step >= 5) this.render();
      });
    }
    if (step >= 6) this.draftScribeEncounter();
  },

  upcoming() {
    const rows = this.upcomingVisits();
    let list;
    if (!rows.length) {
      list = `<div class="empty">${this.icon('calendar')}<h2>No upcoming visits yet.</h2><p>Book a time with Save request and the appointment will show up here for check-in.</p>${this.btn(`${this.icon('plus')} New visit`, 'new-visit')}</div>`;
    } else {
      list = rows.map((row) => this.visitRowCard(row, 'upcoming')).join('');
    }
    const remCount = this.remindersList().filter((row) => row.kind === 'visit' && row.status !== 'removed').length;
    return `<div class="narrow">${this.head('Upcoming visits.', 'Confirmed appointments after you save a request. Check in here when you arrive.')}<section class="card journey-panel">${list}<div class="rule"></div><p style="font-size:12px">${remCount ? `${remCount} visit reminder${remCount === 1 ? '' : 's'} on file.` : 'Set an email or calendar ping on a visit so you do not miss check-in.'} ${this.link('View all reminders', 'reminders')}</p></section></div>`;
  },

  suggestedSpecialty() {
    const j = this.thread.journey || {};
    return j.suggested_specialty
      || this.coverageSnap.intake?.suggested_specialty
      || 'pcp';
  },

  async loadNetwork() {
    const zip = this.visitZip();
    const j = this.thread.journey || {};
    const specialty = j.network_specialty === 'any' ? 'any' : this.suggestedSpecialty();
    try {
      const payload = await API.searchNetwork(specialty, zip);
      this.networkMeta = payload;
      this.clinicians = payload.clinicians || [];
      if (payload.specialty_label && specialty !== 'any') {
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
      this.networkMeta = null;
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
        body = `<h2>Make room for your health.</h2><p>${this.esc(j.doctor)} · ${this.esc(j.clinic || 'Clinic')}<br>Choose a sample time for Thursday, September 24, 2026.</p><div class="chips">${['9:00 AM', '10:30 AM', '2:00 PM', '3:30 PM'].map((t) => `<button type="button" class="chip ${j.slot === t ? 'selected' : ''}" data-slot="${t}">${t}</button>`).join('')}</div>`;
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
        body = this.planBody();
        break;
      default:
        body = '<p>Unknown step.</p>';
    }
    const skip = j.step === 7 ? this.btn('Skip estimates', 'next', 'secondary') : '';
    const nextLabel = j.step === 3 ? 'Save request' : j.step === 4 ? (this.checkinTab() === 'symptoms' ? 'Continue to check-in' : 'Continue to recording') : j.step === 5 ? 'See draft summary' : j.step === 6 && !this.eligibilityOnFile() ? 'Continue to plan' : j.step === 6 ? 'Continue to estimated costs' : j.step === 8 ? 'See follow-ups' : 'Continue';
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
    const j = this.thread.journey || {};
    return String(j.search_zip || this.coverageSnap.profile?.zip || this.thread.patient.zip || '94110').trim();
  },

  audioDisclaimer() {
    return 'Recordings stop at 2 minutes.';
  },

  recordControls(purpose) {
    const visit = purpose === 'visit';
    const day = purpose === 'day-symptoms';
    const action = visit ? 'record-visit' : day ? 'record-day-symptoms' : 'record-symptoms';
    const upload = visit ? 'pick-visit-audio' : day ? 'pick-day-symptoms-audio' : 'pick-symptoms-audio';
    if (this.recording) {
      const status = this.recordStatus
        ? `<div class="notice" id="scribe-record-status">${this.esc(this.recordStatus)}</div>`
        : '<div id="scribe-record-status" hidden></div>';
      return `<div class="visit-record voice-orb-active" id="visit-record-controls"><div class="voice-orb-wrap"><canvas id="voice-orb" class="voice-orb" width="220" height="220" aria-hidden="true"></canvas><button type="button" class="voice-orb-btn" data-action="${action}" aria-label="Stop and transcribe">${this.icon('mic')}</button></div><input type="file" id="visit-audio" accept="audio/*,.webm,.m4a,.mp3,.wav,.ogg" tabindex="-1" aria-hidden="true"></div>${status}`;
    }
    const label = this.sttBusy
      ? 'Transcribing…'
      : (visit ? `${this.icon('mic')} Record this visit` : day ? `${this.icon('mic')} Record new symptoms` : `${this.icon('mic')} Record your reason`);
    const status = this.recordStatus
      ? `<div class="notice green" id="scribe-record-status">${this.esc(this.recordStatus)}</div>`
      : '<div id="scribe-record-status" hidden></div>';
    return `<div class="visit-record" id="visit-record-controls">${this.btn(label, action, 'secondary', this.sttBusy ? 'disabled' : '')}${this.btn('Upload audio', upload, 'secondary', this.sttBusy ? 'disabled' : '')}<input type="file" id="visit-audio" accept="audio/*,.webm,.m4a,.mp3,.wav,.ogg" tabindex="-1" aria-hidden="true"></div>${status}`;
  },

  symptomsBody() {
    const j = this.thread.journey || {};
    const source = j.symptoms_source === 'stt'
      ? `<div class="notice green">Transcribed from your audio. You can edit the text before continuing.</div>`
      : '';
    return `<h2>What’s on your mind?</h2><p>Type a few words, or record a short sample. We transcribe what you say so your clinician can start with what matters to you.</p><div class="chips">${['Fatigue', 'Increased thirst', 'Diabetes follow-up', 'Plaque psoriasis', 'Lower back pain', 'Migraines', 'Something else'].map((n) => `<button type="button" class="chip ${j.symptoms.toLowerCase().includes(n.toLowerCase()) ? 'selected' : ''}" data-symptom="${n}" aria-pressed="${j.symptoms.toLowerCase().includes(n.toLowerCase())}">${n}</button>`).join('')}</div><label class="field">In your own words<textarea id="symptoms">${this.esc(j.symptoms)}</textarea></label>${this.recordControls('symptoms')}${source}<div class="document">${this.icon('file')}<div><h3 style="font-size:12px">Bring your previous visit along</h3><small>${j.prior ? 'Sample note added · metformin history' : 'Optional · sample visit summary'}</small></div>${this.btn(j.prior ? 'Added ✓' : 'Add sample', 'prior-note', 'secondary')}</div><div class="notice">${this.esc(this.audioDisclaimer())}</div>`;
  },

  doctorRows(list) {
    const j = this.thread.journey || {};
    if (!list.length) return '<p style="font-size:12px">None in this group.</p>';
    return list.map((doc) => {
      const selected = j.doctor === doc.name;
      const inNet = doc.in_network;
      return `<div class="doctor"><div class="avatar">${this.esc(this.initials(doc.name))}</div><div><h3>${this.esc(doc.name)}</h3><p>${this.esc(doc.specialty_label)} · ${doc.miles} mi<br>${this.esc(doc.address)}</p>${this.tag(inNet ? 'In network' : 'Confirm network', inNet ? '' : 'peach')}</div>${this.btn(selected ? 'Selected ✓' : 'Choose', 'choose-doctor', selected ? '' : 'secondary', `data-npi="${this.esc(doc.npi)}"`)}</div>`;
    }).join('');
  },

  clinicianBody() {
    const j = this.thread.journey || {};
    const zip = this.visitZip();
    const spec = j.suggested_specialty_label || 'Primary care';
    const any = j.network_specialty === 'any';
    const radius = this.networkMeta?.nearby_radius_miles || 40;
    const fallback = Boolean(this.networkMeta?.zip_fallback_used);
    const nearby = (this.networkMeta?.nearby || this.clinicians.filter((doc) => Number(doc.miles) <= radius)).slice(0, 6);
    const farther = this.clinicians.filter((doc) => !nearby.some((row) => row.npi === doc.npi)).slice(0, 4);
    const zipNote = fallback
      ? `ZIP ${this.esc(zip)} is not in the demo map, so distance is measured from 94110.`
      : `Distances are from ZIP ${this.esc(zip)}.`;
    const found = nearby.length
      ? `<div class="notice green">Found ${nearby.length} clinician${nearby.length === 1 ? '' : 's'} within ${radius} miles for ${this.esc(any ? 'any specialty' : spec)}. ${zipNote}</div>`
      : `<div class="notice">No clinicians within ${radius} miles of ZIP ${this.esc(zip)} for ${this.esc(any ? 'any specialty' : spec)}. ${zipNote} Alternatives below are farther or a different city.</div>`;
    const c = this.coverageLabel();
    const insurance = c
      ? `<div class="document zip-confirm">${this.icon('shield')}<div><h3>I can see your insurance</h3><p>You’re on file with <strong>${this.esc(c.payer)}</strong>${c.plan ? ` · ${this.esc(c.plan)}` : ''}${c.member ? ` · member ${this.esc(c.member)}` : ''} · ${this.esc(c.status || 'saved')}. That’s the same plan on your Insurance tab.</p></div></div>`
      : `<div class="notice">I don’t see a plan on your Insurance tab yet. You can still search nearby. Add a card or your plan details if you want estimated costs later.</div><div class="row" style="flex-wrap:wrap;margin:4px 0 12px">${this.btn('Add insurance', 'add-visit-insurance')}</div>`;
    const specReason = this.quietUserCopy(this.coverageSnap.intake?.suggested_specialty_reason)
      || 'Change the reason on the last step to change this filter.';
    return `<h2>Let’s take this one step at a time.</h2><p class="empathy">${this.esc(this.empathyForSymptoms(j.symptoms))}</p>${insurance}<div class="document mt"><div><h3>Who I would start with</h3><p>From what you shared, I’d look for a <strong>${this.esc(spec)}</strong> first. ${this.esc(specReason)}</p></div></div><div class="rule"></div><h3>Then we can search near you.</h3><p>Enter your ZIP so we can sort nearby clinicians by distance.</p><form id="zip-search-form" class="zip-search"><label class="field">ZIP code<input name="zip" value="${this.esc(zip)}" pattern="[0-9]{5}" maxlength="5" required></label><button class="btn secondary" type="submit">Search nearby</button></form><div class="row" style="flex-wrap:wrap;margin:12px 0 8px">${this.btn(any ? 'Use suggested specialty' : 'Suggested specialty ✓', 'network-suggested', any ? 'secondary' : '')}${this.btn(any ? 'Any specialty nearby ✓' : 'Any specialty nearby', 'network-any', any ? '' : 'secondary')}</div>${found}<h3 class="mt">Near ZIP ${this.esc(zip)}</h3>${this.doctorRows(nearby)}${farther.length ? `<h3 class="mt">Farther alternatives</h3><p style="font-size:12px">Farther than ${radius} miles.</p>${this.doctorRows(farther)}` : ''}`;
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
    return Boolean(j.demo_id || j.demo_transcript) && !this.liveTranscript();
  },

  selectedDemo() {
    const id = Number((this.thread.journey || {}).demo_id);
    return (this.demoTranscripts || []).find((row) => Number(row.id) === id) || null;
  },

  checkInBody() {
    const j = this.thread.journey || {};
    const tab = this.checkinTab();
    const tabs = `<div class="tabs"><button type="button" class="${tab === 'symptoms' ? 'active' : ''}" data-checkin-tab="symptoms">New symptoms</button><button type="button" class="${tab === 'checkin' ? 'active' : ''}" data-checkin-tab="checkin">Check in</button></div>`;
    if (tab === 'symptoms') {
      const extra = String(j.new_symptoms || '');
      const log = this.symptomLog(j);
      const source = j.new_symptoms_source === 'stt'
        ? `<div class="notice green">Transcribed from your audio. Add it to this visit, then keep going.</div>`
        : '';
      const booked = String(j.symptoms || '').trim()
        ? `<div class="document"><div><h3>When you booked</h3><p class="symptom-booked">${this.esc(j.symptoms)}</p></div></div>`
        : '';
      const logBlock = log.length
        ? `<div class="symptom-log">${log.map((entry) => `<article class="symptom-log-item"><time>${this.esc(this.formatStamp(entry.at))}</time><p class="symptom-note">${this.esc(entry.text)}</p></article>`).join('')}</div>`
        : '<p class="symptom-empty">No new symptoms added yet. Each note is saved with a timestamp so it stays distinct from what you booked.</p>';
      return `${tabs}<div class="eyebrow">Visit day</div><h2 class="mt">Any new symptoms before check-in?</h2><p>Add what changed since you booked. Each note is appended with a time so we can tell it apart from the original reason. This is optional — you can skip it and check in.</p>${booked}<h3 class="mt">New since booking</h3>${logBlock}<div class="chips">${['Worse than before', 'New rash', 'Fever', 'Headache', 'Nausea', 'Shortness of breath', 'Something else'].map((n) => `<button type="button" class="chip" data-new-symptom="${n}">${n}</button>`).join('')}</div><label class="field">Add another note<textarea id="new-symptoms">${this.esc(extra)}</textarea></label>${this.btn('Add this note', 'append-symptom', 'secondary')}${this.recordControls('day-symptoms')}${source}<div class="notice">${this.esc(this.audioDisclaimer())}</div>`;
    }
    const booked = this.openJourneys().filter((row) => row.slot && (row.doctor || (row.step || 1) >= 3));
    const choices = booked.length > 1
      ? `<div class="chips">${booked.map((row) => `<button type="button" class="chip ${row.id === j.id ? 'selected' : ''}" data-checkin-visit="${this.esc(row.id)}">${this.esc(this.visitTitle(row))}</button>`).join('')}</div><p>Choose which open visit to check in for.</p>`
      : '';
    const onTime = this.withinCheckInWindow();
    const warn = onTime
      ? `<div class="notice green">You’re within 15 minutes of ${this.esc(this.appointmentLabel())}.</div>`
      : `<div class="notice">The booked time is ${this.esc(this.appointmentLabel())}. You can still check in to continue.</div>`;
    const noted = this.newSymptomsText(j)
      ? `<div class="notice green"><strong>New symptoms noted</strong>${this.symptomLog(j).map((entry) => `<p class="symptom-noted">${this.esc(this.formatStamp(entry.at))} — ${this.esc(entry.text)}</p>`).join('')}${String(j.new_symptoms || '').trim() && !this.symptomLog(j).some((entry) => entry.text === String(j.new_symptoms).trim()) ? `<p class="symptom-noted">${this.esc(j.new_symptoms)}</p>` : ''}</div>`
      : '';
    return `${tabs}<div class="eyebrow">Visit day</div><h2 class="mt">Check in for this visit.</h2><p>${this.esc(j.doctor || 'Your clinician')} · ${this.esc(this.appointmentLabel())}<br>${this.esc(j.clinic || 'Clinic')}</p>${choices}${noted}${warn}<div class="document">${this.icon('check')}<div><h3>${j.checked_in ? 'Checked in' : 'Ready when you are'}</h3><small>${j.checked_in ? 'Next: record the visit, upload audio, or pick Demo 1, 2, or 3.' : 'Confirm check-in to start recording this visit.'}</small></div></div>${this.btn(j.checked_in ? 'Checked in ✓' : 'Check in', 'check-in', j.checked_in ? '' : '')}`;
  },

  liveTranscript() {
    return String((this.thread.journey && this.thread.journey.live_transcript) || '').trim();
  },

  transcriptText() {
    if (this.liveTranscript()) return this.liveTranscript();
    if (this.usesDemoTranscript()) {
      const demo = this.selectedDemo();
      return (demo && demo.transcript) || (this.scribeFixture && this.scribeFixture.transcript) || '';
    }
    return '';
  },

  renderTranscriptParas(text) {
    if (!text) {
      return `<p>No conversation yet. Record or upload audio to transcribe this visit, or choose Demo 1, Demo 2, or Demo 3.</p>`;
    }
    return text.split(/\n\n+/).map((block) => {
      const line = block.replace(/\n/g, ' ').trim();
      const m = line.match(/^([^:]{2,48}):\s*(.*)$/);
      if (m) return `<p><strong>${this.esc(m[1])}</strong> “${this.esc(m[2])}”</p>`;
      return `<p>${this.esc(line)}</p>`;
    }).join('');
  },

  transcriptMarkdown() {
    const j = this.thread.journey || {};
    const text = this.transcriptText();
    const live = Boolean(this.liveTranscript());
    const lines = ['# CareLoop · Visit transcript', '', `Patient: ${this.displayName()}`];
    if (j.doctor) lines.push(`Clinician: ${j.doctor}`);
    if (j.symptoms) lines.push(`Visit reason: ${j.symptoms}`);
    lines.push('', '## Full conversation', '');
    let hasUnresolved = false;
    (text || '').split(/\n\n+/).forEach((block) => {
      const line = block.replace(/\n/g, ' ').trim();
      if (!line) return;
      const m = line.match(/^([^:]{2,48}):\s*(.*)$/);
      if (m) {
        let label = m[1].trim();
        if (live && /^SPEAKER(\s\d+)?$/.test(label)) {
          label += '*';
          hasUnresolved = true;
        }
        lines.push(`### ${label}`, m[2], '');
      } else {
        lines.push(line, '');
      }
    });
    if (hasUnresolved) {
      lines.push('---', '* Speaker role could not be confidently identified as Doctor or Patient.');
    }
    return lines.join('\n');
  },

  transcriptBody() {
    const live = this.liveTranscript();
    const demo = this.usesDemoTranscript();
    const selected = this.selectedDemo();
    const text = this.transcriptText();
    const tag = live
      ? this.tag('Live transcript', '')
      : selected
        ? this.tag(selected.label, 'gray')
        : this.tag('No transcript yet', 'peach');
    const hint = live
      ? 'This came from your recording. Speaker labels are a best guess.'
      : selected
        ? `${selected.label} · ${selected.title}.`
        : this.audioDisclaimer();
    const demos = (this.demoTranscripts.length ? this.demoTranscripts : [
      { id: 1, label: 'Demo 1' },
      { id: 2, label: 'Demo 2' },
      { id: 3, label: 'Demo 3' },
    ]).map((row) => {
      const on = Number(this.thread.journey?.demo_id) === Number(row.id) && demo;
      return this.btn(on ? `${row.label} ✓` : row.label, 'pick-demo', on ? '' : 'secondary', `data-demo-id="${row.id}"`);
    }).join('');
    return `<div class="row" style="justify-content:space-between"><h2>Capture this visit.</h2>${tag}</div><p>Record or upload the conversation, or pick a demo transcript. The samples stay hidden until you choose one.</p>${this.recordControls('visit')}<div class="demo-picks mt">${demos}</div><div class="transcript">${this.renderTranscriptParas(text)}</div><div class="notice">${this.esc(hint)}</div>`;
  },

  planBody() {
    const j = this.thread.journey || {};
    const items = (this.encounter && this.encounter.plan) || [];
    const demo = this.usesDemoTranscript();
    const iconFor = (type) => (type === 'rx' ? 'pill' : type === 'lab' || type === 'imaging' ? 'test' : type === 'follow_up' ? 'calendar' : 'shield');
    let rows;
    if (items.length) {
      rows = items.map((item) => {
        const extra = item.pa_required ? ' May need insurance approval first.' : '';
        return `<div class="task-row"><span class="tile-icon">${this.icon(iconFor(item.type))}</span><div><h3>${this.esc(item.description || item.type)}</h3><p style="font-size:12px">${this.esc((item.notes || '') + extra)}</p></div></div>`;
      }).join('');
    } else if (demo) {
      rows = [['pill', 'Current medicine', 'Metformin stays on the existing schedule. No dose changes.'], ['test', 'HbA1c blood test', j.reviewed ? 'Ready to book.' : 'Suggested test.'], ['shield', 'Possible add-on therapy', 'Clinician may consider a GLP-1 class add-on. May need insurance approval first.'], ['calendar', 'Follow-up visit', 'Discuss a follow-up in 3 months with your clinic.']].map(([i, t, p]) => `<div class="task-row"><span class="tile-icon">${this.icon(i)}</span><div><h3>${t}</h3><p style="font-size:12px">${p}</p></div></div>`).join('');
    } else {
      rows = `<div class="notice">No next steps yet.</div>`;
    }
    return `<h2>Your next steps, together.</h2><p>${demo ? (j.reviewed ? 'These plan items are ready for the next step.' : 'Draft plan from the selected demo conversation.') : (items.length ? (j.reviewed ? 'These items came from your transcript.' : 'Draft plan pulled from your transcript.') : 'Waiting on a transcript we can read.')}</p>${rows}`;
  },

  refreshRecordUi() {
    const row = document.getElementById('visit-record-controls') || document.querySelector('.visit-record');
    if (!row) {
      this.render();
      return;
    }
    const html = this.recordControls(this.recordPurpose || 'visit');
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const nextRow = tmp.querySelector('.visit-record');
    const nextStatus = tmp.querySelector('#scribe-record-status');
    const oldStatus = document.getElementById('scribe-record-status');
    row.replaceWith(nextRow);
    if (oldStatus && nextStatus) oldStatus.replaceWith(nextStatus);
    else if (nextStatus && nextRow.nextSibling) nextRow.after(nextStatus);
    this.bindVisitAudio();
  },

  bindVisitAudio() {
    const visitAudio = document.getElementById('visit-audio');
    if (!visitAudio || visitAudio.dataset.bound === '1') return;
    visitAudio.dataset.bound = '1';
    visitAudio.addEventListener('change', () => {
      const file = visitAudio.files && visitAudio.files[0];
      if (file) this.transcribeVisitFile(file);
    });
  },

  soapBody() {
    const j = this.thread.journey || {};
    const soap = (this.encounter && this.encounter.soap) || {};
    const source = (this.encounter && this.encounter.source) || 'seeded';
    const live = this.liveTranscript();
    const sum = this.extractiveSummary || {};
    const bullets = (sum.bullets || []).map((b) => `<li style="margin:6px 0;font-size:12px">${this.esc(b)}</li>`).join('');
    const sumBlock = bullets
      ? `<div class="notice green" style="margin-bottom:22px"><strong style="display:block;margin-bottom:8px">Visit summary</strong><ul style="margin:0;padding-left:18px">${bullets}</ul></div>`
      : '';
    const intro = this.usesDemoTranscript()
      ? `${(this.selectedDemo() && this.selectedDemo().label) || 'Demo'} conversation: sample notes from that visit.`
      : live && source === 'llm'
        ? 'Drafted from your transcribed visit.'
        : live
          ? 'Your recording was transcribed. A draft summary is below.'
          : 'Draft summary from this visit.';
    const demo = this.usesDemoTranscript();
    const fallback = {
      subjective: demo ? 'Fatigue and increased thirst; taking metformin twice daily.' : '',
      objective: demo ? 'Current metformin routine. No new lab result is available in this demo.' : '',
      assessment: demo ? 'Diabetes follow-up. Any change in assessment needs clinician verification.' : '',
      plan_summary: demo ? 'Review HbA1c testing, current medicines, possible add-on therapy, and a follow-up visit.' : '',
    };
    const rows = [
      ['S', 'What you shared', soap.subjective || fallback.subjective || 'Nothing could be pulled from this transcript yet.'],
      ['O', 'What’s on file', soap.objective || fallback.objective || 'No objective details were extracted from this transcript.'],
      ['A', 'What to review', soap.assessment || fallback.assessment || 'No assessment could be drafted from this transcript yet.'],
      ['P', 'Suggested next steps', soap.plan_summary || fallback.plan_summary || 'No next steps could be pulled from this transcript yet.'],
    ];
    const transcriptActions = this.transcriptText()
      ? `<div class="mt">${this.btn(`${this.icon('download')} Download full transcript (PDF)`, 'export-transcript-pdf', 'secondary')}</div>`
      : '';
    return `<h2>Your visit, in plain language.</h2><p>${intro}</p>${sumBlock}${rows.map(([l, t, p]) => `<div class="soap"><span class="letter">${l}</span><div><h3>${t}</h3><p>${this.esc(p)}</p></div></div>`).join('')}${transcriptActions}<label class="check"><input type="checkbox" id="reviewed" ${j.reviewed ? 'checked' : ''}>Mark this summary as reviewed.</label>`;
  },

  async loadScribeFixture() {
    return this.loadScribeDemos();
  },

  async loadScribeDemos() {
    try {
      const payload = await API.listScribeDemos();
      this.demoTranscripts = payload.demos || payload || [];
    } catch (err) {
      this.demoTranscripts = [];
      this.toast(err.message);
    }
    return this.demoTranscripts;
  },

  async loadScribeDemo(id) {
    if (!this.demoTranscripts.length) await this.loadScribeDemos();
    const demo = (this.demoTranscripts || []).find((row) => Number(row.id) === Number(id));
    this.scribeFixture = demo || null;
    return demo;
  },

  async draftScribeEncounter() {
    const live = this.liveTranscript();
    const demo = this.usesDemoTranscript();
    if (demo && !this.selectedDemo()) await this.loadScribeDemos();
    const fixture = (this.selectedDemo() && this.selectedDemo().transcript)
      || (this.scribeFixture && this.scribeFixture.transcript)
      || '';
    const transcript = live || (demo ? fixture : '');
    const demoId = demo ? Number((this.thread.journey || {}).demo_id) || undefined : undefined;
    if (!transcript) {
      this.encounter = null;
      this.extractiveSummary = null;
      this.toast('Record, upload, or choose Demo 1, 2, or 3 first.');
      return;
    }
    try {
      if (live && !demo) {
        try {
          const result = await API.draftScribe({ transcript, use_seeded: false });
          this.encounter = result.encounter || result;
        } catch (err) {
          this.toast('Couldn’t draft from this recording. Using a sample summary so you can keep going.');
          const result = await API.draftScribe({ transcript, use_seeded: true, demo_id: demoId });
          this.encounter = result.encounter || result;
        }
      } else {
        const result = await API.draftScribe({ transcript, use_seeded: true, demo_id: demoId });
        this.encounter = result.encounter || result;
      }
      try {
        this.extractiveSummary = await API.summarizeScribe({ transcript, sentence_count: 5 });
      } catch (sumErr) {
        this.extractiveSummary = null;
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
      const label = `Listening… ${left}s left (max 2 minutes). Tap the orb to stop.`;
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

  /** Web Audio analyser driving the voice-orb canvas — mic level only, never routed to speakers. */
  startVoiceOrb() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx || !this.recordStream) return;
    try {
      this.orbAudioCtx = new Ctx();
      const source = this.orbAudioCtx.createMediaStreamSource(this.recordStream);
      this.orbAnalyser = this.orbAudioCtx.createAnalyser();
      this.orbAnalyser.fftSize = 256;
      this.orbAnalyser.smoothingTimeConstant = 0.8;
      source.connect(this.orbAnalyser);
      this.orbData = new Uint8Array(this.orbAnalyser.frequencyBinCount);
      this.orbLevel = 0;
      this.orbPoints = null;
      this.orbT = 0;
      this.drawVoiceOrb();
    } catch (_) {
      /* Web Audio unavailable/blocked — recording still works without the animation */
    }
  },

  drawVoiceOrb() {
    const canvas = document.getElementById('voice-orb');
    if (!canvas || !this.orbAnalyser) {
      this.orbRAF = null;
      return;
    }
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;

    this.orbAnalyser.getByteTimeDomainData(this.orbData);
    let sum = 0;
    for (let i = 0; i < this.orbData.length; i++) {
      const v = (this.orbData[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this.orbData.length);
    const target = Math.min(1, rms * 4.5);
    this.orbLevel += (target - this.orbLevel) * 0.25;

    if (!this.orbPoints) {
      this.orbPoints = [];
      for (let i = 0; i < 480; i++) {
        this.orbPoints.push({
          a: Math.random() * Math.PI * 2,
          r: Math.sqrt(Math.random()),
          tw: 0.6 + Math.random() * 0.8,
          seed: Math.random() * Math.PI * 2,
        });
      }
    }

    ctx.clearRect(0, 0, w, h);
    this.orbT += 0.02;
    const t = this.orbT;
    const level = this.orbLevel;
    const baseR = Math.min(w, h) * 0.24;
    const wobbleAmp = Math.min(w, h) * 0.1;
    const wobble = (angle) => (
      Math.sin(angle * 3 + t * 1.3) * 0.5
      + Math.sin(angle * 5 - t * 2.1) * 0.3
      + Math.sin(angle * 2 + t * 0.7) * 0.2
    );

    ctx.save();
    ctx.translate(cx, cy);
    for (const p of this.orbPoints) {
      const edge = wobble(p.a) * wobbleAmp * (0.4 + level * 1.2);
      const R = baseR + edge + level * wobbleAmp * 0.8;
      const rr = p.r * (R + Math.sin(t * p.tw + p.seed) * 3);
      const x = Math.cos(p.a) * rr;
      const y = Math.sin(p.a) * rr;
      const edgeFactor = Math.pow(p.r, 2.2);
      const alpha = 0.08 + edgeFactor * (0.5 + level * 0.4);
      const size = 0.6 + edgeFactor * 1.6 + level * 1.2;
      ctx.beginPath();
      ctx.fillStyle = `rgba(49,89,75,${alpha.toFixed(3)})`;
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    this.orbRAF = requestAnimationFrame(() => this.drawVoiceOrb());
  },

  stopVoiceOrb() {
    if (this.orbRAF) {
      cancelAnimationFrame(this.orbRAF);
      this.orbRAF = null;
    }
    if (this.orbAudioCtx) {
      try { this.orbAudioCtx.close(); } catch (_) { /* ignore */ }
      this.orbAudioCtx = null;
    }
    this.orbAnalyser = null;
    this.orbPoints = null;
    this.orbLevel = 0;
    this.orbT = 0;
  },

  cancelRecording() {
    this.discardRecording = this.recording || Boolean(this.mediaRecorder);
    this.recording = false;
    this.sttBusy = false;
    this.clearRecordTimer();
    this.stopVoiceOrb();
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try { this.mediaRecorder.stop(); } catch (_) { /* ignore */ }
    }
    this.stopRecordTracks();
    this.recordChunks = [];
    this.recordStatus = '';
  },

  async toggleVisitRecord(purpose) {
    this.recordPurpose = (purpose === 'symptoms' || purpose === 'day-symptoms') ? purpose : 'visit';
    if (this.sttBusy && !this.recording) return;
    if (this.recording) {
      this.stopVisitRecord();
      return;
    }
    await this.startVisitRecord();
  },

  async startVisitRecord() {
    if (!window.isSecureContext) {
      this.toast('Recording needs a private connection. Upload an audio file instead.');
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
      this.refreshRecordUi();
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
        this.refreshRecordUi();
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
          this.refreshRecordUi();
          return;
        }
        if (!blob.size) {
          this.sttBusy = false;
          this.recordStatus = 'No audio captured. Tap Record this visit again.';
          this.toast('Recording was empty — speak for a few seconds.');
          this.refreshRecordUi();
          return;
        }
        const file = new File([blob], `visit-recording.${ext}`, { type: mimeType });
        await this.transcribeVisitFile(file);
      };

      this.mediaRecorder.start(250);
      this.recording = true;
      this.recordStatus = 'Listening… 120s left (max 2 minutes). Tap the orb to stop.';
      this.startRecordTimer();
      this.refreshRecordUi();
      this.startVoiceOrb();
      this.toast('Listening — max 2 minutes. Tap the orb to stop.');
    } catch (err) {
      this.stopRecordTracks();
      this.recording = false;
      this.toast(err.message || 'Could not start the recorder.');
      this.refreshRecordUi();
    }
  },

  stopVisitRecord() {
    if (!this.mediaRecorder || !this.recording) return;
    this.recording = false;
    this.sttBusy = true;
    this.clearRecordTimer();
    this.recordStatus = 'Sending the recording…';
    this.stopVoiceOrb();
    this.refreshRecordUi();
    try {
      if (this.mediaRecorder.state !== 'inactive') this.mediaRecorder.stop();
    } catch (err) {
      this.sttBusy = false;
      this.toast(err.message || 'Failed to stop recording.');
      this.refreshRecordUi();
    }
  },

  pickVisitAudio() {
    const input = document.getElementById('visit-audio');
    if (input) input.click();
  },

  async toggleDemoTranscript() {
    await this.selectDemoTranscript(1);
  },

  async selectDemoTranscript(id) {
    this.cancelRecording();
    const nextId = Number(id);
    if (!this.demoTranscripts.length) await this.loadScribeDemos();
    if (Number(this.thread.journey?.demo_id) === nextId && !this.liveTranscript()) {
      this.saveThread({
        journey: {
          ...this.thread.journey,
          demo_id: null,
          demo_transcript: false,
          transcript_source: '',
          stt_meta: '',
        },
      });
      this.scribeFixture = null;
      this.recordStatus = '';
      this.render();
      this.toast('Demo transcript cleared.');
      return;
    }
    const demo = await this.loadScribeDemo(nextId);
    if (!demo) {
      this.toast('That demo transcript is not loaded.');
      return;
    }
    this.saveThread({
      journey: {
        ...this.thread.journey,
        demo_id: nextId,
        demo_transcript: true,
        live_transcript: '',
        transcript_source: 'fixture',
        stt_meta: demo.label,
        symptoms: demo.symptoms || this.thread.journey.symptoms,
        suggested_specialty: demo.suggested_specialty || this.thread.journey.suggested_specialty,
        suggested_specialty_label: demo.suggested_specialty_label || this.thread.journey.suggested_specialty_label,
      },
    });
    this.recordStatus = `${demo.label} selected. Continue to draft the summary.`;
    this.render();
    this.toast(`${demo.label} selected.`);
  },

  async transcribeVisitFile(file) {
    if (!file) {
      this.toast('Choose an audio file first, or tap Record this visit.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      this.toast('That recording is too large. Try a shorter clip.');
      return;
    }
    this.sttBusy = true;
    this.recordStatus = `Transcribing ${file.name}…`;
    this.refreshRecordUi();
    try {
      const result = await API.transcribeScribeAudio(file);
      const labeled = (result.text || '').trim();
      const plain = (result.text_plain || labeled).trim();
      if (!labeled && !plain) throw new Error('No words were captured. Try again, or pick a sample visit.');
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
      } else if (this.recordPurpose === 'day-symptoms') {
        this.appendNewSymptom(plain, 'stt');
        this.saveThread({
          journey: {
            ...this.thread.journey,
            new_symptoms_source: 'stt',
            checkin_tab: 'symptoms',
          },
        });
        this.recordStatus = 'Transcribed your new symptoms and added them with a timestamp.';
        this.toast('New symptoms transcribed.');
      } else {
        this.saveThread({
          journey: {
            ...this.thread.journey,
            live_transcript: labeled || plain,
            transcript_source: 'live',
            demo_transcript: false,
            stt_meta: result.diarized
              ? `${n} voices · ${roles || 'Doctor / Patient'}`
              : result.guessed
                ? '1 voice · Doctor / Patient guessed from the text'
                : `${n || 1} voice`,
          },
        });
        this.recordStatus = result.diarized
          ? `Ready — ${roles || 'Doctor / Patient'}. Continue to draft the summary.`
          : result.guessed
            ? 'Ready — Doctor / Patient split guessed from phrasing. Review before continuing.'
            : 'Transcribed. Continue to draft the summary.';
        this.toast(result.diarized ? `Split ${n} speakers (${roles}).` : result.guessed ? 'Guessed Doctor/Patient turns from the text.' : 'Transcribed. Continue for a draft summary.');
      }
    } catch (err) {
      const raw = String(err.message || '');
      let msg = 'Couldn’t transcribe that recording. Try again, or pick a sample visit.';
      if (/incorrect api key|invalid api key|401|not set|XAI_API_KEY/i.test(raw)) {
        msg = 'Live transcription isn’t available on this host. Pick a sample visit to continue.';
      }
      this.recordStatus = 'Couldn’t transcribe that recording. Pick a sample visit, or try again.';
      this.toast(msg);
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

  medicinesForCostGuess() {
    const plan = (this.encounter && this.encounter.plan) || [];
    const fromPlan = plan
      .filter((item) => String(item.type || '').toLowerCase() === 'rx')
      .map((item) => ({
        id: item.id || item.plan_item_id,
        name: this.careName(item.description) || item.description,
        description: item.description || '',
        pa_required: Boolean(item.pa_required),
        code: item.code || null,
      }));
    if (fromPlan.length) return fromPlan;
    return (this.careFromEncounter().prescriptions || []).map((item) => ({
      id: item.id,
      name: item.name,
      description: [item.name, item.notes].filter(Boolean).join(' · '),
      pa_required: /may need (insurance )?approval|PA may be required/i.test(item.notes || ''),
      code: null,
    }));
  },

  costMoneyCell(line) {
    if (!line || line.priced === false || line.patient_owes_low == null) {
      if (line && line.pa_required) {
        return `${this.tag('May need approval', 'peach')} — not priced`;
      }
      return this.tag('Not priced', 'gray');
    }
    return this.money(line.patient_owes_low);
  },

  claimAcceptanceBlock() {
    const claim = this.claimAcceptance
      || (this.costEstimate && this.costEstimate.claim_acceptance)
      || (this.coverageSnap.visit_cost_estimate && this.coverageSnap.visit_cost_estimate.claim_acceptance);
    if (!claim) {
      return `<div class="notice">Estimate isn’t ready yet.</div>`;
    }
    if (!claim.available || claim.acceptance_percent == null) {
      return `<div class="notice">Estimate isn’t ready yet.</div>`;
    }
    const pct = Number(claim.acceptance_percent);
    const factors = (claim.factors || [])
      .map((row) => this.quietClaimFactor(row))
      .filter(Boolean)
      .filter((row, i, all) => all.indexOf(row) === i)
      .slice(0, 3)
      .map((row) => `<li>${this.esc(row)}</li>`).join('');
    return `<div class="acceptance"><div class="acceptance-meter"><strong>${pct}%</strong><small>estimated chance a later claim is accepted</small></div>${factors ? `<ul class="acceptance-factors">${factors}</ul>` : ''}</div>`;
  },

  costBody() {
    const demo = this.usesDemoTranscript();
    const estimate = this.costEstimate || this.coverageSnap.visit_cost_estimate;
    const claim = this.claimAcceptanceBlock();
    if (!demo && !this.transcriptText()) {
      return `<h2>A little visibility into costs.</h2><p>Estimated costs come from your visit transcript unless you pick Demo 1, 2, or 3.</p><div class="notice">No transcript yet, so there is no cost estimate to show.</div>${claim}`;
    }
    if (!estimate) {
      return `<h2>A little visibility into costs.</h2><p>${demo ? 'Loading amounts from the selected demo conversation…' : 'Trying to pull cost lines from your transcript…'}</p>${claim}`;
    }
    const lines = estimate.likely_visits || [];
    if (!lines.length && !(estimate.medicines || []).length) {
      return `<h2>A little visibility into costs.</h2><p>${demo ? 'The selected demo did not return priced services.' : 'Nothing billable could be pulled from this transcript yet.'}</p><div class="notice">No priced services yet.</div>${claim}`;
    }
    const visitRows = lines.map((line) => {
      const allowed = line.allowed;
      const you = line.patient_owes_low;
      const planPays = (allowed != null && you != null) ? Math.max(0, Number(allowed) - Number(you)) : null;
      const basis = this.quietCostBasis(line.basis);
      return `<tr><td>${this.esc(line.description)}${basis ? `<div class="cost-basis">${this.esc(basis)}</div>` : ''}</td><td>${this.money(allowed)}</td><td>${planPays == null ? '—' : this.money(planPays)}</td><td>${this.money(you)}</td></tr>`;
    }).join('');
    const meds = estimate.medicines || [];
    const medRows = meds.length
      ? meds.map((line) => {
        const tier = line.tier_label ? `<small>${this.esc(line.tier_label)}</small>` : '';
        const basis = this.quietCostBasis(line.basis);
        return `<tr><td>${this.esc(line.name || line.description || 'Medicine')} ${tier}${basis ? `<div class="cost-basis">${this.esc(basis)}</div>` : ''}</td><td>${line.allowed != null ? this.money(line.allowed) : '—'}</td><td>${line.priced ? this.money(0) : '—'}</td><td>${this.costMoneyCell(line)}</td></tr>`;
      }).join('')
      : '<tr><td colspan="4"><span style="color:var(--muted)">No medicines on this visit plan yet.</span></td></tr>';
    const visitLow = estimate.visit_owes_low != null ? estimate.visit_owes_low : estimate.patient_owes_low;
    const visitHigh = estimate.visit_owes_high != null ? estimate.visit_owes_high : estimate.patient_owes_high;
    const medLow = estimate.medicine_owes_low || 0;
    const medHigh = estimate.medicine_owes_high || 0;
    const unpriced = estimate.medicine_unpriced_count || 0;
    const totalNote = unpriced
      ? `estimated you-pay · visit + priced medicines · ${unpriced} medicine${unpriced === 1 ? '' : 's'} not priced`
      : 'estimated you-pay · visit + medicines';
    const source = demo
      ? 'Sample amounts from the selected demo conversation, your saved plan, and medicines on this visit’s plan.'
      : 'Amounts from your transcript, your saved plan, and medicines on this visit’s plan.';
    const visitTable = lines.length
      ? `<h3 class="mt">Visit</h3><table class="cost-table"><thead><tr><th>ESTIMATED SERVICE</th><th>ALLOWED</th><th>PLAN PAYS</th><th>YOU PAY</th></tr></thead><tbody>${visitRows}</tbody></table><div class="cost-subtotal">Visit subtotal ${this.money(visitLow)}${visitHigh !== visitLow ? `–${this.money(visitHigh)}` : ''}</div>`
      : `<h3 class="mt">Visit</h3><div class="notice">No visit services priced yet.</div>`;
    return `<h2>A little visibility into costs.</h2><p>${source}</p>${visitTable}<h3 class="mt">Prescription medicines</h3><table class="cost-table"><thead><tr><th>MEDICINE</th><th>ALLOWED</th><th>PLAN PAYS</th><th>YOU PAY</th></tr></thead><tbody>${medRows}</tbody></table><div class="cost-subtotal">Medicines subtotal ${this.money(medLow)}${medHigh !== medLow ? `–${this.money(medHigh)}` : ''}${unpriced ? ` · ${unpriced} not priced` : ''}</div><div class="cost-total">${this.money(estimate.patient_owes_low)}${estimate.patient_owes_high !== estimate.patient_owes_low ? `–${this.money(estimate.patient_owes_high)}` : ''} <small>${this.esc(totalNote)}</small></div>${claim}`;
  },

  followups() {
    const pending = this.thread.pendingCare || this.careFromEncounter();
    const rx = pending.prescriptions || [];
    const labs = pending.tests || [];
    const rxRows = rx.length
      ? rx.map((item) => `<div class="task-row"><span class="tile-icon peach">${this.icon('pill')}</span><div><h3>${this.esc(item.name)}</h3><p style="font-size:12px">${this.esc(item.status || 'To take or buy')}${item.notes ? ` · ${this.esc(item.notes)}` : ''}</p></div></div>`).join('')
      : '<p style="font-size:12px">No medicines were listed on this visit plan.</p>';
    const labRows = labs.length
      ? labs.map((item) => `<div class="task-row"><span class="tile-icon">${this.icon('test')}</span><div><h3>${this.esc(item.name)}</h3><p style="font-size:12px">${this.esc(item.status || 'To schedule')}${item.notes ? ` · ${this.esc(item.notes)}` : ''}</p></div></div>`).join('')
      : '<p style="font-size:12px">No tests were listed on this visit plan.</p>';
    const applied = Boolean(pending.applied);
    const updateBtn = applied
      ? this.btn('View prescriptions', 'prescriptions') + this.btn('View test records', 'test-records', 'secondary')
      : this.btn('Update Prescriptions and Test records', 'apply-care');
    return `<div class="narrow">${this.head('What to take. What to book.', 'Medicines and tests from this visit.')}<section class="card"><h2>Medicines to take or buy</h2>${rxRows}<div class="rule"></div><h2>Tests to complete</h2>${labRows}<div class="actions">${this.btn('Prepare clinic packet', 'packet', 'secondary')}<div class="row">${updateBtn}</div></div></section></div>`;
  },

  visitCareItemForm(visitId, kind, item) {
    const statuses = kind === 'rx'
      ? ['To take', 'To buy', 'Picked up', 'Taking as written', 'Stopped', 'Updated after visit']
      : ['To schedule', 'Scheduled', 'Completed', 'Result on file', 'Updated after visit'];
    const current = item.status || statuses[0];
    const opts = statuses.map((s) => `<option value="${this.esc(s)}" ${s === current ? 'selected' : ''}>${this.esc(s)}</option>`).join('');
    return `<form class="visit-care-form" data-visit-id="${this.esc(visitId)}" data-care-kind="${kind}" data-item-id="${this.esc(item.id)}"><div class="split"><label class="field">Status<select name="status">${opts}</select></label><label class="field">${kind === 'rx' ? 'Pharmacy / how you take it' : 'Lab / appointment'}<input name="place" value="${this.esc(item.place || item.lab || '')}" maxlength="80"></label></div><label class="field">After-visit information<textarea name="notes" rows="3">${this.esc(item.notes || '')}</textarea></label><button class="btn secondary" type="submit">Update this ${kind === 'rx' ? 'prescription' : 'test'}</button></form>`;
  },

  pastVisitDetail(v) {
    const log = this.symptomLog(v);
    const extra = log.length
      ? log.map((entry) => `${this.formatStamp(entry.at)} — ${entry.text}`).join('\n')
      : (v.new_symptoms || '');
    const care = v.care || { prescriptions: [], tests: [] };
    const rx = care.prescriptions || [];
    const tests = care.tests || [];
    const rxBlock = rx.length
      ? rx.map((item) => `<div class="document mt visit-care-item"><span class="tile-icon peach">${this.icon('pill')}</span><div style="flex:1"><h3>${this.esc(item.name)}</h3><small>${this.esc(item.status || '')}${item.place ? ` · ${this.esc(item.place)}` : ''}</small>${this.visitCareItemForm(v.id, 'rx', item)}</div></div>`).join('')
      : '<p style="font-size:12px">No prescriptions on this visit yet. Add them from a doctor’s page below.</p>';
    const testBlock = tests.length
      ? tests.map((item) => `<div class="document mt visit-care-item"><span class="tile-icon">${this.icon('test')}</span><div style="flex:1"><h3>${this.esc(item.name)}</h3><small>${this.esc(item.status || '')}${item.place || item.lab ? ` · ${this.esc(item.place || item.lab)}` : ''}</small>${this.visitCareItemForm(v.id, 'test', item)}</div></div>`).join('')
      : '<p style="font-size:12px">No tests on this visit yet. Add them from a doctor’s page below.</p>';
    const script = v.script
      ? `<div class="notice green">Doctor’s page on file: ${this.esc(v.script.filename || 'uploaded page')}${v.script.at ? ` · ${this.esc(this.formatStamp(v.script.at))}` : ''}${v.script.extracted && v.script.extracted.document_type ? ` · read as ${this.esc(v.script.extracted.document_type)}` : ''}</div>${this.extractedPartsBlock(v.script.extracted)}`
      : '';
    return `<button class="back" data-action="history-back" type="button">${this.icon('back')}Past visits</button><h2>${this.esc(v.reason)}</h2><p class="mt">${this.esc(v.date)} · ${this.esc(v.doctor)}</p><div class="rule"></div>${[['What happened', v.summary], ...(extra ? [['New symptoms at check-in', extra]] : []), ['Coverage at this visit', v.coverage]].map(([t, p]) => `<h3 class="mt">${t}</h3><p style="font-size:12px;margin-top:7px">${this.esc(p)}</p>`).join('')}<div class="rule"></div><h3>Update from a doctor’s prescription</h3><p class="mt" style="font-size:12px">Upload the page you were given, or type each medicine or test yourself.</p>${script}<form id="visit-script-form" data-visit-id="${this.esc(v.id)}"><label class="field">Doctor’s page (PDF or picture)<input type="file" id="visit-script-file" accept="image/*,.pdf,application/pdf"></label><label class="field">Prescriptions on that page (one per line)<textarea name="rx" rows="3" placeholder="Metformin 1000 mg twice daily"></textarea></label><label class="field">Tests needed (one per line)<textarea name="tests" rows="3" placeholder="HbA1c"></textarea></label><label class="field">Notes from after the visit<textarea name="notes" rows="2" placeholder="Pharmacy, fasting, follow-up date"></textarea></label><button class="btn" type="submit">Update this visit from the page</button></form><div class="rule"></div><h3>Prescriptions from this visit</h3>${rxBlock}<div class="rule"></div><h3>Tests needed</h3>${testBlock}<div class="mt">${this.btn('View in clinic packet', 'packet')}</div>`;
  },

  history() {
    let content = '';
    if (this.selectedVisit) {
      const v = this.thread.visits.find((x) => x.id === this.selectedVisit);
      if (!v) {
        this.selectedVisit = null;
        return this.history();
      }
      content = this.pastVisitDetail(v);
    } else {
      content = `<div class="tabs"><button type="button" class="${this.historyTab === 'visits' ? 'active' : ''}" data-tab="visits">My visits</button><button type="button" class="${this.historyTab === 'packet' ? 'active' : ''}" data-tab="packet">For the clinic</button></div>`;
      if (this.historyTab === 'visits') {
        const past = this.thread.visits.length
          ? this.thread.visits.map((v) => `<button class="visit-row" data-visit="${v.id}" type="button"><div class="tile-icon">${this.icon('file')}</div><div><small>${this.esc(v.date)}</small><h3>${this.esc(v.reason)}</h3><small>${this.esc(v.doctor)} · ${v.reviewed ? 'Reviewed' : 'Awaiting review'}</small></div>${this.icon('arrow')}</button>`).join('')
          : `<div class="empty">${this.icon('history')}<h2>Your story starts here.</h2><p>Finish an upcoming visit and it will appear here as a past visit. You can also start another visit without finishing this one.</p>${this.btn(`${this.icon('plus')} New visit`, 'new-visit')}</div>`;
        content += `${this.historyOpenVisits()}${this.thread.visits.length ? `<div class="section-heading"><h2>Finished visits</h2></div>${past}` : (this.openJourneys().length ? `<div class="section-heading"><h2>Finished visits</h2></div><p style="font-size:12px">None saved yet.</p>` : past)}`;
      } else {
        content += `<h2>Don’t start from scratch.</h2><p class="mt">A packet of this patient’s visits, prescriptions, tests, and coverage — ready to take to the clinic.</p><div class="packet-preview"><p class="packet-preview-status" id="packet-preview-status">Preparing your packet…</p><iframe class="packet-preview-frame" id="packet-preview-frame" title="Clinic packet PDF" hidden></iframe></div><div class="actions"><small>Includes visits, prescriptions, test records, and coverage.</small><div class="row">${this.btn(`${this.icon('download')} Download PDF`, 'export-pdf')}</div></div>`;
      }
    }
    return `<div class="narrow">${this.head('Past visits.', 'Finished appointments, with room to update prescriptions and tests after you leave the clinic.')}<section class="card journey-panel">${content}</section></div>`;
  },

  medicines() {
    return this.prescriptions();
  },

  prescriptions() {
    const list = this.thread.prescriptions || [];
    const rows = list.length
      ? list.map((rx) => `<div class="task-row" style="flex-wrap:wrap;align-items:flex-start"><span class="tile-icon peach">${this.icon('pill')}</span><div style="flex:1;min-width:160px"><h3>${this.esc(rx.name)}</h3><p style="font-size:12px">${this.esc(rx.notes || '')}</p><small>${this.esc(rx.status || 'active')}${rx.source === 'visit' ? ' · from a visit' : ''}</small></div><div>${this.reminderPingButton('dose', rx.id || this.careKey(rx.name), `${rx.name} dose`, rx.notes || 'Medicine reminder', this.reminderDefaultWhen('dose'))}</div></div>`).join('')
      : '<p style="font-size:12px">No prescriptions on file yet. Finish an upcoming visit to add medicines to take or buy.</p>';
    const scheduled = list.some((rx) => rx.schedule);
    const doses = scheduled
      ? `${[['morning', '8:00 AM', 'Morning dose'], ['evening', '8:00 PM', 'Evening dose']].map(([key, time, title]) => `<div class="task-row" style="flex-wrap:wrap;align-items:flex-start"><div style="flex:1"><small>${time}</small><h3 style="margin-top:6px">${title}</h3>${this.tag(this.thread.doses[key], this.thread.doses[key] === 'missed' ? 'peach' : '')}</div><div class="row" style="flex-wrap:wrap">${this.btn('Taken', 'dose', 'secondary', `data-dose="${key}" data-status="taken"`)}${this.btn('Missed', 'dose', 'secondary', `data-dose="${key}" data-status="missed"`)}${this.reminderPingButton('dose', `schedule-${key}`, `Metformin ${title.toLowerCase()}`, time, this.reminderDefaultWhen('dose'))}</div></div>`).join('')}`
      : '';
    const refillExisting = this.reminderForSource('refill', 'metformin-refill');
    const refillNote = list.length
      ? `<p class="mt">Prepare a refill request for an existing medicine.</p><div class="mt row" style="flex-wrap:wrap">${this.btn(this.thread.refill ? 'View refill draft' : 'Draft refill request', 'refill', 'secondary')}${this.reminderPingButton('refill', 'metformin-refill', 'Metformin refill', 'About 12 days of supply remaining on the sample record', this.reminderDefaultWhen('refill'))}</div>${refillExisting ? '' : '<p style="font-size:11px;margin-top:10px">Refill pings live with your other reminders.</p>'}`
      : '<p class="mt">Add a medicine from a visit first, then you can draft a refill request here.</p>';
    return `${this.head('Prescriptions.', 'Medicines from your visits — what to keep taking, and what to pick up.')}<div class="grid"><section class="card"><div class="section-heading"><h2>On your list</h2>${this.tag(`${list.length} on file`, 'gray')}</div>${rows}${doses}</section><div class="stack"><section class="card insurance-mini"><div class="eyebrow">A little ahead of time</div><h2 class="mt">Refill note</h2>${refillNote}<div class="mt">${this.link('View all reminders', 'reminders')}</div></section></div></div>`;
  },

  tests() {
    return this.testRecords();
  },

  testRecords() {
    const list = this.thread.testRecords || [];
    const results = list.filter((row) => row.kind === 'result' || row.preview || row.dataUrl);
    const planned = list.filter((row) => row.kind === 'appointment' || row.kind === 'order');
    const resultRows = results.length
      ? results.map((row) => {
        const kind = (row.mime || '').includes('pdf') || (row.filename || '').toLowerCase().endsWith('.pdf') ? 'PDF' : (row.preview === 'sample' ? 'Sample' : 'Picture');
        return `<div class="document mt"><span class="tile-icon lilac">${this.icon('file')}</span><div style="flex:1"><h3>${this.esc(row.name)}</h3><small>${this.esc(row.date || 'Date not listed')} · ${kind}${row.filename ? ` · ${this.esc(row.filename)}` : ''}<br>${this.esc(row.notes || row.status || '')}</small></div>${this.btn('View', 'view-test', 'secondary', `data-test-id="${this.esc(row.id)}"`)}</div>`;
      }).join('')
      : '<p style="font-size:12px">No past results on file yet. Upload a PDF or picture, or finish a visit and update test records.</p>';
    const plannedRows = planned.length
      ? planned.map((row) => `<div class="task-row" style="flex-wrap:wrap;align-items:flex-start"><span class="tile-icon">${this.icon(row.kind === 'appointment' ? 'calendar' : 'test')}</span><div style="flex:1;min-width:160px"><h3>${this.esc(row.name)}</h3><p style="font-size:12px">${this.esc(row.lab || '')}${row.lab && (row.date || row.time) ? ' · ' : ''}${this.esc([row.date, row.time].filter(Boolean).join(' · '))}</p><small>${this.esc(row.status || 'To schedule')}${row.notes ? ` · ${this.esc(row.notes)}` : ''}${row.source === 'visit' ? ' · from a visit' : ''}</small></div><div class="row" style="flex-wrap:wrap">${this.btn('Attach result', 'attach-test', 'secondary', `data-test-id="${this.esc(row.id)}"`)}${this.reminderPingButton('test', row.id, row.name, [row.lab, row.date, row.time].filter(Boolean).join(' · '), row.date ? `${row.date}T${(row.time || '10:00').length === 5 ? row.time || '10:00' : '10:00'}` : this.reminderDefaultWhen('test'))}</div></div>`).join('')
      : '<p style="font-size:12px">No lab appointments or visit tests yet. Record one below, or finish an upcoming visit.</p>';
    return `${this.head('Test records.', 'Past results you can open, and lab appointments you still need to complete.')}<div class="grid"><section class="card"><div class="section-heading"><h2>Past results</h2>${this.tag(`${results.length} on file`, 'gray')}</div><p style="font-size:12px">Open a PDF or picture from a prior test.</p>${resultRows}<div class="rule"></div><h3>Add a result</h3><form id="test-result-form"><label class="field">Test name<input name="name" required maxlength="80" placeholder="HbA1c"></label><label class="field">Result file (PDF or picture)<input type="file" id="test-result-file" accept="image/*,.pdf,application/pdf" required></label><button class="btn" type="submit">Save result</button></form></section><div class="stack"><section class="card"><div class="section-heading"><h2>Labs to complete</h2>${this.tag(`${planned.length}`, 'gray')}</div>${plannedRows}<input type="file" id="test-attach-file" accept="image/*,.pdf,application/pdf"><div class="mt">${this.link('View all reminders', 'reminders')}</div></section><section class="card insurance-mini"><div class="eyebrow">Potential test</div><h2 class="mt">Record a lab appointment</h2><p class="mt">Save a time with a lab as a test you still need to complete. You can add an email or calendar ping afterward.</p><form id="lab-form"><label class="field">Test name<input name="name" required maxlength="80" placeholder="HbA1c"></label><label class="field">Lab<input name="lab" maxlength="80" placeholder="Quest · Mission"></label><div class="split"><label class="field">Date<input type="date" name="date" required></label><label class="field">Time<input type="time" name="time"></label></div><label class="field">Notes<input name="notes" maxlength="160" placeholder="Fasting, if the clinic asked"></label><button class="btn" type="submit">Save lab appointment</button></form></section></div></div>`;
  },

  insurance() {
    const c = this.coverageLabel();
    if (!c) {
      return `<div class="narrow">${this.head('Insurance, a little clearer.', 'Your plan details stay alongside your care.')}<section class="card empty">${this.icon('shield')}<h2>No plan on file.</h2><p>You can add a sample plan or continue without estimates.</p>${this.btn('Add insurance', 'update-insurance')}</section></div>`;
    }
    const e = this.coverageSnap.eligibility || {};
    return `<div class="narrow">${this.head('Insurance, a little clearer.', 'One place for your plan, estimated costs, and what needs a second look.')}<section class="card journey-panel"><div class="insurance-card"><div class="row" style="justify-content:space-between"><span>careloop / coverage</span>${this.icon('shield')}</div><h2>${this.esc(c.payer)}</h2><strong>${this.esc(this.displayName())}</strong><div class="split"><div><small>MEMBER ID</small><p style="color:white">${this.esc(c.member || 'Not provided')}</p></div><div><small>DOB</small><p style="color:white">${this.esc(c.dob || 'Not provided')}</p></div></div></div><div class="section-heading"><h3>Coverage snapshot</h3>${this.tag(c.status, c.status === 'active' ? '' : 'peach')}</div><div class="coverage-stats"><div><small>PCP copay</small><strong>${c.status === 'active' ? this.money(c.copay) : '—'}</strong><small>estimated</small></div><div><small>Deductible left</small><strong>${c.status === 'active' ? this.money(c.deductible) : '—'}</strong><small>remaining</small></div><div><small>Plan type</small><strong>${this.esc(c.plan || '—')}</strong><small>${this.esc(e.network_name || 'your plan')}</small></div></div>${this.eligibilityNote() ? `<div class="notice">${this.esc(this.eligibilityNote())}</div>` : ''}<div class="actions">${this.btn('Update plan details', 'update-insurance', 'secondary')}${this.btn('Refresh coverage', 'refresh-eligibility')}${this.link('Start a visit', 'start')}</div><div class="rule"></div><div class="document mt"><div style="flex:1"><h3>Insurance Claims Management</h3><small>Coming soon</small></div></div></section></div>`;
  },

  profile() {
    const p = this.thread.patient;
    const shown = this.displayName();
    const account = App.user?.username || 'account';
    return `<div class="narrow">${this.head('A space that’s yours.', 'General details for your fictional patient profile.')}<section class="card journey-panel"><div class="row" style="justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap"><div class="row"><div class="avatar">${this.esc(this.initials(shown))}</div><div><h2>${this.esc(shown)}</h2><small>Fictional demo patient${App.user ? ` · signed in as ${this.esc(App.user.username)}` : ''}</small></div></div>${this.btn(`${this.icon('logout')} Log out`, 'logout', 'secondary')}</div><div class="rule"></div><form id="profile-form"><label class="field">Display name<input name="name" value="${this.esc(p.name)}" required maxlength="60"></label><label class="field">Email<input type="email" name="email" value="${this.esc(p.email)}" required></label><label class="field">ZIP code<input name="zip" pattern="[0-9]{5}" value="${this.esc(p.zip)}" required></label><button class="btn" type="submit">Save profile</button></form>${this.envPanel()}<div class="rule"></div><h3>Ready for another walkthrough?</h3><p style="font-size:12px;margin:10px 0 20px">Reset only this demo’s saved visits, doses, and insurance to the sample record.</p><div class="actions" style="justify-content:flex-start;flex-wrap:wrap"><div class="row">${this.btn('Reset demo data', 'reset', 'secondary')}${this.btn(`${this.icon('logout')} Log out of ${this.esc(account)}`, 'logout')}</div></div></section></div>`;
  },

  render() {
    if (!App.user) {
      this.renderLogin();
      return;
    }
    const pages = {
      Today: () => this.today(),
      Setup: () => this.setup(),
      Journey: () => this.journey(),
      Followups: () => this.followups(),
      History: () => this.history(),
      'Past visits': () => this.history(),
      'Upcoming visits': () => this.upcoming(),
      Reminders: () => this.reminders(),
      Prescriptions: () => this.prescriptions(),
      'Test records': () => this.testRecords(),
      Medicines: () => this.prescriptions(),
      Tests: () => this.testRecords(),
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
        const name = String(d.get('name') || '').trim() || 'Jane Doe';
        this.saveThread({
          patient: {
            ...this.thread.patient,
            name,
            email: d.get('email'),
            zip: d.get('zip'),
            identity_source: 'profile',
          },
        });
        if (App.user) App.user.name = name;
        this.render();
        this.toast('Profile saved');
      });
    }
    const symptom = document.getElementById('symptoms');
    if (symptom) {
      symptom.addEventListener('input', (e) => {
        this.saveThread({ journey: { ...this.thread.journey, symptoms: e.target.value } });
      });
    }
    const newSymptoms = document.getElementById('new-symptoms');
    if (newSymptoms) {
      newSymptoms.addEventListener('input', (e) => {
        this.saveThread({ journey: { ...this.thread.journey, new_symptoms: e.target.value } });
      });
    }
    const scriptForm = document.getElementById('visit-script-form');
    if (scriptForm) {
      scriptForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.applyDoctorScript(scriptForm.dataset.visitId, e.currentTarget);
      });
    }
    document.querySelectorAll('.visit-care-form').forEach((form) => {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const d = new FormData(form);
        this.updateVisitCareItem(form.dataset.visitId, form.dataset.careKind, form.dataset.itemId, {
          status: String(d.get('status') || '').trim(),
          place: String(d.get('place') || '').trim(),
          notes: String(d.get('notes') || '').trim(),
        });
      });
    });
    const review = document.getElementById('reviewed');
    if (review) {
      review.addEventListener('change', (e) => {
        this.approveScribeEncounter(e.target.checked);
      });
    }
    this.bindVisitAudio();
    const labForm = document.getElementById('lab-form');
    if (labForm) {
      labForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.addLabAppointment(e.currentTarget);
      });
    }
    const resultForm = document.getElementById('test-result-form');
    if (resultForm) {
      resultForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.addTestResult(e.currentTarget);
      });
    }
    const zipSearch = document.getElementById('zip-search-form');
    if (zipSearch) {
      zipSearch.addEventListener('submit', async (e) => {
        e.preventDefault();
        const zip = String(new FormData(e.currentTarget).get('zip') || '').trim();
        if (!/^\d{5}$/.test(zip)) {
          this.toast('Enter a 5-digit ZIP.');
          return;
        }
        this.saveThread({ journey: { ...this.thread.journey, search_zip: zip, doctor: '' } });
        await this.loadNetwork();
        this.render();
        const n = (this.networkMeta && this.networkMeta.nearby_count) || 0;
        this.toast(n ? `Found ${n} nearby clinician${n === 1 ? '' : 's'}.` : 'No nearby matches. Showing farther alternatives.');
      });
    }
    const attachFile = document.getElementById('test-attach-file');
    if (attachFile) {
      attachFile.addEventListener('change', () => {
        const file = attachFile.files && attachFile.files[0];
        if (file) this.attachTestResult(this.attachTestId, file);
        this.attachTestId = null;
        attachFile.value = '';
      });
    }
    this.refreshPacketPreview();
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
      if (this.insuranceFromVisit) {
        this.insuranceFromVisit = false;
        this.insuranceReturn = false;
        this.toast('Plan saved. I can see it now — continue with your ZIP search.');
        this.navigate('Journey');
        if (this.thread.journey && this.thread.journey.step >= 2) await this.loadNetwork();
        this.render();
        return;
      }
      this.navigate('Insurance');
      this.toast('Plan saved.');
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
    const pending = { ...this.careFromEncounter(), applied: false, visitId: j.id };
    const done = {
      id: j.id || Date.now().toString(),
      date: 'September 24, 2026',
      reason: j.symptoms || 'Visit',
      new_symptoms: this.newSymptomsText(j),
      new_symptoms_log: this.symptomLog(j),
      doctor: j.doctor,
      reviewed: j.reviewed,
      summary: this.visitCareSummary(pending),
      coverage: c ? c.payer : 'No plan on file',
      care: pending,
    };
    const remaining = this.openJourneys().filter((row) => row.id !== done.id);
    this.saveThread({
      visits: [done, ...this.thread.visits],
      openVisits: remaining,
      journey: { ...j, completed: true },
      pendingCare: pending,
    });
    this.clearVisitRuntime();
  },

  async loadCostGuess() {
    const j = this.thread.journey;
    const demo = this.usesDemoTranscript();
    const selected = this.selectedDemo();
    const transcript = this.transcriptText();
    const symptoms = (demo && selected && selected.symptoms)
      ? selected.symptoms
      : (transcript || this.visitReasonText(j) || j.symptoms || '');
    this.costEstimate = null;
    this.claimAcceptance = null;
    if (this.eligibilityOnFile()) {
      try {
        await API.saveCoverageIntake({
          symptoms,
          use_fixture_prior_visit: Boolean(j.prior) || demo,
        });
        this.rememberCoverage(await API.guessVisitCost({
          symptoms,
          from_transcript: !demo,
          medicines: this.medicinesForCostGuess(),
          specialty: j.suggested_specialty || this.coverageSnap.intake?.suggested_specialty || '',
        }));
        this.costEstimate = this.coverageSnap.visit_cost_estimate;
      } catch (err) {
        this.costEstimate = null;
        if (demo) this.toast(err.message);
      }
    }
    try {
      const planCode = ((this.encounter && this.encounter.plan) || [])
        .map((item) => item && item.code)
        .find(Boolean) || '';
      const lineCode = (this.costEstimate && this.costEstimate.likely_visits && this.costEstimate.likely_visits[0] && this.costEstimate.likely_visits[0].code) || '';
      this.claimAcceptance = await API.claimAcceptance({
        symptoms: symptoms || transcript,
        cpt_code: planCode || lineCode,
        has_clinical_notes: Boolean(transcript),
        has_prior_auth: false,
      });
    } catch (err) {
      this.claimAcceptance = {
        available: false,
        disclaimer: err.message || 'Could not estimate claim acceptance from this visit yet.',
      };
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
    if (j.step === 4 && this.checkinTab() !== 'checkin') {
      const typed = document.getElementById('new-symptoms');
      if (typed && typed.value.trim()) this.appendNewSymptom(typed.value, 'typed');
      this.saveThread({
        journey: {
          ...this.thread.journey,
          checkin_tab: 'checkin',
        },
      });
      this.render();
      window.scrollTo(0, 0);
      return;
    }
    if (j.step === 4 && !j.checked_in) {
      this.toast('Check in for this visit first.');
      return;
    }
    if (j.step === 5 && !this.liveTranscript() && !this.usesDemoTranscript()) {
      this.toast('Record, upload, or choose Demo 1, 2, or 3 first.');
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
    if (next === 5) await this.loadScribeDemos();
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
      if (d.checkinTab) {
        if (this.recording || this.sttBusy) {
          this.toast(this.recording ? 'Tap Stop & transcribe first.' : 'Wait for transcription to finish.');
          return;
        }
        this.saveThread({ journey: { ...this.thread.journey, checkin_tab: d.checkinTab } });
        this.render();
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
        this.saveThread({
          journey: {
            ...this.thread.journey,
            symptoms: this.toggleChipValue(this.thread.journey.symptoms, d.symptom),
          },
        });
        this.render();
        return;
      }
      if (d.newSymptom) {
        this.appendNewSymptom(d.newSymptom, 'chip');
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
      case 'reminders':
        this.closeModal();
        this.navigate('Reminders');
        break;
      case 'reminder-setup':
        this.openReminderSetup({
          kind: d.remKind,
          sourceId: d.remSource,
          title: d.remTitle,
          detail: d.remDetail,
          when: d.remWhen,
        });
        break;
      case 'reminder-save':
        this.saveReminderFromForm();
        break;
      case 'reminder-remove': {
        const remId = d.remId;
        if (!remId) break;
        this.removeReminder(remId);
        break;
      }
      case 'reminder-calendar': {
        const row = this.remindersList().find((item) => item.id === d.remId);
        if (!row) {
          this.toast('Reminder not found.');
          break;
        }
        this.downloadReminderIcs(row);
        this.toast('Calendar file downloaded.');
        break;
      }
      case 'reminder-email': {
        const row = this.remindersList().find((item) => item.id === d.remId);
        if (!row) {
          this.toast('Reminder not found.');
          break;
        }
        this.openReminderMailto(row);
        break;
      }
      case 'today':
        this.closeModal();
        this.navigate('Today');
        break;
      case 'followups':
        this.closeModal();
        this.navigate('Followups');
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
      case 'prescriptions':
        this.closeModal();
        this.navigate('Prescriptions');
        break;
      case 'tests':
      case 'test-records':
        this.closeModal();
        this.navigate('Test records');
        break;
      case 'apply-care':
        this.applyVisitCare();
        break;
      case 'view-test':
        this.viewTestRecord(d.testId);
        break;
      case 'attach-test':
        this.attachTestId = d.testId;
        document.getElementById('test-attach-file')?.click();
        break;
      case 'insurance':
        this.navigate('Insurance');
        break;
      case 'packet':
        this.closeModal();
        this.historyTab = 'packet';
        this.navigate('Past visits');
        break;
      case 'latest-visit':
        this.view = 'Past visits';
        this.historyTab = 'visits';
        this.selectedVisit = this.thread.visits[0]?.id;
        this.render();
        break;
      case 'append-symptom': {
        const typed = document.getElementById('new-symptoms');
        if (!typed || !String(typed.value || '').trim()) {
          this.toast('Write a note first, or tap a chip.');
          break;
        }
        this.appendNewSymptom(typed.value, 'typed');
        this.render();
        this.toast('New symptom added with a timestamp.');
        break;
      }
      case 'history-back':
        this.selectedVisit = null;
        this.historyTab = 'visits';
        this.render();
        break;
      case 'update-insurance':
        this.insuranceFromVisit = false;
        this.insuranceReturn = true;
        this.insuranceMode = 'hub';
        await this.loadPayers();
        this.navigate('Setup');
        break;
      case 'add-visit-insurance':
        this.insuranceFromVisit = true;
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
          this.toast('Coverage refreshed.');
        } catch (err) {
          this.toast(err.message);
        }
        break;
      case 'skip-insurance':
        if (this.insuranceFromVisit) {
          this.insuranceFromVisit = false;
          this.navigate('Journey');
          if (this.thread.journey && this.thread.journey.step >= 2) this.loadNetwork();
        } else {
          this.navigate('Today');
        }
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
      case 'record-day-symptoms':
        await this.toggleVisitRecord('day-symptoms');
        break;
      case 'pick-visit-audio':
        this.recordPurpose = 'visit';
        this.pickVisitAudio();
        break;
      case 'pick-symptoms-audio':
        this.recordPurpose = 'symptoms';
        this.pickVisitAudio();
        break;
      case 'pick-day-symptoms-audio':
        this.recordPurpose = 'day-symptoms';
        this.pickVisitAudio();
        break;
      case 'toggle-demo-transcript':
        await this.toggleDemoTranscript();
        break;
      case 'pick-demo':
        await this.selectDemoTranscript(d.demoId);
        break;
      case 'ask-delete-visit':
        this.askDeleteVisit(d.visitId);
        break;
      case 'confirm-delete-visit':
        if (this.pendingDeleteId) this.deleteOpenVisit(this.pendingDeleteId);
        break;
      case 'network-any':
        this.saveThread({ journey: { ...this.thread.journey, network_specialty: 'any', doctor: '' } });
        await this.loadNetwork();
        this.render();
        break;
      case 'network-suggested':
        this.saveThread({ journey: { ...this.thread.journey, network_specialty: '', doctor: '' } });
        await this.loadNetwork();
        this.render();
        break;
      case 'check-in':
        this.saveThread({ journey: { ...this.thread.journey, checked_in: true, checkin_tab: 'checkin' } });
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
        this.toast(`Dose marked ${d.status}.`);
        break;
      case 'refill': {
        const rx = (this.thread.prescriptions || []).find((item) => item.status !== 'stopped') || (this.thread.prescriptions || [])[0];
        if (!rx) {
          this.toast('Add a medicine from a visit first.');
          break;
        }
        this.saveThread({ refill: true });
        this.modal(
          'A note for your clinic.',
          `<p>For ${this.esc(this.displayName())}: Please review a refill of the existing ${this.esc(rx.name)} prescription${rx.notes ? ` (${this.esc(rx.notes)})` : ''}. No dose change requested.</p>`,
        );
        break;
      }
      case 'test-doc':
        this.modal(
          'HbA1c · sample document',
          `<p>Patient: ${this.esc(this.displayName())}<br>Status: ${this.thread.journey?.reviewed ? 'Order ready' : 'Awaiting clinician review'}<br>Result: not available<br>Ordering clinician: review required</p>`,
        );
        break;
      case 'export-pdf':
        try {
          const markdown = this.historyPacket();
          if (this.packetPdf.key === markdown && this.packetPdf.url) {
            const a = document.createElement('a');
            a.href = this.packetPdf.url;
            a.download = 'careloop-history.pdf';
            a.click();
          } else {
            await API.downloadHistoryPdf(markdown, 'CareLoop history packet');
          }
          this.toast('PDF packet downloaded.');
        } catch (err) {
          this.toast(err.message);
        }
        break;
      case 'export-transcript-pdf':
        try {
          await API.downloadHistoryPdf(this.transcriptMarkdown(), 'CareLoop visit transcript', 'visit-transcript.pdf');
          this.toast('Full transcript downloaded.');
        } catch (err) {
          this.toast(err.message);
        }
        break;
      case 'reset':
        this.modal(
          'Start with a fresh sample record?',
          '<p>This resets saved visits, doses, and insurance in this browser.</p>',
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
