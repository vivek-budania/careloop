import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../frontend/js/careloop.js', import.meta.url), 'utf8');
const sandbox = { document: { body: { dataset: { page: 'test' } }, readyState: 'complete' } };
vm.runInNewContext(`${source}\nglobalThis.__CareLoop = CareLoop; globalThis.__patientSummaryCopy = patientSummaryCopy;`, sandbox);

test('patient summary copy expands conservative glossary terms without removing uncertainty', () => {
  const copy = sandbox.__patientSummaryCopy(
    '41F with lumbar radiculopathy suspected after 12 PT sessions. Order MRI; PA likely. [NEEDS VERIFICATION] strength and reflexes.',
  );

  assert.match(copy.text, /41-year-old woman/i);
  assert.match(copy.text, /lumbar radiculopathy is suspected \(irritation of a nerve in the lower back\)/i);
  assert.match(copy.text, /12 physical therapy sessions/i);
  assert.match(copy.text, /MRI scan/i);
  assert.match(copy.text, /prior authorization \(approval from your insurance plan\)/i);
  assert.deepEqual([...copy.verification], ['strength and reflexes']);
});

test('patient summary copy leaves ambiguous abbreviations unchanged and does not duplicate expanded terms', () => {
  const copy = sandbox.__patientSummaryCopy(
    'PT/INR is on file. The patient was seen by PA Rivera. MRI scan and blood pressure (BP) are documented. A1c blood sugar test (HbA1c) and anti-inflammatory medicine (NSAID) are already expanded.',
  );

  assert.match(copy.text, /PT\/INR is on file/);
  assert.match(copy.text, /seen by PA Rivera/);
  assert.doesNotMatch(copy.text, /MRI scan scan|blood pressure \(blood pressure|HbA1c\)\)|NSAID\)\)/);
});

test('patient summary copy preserves verification details whether the marker starts or ends a statement', () => {
  const prefix = sandbox.__patientSummaryCopy('[NEEDS VERIFICATION] strength, reflexes, and straight-leg raise.');
  const appended = sandbox.__patientSummaryCopy('Neurologic exam findings need review [NEEDS VERIFICATION].');

  assert.equal(prefix.text, '');
  assert.deepEqual([...prefix.verification], ['strength, reflexes, and straight-leg raise']);
  assert.equal(appended.text, 'Neurologic exam findings need review.');
  assert.deepEqual([...appended.verification], ['Neurologic exam findings need review']);
});

test('lumbar radiculopathy explanation keeps the source certainty intact', () => {
  const suspected = sandbox.__patientSummaryCopy('Lumbar radiculopathy suspected after conservative care.');
  const confirmed = sandbox.__patientSummaryCopy('Lumbar radiculopathy diagnosed after imaging.');

  assert.match(suspected.text, /is suspected \(irritation of a nerve in the lower back\)/i);
  assert.match(confirmed.text, /lumbar radiculopathy \(irritation of a nerve in the lower back\) diagnosed/i);
  assert.doesNotMatch(confirmed.text, /suspected/i);
});

test('patient summary uses plain-language sections, highlights verification, and has no approval control', () => {
  const app = sandbox.__CareLoop;
  const html = app.soapBody.call({
    encounter: {
      clinician_reviewed: false,
      source: 'seeded',
      soap: {
        subjective: 'Pain after PT.',
        objective: '[NEEDS VERIFICATION] strength, reflexes, and straight-leg raise.',
        assessment: 'Lumbar radiculopathy suspected.',
        plan_summary: 'Order MRI; PA likely.',
      },
    },
    extractiveSummary: null,
    usesDemoTranscript: () => true,
    selectedDemo: () => ({ label: 'Demo 2' }),
    liveTranscript: () => '',
    transcriptText: () => '',
    esc: (value) => String(value),
  });

  for (const label of ['What you told us', 'What your care team knows', 'What this could mean', 'What happens next']) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /Awaiting clinician review/);
  assert.match(html, /Your care team still needs to confirm/);
  assert.doesNotMatch(html, /<input|Mark this summary as reviewed|SOAP/);
});

test('the patient shell cannot call the clinician approval endpoint', () => {
  assert.doesNotMatch(source, /API\.approveScribe\s*\(/);
  assert.doesNotMatch(source, /id="reviewed"/);
});
