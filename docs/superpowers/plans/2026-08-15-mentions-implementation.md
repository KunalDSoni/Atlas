# @mentions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace display-name @mentions with resolvable `@[Name](user:id)` tokens that work on every authoring surface across web, backend and mobile.

**Architecture:** A pure parser module, duplicated across three package roots and anchored by a shared JSON test-vector fixture, defines the token grammar. A headless `useMentions` hook replaces the ref-cloning wrapper that is the root cause of the dead dropdown. Notification fan-out reads ids from the parser instead of substring-matching names.

**Tech Stack:** Node/Express/SQLite (jest + supertest), React 18 + Vite + Tailwind (vitest + Playwright), React Native 0.86 / Expo 57 (jest + RN Testing Library).

**Spec:** `docs/superpowers/specs/2026-08-15-mentions-design.md`

## Global Constraints

- Token grammar: `@[Display Name](user:<id>)`. Display 1–100 chars, no `]`, no newline. Id `[A-Za-z0-9_-]{1,64}`.
- HTML surfaces use `<span data-mention-id="<id>">@Name</span>`. Allowlist `data-mention-id` only — never blanket `data-*`.
- The id is authoritative. An id that does not resolve renders as plain text, never a badge.
- No database migration. Existing plain `@Name` content is never rewritten.
- Notification type string is `mention` everywhere (never `mentioned`).
- Notification delivery is fire-and-forget; it must never fail the write that triggered it.
- All three parser implementations must pass `docs/mention-test-vectors.json`.
- Mention badges do not link anywhere — Atlas has no per-user profile route.

---

## File Structure

**Create:**
- `docs/mention-test-vectors.json` — shared parser conformance fixture
- `backend/utils/mentions.js` — parser (CJS)
- `backend/routes/mentions.js` — `GET /api/mentions/search`
- `frontend/src/lib/mentions.ts` — parser (TS)
- `frontend/src/hooks/use-mentions.ts` — headless picker logic
- `frontend/src/components/app/mention-dropdown.tsx` — portaled listbox
- `frontend/src/components/app/mention-text.tsx` — plain-text renderer with hover card
- `mobile/src/utils/mentions.ts` — parser (TS)
- `mobile/src/components/MentionBar.tsx` — keyboard-docked suggestion bar
- `mobile/src/components/MentionText.tsx` — RN renderer

**Modify:**
- `frontend/src/components/ui/textarea.tsx` — wrap in `forwardRef`
- `frontend/src/lib/mention-renderer.tsx` — rebuild over `tokenizeMentions`
- `frontend/src/components/app/rich-text.tsx` — sanitizer allowlist + `applyMacros` mention pass
- `backend/utils/sanitize.js` — sanitizer allowlist
- `backend/utils/notify.js` — id-based parsing, legacy fallback
- `backend/routes/{issues,comments,wiki}.js` — fan-out
- `backend/utils/email.js` — strip token syntax
- Authoring surfaces per the spec's Surfaces table

**Delete:**
- `frontend/src/components/app/mention-autocomplete.tsx` — replaced by hook + dropdown

---

## Task 1: Shared parser and test vectors

**Files:**
- Create: `docs/mention-test-vectors.json`, `backend/utils/mentions.js`
- Test: `backend/tests/backend/mentions.parser.test.js`

**Interfaces produced:**
- `parseMentionIds(text) -> string[]` — unique ids, document order
- `tokenizeMentions(text) -> Array<{type:'text',value}|{type:'mention',id,name}>`
- `stripMentionSyntax(text) -> string`
- `insertMention(text, caret, user) -> { text, caret }`
- `MENTION_RE` — the compiled token regex

- [ ] **Step 1:** Write `docs/mention-test-vectors.json` with cases: plain token, two adjacent tokens, token mid-sentence, `foo@bar.com`, unclosed `@[`, `]` inside display name, legacy `@Name`, empty string, token with `_-` in id.
- [ ] **Step 2:** Write `backend/tests/backend/mentions.parser.test.js` looping the fixture through all four functions.
- [ ] **Step 3:** Run `npx jest tests/backend/mentions.parser.test.js` — expect failure, module not found.
- [ ] **Step 4:** Implement `backend/utils/mentions.js`.
- [ ] **Step 5:** Run the test — expect pass.
- [ ] **Step 6:** Commit.

## Task 2: Mention search endpoint

**Files:**
- Create: `backend/routes/mentions.js`
- Modify: `backend/server.js` (route registration)
- Test: `backend/tests/backend/mentions.search.test.js`

**Interfaces produced:** `GET /api/mentions/search?q=&projectId=` → `[{ id, name, email, avatar_color, is_member }]`, max 10, members first.

- [ ] **Step 1:** Write tests: members rank above non-members; `is_member` correct; inactive users excluded; limit 10; requires auth.
- [ ] **Step 2:** Run — expect 404.
- [ ] **Step 3:** Implement the route.
- [ ] **Step 4:** Run — expect pass.
- [ ] **Step 5:** Commit.

## Task 3: Backend fan-out on resolvable ids

**Files:**
- Modify: `backend/utils/notify.js`, `backend/routes/issues.js`, `backend/routes/comments.js`, `backend/utils/email.js`
- Test: `backend/tests/backend/issues.mentions.test.js` (extend)

**Interfaces produced:** `mentionedUserIds(db, text, authorId, { projectId })` — ids from tokens, plus unambiguous legacy name matches.

- [ ] **Step 1:** Write tests: token mention notifies; `type` is `mention` on both comment and description paths; edit notifies only newly-added ids; issue creation notifies; self-mention silent; deactivated user silent; internal comment does not notify a client-role user; `foo@bar.com` notifies nobody.
- [ ] **Step 2:** Run — expect failures on type string, creation path, internal-note suppression.
- [ ] **Step 3:** Rewrite `mentionedUserIds` over `parseMentionIds` with the legacy fallback; unify the type string; add the creation path and the client suppression; run email bodies through `stripMentionSyntax`.
- [ ] **Step 4:** Run — expect pass.
- [ ] **Step 5:** Commit.

## Task 4: forwardRef Textarea + useMentions hook

**Files:**
- Create: `frontend/src/lib/mentions.ts`, `frontend/src/hooks/use-mentions.ts`, `frontend/src/components/app/mention-dropdown.tsx`
- Modify: `frontend/src/components/ui/textarea.tsx`
- Delete: `frontend/src/components/app/mention-autocomplete.tsx`
- Test: `frontend/src/lib/__tests__/mentions.test.ts`, `frontend/src/hooks/__tests__/use-mentions.test.tsx`

**Interfaces produced:** `useMentions({ projectId, value, onChange, inputRef })` → `{ ref, inputProps, dropdownProps }`.

- [ ] **Step 1:** Port the vector fixture into a vitest suite for `frontend/src/lib/mentions.ts`.
- [ ] **Step 2:** Write hook tests: `@` after whitespace opens; `foo@bar.com` does not; one-space query matches `John Doe`; ↑↓ move selection; Enter and Tab insert; Escape closes leaving the literal `@`; insertion places the caret after the token.
- [ ] **Step 3:** Run — expect failure.
- [ ] **Step 4:** Implement parser, hook, dropdown (portal, `position: fixed`, mirror-div caret, viewport flip, combobox/listbox ARIA); convert `Textarea` to `forwardRef`.
- [ ] **Step 5:** Run — expect pass.
- [ ] **Step 6:** Commit.

## Task 5: Renderer and legacy resolution

**Files:**
- Create: `frontend/src/components/app/mention-text.tsx`
- Modify: `frontend/src/lib/mention-renderer.tsx`, `frontend/src/components/app/rich-text.tsx`, `backend/utils/sanitize.js`
- Test: `frontend/src/lib/__tests__/mention-renderer.test.tsx`

- [ ] **Step 1:** Write tests: resolved id renders a badge with the live name; unresolved id renders plain text; deactivated renders muted; legacy `@Name` with one match renders a badge; legacy name matching two users stays prose; longest-match wins between `Jo` and `Joanna`.
- [ ] **Step 2:** Run — expect failure.
- [ ] **Step 3:** Rebuild the renderer over `tokenizeMentions`; add the `applyMacros` mention pass handling both spans and raw tokens; allowlist `data-mention-id` in both sanitizers.
- [ ] **Step 4:** Run — expect pass.
- [ ] **Step 5:** Commit.

## Task 6: Wire every web surface

**Files:** `create-issue-dialog.tsx`, `edit-issue-dialog.tsx`, `issue-detail/issue-tabs.tsx`, `issue-detail/issue-detail-body.tsx`, `wiki-page.tsx`, `help-requests.tsx`, `portal.tsx`, `outcome-dialog.tsx`, `feature-detail-sheet.tsx`, `rich-text.tsx`
- Test: `frontend/e2e/mention-workflow.spec.ts`

- [ ] **Step 1:** Write the e2e flow: open an issue, type `@`, see the dropdown, pick a member, post, assert the badge and the recipient's notification.
- [ ] **Step 2:** Run — expect failure.
- [ ] **Step 3:** Wire each composer to `useMentions`; wire each renderer to `MentionText`; add the contentEditable insertion path for the wiki body.
- [ ] **Step 4:** Run e2e and the unit suites — expect pass.
- [ ] **Step 5:** Commit.

## Task 7: Mobile

**Files:**
- Create: `mobile/src/utils/mentions.ts`, `mobile/src/components/MentionBar.tsx`, `mobile/src/components/MentionText.tsx`
- Modify: `mobile/src/components/CommentInput.tsx`, `mobile/src/components/CommentList.tsx`, `mobile/src/screens/CreateIssueScreen.tsx`, `mobile/src/screens/IssueDetailScreen.tsx`
- Test: `mobile/src/__tests__/mentions.test.ts`, `mobile/src/__tests__/MentionBar.test.tsx`

- [ ] **Step 1:** Port the vector fixture to a mobile jest suite; write `MentionBar` tests for trigger and insertion via `onChangeText`/`onSelectionChange`.
- [ ] **Step 2:** Run — expect failure.
- [ ] **Step 3:** Implement parser, bar and renderer; wire the two composers and two read surfaces.
- [ ] **Step 4:** Run — expect pass.
- [ ] **Step 5:** Commit.

## Task 8: Read-path sweep

**Files:** `backend/utils/notify.js`, `backend/utils/email.js`, board/backlog cards, search results, command palette, activity feed, exports

- [ ] **Step 1:** Grep every site rendering `description` or comment `body` raw.
- [ ] **Step 2:** Apply `stripMentionSyntax` or the renderer at each.
- [ ] **Step 3:** Run the full suite.
- [ ] **Step 4:** Commit.
