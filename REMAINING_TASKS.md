# Person Mention Notifications — Complete

**Status:** Shipped. This file is kept as a pointer, not a task list.

**Last verified:** 2026-08-15

---

All seven tasks this document tracked are done. It sat at "4 of 7 complete, 3
critical tasks remaining" for nine days after the remaining three had shipped,
and reading it in August 2026 sends you looking for work that is not there.

What it listed as missing, and where that work now lives:

| Was listed as missing | Actually shipped in |
|---|---|
| Task 1 — backend mention detection on issue update | `backend/utils/notify.js` (`mentionedUserIdsInProject`, `notifyNewMentions`), covered by `backend/tests/backend/issues.mentions.test.js` |
| Task 3 — autocomplete in the description editor | `frontend/src/hooks/use-mentions.tsx`, wired through issue creation and the wiki |
| Task 7 — end-to-end validation | `frontend/e2e/mention-workflow.spec.ts` |

Mentions since grew past this document's scope: a shared token parser with a
conformance fixture (`docs/mention-test-vectors.json`), id-resolved badges,
mobile support (`mobile/src/utils/mentions.ts`), and the product board and
portal surfaces.

**Current spec:** `docs/superpowers/specs/2026-08-15-mentions-design.md` — the
design was reconciled with what shipped, and is the source of truth over the
older `2026-08-06-person-mention-notifications-design.md`.

---

## A note on task files

A per-feature checklist that outlives its feature costs more than it saved. If
you add one, delete it when the work lands, or replace it with a pointer like
this one. The durable records are the spec, the tests, and `KNOWN-ISSUES.md`.
