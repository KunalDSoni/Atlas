# Person Mention Notifications — Design Spec

**Date:** 2026-08-06  
**Branch:** `claude/person-mentions-notifications-813374`  
**Status:** Design approved, ready for implementation planning

---

## Overview

Add person mention notifications that alert users when they're tagged with `@mention` in comments or issue descriptions. Extends the existing mention system (already working in comments) to cover issue descriptions and formalize notification preferences.

---

## Scope

### In Scope
- Mention parsing in issue descriptions (`PUT /api/issues/:id`)
- Autocomplete UI for mentions in both comments and descriptions
- Mention highlighting (styled badges in rendered text)
- Notification preferences: global on/off + granular user muting
- Edit-time mention detection (notify on new mentions in edits)
- Respect project membership (only mention users in same project)

### Out of Scope
- Mention-specific database table (reuse notifications table)
- Mention history/analytics pages
- Profile links on mention badges (v2 feature)
- Mention threading or conversation threading
- Email notification customization beyond existing settings

---

## Technical Architecture

### Mention Parsing

**Existing function (no changes):**
```javascript
// backend/utils/notify.js
mentionedUserIds(db, text, authorId)
  // Returns unique user IDs for @mentions in text
  // Matches @First or @First Last (case-insensitive)
  // Excludes author and inactive users
```

**New context:** Apply this function to issue descriptions on create + edit.

### Database Schema

**No schema changes.** Reuse existing tables:

- `notifications` table: stores mention notifications with `type: 'mention'`
- `user_settings` table: add optional `muted_users` JSON array (or NULL)

```sql
-- Already exists, no changes needed:
-- notifications(id, user_id, actor_id, type, message, link, issue_id, created_at, read_at)

-- Optional future enhancement:
-- ALTER TABLE user_settings ADD COLUMN muted_users JSON DEFAULT NULL;
-- e.g., muted_users: ["user-id-1", "user-id-2"]
```

### Notification Flow

#### Comments (already implemented)
```
POST /api/issues/:id/comments
  → mentionedUserIds(body)
  → notify() for each mentioned user
  → SSE broadcast + email delivery
```

#### Issue Descriptions (new)
```
PUT /api/issues/:id
  → Compare old_description vs new_description
  → Extract new mentions (not in old)
  → notify() for each newly mentioned user
  → SSE broadcast + email delivery
```

---

## Frontend Changes

### 1. Mention Autocomplete (Comments + Descriptions)

**Trigger:** User types `@` in editor

**Behavior:**
- Show dropdown with active users in the project
- Filter by typed characters: `@jo` → "John", "Jordan"
- Click name or press Enter to insert `@Full Name`
- ESC to close dropdown
- Up/down arrows to navigate

**Implementation location:** 
- Reusable React component: `frontend/src/components/app/mention-autocomplete.tsx`
- Use in: comment editor + issue description editor

### 2. Mention Display Styling

**In rendered text (comments, descriptions):**
- `@John Smith` → blue badge with slight padding
- CSS class: `.mention` with `color: #0066cc`, `font-weight: 500`, `border-radius: 3px`, `padding: 0 2px`

**Behavior:**
- Hover: show user avatar + name in tooltip
- Click: no-op for now (v2: link to profile)

**Implementation:** Update markdown renderer or rich text component to detect `@user-id` patterns and wrap in styled span.

### 3. Issue Description Editor

**Location:** `frontend/src/screens/issue.tsx` (issue detail panel)

**Changes:**
- Add `<MentionAutocomplete />` wrapper around description textarea
- Apply same mention parsing logic as comments
- Display mentions as badges in preview/rendered view

---

## Backend Changes

### 1. Issue Update Endpoint: `PUT /api/issues/:id`

**File:** `backend/routes/issues.js`

**New logic (pseudo-code):**
```javascript
// After updating description in DB:
const oldIssue = await getOldDescription(); // before update
const newIssue = await getUpdatedIssue();

const oldMentioned = await mentionedUserIds(db, oldIssue.description, req.userId);
const newMentioned = await mentionedUserIds(db, newIssue.description, req.userId);

// Only notify newly mentioned users
const deltaIds = newMentioned.filter(id => !oldMentioned.includes(id));

for (const uid of deltaIds) {
  await notify(db, {
    userId: uid,
    actorId: req.userId,
    type: 'mention',
    message: `${actorName} mentioned you on ${issue.issue_key}`,
    link: issueLink(issue.issue_key),
    issueId: issue.id
  });
}
```

### 2. Notification Preferences (Existing)

**File:** `backend/routes/settings.js`

**Existing fields (no changes needed):**
- `notify_mentions` (boolean) — global on/off for mention notifications
- Email delivery: `email_notifications` toggle

**Future enhancement (not in v1):**
- `muted_users` JSON array in `user_settings` → allows per-user muting

### 3. Comment Endpoint (No Changes)

**File:** `backend/routes/comments.js`

Already handles mention parsing and notification. Ensure it respects `notify_mentions` setting (should already do this via `notify()` function).

---

## Notification Preferences

### User Settings UI

**In `/settings`:**

```
Notifications
  [✓] Email notifications
  [✓] Notify me when assigned
  [✓] Notify me when mentioned  ← NEW TOGGLE
  [✓] Notify me on comments
  [✓] Notify me on status changes

Muted Users (future v2)
  [+ Add user]
  Sarah Chen (remove)
  Alex Rivera (remove)
```

### Behavior

- If `notify_mentions = false`: no notifications, in-app or email
- If `notify_mentions = true`: both in-app (SSE) and email (if SMTP configured)
- Muted users: future feature, skip in v1

---

## Mention Constraints

### Who can be mentioned?

- Active users only (is_active = 1)
- Users in the same project (has role on project)
- Not the author (avoid self-mention)

### Mention Format

- `@First` (case-insensitive) matches first name
- `@First Last` matches full name
- Non-matching text like `@nobody` is left as plain text (no badge)

### Rendering

- In database: stored as-is (`@John Smith`)
- In UI: parsed and rendered as badge element
- In email: plain text with link (no styling)

---

## Data Flow: Full Example

**Scenario:** Kunal edits issue ATLAS-5 description, adding mention of John.

1. **Frontend:**
   - User types "Hey @jo" in description editor
   - Autocomplete shows "John Smith"
   - User clicks → inserts "Hey @John Smith"
   - User clicks Save → `PUT /api/issues/atlas-5`

2. **Backend:**
   - Old description: "Fix the login bug"
   - New description: "Fix the login bug. @John Smith please review."
   - `mentionedUserIds(db, newDesc, kunal_id)` → returns `["john_id"]`
   - `mentionedUserIds(db, oldDesc, kunal_id)` → returns `[]`
   - Delta: `["john_id"]` is new
   - Call `notify(userId: john_id, type: 'mention', message: "Kunal mentioned you on ATLAS-5", link: "/atlas/ATLAS-5")`

3. **Notification System:**
   - Insert into `notifications` table
   - Check `user_settings.notify_mentions` for John → true
   - Broadcast SSE event → bell icon updates on John's open tabs
   - Queue email via SMTP (if configured and John has `email_notifications` on)

4. **Frontend (John's view):**
   - Bell icon shows "1 unread"
   - Click bell → notification list shows "Kunal mentioned you on ATLAS-5"
   - Click notification → navigates to ATLAS-5, highlights the mention in description

---

## Testing Strategy

### Unit Tests (Backend)
- `mentionedUserIds()` with various formats (`@John`, `@john`, `@John Smith`, etc.)
- `notify()` skips self-mentions and respects `notify_mentions` setting
- Issue update extracts delta correctly (old vs new mentions)

### Integration Tests
- Create issue with mention in description → notification created
- Edit issue, add new mention → notification created for new mention only
- Edit issue, remove mention → no new notification
- Mention user not in project → ignored (no badge, no notification)
- Mention inactive user → ignored

### E2E Tests (if time)
- Autocomplete shows correct users in project
- Mention badge renders and is clickable
- Notification appears in bell icon

---

## Success Criteria

- ✅ Mentions work in both comments and descriptions
- ✅ Autocomplete shows project members and filters by name
- ✅ Mentions render as styled badges
- ✅ Mentioned users receive notifications (in-app + email)
- ✅ Users can toggle mention notifications globally
- ✅ Edits with new mentions trigger notifications
- ✅ Self-mentions and inactive users are excluded

---

## Migration / Rollout

- **No data migration needed** — leverages existing notification system
- **Feature flag:** Not needed; safe to deploy
- **Monitoring:** Watch notification creation rate, email delivery logs

---

## Open Questions / Deferred

1. **Muting specific users** — defer to v2 (adds complexity, lower priority)
2. **Mention @ rich text editor** — currently plain text parsing, sufficient for v1
3. **Mention unread badge on profile** — defer to v2

---

## Files to Change

**Backend:**
- `backend/routes/issues.js` — add mention parsing on description update
- `backend/utils/notify.js` — no changes (reuse existing functions)

**Frontend:**
- `frontend/src/components/app/mention-autocomplete.tsx` — new autocomplete component
- `frontend/src/screens/issue.tsx` — integrate autocomplete into description editor
- `frontend/src/screens/settings.tsx` — ensure `notify_mentions` toggle is visible (likely already is)
- `frontend/src/lib/formatting.ts` (or similar) — add mention badge styling to markdown renderer

---

## Effort Estimate

- **Backend:** 1 day (issue update endpoint + tests)
- **Frontend:** 1.5 days (autocomplete + styling + integration)
- **Testing:** 0.5 days (unit + integration tests)
- **Total:** ~2.5 days

---

## Notes for Implementer

- Reuse `mentionedUserIds()` and `notify()` — don't reinvent
- Test mention parsing carefully (edge cases: apostrophes, hyphens in names)
- Ensure autocomplete filters by project membership, not all users
- Email notifications respect existing SMTP configuration
- Mention highlighting must work in both light and dark themes
