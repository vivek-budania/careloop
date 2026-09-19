# CareLoop patient workflow (teammate map)

How the **hackathon web app** should feel for the patient. Visual clickthrough: [`frontend/mockups/`](frontend/mockups/) → http://localhost:8080/mockups/. Owner/build split: [`plan.md`](plan.md) (Vivek = shell + thread + history share). This file is **not** a product spec for live insurance or clinical decisions.

**Demo patient (fictional, no PHI):** Maya Chen · Horizon Health PPO · metformin already on file · golden-path T2DM fixture.

**Rule for all copy and buttons:** draft / suggest / review / estimate. The app does **not** diagnose, prescribe, approve care, or decide coverage.

Screens in the mockup are `phone.html#s01` … `#s21`.

---

## Two kinds of navigation (not one wizard)

| | Visit journey | Hamburger / standing destinations |
|--|----------------|-----------------------------------|
| **Job** | Primary path to get through *this* visit | Always available after login |
| **How** | Stepper (“Visit journey · N of 8”) + **Continue** / primary CTA | ☰ menu (and shortcuts on **Today**) |
| **Screens** | Insurance → symptoms → doctors → book → check-in → scribe → SOAP → plan → follow-ups | **Today/Home**, **Coverage**, **Reminders**, **Refills**, **History**, **Profile** |
| **Forced?** | No. User can skip insurance for now, open History mid-visit, or jump home | No. These are not steps 1–8 |

Hamburger can open from most journey screens. **Back** (←) is local (e.g. scan → insurance hub, book → doctor list). **Today** is the hub to resume the journey.

DenialShield **Provider / Patient Advocate** tabs are a different product surface. Do not treat them as this UX.

---

## Visit journey (Continue path)

### 0. Login — `#s01`

- **User sees:** CareLoop wordmark, demo email `maya.chen@example.com`, password field, note that this is a prototype and a clinician reviews drafts.
- **User does:** **Continue**.
- **Goes to:** Insurance hub (`#s02`).

---

### 1. Insurance hub — `#s02` · journey 1 of 8

**Decision point (two options; both exist).**

- **User sees:** “Add your insurance.” Two cards: **Photo of insurance card** vs **Enter plan details**. Copy: we use this to *suggest* in-network clinics; **this is not a coverage decision**.
- **User does:**
  - Tap **Photo…** → card scan (`#s03`).
  - Tap **Enter plan details** → manual form (`#s04`).
  - Or **Skip for now · go to Today** → Today (`#s19`) without blocking the rest of the demo.
- **Goes to:** `#s03`, `#s04`, or `#s19`.

Dave owns card/coverage APIs later; Vivek renders this shell.

---

### 2a. Card photo / scan — `#s03`

- **User sees:** Camera frame with mock Horizon card (Maya Chen, ID `MCH-889120`, group `GH-4421`). Banner: mock OCR fills fields **for review**; user confirms before save. **Capture for review** + **Upload from photos**.
- **User does:** Capture (or upload, which in the prototype routes to the same confirm path as typing).
- **Goes to:** Issues/symptoms (`#s05`) after confirm. ← back to hub (`#s02`). Upload can land on manual details (`#s04`) so the user can fix fields.

---

### 2b. Manual plan details — `#s04`

- **User sees:** Company, plan type (PPO), group, member ID, subscriber name — prefilled demo values to check against a card.
- **User does:** **Save for review** (not “verified eligible”).
- **Goes to:** Issues/symptoms (`#s05`). ← hub (`#s02`).

---

### 3. Issues / symptoms — `#s05` · journey 2 of 8

- **User sees:** Chips (fatigue, thirst, frequent urination on; others off) + free-text note. “CareLoop does not diagnose.”
- **User does:** Toggle chips / edit note → **Continue**.
- **Goes to:** Doctor suggestions (`#s06`). ☰ available.

---

### 4. Doctor suggestions — `#s06` · journey 3 of 8

- **User sees:** Mock in-network PCP list (e.g. Dr. Priya Raman, est. in-network, estimated slots). One row may be **Confirm network**. Availability is estimated; user still books with the clinic.
- **User does:** Tap a clinician (demo: Raman).
- **Goes to:** Appointment (`#s07`).

**Optional copay:** not a separate required screen. Cost share can appear as an estimate on booking (`#s07`) and Coverage (`#s20`). Skip/hide richer deductible/OOP if Dave has not landed it — office copay ~$25 in the mock is enough.

---

### 5. Appointment — `#s07` · journey 4 of 8

- **User sees:** Week strip (Thu 24 selected), time chips (10:30 selected). “Prototype booking. Clinic confirms. Estimated office copay $25 — **not a coverage determination**.”
- **User does:** Change day/time (visual) → **Request Thu 10:30** (request, not a guaranteed book).
- **Goes to:** Doctor visit / check-in (`#s08`). ← doctor list (`#s06`).

---

### 6. Doctor visit (waiting / check-in) — `#s08` · journey 5 of 8

- **User sees:** “You’re here / Waiting room,” check-in complete, queue ~8 min. Next: draft transcript → SOAP for clinician review → suggested plan. Nothing is an order until a clinician confirms.
- **User does:** **Start draft transcript**.
- **Goes to:** Transcribing (`#s09`).

---

### 7. Live transcribing — `#s09` · journey 6 of 8

- **User sees:** “Draft only / listening,” waveform, sample lines (metformin, thirst, HbA1c, add-on *may* need PA — clinician’s words, not an app decision).
- **User does:** **See draft SOAP**.
- **Goes to:** SOAP (`#s10`). ← check-in (`#s08`).

---

### 8. SOAP summary — `#s10` · journey 7 of 8

- **User sees:** Patient-readable S/O/A/P. Badge **Awaiting clinician review**. Assessment is a *draft impression*; `[NEEDS VERIFICATION]` if labs would change it. App does not finalize diagnosis.
- **User does:** **View suggested plan**.
- **Goes to:** Care plan (`#s11`).

---

### 9. Care plan (meds / tests / referrals) — `#s11` · journey 8 of 8

- **User sees:**
  - **Meds:** continue metformin (current); add-on e.g. GLP-1 class *clinician may consider* — **PA may be required** (not an approval or denial).
  - **Tests:** HbA1c — on this mock plan typically not PA-gated; still an estimate.
  - **Referrals:** diabetes education *suggested*.
- **User does:** **See follow-ups**.
- **Goes to:** Follow-ups (`#s12`).

Sreekar owns encounter/orders/PA facts; this screen only presents them.

---

### 10. Follow-ups — `#s12`

- **User sees:** Who acts: **You** (lab when order ready), **Clinic** (review SOAP), **Insurance if add-on Rx** (PA is a *separate* step from any later **claim**), **You + clinic** (suggested 3-month visit).
- **User does:** **Go to Today**.
- **Goes to:** Today (`#s19`). Reminders / refills / history from the menu, not as extra journey steps.

---

## Hamburger destinations

Open ☰ → `#s18` (drawer over Today). Tap a row. Close by picking a destination (or treat ☰ as toggle back to Today).

### Today / Home — `#s19`

- **User sees:** “Good afternoon, Maya.” Cards: **Continue visit** (resume journey), evening metformin shortcut, coverage snapshot, History.
- **User does:** Continue → symptoms (`#s05`) in the mock (insurance already “on file”); or jump to Reminders / Coverage / History.
- **Goes to:** `#s05`, `#s13`, `#s20`, or `#s15`.

### Coverage — `#s20`

- **User sees:** Horizon PPO, member IDs, **Est. active**, estimated copay, short **PA vs claim** explainer. Banner: estimates only — app does not decide coverage.
- **User does:** **Update card or details** (optional).
- **Goes to:** Insurance hub (`#s02`), or ☰ elsewhere.

### Reminders — `#s13`

- **User sees:** Today’s metformin AM **Taken**, PM **Upcoming**. Streak is a log, not a clinical judgment. App does not change dose.
- **User does:** **Mark evening taken** (demo).
- **Goes to:** Refills (`#s14`) in the clickthrough (nudge adjacency); in product, stay on Reminders and write taken/missed to the thread.

### Refills — `#s14`

- **User sees:** ~12 days left; **Refill reminder**. Add-on Rx placeholder if PA + dispense happen later. PA approval ≠ paid claim. App does not e-prescribe.
- **User does:** **Draft refill request for clinic** (draft only) or **Back to reminders**.
- **Goes to:** History (`#s15`) after draft in the mock, or `#s13`.

### Profile — `#s21`

- **User sees:** Demo identity, allergies none recorded, patient-reported metformin, note that DenialShield tabs are not this UX.
- **User does:** ☰ to leave. No clinical actions.

### History — list, detail, share (first-class)

See next section.

---

## History: list → breakup → share packet

Not a visit-journey step. Use ☰ **History**, Today shortcut, or **Prepare share packet**.

### List — `#s15`

- **User sees:** Chronological thread cards: PCP visit (SOAP draft, clinician review), coverage snapshot, medications, tests (HbA1c ordered, result not in).
- **User does:** Tap the visit card → detail. Or **Prepare share packet** → share screen (can skip detail).
- **Goes to:** `#s16` or `#s17`.

### Detail / breakup — `#s16`

- **User sees:** What happened / waiting / who acts / evidence on **this** visit. Explicit: a future **prior auth** is not a **claim** payment; both can appear as separate events.
- **User does:** **Share this visit** or ← list.
- **Goes to:** `#s17` or `#s15`.

### Share packet (next doctor) — `#s17`

- **User sees:** Checkboxes of what to include (coverage snapshot, SOAP + review status, meds/refill, tests; auth/claim unchecked if none yet). This is a **patient record view**, not an appeal letter. Letter downloads in the real app still need HITL.
- **User does:** Toggle includes (prototype: mostly fixed) → **Create packet (mock)** (PDF/markdown/JSON fixture is enough).
- **Goes to:** Back to list (`#s15`). Packet must **read** facts Dave/Sreekar persisted — do not invent labs or eligibility.

---

## Stage map (quick)

```
Login
  └─ Insurance hub ──┬─ Photo/scan ──┐
                     └─ Type details─┴─ Symptoms → Doctors → Book → Check-in
                                                              → Scribe → SOAP → Plan → Follow-ups → Today
☰ always: Today | Coverage | Reminders | Refills | History | Profile
History: list → visit breakup → share packet
Skip insurance → Today (resume journey later)
```

---

## Mocked vs real (hackathon)

| Piece | Hackathon truth |
|--------|-----------------|
| This workflow + mockups | **Visual/HTML prototype.** Clickthrough does not persist a thread. |
| Patient, plan, network, copay | **Mock.** Fixture card/OCR OK. Estimates, not eligibility determinations. |
| In-network doctor list + slots | **Mock directory.** Booking is a **request**; clinic “confirms” in demo state. |
| Transcript / SOAP / Plan | **Seeded or mocked scribe OK.** Clinician review gate before orders. Optional live mic. |
| HbA1c vs add-on Rx | Scripted: lab typically **no PA**; add-on **PA may be required** — flags only. |
| Payer PA | **Mock payer.** First PA submit → deterministic **step-therapy denial** + citable policy; appeal path then **approves**. Not an LLM coverage decision. |
| Claim / EOB | **Separate mock object** from PA. Do not collapse. |
| Meds taken/missed/refill | **Local/mock schedule** after mock dispense. No pharmacy, no eRx. |
| History packet | **Export fixture** from the thread. Not a signed appeal. |
| DenialShield letters (PA/appeal/demand) | **Real LLM drafts** when `GEMINI_API_KEY` is set, plus **watermark + HITL**. Journey should *call* those APIs, not invent new letter types. |
| Provider / Patient Advocate tabs | **Existing app** at `/`. Keep reachable; not CareLoop chrome. |
| Live payer, EHR, eRx, real claims, production HIPAA | **Out of scope.** |

Until the store exists, UI can mock `GET /api/careloop/thread`. After Vivek’s B lands, one thread is source of truth (Dave writes Coverage; Sreekar writes encounter/orders/auth/meds/claim/follow-up; Vivek presents + share/export).
