# Person Mention Notifications — Remaining Tasks

**Status:** 4 of 7 tasks complete. 3 critical tasks remaining.

**Last Updated:** 2026-08-06

---

## Completed Tasks ✅

- **Task 2:** Frontend mention autocomplete component
- **Task 4:** Mention badge styling (light/dark themes)
- **Task 5:** Comment editor autocomplete integration
- **Task 6:** Settings UI notify_mentions toggle

---

## Remaining Tasks ❌

### Task 1: Backend — Add mention detection to issue update endpoint

**Priority:** CRITICAL

**Description:**  
Add backend logic to detect @mentions in issue descriptions, compare old vs new mentions, and send notifications for newly mentioned users.

**Files to modify:**
- `backend/routes/issues.js` — Add mention delta detection in `PUT /api/issues/:id`
- `backend/utils/notify.js` — Add `mentionedUserIdsInProject(db, text, authorId, projectId)` helper
- `backend/tests/backend/issues.mentions.test.js` — Add test suite (9+ tests)

**What needs to be implemented:**
1. Helper function to filter mentions by project membership
2. Mention delta logic: compare old description mentions vs new mentions
3. Notification dispatch for newly mentioned users only
4. Respect project scoping (only mention project members)
5. Exclude self-mentions and inactive users
6. Full test coverage with edge cases

**Why it matters:**  
Without this, users won't receive notifications when mentioned in issue descriptions. The feature will be incomplete.

**Estimated effort:** 4-6 hours

---

### Task 3: Frontend — Integrate autocomplete into description editor

**Priority:** CRITICAL

**Description:**  
Wrap the issue description textarea with the MentionAutocomplete component to enable @mention autocomplete when users edit descriptions.

**Files to modify:**
- `frontend/src/screens/issue.tsx` or the issue detail component containing the description editor

**What needs to be implemented:**
1. Import `MentionAutocomplete` component
2. Wrap description textarea with the component
3. Pass props: `projectId={issue.project_id}`, `authorId={currentUserId}`
4. Verify autocomplete appears when typing `@`
5. Test mention insertion works correctly

**Why it matters:**  
Currently users can only mention in comments, not in descriptions. This is 50% of the intended mention UX.

**Estimated effort:** 1-2 hours

---

### Task 7: End-to-end testing and validation

**Priority:** HIGH

**Description:**  
Comprehensive end-to-end testing of the full mention workflow to validate all functionality works correctly across the application.

**Testing checklist:**

**Description mentions:**
- [ ] User can type @ in description editor and see autocomplete
- [ ] Selecting a user inserts mention into description
- [ ] Mention displays as blue badge when description is saved
- [ ] Mentioned user receives notification

**Comment mentions:**
- [ ] User can type @ in comment editor and see autocomplete
- [ ] Selecting a user inserts mention into comment
- [ ] Mention displays as blue badge when comment is posted
- [ ] Mentioned user receives notification

**Badge styling:**
- [ ] Badges display correctly in light theme (blue #0066cc)
- [ ] Badges display correctly in dark theme (lighter blue #579dff)
- [ ] Badges have proper hover effects

**Notification settings:**
- [ ] Settings page shows "Notify me when mentioned" toggle
- [ ] Toggle OFF → no mention notifications received
- [ ] Toggle ON → mention notifications resume
- [ ] Setting persists across sessions

**Edge cases:**
- [ ] Inactive users don't appear in autocomplete
- [ ] Self-mentions don't appear in autocomplete
- [ ] Users from other projects don't appear in autocomplete
- [ ] Multiple mentions in single comment/description all render as badges
- [ ] Editing description to add new mention triggers notification only for new mentions

**Why it matters:**  
Ensures the feature works end-to-end without regressions or breaking changes.

**Estimated effort:** 2-3 hours

---

## Summary

| Task | Status | Effort | Impact |
|------|--------|--------|--------|
| Task 1 (Backend detection) | ❌ Missing | 4-6h | CRITICAL - No notifications on description mentions |
| Task 3 (Description editor) | ❌ Missing | 1-2h | CRITICAL - No autocomplete in descriptions |
| Task 7 (E2E testing) | ⚠️ Incomplete | 2-3h | HIGH - No validation of full workflow |

**Total remaining effort:** ~8-11 hours

**Current feature completion:** ~60% (comments work fully, descriptions lack autocomplete and backend notification)

---

## Notes

- Tasks 1 & 3 are blocking completion of the feature
- Task 7 is for validation and quality assurance
- All other tasks (2, 4, 5, 6) have been completed and merged to main
- Test suite passes (797 tests) with current implementation
