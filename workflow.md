# CareLoop patient workflow (teammate map)

How the **hackathon web app** should feel for the patient. Visual clickthrough: [`frontend/mockups/`](frontend/mockups/) → http://localhost:8080/mockups/. Owner/build split: [`plan.md`](plan.md) (Vivek = shell + thread + history share). This file is **not** a product spec for live insurance or clinical decisions.

**Demo patient (fictional, no PHI):** Maya Chen · Horizon Health PPO · metformin already on file · golden-path T2DM fixture.

**Rule for all copy and buttons:** draft / suggest / review / estimate. The app does **not** diagnose, prescribe, approve care, or decide coverage. **PA ≠ claim.** Letter downloads stay **HITL**.

Screens in the mockup are `phone.html#s01` … `#s23`.

---

## Locked IA (read this first)

### Hamburger (☰) — standing destinations only

Order, top to bottom:

1. **Today**
2. **History** — two tabs (do **not** name the second tab “Doctor”):
   - **My visits** — past visits + reason
   - **For the clinic** — doctor-facing PDF/packet
3. **Medicines** — today’s doses **and** the list (sig: when / times per day) **and** refill. Not a separate Reminders or Refills item.
4. **Tests** — summaries + documents
5. **Insurance** — card on file, coverage snapshot, update
6. **Profile** — general details
7. **Log out** — footer of the drawer

The **visit journey is not in the hamburger:** symptoms → doctors → book → visit → transcript → SOAP → **estimated costs** → plan (then follow-ups). Resume it from **Today** (Continue / start a visit) or first-time onboarding.

**Back** (←) is local (scan → insurance hub, book → doctor list). DenialShield Provider / Patient Advocate tabs are a different surface.

### Two workflows

| | First-time | Repeat |
|--|------------|--------|
| **After login** | Insurance hub (photo **or** type details) → save onto the thread (“build record”) → visit journey | **Today**. ☰-first. Insurance already on file (prefilled). |
| **New visit** | The first journey *is* the record | Start/continue visit from Today; completed visits **append to History → My visits** |
| **Skip insurance** | Allowed (go to Today). No cost estimates later (skip that screen). In-network suggestions are weaker. | N/A unless they clear/update Insurance |

Login mockup: **Continue (first visit)** vs **I’m returning** so both paths are demoable.

---

## Visit journey (Continue path)

Not a ☰ item. Stepper is **1–8 of 8** on the visit itself (symptoms … plan). Insurance setup is *before* the stepper on first-time only. Follow-ups are a coda after plan.

### 0. Login — `#s01`

- **User sees:** CareLoop wordmark, demo email `maya.chen@example.com`, password, prototype note (clinician reviews drafts).
- **User does:** **Continue (first visit)** *or* **I’m returning**.
- **Goes to:** Insurance hub (`#s02`) if first-time; Today (`#s19`) if repeat.

---

### First-time only: insurance hub — `#s02`

**Decision point (both options exist). Not in the hamburger** — standing **Insurance** (`#s20`) is for later view/update.

- **User sees:** “Add your insurance.” Cards: **Photo of insurance card** vs **Enter plan details**. Copy: used to *suggest* in-network clinics; **not a coverage decision**.
- **User does:** Photo → scan (`#s03`); type → manual (`#s04`); **Skip for now · go to Today** → `#s19`.
- **Goes to:** `#s03`, `#s04`, or `#s19`.

Dave owns card/coverage APIs; Vivek renders the shell.

#### Card photo / scan — `#s03`

- **User sees:** Camera frame, mock Horizon card (Maya Chen, ID `MCH-889120`, group `GH-4421`). Mock OCR fills fields **for review**. **Capture for review** + **Upload from photos**.
- **User does:** Capture (or upload → manual `#s04` to fix fields).
- **Goes to:** Symptoms (`#s05`) after confirm (record started). ← hub (`#s02`).

#### Manual plan details — `#s04`

- **User sees:** Company, PPO, group, member ID, subscriber — check against the card.
- **User does:** **Save for review** (not “verified eligible”).
- **Goes to:** Symptoms (`#s05`). ← hub (`#s02`).

---

### 1. Issues / symptoms — `#s05` · journey 1 of 8

- **User sees:** Chips (fatigue, thirst, frequent urination on) + free-text. “CareLoop does not diagnose.”
- **User does:** Edit → **Continue**.
- **Goes to:** Doctor suggestions (`#s06`). ☰ available but does not contain this step.

---

### 2. Doctor suggestions — `#s06` · journey 2 of 8

- **User sees:** Mock in-network PCP list (e.g. Dr. Priya Raman). One row may be **Confirm network**. Slots estimated; clinic still confirms.
- **User does:** Tap a clinician (demo: Raman).
- **Goes to:** Appointment (`#s07`).

---

### 3. Appointment — `#s07` · journey 3 of 8

- **User sees:** Week strip, time chips. Prototype booking; clinic confirms. Optional tiny copay hint is OK; the dedicated **you-pay vs plan** screen is **after SOAP**, not here.
- **User does:** **Request Thu 10:30** (request, not a guaranteed book).
- **Goes to:** Visit check-in (`#s08`). ← `#s06`.

---

### 4. Doctor visit (waiting / check-in) — `#s08` · journey 4 of 8

- **User sees:** Waiting room, check-in complete. Next: draft transcript → SOAP (clinician review) → **estimated costs** (if insurance on file) → suggested plan. Nothing is an order until a clinician confirms.
- **User does:** **Start draft transcript**.
- **Goes to:** Transcribing (`#s09`).

---

### 5. Live transcribing — `#s09` · journey 5 of 8

- **User sees:** Draft only / listening, sample lines (metformin, thirst, HbA1c, add-on *may* need PA — clinician’s words).
- **User does:** **See draft SOAP**.
- **Goes to:** SOAP (`#s10`). ← `#s08`.

---

### 6. SOAP summary — `#s10` · journey 6 of 8

- **User sees:** Patient-readable S/O/A/P. **Awaiting clinician review.** Draft impression; `[NEEDS VERIFICATION]` if labs would change it. App does not finalize diagnosis.
- **User does:** **Continue to estimated costs** (or the app auto-skips costs if no insurance on file).
- **Goes to:** Estimated costs (`#s22`) if insurance on file; else care plan (`#s11`).

---

### 7. Estimated costs (skippable) — `#s22` · journey 7 of 8

**After SOAP, before care plan.** Skip if no insurance. Not a bill. Not a coverage decision. **PA-may-be-required is not a price.**

- **User sees:** Mock **you-pay vs plan** rows for the *suggested* plan lines (office visit, HbA1c, etc.). Add-on Rx row: “PA may be required” — no dollar as if it were allowed. Banner: estimate only.
- **User does:** **Continue to plan** *or* **Skip estimates**.
- **Goes to:** Care plan (`#s11`).

**Owners:** Dave = mock coverage numbers; Sreekar = which plan lines exist; Vivek = this screen.

---

### 8. Care plan — `#s11` · journey 8 of 8

- **User sees:**
  - **Meds:** continue metformin (current); add-on e.g. GLP-1 class *clinician may consider* — **PA may be required** (not approval/denial, not a price).
  - **Tests:** HbA1c — typically not PA-gated on this mock plan; still an estimate.
  - **Referrals:** diabetes education *suggested*.
- **User does:** **See follow-ups**.
- **Goes to:** Follow-ups (`#s12`).

Sreekar owns encounter/orders/PA facts; this screen presents them. After clinician review, meds/tests also show under ☰ **Medicines** / **Tests**.

---

### Coda: Follow-ups — `#s12`

- **User sees:** Who acts — **You** (lab when order ready), **Clinic** (review SOAP), **Insurance if add-on Rx** (PA is a *separate* step from any later **claim**), **You + clinic** (suggested 3-month visit).
- **User does:** **Go to Today**.
- **Goes to:** Today (`#s19`). Visit is ready to **append** on History → My visits (repeat visits add another row).

---

## Hamburger destinations

Open ☰ → `#s18`. Visit steps are **not** listed. **Log out** is the drawer footer → login (`#s01`).

### Today — `#s19`

- **User sees:** Greeting. **Continue visit** / **Start a visit** (journey, not a ☰ item). Shortcuts into standing dests (evening dose → Medicines, packet → History). Repeat users land here after login.
- **User does:** Continue → symptoms (`#s05`) when insurance is on file; or ☰.
- **Goes to:** `#s05`, `#s13`, `#s15`, `#s20`, etc.

### History — two tabs

Not the visit wizard. ☰ **History**.

#### My visits — `#s15`

- **User sees:** Tab **My visits** | **For the clinic**. List of **past visits + reason** (e.g. Sep 24, 2026 · fatigue / thirst follow-up · Dr. Raman). Coverage/meds/tests are *not* dumped here — those live under Insurance / Medicines / Tests.
- **User does:** Tap a visit → breakup (`#s16`). Switch tab → For the clinic (`#s17`).
- **Goes to:** `#s16` or `#s17`.

#### Visit breakup (detail) — `#s16`

- **User sees:** What happened / waiting / who acts / evidence. **Prior auth ≠ claim** (separate events if both exist).
- **User does:** **Add to clinic packet** or ← My visits.
- **Goes to:** `#s17` or `#s15`.

#### For the clinic (packet) — `#s17`

- **User sees:** Same History tabs; **For the clinic** selected. Doctor-facing PDF/packet: what to include (visits, SOAP review status, meds, tests, coverage snapshot; auth/claim if any). **Not** labeled “Doctor.” Patient record export — **not** an appeal letter. Letters still need HITL.
- **User does:** **Create packet (mock)** (PDF/markdown/JSON fixture).
- **Goes to:** Stays on History (`#s15` / `#s17`). Reads thread facts; does not invent labs or eligibility.

### Medicines — `#s13` (merged reminders + list + refill)

- **User sees:** **Today’s doses** (taken / upcoming). **List** with **sig** (e.g. metformin 1000 mg **twice daily** · 8:00 AM / 8:00 PM). **Refill** (~12 days left; draft request for clinic). App does not change dose or e-prescribe. PA approval ≠ paid claim.
- **User does:** Mark taken/missed; **Draft refill request for clinic** (draft only). Optional refill-focused card still may use `#s14` in the clickthrough.
- **Goes to:** Stay on Medicines, or `#s14` then back.

### Tests — `#s23`

- **User sees:** **Summaries** (HbA1c ordered, result not in) + **documents** (mock requisition / result PDF stubs). No independent interpretation.
- **User does:** Open a document stub.
- **Goes to:** Stay on Tests (or a simple preview in-place).

### Insurance — `#s20`

- **User sees:** Card on file, member IDs, **Est. active**, estimated cost share, PA vs claim explainer. Estimates only.
- **User does:** **Update card or details** → first-time hub pattern (`#s02`) with fields prefilled on repeat.
- **Goes to:** `#s02`, then back to Insurance / Today.

### Profile — `#s21`

- **User sees:** General details (name, demo contact, that this is a fictional patient). Not the meds/tests/insurance homes.
- **User does:** ☰ to leave. **Log out** from the drawer, not from Profile required.

---

## Decision points (checklist)

| Decision | Behavior |
|----------|----------|
| Card photo vs type details | Both exist on insurance hub; both must be confirm-for-review |
| Skip insurance | Today without blocking demo; **skip estimated costs**; weaker network suggestions |
| First visit vs returning | Login splits; returning → Today, insurance prefilled |
| Skip estimated costs | Always allowed; auto-skip if no insurance |
| PA may be required | Flag / checklist — **not** a dollar and **not** a claim |
| History packet vs letters | Packet is a record view; PA/appeal/demand still watermark + HITL |

---

## Stage map (quick)

```
FIRST-TIME
Login → Insurance hub ─┬─ Photo/scan ──┐
                       └─ Type details─┴─ build record
                         → Symptoms → Doctors → Book → Visit
                         → Transcript → SOAP → Estimated costs (skip if no insurance)
                         → Plan → Follow-ups → Today
                         (visit appends to History → My visits)

REPEAT
Login → Today   ☰ = Today · History · Medicines · Tests · Insurance · Profile
                footer: Log out
                History tabs: My visits | For the clinic
                Start/continue visit from Today (not from ☰)

Skip insurance → Today (no cost screen on that visit)
```

---

## Mocked vs real (hackathon)

| Piece | Hackathon truth |
|--------|-----------------|
| This workflow + mockups | **Visual/HTML prototype.** Clickthrough does not persist a thread. |
| Patient, plan, network, copay / you-pay vs plan | **Mock.** Fixture card/OCR OK. Estimates, not eligibility determinations or bills. |
| In-network doctor list + slots | **Mock directory.** Booking is a **request**; clinic “confirms” in demo state. |
| Transcript / SOAP / Plan | **Seeded or mocked scribe OK.** Clinician review gate before orders. Optional live mic. |
| Estimated costs screen | **Mock numbers (Dave)** on **plan lines (Sreekar)**; **Vivek** screens. Skip if no insurance. |
| HbA1c vs add-on Rx | Lab typically **no PA**; add-on **PA may be required** — flags, not prices. |
| Payer PA | **Mock payer.** First PA submit → deterministic **step-therapy denial** + citable policy; appeal path then **approves**. Not an LLM coverage decision. |
| Claim / EOB | **Separate mock object** from PA. Do not collapse. |
| Meds taken/missed/refill | **Local/mock schedule** after mock dispense. No pharmacy, no eRx. |
| History packet (For the clinic) | **Export fixture** from the thread. Not a signed appeal. |
| DenialShield letters (PA/appeal/demand) | **Real LLM drafts** when `XAI_API_KEY` is set, plus **watermark + HITL**. Journey *calls* those APIs; no new letter types. |
| Provider / Patient Advocate tabs | **Existing app** at `/`. Keep reachable; not CareLoop chrome. |
| Live payer, EHR, eRx, real claims, production HIPAA | **Out of scope.** |

Until the store exists, UI can mock `GET /api/careloop/thread`. After Vivek’s B lands, one thread is source of truth (Dave writes Coverage; Sreekar writes encounter/orders/auth/meds/claim/follow-up; Vivek presents + share/export).
