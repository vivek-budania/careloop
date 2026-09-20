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
  assert.match(copy.text, /possible irritation of a nerve in the lower back \(lumbar radiculopathy\)/i);
  assert.match(copy.text, /12 physical therapy sessions/i);
  assert.match(copy.text, /MRI scan/i);
  assert.match(copy.text, /prior authorization \(approval from your insurance plan\)/i);
  assert.deepEqual([...copy.verification], ['strength and reflexes']);
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
