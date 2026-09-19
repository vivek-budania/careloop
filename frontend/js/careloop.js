/**
 * CareLoop coverage intake (Dave). Mock data only — no OCR, no live payer.
 */
const CareLoop = {
  init() {
    this.bind();
    this.loadPayers();
  },

  bind() {
    document.getElementById('cl-btn-save').addEventListener('click', () => this.saveIdentity());
    document.getElementById('cl-btn-scan').addEventListener('click', () => this.scanFixture());
    document.getElementById('cl-btn-skip-review').addEventListener('click', () => {
      App.notify('Review skipped. You can still confirm coverage.', 'info');
    });
    document.getElementById('cl-btn-apply-review').addEventListener('click', () => this.saveIdentity());
    document.getElementById('cl-btn-confirm').addEventListener('click', () => this.confirmCoverage());
    document.getElementById('cl-btn-intake').addEventListener('click', () => this.saveIntakeAndGuess());
    document.getElementById('cl-btn-network').addEventListener('click', () => this.findClinicians());
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

  async loadPayers() {
    try {
      const payers = await API.listPayers();
      const select = document.getElementById('cl-payer');
      payers.forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = `${p.name} (${p.plan_type})`;
        select.appendChild(opt);
      });
    } catch (err) {
      App.notify(err.message, 'error');
    }
  },

  async saveIdentity() {
    if (!this.payerName()) {
      App.notify('Pick an insurance company first.', 'error');
      return;
    }
    try {
      const snap = await API.saveCoverage(this.identityPayload());
      this.fillFormFromProfile(snap.profile);
      document.getElementById('cl-identity-status').textContent =
        `Saved ${snap.profile.payer_name} member ${snap.profile.member_id || '(none)'}.`;
      App.notify('Identity saved (mock).', 'success');
    } catch (err) {
      App.notify(err.message, 'error');
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
      return;
    }
    try {
      await API.saveCoverage(this.identityPayload());
      const snap = await API.confirmCoverage({
        payer_name: this.payerName(),
        member_id: document.getElementById('cl-member-id').value.trim(),
      });
      this.renderEligibility(snap.eligibility);
      App.notify(`Coverage ${snap.eligibility.status} (mock).`, 'success');
    } catch (err) {
      App.notify(err.message, 'error');
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
    } catch (err) {
      App.notify(err.message, 'error');
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
