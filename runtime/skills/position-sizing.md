---
name: position-sizing
description: >
  DEPRECATED — superseded by swing-horizon-sizer. Kept only as a redirect so older
  prompts/routes resolve. Do NOT apply this file's logic.
superseded_by: swing-horizon-sizer
---

# Position Sizing — DEPRECATED (redirect)

Sizing is no longer a standalone formula sheet. It is the **`swing-horizon-sizer.md`**
stage: it estimates the realistic move over the operator's horizon, tests reward
vs the technical stop, and only then returns an exact share count via
`Shares = Risk_Budget ÷ (Entry − Stop)` (round down). A great company with no room
to move in the window is a **no-bet**.

**→ Read `swing-horizon-sizer.md` instead.** See `CONTEXT.md` § "The doctrine
pipeline" and `docs/adr/0001-doctrine-is-a-staged-pipeline.md`.
