# Patient-facing CareLoop mockups (visual prototype)

Static HTML clickthrough for Vivek’s patient app shell. **Not** the live golden-path product at `/`. Product story: `/showcase`.

Live hamburger on `main`: Today · Past visits · Upcoming visits · Reminders · Prescriptions · Test records · Insurance · Profile · Log out. This folder still uses the earlier names (History / Medicines / Tests) and **Maya Chen**.

## Open in a browser

With the usual app server:

```bash
python3 -m uvicorn backend.main:app --reload --port 8080
```

Then visit **http://localhost:8080/mockups/** (gallery) or **http://localhost:8080/mockups/phone.html#s01** (phone).

You can also open `frontend/mockups/index.html` directly from disk.

## What this is

- ~390×844 phone frames, calm healthcare UI (sage / cream / ink)
- Fictional patient **Maya Chen** — no real PHI
- Copy uses draft / suggest / review language only
- Visit **Continue** path (symptoms → … → SOAP → estimated costs → plan) plus hamburger (mockup labels): Today, History, Medicines, Tests, Insurance, Profile, Log out
- History tabs: **My visits** and **For the clinic** (not labeled “Doctor”)

PNG exports of each screen live with the design handoff (see the PR description), not in this folder, so the repo stays light.

Teammate text map of the same IA (stages, buttons, mocked vs real): [`../../workflow.md`](../../workflow.md). Live product: [`../../README.md`](../../README.md).
