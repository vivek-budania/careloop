# Patient-facing CareLoop mockups (visual prototype)

Static HTML clickthrough for Vivek’s patient app shell. **Not** the live golden-path product and **not** DenialShield’s Provider / Patient Advocate tabs.

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
- Visit **Continue** path plus hamburger destinations (Today, Coverage, Reminders, Refills, History, Profile)
- History includes list, visit breakup, and a share-packet screen

PNG exports of each screen live with the design handoff (see the PR description), not in this folder, so the repo stays light.

Teammate text map of the same IA (stages, buttons, mocked vs real): [`../../workflow.md`](../../workflow.md).
