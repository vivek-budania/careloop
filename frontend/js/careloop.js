/**
 * CareLoop coverage intake (Dave). Mock data only — no OCR, no live payer.
 * One step visible at a time.
 */
const CareLoop = {
  step: 1,
  totalSteps: 8,
  payersLoaded: false,

  init() {
    this.bind();
    this.showStep(1);
  },

  bind() {
    document.getElementById('cl-btn-save').addEventListener('click', () => this.saveIdentity());
    document.getElementById('cl-btn-scan').addEventListener('click', () => this.scanFixture());
    document.getElementById('cl-btn-confirm').addEventListener('click', () => this.confirmCoverage());
    document.getElementById('cl-btn-intake').addEventListener('click', () => this.saveIntakeAndGuess());
    document.getElementById('cl-btn-network').addEventListener('click', () => this.findClinicians());
    document.getElementById('cl-btn-back').addEventListener('click', () => this.back());
    document.getElementById('cl-btn-next').addEventListener('click', () => this.next());
  },

  resetUi() {
    this.showStep(1);
    const status = document.getElementById('cl-identity-status');
    if (status) status.textContent = '';
    ['cl-eligibility', 'cl-visit-guess', 'cl-network', 'cl-review-summary'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '';
    });
  },

  showStep(n) {
    this.step = n;
    document.querySelectorAll('.cl-step').forEach((el) => {
      el.hidden = Number(el.dataset.step) !== n;
    });
    document.getElementById('cl-step-label').textContent = `Step ${n} of ${this.totalSteps}`;
    document.getElementById('cl-btn-back').disabled = n === 1;
    document.getElementById('cl-btn-next').textContent = n === this.totalSteps ? 'Done' : 'Continue';
    if (n === 2) this.renderReview();
  },

  back() {
    if (this.step > 1) this.showStep(this.step - 1);
  },

  async next() {
    try {
      if (this.step === 1) {
        const ok = await this.saveIdentity();
        if (!ok) return;
        this.showStep(2);
        return;
      }
      if (this.step === 2) {
        this.showStep(3);
        return;
      }
      if (this.step === 3) {
        const ok = await this.confirmCoverage();
        if (!ok) return;
        this.showStep(4);
        return;
      }
      if (this.step === 4) {
        const ok = await this.saveIntakeAndGuess();
        if (!ok) return;
        this.showStep(5);
        return;
      }
      if (this.step === 5) {
        this.showStep(6);
        this.findClinicians();
        return;
      }
      if (this.step === 6) {
        this.showStep(7);
        return;
      }
      if (this.step === 7) {
        if (!document.getElementById('scribe-transcript').value.trim()) {
          App.notify('Load the mock visit or paste a transcript first.', 'error');
          return;
        }
        this.showStep(8);
        return;
      }
      App.notify('Visit documented. Orders (if approved) are ready for the PA chain next.', 'success');
    } catch (err) {
      App.notify(err.message, 'error');
    }
  },

  fileNote(inputId, prefix) {
    const input = document.getElementById(inputId);
    const file = input && input.files && input.files[0];
    return file ? `${prefix}:${file.name}` : '';
  },

  payerName() {
    return document.getElementById('cl-payer').value.trim();
  },

  identityPayload() {
    const docs = [];
    const card = this.fileNote('cl-card-file', 'card');
    const sbc = this.fileNote('cl-sbc-file', 'sbc');
    if (card) docs.push(card);
    if (sbc) docs.push(sbc);
    return {
      payer_name: this.payerName(),
      member_name: document.getElementById('cl-member-name').value.trim(),
      member_id: document.getElementById('cl-member-id').value.trim(),
      group_number: document.getElementById('cl-group').value.trim(),
      zip: document.getElementById('cl-zip').value.trim(),
      supporting_docs: docs,
    };
  },

  fillFormFromProfile(profile) {
    if (!profile) return;
    if (profile.payer_name) document.getElementById('cl-payer').value = profile.payer_name;
    document.getElementById('cl-member-name').value = profile.member_name || '';
    document.getElementById('cl-member-id').value = profile.member_id || '';
    document.getElementById('cl-group').value = profile.group_number || '';
    document.getElementById('cl-zip').value = profile.zip || '';
    if (profile.zip) document.getElementById('cl-network-zip').value = profile.zip;
  },

  renderReview() {
    const box = document.getElementById('cl-review-summary');
    const p = this.identityPayload();
    box.innerHTML = `
      <p><strong>Payer:</strong> ${App.escapeHTML(p.payer_name || '—')}</p>
      <p><strong>Member:</strong> ${App.escapeHTML(p.member_name || '—')}
        · <strong>ID:</strong> ${App.escapeHTML(p.member_id || '—')}</p>
      <p><strong>Group:</strong> ${App.escapeHTML(p.group_number || '—')}
        · <strong>ZIP:</strong> ${App.escapeHTML(p.zip || '—')}</p>
    `;
  },

  async loadPayers() {
    const select = document.getElementById('cl-payer');
    if (!select) return;
    if (this.payersLoaded && select.options.length > 1) return;
    try {
      const payers = await API.listPayers();
      while (select.options.length > 1) select.remove(1);
      (payers || []).forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = `${p.name} (${p.plan_type})`;
        select.appendChild(opt);
      });
      this.payersLoaded = select.options.length > 1;
    } catch (err) {
      this.payersLoaded = false;
      App.notify(err.message, 'error');
    }
  },

  async saveIdentity() {
    if (!this.payerName()) {
      App.notify('Pick an insurance company first.', 'error');
      return false;
    }
    try {
      const snap = await API.saveCoverage(this.identityPayload());
      this.fillFormFromProfile(snap.profile);
      document.getElementById('cl-identity-status').textContent =
        `Saved ${snap.profile.payer_name} member ${snap.profile.member_id || '(none)'}.`;
      App.notify('Identity saved (mock).', 'success');
      return true;
    } catch (err) {
      App.notify(err.message, 'error');
      return false;
    }
  },

  async scanFixture() {
    try {
      const snap = await API.scanCoverage({
        payer_name: this.payerName(),
        image_note: this.fileNote('cl-card-file', 'card') || 'fixture:front-of-card',
        sbc_note: this.fileNote('cl-sbc-file', 'sbc'),
      });
      this.fillFormFromProfile(snap.profile);
      document.getElementById('cl-identity-status').textContent =
        'Fixture card loaded. Fields are mocked, not OCR’d.';
      App.notify('Sample card loaded.', 'success');
    } catch (err) {
      App.notify(err.message, 'error');
    }
  },

  renderEligibility(el) {
    const box = document.getElementById('cl-eligibility');
    if (!el) {
      box.innerHTML = '';
      return;
    }
    const live = el.live_api || {};
    box.innerHTML = `
      <p><strong>Status:</strong> ${App.escapeHTML(el.status || '')}
        ${el.in_network ? ' · in-network' : ' · not in-network'}</p>
      <p><strong>Plan:</strong> ${App.escapeHTML(el.plan_type || '')} — ${App.escapeHTML(el.network_name || '')}</p>
      <p><strong>PCP copay:</strong> $${el.estimated_copay_pcp ?? '—'}
         · <strong>Specialist:</strong> $${el.estimated_copay_specialist ?? '—'}
         · <strong>Deductible remaining:</strong> $${el.deductible_remaining ?? '—'}</p>
      <p class="form-hint">${App.escapeHTML(el.disclaimer || '')}</p>
      <p class="form-hint">Live 270/271: ${live.attempted ? 'attempted' : 'not configured'}
        — ${App.escapeHTML(live.message || '')}</p>
    `;
  },

  async confirmCoverage() {
    if (!this.payerName()) {
      App.notify('Pick an insurance company first.', 'error');
      return false;
    }
    try {
      await API.saveCoverage(this.identityPayload());
      const snap = await API.confirmCoverage({
        payer_name: this.payerName(),
        member_id: document.getElementById('cl-member-id').value.trim(),
      });
      this.renderEligibility(snap.eligibility);
      App.notify(`Coverage ${snap.eligibility.status} (mock).`, 'success');
      return true;
    } catch (err) {
      App.notify(err.message, 'error');
      return false;
    }
  },

  renderGuess(estimate) {
    const box = document.getElementById('cl-visit-guess');
    if (!estimate) {
      box.innerHTML = '';
      return;
    }
    const rows = (estimate.likely_visits || []).map((line) => `
      <li><strong>${App.escapeHTML(line.code)}</strong> ${App.escapeHTML(line.description)}
        — patient ~$${line.patient_owes_low}
        <span class="form-hint">(${App.escapeHTML(line.basis || '')})</span>
      </li>`).join('');
    const warnings = (estimate.warnings || []).map((w) => `<p class="form-hint">${App.escapeHTML(w)}</p>`).join('');
    box.innerHTML = `
      <p><strong>Guess:</strong> $${estimate.patient_owes_low}–$${estimate.patient_owes_high} patient-owed</p>
      <ul>${rows}</ul>
      <p class="form-hint">${App.escapeHTML(estimate.disclaimer || '')}</p>
      ${warnings}
    `;
  },

  async saveIntakeAndGuess() {
    try {
      const filename = this.fileNote('cl-prior-file', 'prior').replace(/^prior:/, '');
      await API.saveCoverageIntake({
        symptoms: document.getElementById('cl-symptoms').value.trim(),
        prior_visit_filename: filename,
        use_fixture_prior_visit: document.getElementById('cl-prior-fixture').checked,
      });
      const snap = await API.guessVisitCost({
        symptoms: document.getElementById('cl-symptoms').value.trim(),
      });
      this.renderGuess(snap.visit_cost_estimate);
      App.notify('Visit/cost guess ready (estimate only).', 'success');
      return true;
    } catch (err) {
      App.notify(err.message, 'error');
      return false;
    }
  },

  renderNetwork(payload) {
    const box = document.getElementById('cl-network');
    if (!payload) {
      box.innerHTML = '';
      return;
    }
    const rows = (payload.clinicians || []).map((doc) => `
      <li>
        <strong>${App.escapeHTML(doc.name)}</strong>
        ${doc.in_network ? ' · in-network' : ' · out of this mock network'}
        · ${App.escapeHTML(doc.specialty_label)} · ${doc.miles} mi
        <div class="form-hint">${App.escapeHTML(doc.address)} · ${App.escapeHTML(doc.phone)}</div>
      </li>`).join('');
    box.innerHTML = `
      <p class="form-hint">${App.escapeHTML(payload.disclaimer || '')}</p>
      <ul>${rows || '<li>No clinicians in this fixture for that filter.</li>'}</ul>
    `;
  },

  async findClinicians() {
    try {
      const zip = document.getElementById('cl-network-zip').value.trim()
        || document.getElementById('cl-zip').value.trim();
      const specialty = document.getElementById('cl-specialty').value;
      const payload = await API.searchNetwork(specialty, zip);
      this.renderNetwork(payload);
      App.notify(`Found ${payload.clinicians.length} fixture clinicians.`, 'success');
    } catch (err) {
      App.notify(err.message, 'error');
    }
  },
};
