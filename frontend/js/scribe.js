/**
 * Visit Scribe (Stream C) — patient near doctor: transcript → SOAP/Plan → Orders.
 * Lives inside CareLoop steps 7–8 (after Dave coverage intake).
 */

const Scribe = {
  encounter: null,
  orders: null,

  init() {
    const loadBtn = document.getElementById('btn-load-fixture');
    const draftBtn = document.getElementById('btn-draft-soap');
    const approveBtn = document.getElementById('btn-approve-encounter');
    const transcribeBtn = document.getElementById('btn-transcribe-audio');

    if (!loadBtn) return;

    loadBtn.addEventListener('click', () => this.loadFixture());
    draftBtn.addEventListener('click', () => this.draftSoap());
    approveBtn.addEventListener('click', () => this.approveEncounter());
    if (transcribeBtn) {
      transcribeBtn.addEventListener('click', () => this.transcribeAudio());
    }
  },

  async loadFixture() {
    try {
      const fixture = await API.getScribeFixture();
      document.getElementById('scribe-transcript').value = fixture.transcript || '';
      document.getElementById('scribe-meta').textContent =
        `${fixture.patient_name || 'Patient'} · ${fixture.visit_date || ''} · ${fixture.clinician || ''}`;
      App.notify('Mock visit transcript loaded.', 'success');
    } catch (err) {
      App.notify(err.message, 'error');
    }
  },

  async transcribeAudio() {
    const input = document.getElementById('scribe-audio');
    const file = input && input.files && input.files[0];
    if (!file) {
      App.notify('Choose an audio file first.', 'error');
      return;
    }
    const loading = document.getElementById('scribe-loading');
    if (loading) loading.classList.add('visible');
    try {
      const result = await API.transcribeScribeAudio(file);
      document.getElementById('scribe-transcript').value = result.text || '';
      document.getElementById('scribe-meta').textContent =
        `Grok STT · ${result.language || 'lang unknown'} · review before drafting SOAP`;
      App.notify('Audio transcribed. Review the text, then draft SOAP.', 'success');
    } catch (err) {
      App.notify(err.message, 'error');
    } finally {
      if (loading) loading.classList.remove('visible');
    }
  },

  async draftSoap() {
    const transcript = document.getElementById('scribe-transcript').value.trim();
    const useSeeded = document.getElementById('scribe-use-seeded').checked;
    const loading = document.getElementById('scribe-loading');
    const approveBtn = document.getElementById('btn-approve-encounter');

    if (!transcript) {
      App.notify('Load mock visit, paste a transcript, or transcribe audio first.', 'error');
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
