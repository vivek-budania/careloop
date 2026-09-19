/**
 * Patient Advocate Module — denial parsing, appeal + demand letter generation.
 */

const Patient = {
  parsedDenial: null,
  denialText: '',
  generatedAppeal: '',
  generatedDemand: '',

  init() {
    document.getElementById('btn-parse-denial').addEventListener('click', () => this.parseDenial());
    document.getElementById('btn-generate-appeal').addEventListener('click', () => this.generateAppeal());
    document.getElementById('btn-generate-demand').addEventListener('click', () => this.generateDemand());
    document.getElementById('btn-approve-appeal').addEventListener('click', () => this.approveAppeal());
    document.getElementById('btn-approve-demand').addEventListener('click', () => this.approveDemand());
  },

  // ─── Step Management ──────────────────────────────────
  setStep(step) {
    document.querySelectorAll('#patient-steps .step-item').forEach(s => {
      const sNum = parseInt(s.dataset.step);
      s.classList.remove('active', 'done');
      if (sNum < step) s.classList.add('done');
      if (sNum === step) s.classList.add('active');
    });
  },

  // ─── Denial Parsing ───────────────────────────────────
  async parseDenial() {
    const text = document.getElementById('denial-text').value.trim();
    if (!text) {
      App.notify('Please paste your denial letter text.', 'error');
      return;
    }

    this.denialText = text;

    // Show step 2
    const step2 = document.getElementById('patient-step-2');
    const loading = document.getElementById('parsed-denial-loading');
    const content = document.getElementById('parsed-denial-content');

    step2.style.display = 'block';
    loading.classList.add('visible');
    content.style.display = 'none';
    this.setStep(2);

    // Scroll to step 2
    step2.scrollIntoView({ behavior: 'smooth', block: 'start' });

    try {
      const parsed = await API.parseDenial(text);
      this.parsedDenial = parsed;

      loading.classList.remove('visible');
      content.style.display = 'block';
      this.renderParsedDenial(parsed);

      // Show step 3
      document.getElementById('patient-step-3').style.display = 'block';
      this.setStep(3);

      // Pre-fill fields from parsed data
      if (parsed.patient_name) {
        document.getElementById('appeal-patient-name').value = parsed.patient_name;
      }
      if (parsed.claim_number) {
        document.getElementById('appeal-claim-number').value = parsed.claim_number;
      }

      App.notify('Denial analyzed. Review the breakdown below.', 'success');

    } catch (err) {
      loading.classList.remove('visible');
      content.style.display = 'block';
      content.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">❌</div>
        <div class="empty-state-title">Analysis Failed</div>
        <div class="empty-state-desc">${App.escapeHTML(err.message)}</div>
      </div>`;
      App.notify('Failed to analyze denial: ' + err.message, 'error');
    }
  },

  async renderNationalStatBanner() {
    const el = document.getElementById('national-stat-banner');
    try {
      const stats = await API.getNationalStats();
      el.innerHTML = `
        <span>📊</span>
        <span>
          Insurers denied about <strong>${stats.denial_rate_pct}%</strong> of in-network claims in ${stats.plan_year} —
          but among the small share of denials patients appealed, <strong>${stats.overturn_rate_pct}%</strong> were
          overturned in the patient's favor. Appealing is worth it.
          <span class="stat-source">Source: ${App.escapeHTML(stats.source)}</span>
        </span>
      `;
    } catch (err) {
      el.style.display = 'none';
    }
  },

  renderParsedDenial(parsed) {
    this.renderNationalStatBanner();

    // Info grid
    const infoGrid = document.getElementById('denial-info-grid');
    const fields = [
      { label: 'Patient', value: parsed.patient_name },
      { label: 'Claim #', value: parsed.claim_number },
      { label: 'Service Date', value: parsed.date_of_service },
      { label: 'Denial Date', value: parsed.date_of_denial },
      { label: 'Insurance', value: parsed.insurance_company },
      { label: 'Plan', value: parsed.plan_name },
      { label: 'Denied Service', value: parsed.denied_service },
      { label: 'Amount', value: parsed.amount_denied },
      { label: 'Appeal Deadline', value: parsed.appeal_deadline },
    ];

    infoGrid.innerHTML = fields
      .filter(f => f.value)
      .map(f => `
        <div class="denial-info-item">
          <div class="denial-info-label">${App.escapeHTML(f.label)}</div>
          <div class="denial-info-value">${App.escapeHTML(f.value)}</div>
        </div>
      `).join('');

    // Denial reasons
    const reasonsList = document.getElementById('denial-reasons-list');
    if (parsed.denial_reasons && parsed.denial_reasons.length > 0) {
      reasonsList.innerHTML = parsed.denial_reasons.map(r => `
        <div class="denial-reason-card">
          ${r.code ? `<div class="denial-reason-code">${App.escapeHTML(r.code)}</div>` : ''}
          <div class="denial-reason-desc">${App.escapeHTML(r.description)}</div>
        </div>
      `).join('');
    } else {
      reasonsList.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem;">No specific denial reason codes found.</p>';
    }

    // Key quotes
    const quotesEl = document.getElementById('denial-quotes');
    if (parsed.key_quotes && parsed.key_quotes.length > 0) {
      quotesEl.innerHTML = parsed.key_quotes.map(q => `
        <div class="recommendation-item" style="border-left: 3px solid var(--accent-purple); background: var(--accent-purple-glow);">
          <span style="color: var(--accent-purple);">"</span>
          <span style="font-style: italic;">${App.escapeHTML(q)}</span>
        </div>
      `).join('');
    } else {
      quotesEl.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem;">No key quotes extracted.</p>';
    }

    // Appeal instructions
    if (parsed.appeal_instructions) {
      const instrEl = document.createElement('div');
      instrEl.innerHTML = `
        <h3 style="margin: var(--space-lg) 0 var(--space-md);">📋 Appeal Instructions from Letter</h3>
        <div class="recommendation-item">
          <span class="recommendation-icon">→</span>
          <span>${App.escapeHTML(parsed.appeal_instructions)}</span>
        </div>
      `;
      document.getElementById('parsed-denial-content').appendChild(instrEl);
    }
  },

  // ─── Appeal Generation ────────────────────────────────
  async generateAppeal() {
    if (!this.denialText) {
      App.notify('Please parse a denial letter first.', 'error');
      return;
    }

    const resultEl = document.getElementById('appeal-result');
    const loading = document.getElementById('appeal-loading');
    const docEl = document.getElementById('appeal-document');
    const approveBtn = document.getElementById('btn-approve-appeal');
    const warningsEl = document.getElementById('appeal-warnings');

    resultEl.style.display = 'block';
    loading.classList.add('visible');
    docEl.textContent = '';
    approveBtn.style.display = 'none';
    warningsEl.innerHTML = '';

    try {
      const result = await API.generateAppeal({
        denial_text: this.denialText,
        parsed_denial: this.parsedDenial,
        additional_context: document.getElementById('additional-context').value,
        patient_name: document.getElementById('appeal-patient-name').value,
        claim_number: document.getElementById('appeal-claim-number').value,
      });

      loading.classList.remove('visible');
      this.generatedAppeal = result.content;
      docEl.innerHTML = App.renderMarkdown(result.content);
      approveBtn.style.display = 'inline-flex';

      if (result.warnings && result.warnings.length > 0) {
        warningsEl.innerHTML = result.warnings.map(w => `
          <div class="warning-banner">
            <span class="warning-icon">⚠️</span>
            <span>${App.escapeHTML(w)}</span>
          </div>
        `).join('');
      }

      App.notify('Appeal letter generated. Review carefully before approving.', 'info');
      resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

    } catch (err) {
      loading.classList.remove('visible');
      docEl.textContent = 'Generation failed. Please try again.';
      App.notify('Appeal generation failed: ' + err.message, 'error');
    }
  },

  // ─── Demand Generation ────────────────────────────────
  async generateDemand() {
    if (!this.denialText) {
      App.notify('Please parse a denial letter first.', 'error');
      return;
    }

    const resultEl = document.getElementById('demand-result');
    const loading = document.getElementById('demand-loading');
    const docEl = document.getElementById('demand-document');
    const approveBtn = document.getElementById('btn-approve-demand');
    const warningsEl = document.getElementById('demand-warnings');

    resultEl.style.display = 'block';
    loading.classList.add('visible');
    docEl.textContent = '';
    approveBtn.style.display = 'none';
    warningsEl.innerHTML = '';

    try {
      const result = await API.generateDemand({
        patient_name: document.getElementById('appeal-patient-name').value,
        claim_number: document.getElementById('appeal-claim-number').value,
        insurance_company: this.parsedDenial?.insurance_company || '',
        date_of_denial: this.parsedDenial?.date_of_denial || '',
        denied_service: this.parsedDenial?.denied_service || '',
      });

      loading.classList.remove('visible');
      this.generatedDemand = result.content;
      docEl.innerHTML = App.renderMarkdown(result.content);
      approveBtn.style.display = 'inline-flex';

      if (result.warnings && result.warnings.length > 0) {
        warningsEl.innerHTML = result.warnings.map(w => `
          <div class="warning-banner">
            <span class="warning-icon">⚠️</span>
            <span>${App.escapeHTML(w)}</span>
          </div>
        `).join('');
      }

      App.notify('Demand letter generated. Review before approving.', 'info');
      resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

    } catch (err) {
      loading.classList.remove('visible');
      docEl.textContent = 'Generation failed. Please try again.';
      App.notify('Demand generation failed: ' + err.message, 'error');
    }
  },

  // ─── Approvals ────────────────────────────────────────
  async approveAppeal() {
    const approved = await App.requestApproval(this.generatedAppeal);
    if (approved) {
      App.downloadDocument(this.generatedAppeal, 'insurance_appeal_letter.txt');
    }
  },

  async approveDemand() {
    const approved = await App.requestApproval(this.generatedDemand);
    if (approved) {
      App.downloadDocument(this.generatedDemand, 'claim_file_demand_letter.txt');
    }
  },
};
