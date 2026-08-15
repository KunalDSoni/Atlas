# @mentions, rebuilt on resolvable identity

**Date:** 2026-08-15
**Branch:** `claude/annotations-at-mentions-303f36`
**Status:** Design approved, ready for implementation planning
**Supersedes:** `2026-08-06-person-mention-notifications-design.md`, whose
implementation is the code this spec replaces.

## Problem

Typing `@` in a comment box produces nothing. The dropdown never opens, and the
composer visibly collapses to a narrow column because the wrapper element
breaks its parent's flex row.

Four defects stack up:

1. **The ref never attaches.** `frontend/src/components/ui/textarea.tsx` is a
   plain function component, not `forwardRef`. `MentionAutocomplete` clones a
   `ref` onto it, so `inputRef.current` stays `null` on React 18.
   `getCaretCoordinates()` returns `{0,0}` and `insertMention()` returns on its
   first line. The same broken ref hits `descriptionRef` in
   `edit-issue-dialog.tsx:156`.
2. **The wrapper breaks layout.** `.mention-autocomplete-wrapper` has no flex
   sizing, but its parent in `issue-tabs.tsx:25` is `flex gap-2`, so it
   collapses to min-content.
3. **The dropdown is positioned in the wrong coordinate space.** It is
   `position: absolute` inside a `position: relative` wrapper, fed viewport
   coordinates from `getBoundingClientRect()`. The textarea branch of the caret
   calculation derives a line number from `scrollTop` alone, which does not
   track the caret.
4. **Identity is a display name, so mentions are ambiguous.** The picker
   inserts plain `@Full Name`. The renderer's `/@[\w]+/` matches only `@John`,
   leaving `Doe` as prose. The backend substring-matches names
   (`notify.js:48`), so `@Jo` notifies Joanna, two people sharing a name both
   get pinged, and `foo@bar.com` is a mention.

Two further problems sit behind the visible ones. The notification type string
is `mention` in comments but `mentioned` in issue descriptions
(`issues.js:475`); only `mention` appears in `TYPE_TOGGLE` at `email.js:14`, so
description mentions ignore the recipient's `notify_mentions` opt-out and email
them anyway. And mentions exist on only two surfaces — issue description via
the edit dialog, and issue comments — while wiki pages, wiki comments, service
desk, product descriptions, issue creation and all of mobile have none.

## Goals

Mentions that behave like Jira and Confluence: a mention names exactly one
person, renders as a badge, survives that person being renamed, notifies them,
and works on every surface where a user writes prose, mobile included.

## Decisions

### A mention is a resolvable reference, not a name

Plain-text fields store a token:

```
@[Kunal Soni](user:8f3c1d20-4e5a-4c1b-9f2e-7a6b5c4d3e2f)
```

- Display name: 1–100 characters, no `]` and no newline. The picker strips both
  when inserting.
- Id: `[A-Za-z0-9_-]{1,64}`. Accounts are uuidv4 in practice; the pattern stays
  tolerant so a differently-seeded account cannot silently fail to parse.

HTML fields — wiki page bodies and wiki comments — store the same reference as
`<span data-mention-id="8f3c…">@Kunal Soni</span>`. Both sanitizers currently
strip data attributes: `rich-text.tsx:39` sets `ALLOW_DATA_ATTR: false` and
`backend/utils/sanitize.js` does not allowlist them. Each gains an exception for
`data-mention-id` alone, never blanket `data-*`.

**The id is authoritative; the stored name is a fallback.** The renderer
resolves the live name from the id, so renaming a user updates every existing
mention. An id that does not resolve renders as plain text, never as a badge —
which is also what stops a hand-typed `@[Admin](user:<someone-else>)` from
producing a convincing impersonation, since a badge always shows whoever the id
really is.

### The parser is duplicated on purpose

The backend is CommonJS; frontend and mobile are separate TypeScript package
roots with no shared build. Introducing a workspace package to share four small
pure functions is a build-system change out of proportion to the feature. The
module is implemented three times:

- `backend/utils/mentions.js`
- `frontend/src/lib/mentions.ts`
- `mobile/src/utils/mentions.ts`

Each exposes the same four functions:

| Function | Purpose |
| --- | --- |
| `parseMentionIds(text)` | Ids only — what notification fan-out needs |
| `tokenizeMentions(text)` | Ordered text/mention segments for rendering |
| `stripMentionSyntax(text)` | `@Kunal Soni` plain text for email, push, previews, search |
| `insertMention(text, caret, user)` | Returns `{ text, caret }` — the body with the token swapped in for the partial `@query`, and the caret placed after it, so all three platforms agree on spacing |

Drift is prevented by `docs/mention-test-vectors.json`: input strings paired
with expected outputs, loaded by all three test suites. An implementation that
drifts fails its own tests. The fixture is where the edge cases live —
`foo@bar.com`, a token inside a code block, an unclosed `@[`, adjacent
mentions, a legacy bare `@Name`.

`stripMentionSyntax` needs the most operational care. Raw stored text reaches
users through notification `message` strings, email bodies, mobile push
payloads, board card previews and search results. Section "Read paths" lists
every call site; a miss there shows a user raw
`@[Kunal Soni](user:8f3c…)` in their inbox.

### Members rank first, everyone is reachable

`GET /api/mentions/search?q=&projectId=` returns up to 10 active users ranked
members-first, each carrying an `is_member` flag. The picker debounces 150ms.

Selecting a non-member inserts the mention normally and shows an inline note:
*"Sarah Lee isn't a member of this project and may not be able to open it."*
The mention still notifies. This replaces two contradictory existing rules —
descriptions used `mentionedUserIdsInProject` (members only) while comments used
`mentionedUserIds` (every active user in the system, dead links included).

### Legacy text renders, and is never rewritten

No migration. Existing plain `@Name` content stays byte-identical in the
database.

A second resolution pass matches untokenized `@Name` runs against known display
names, longest-match-first, and renders a badge only when exactly one active
user matches. Two people sharing a name, or a name that is also a prefix of
another, stays plain prose. Legacy mentions render but are not clickable —
there is no id to link to.

This is a deliberate trade against backfilling. A migration would make old
mentions fully clickable, but ambiguous names and false positives would be
permanently rewritten into live user content.

## Components

### `useMentions` hook and `MentionDropdown` (web)

The wrapper component is removed. Cloning a ref and handlers onto a child it
does not control is what broke the ref, and interposing a `<div>` is what broke
the layout. The replacement is headless:

```tsx
const mentions = useMentions({ projectId, value, onChange, inputRef });
<Textarea {...mentions.inputProps} ref={mentions.ref} />
<MentionDropdown {...mentions.dropdownProps} />
```

No wrapper element, so no call site changes shape. `Textarea` becomes
`React.forwardRef`, which also repairs `descriptionRef` in the edit dialog.

**Caret positioning** uses a mirror div: a hidden element with the textarea's
computed styles copied onto it, holding the text up to the caret, measured for
real pixel coordinates. `MentionDropdown` renders in a portal with
`position: fixed`, flipping above the caret when it would overflow the viewport
bottom.

**Trigger rules:**

| Rule | Behaviour |
| --- | --- |
| `@` position | Fires only at start of field or after whitespace, `(`, or `[` |
| Query | May contain one space, so `@John Doe` works; a second space with no matches closes it |
| Keys | ↑ ↓ navigate; Enter and Tab complete; Escape closes, leaving the literal `@` |
| Close | Escape, blur, deleting past the `@`, or no matches after 3+ characters |

Accessibility: the input carries `role="combobox"` with `aria-controls` and
`aria-activedescendant`; the list is `role="listbox"` with `role="option"`
children. The current markup has `role="option"` without a listbox parent.

### Renderer

`renderMentions` is rewritten over `tokenizeMentions`, returning badges for
resolved ids and plain text otherwise. In the HTML pipeline, mention resolution
becomes a pass inside `applyMacros` (`rich-text.tsx:79`) handling both
`<span data-mention-id>` elements and raw tokens in text nodes. One pass serves
page bodies and wiki comments — necessary because wiki comments are composed as
plain text but rendered through `RichTextView` as HTML.

Hovering a badge opens a card with the person's name, email and role, reusing
the hover-card pattern already built for issue chips at `rich-text.tsx:372`.

Badges do **not** link anywhere. Jira links a mention to that person's profile,
but Atlas has no per-user profile route — `App.tsx:117` serves `/profile` for
the current user only, and `/admin/users` is admin-gated. Adding a public
profile route is a separate feature; the hover card delivers the identifying
information without it. Deactivated users render muted with no hover card.

## Surfaces

| Surface | File | Content model |
| --- | --- | --- |
| Create issue description | `create-issue-dialog.tsx` | plain |
| Edit issue description | `edit-issue-dialog.tsx` | plain — repair existing |
| Issue comments | `issue-detail/issue-tabs.tsx:31` | plain — repair existing |
| Wiki page body | `rich-text.tsx:683` | HTML (contentEditable) |
| Wiki comments | `wiki-page.tsx:610` | plain in, HTML out |
| Product features | `product-features.tsx` | plain |
| Product objectives | `product-objectives.tsx` | plain |
| Product insights | `product-insights.tsx` | plain |
| Portal ideas (staff only) | `portal.tsx` | plain |
| Mobile comments | `mobile/src/components/CommentInput.tsx` | plain |
| Mobile create issue | `mobile/src/screens/CreateIssueScreen.tsx` | plain |

Two composers are deliberately **not** wired, both customer-facing:
`help-requests.tsx` (a customer replying to their own request) and the outcome
review dialog's non-notifying fields. A client cannot reach
`/api/mentions/search` — it sits behind `blockClients` — so the picker could
never open for them, and a mention they hand-typed would either notify nobody
or let someone outside the company ping staff at will.

The portal's idea composer is wired because staff use it too. The server
enforces the boundary rather than the UI: `POST /api/portal/ideas` skips mention
fan-out entirely when the submitter is a client.

The wiki page body is the one surface needing its own insertion path:
`contentEditable` has no `selectionStart`, so insertion goes through
`document.execCommand('insertHTML')` alongside the existing toolbar commands,
and caret coordinates come from the selection `Range` rather than the mirror
div.

Issue descriptions are not inline-editable in the detail view —
`issue-detail-body.tsx:52` is read-only — so the edit dialog is the only
description composer on web.

### Read paths

Every site rendering stored text, each needing either the renderer or
`stripMentionSyntax`:

- Issue description and comments (`issue-detail-body.tsx`, `issue-tabs.tsx`)
- Wiki bodies and comments (`RichTextView`)
- Notification `message` strings (`backend/utils/notify.js`)
- Email bodies (`backend/utils/email.js`)
- Mobile push payloads
- Board and backlog card previews
- Search results and the command palette
- Activity feed entries
- CSV and report exports

## Notifications

The type string becomes `mention` everywhere. Changing `'mentioned'` at
`issues.js:475` is what makes `notify_mentions` actually apply to description
mentions.

Fan-out fires on every surface listed above, **including issue creation**,
which has no mention handling today.

- **Edits notify only newly-added ids.** The old/new diff at `issues.js:463`
  generalises to every surface, so fixing a typo does not re-notify.
- **A mention outranks a watcher notification.** Already true at
  `comments.js:87`; extended to wiki page watchers.
- **Self-mentions notify nobody** — the existing guard in `notify()` covers it.
- **Deactivated users** are never notified.
- **One suppression:** a mention inside an `internal` service-desk comment does
  not notify a `client`-role user. Clients cannot see internal notes;
  notifying them would reveal that a note exists and link them to something
  they cannot open. This is the only case where a mention is stored but
  deliberately silent.

Emails and push payloads run the body through `stripMentionSyntax` first.
Delivery stays fire-and-forget: notification failure must never fail the write
that triggered it, per the contract at `backend/utils/notify.js:1`.

## Error handling

| Failure | Behaviour |
| --- | --- |
| Lookup request fails | No dropdown; typing continues uninterrupted; a compact retry appears on the next `@` |
| Id does not resolve | Renders as plain text, no badge |
| Mentioned user deactivated | Muted, unlinked badge; no notification |
| Malformed token in stored text | Left as literal text; never throws during render |
| Notification insert or email fails | Logged, request still succeeds |

## Testing

The shared vector fixture anchors all three implementations.

**Backend** — parsing against the fixture; fan-out per surface; the edit diff
suppressing repeat notifications; internal-note suppression for client-role
users; `mention` mapping to `notify_mentions`. Extends
`backend/tests/backend/issues.mentions.test.js`.

**Frontend unit** — trigger rules including the `foo@bar.com` case and the
one-space query; keyboard navigation; insertion spacing; renderer output for
resolved, unresolved, deactivated and legacy mentions.
`frontend/src/components/app/__tests__/mention-autocomplete.test.tsx` is
rewritten against the hook. Its current tests pass while the feature is broken
in the browser, because they never exercise the ref that fails — the rewritten
suite must fail against today's code.

**E2E** — `frontend/e2e/mention-workflow.spec.ts` gains a real flow: type `@`,
see the dropdown, pick a member, post, see the badge, assert the notification.

**Mobile** — React Native Testing Library over trigger rules, insertion and
`MentionText` rendering.

## Mobile

Mobile shares the parser and the endpoint, and nothing else. React Native has
no DOM, no `contentEditable`, and no caret coordinates.

The picker is a horizontal suggestion bar docked above the keyboard — the
standard mobile pattern and what Jira's own app does. `onChangeText` and
`onSelectionChange` drive the same trigger rules; insertion uses the shared
`insertMention`. Rendering uses a `<MentionText>` component mapping tokens to
styled `<Text>` segments, since there is no `dangerouslySetInnerHTML`.

Mobile ships last, after the web surfaces prove the format.

## Sequencing

1. Shared parser, test vectors, `/api/mentions/search`
2. `useMentions` + `MentionDropdown` + `forwardRef` on `Textarea`; repair the
   two existing surfaces
3. Renderer, including the `applyMacros` pass and legacy resolution
4. Remaining web surfaces
5. Notification unification and fan-out
6. Mobile

Each phase is independently shippable. Phase 2 alone fixes the reported bug.

## Customer-facing reads

Three views render text a staff member wrote to an audience that cannot load
the user directory: the customer's view of a service desk request, and the two
portal feature views. These call `stripMentionSyntax` rather than the renderer,
so a mention reads as `@Sarah Chen` instead of raw token syntax — and no
directory fetch is attempted that would 403 for a client.

The activity feed does the same, for a different reason: a description edit
logs its full old and new text, which would otherwise show token syntax in the
timeline.

## Out of scope

- Group and team mentions (`@here`, `@team`) — neither Jira nor Confluence has
  a direct equivalent
- Mention analytics or a "mentions of me" inbox view
- Backfilling existing plain-text mentions
- Muting specific users, proposed by the superseded spec and never built
- A public per-user profile route, which is what a clickable mention badge
  would need (see Renderer above)
