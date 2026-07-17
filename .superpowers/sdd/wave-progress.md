# Parity Wave — Epics 3-12 (user directive 2026-07-17: build all epics, testing AFTER all are done, autonomous decisions, push continuously)

Branch: feature/parity-epics (from dev @ e833b4e). Per-epic: implement backend+frontend, tsc+build must pass, commit+push, mark ATLAS-N done in seed w/ 3-5 done children. NO test-writing per epic; full testing phase at the end (fix suites, new suites, e2e, then merge to dev).

Scopes (locked by controller):
- E3 search/filters: GET /api/search (issues+wiki LIKE), palette server search, backlog filter bar (type/assignee/label), saved_filters table+CRUD+UI. [x]
- E4 notifications: notifications table+API (list/unread/mark), header bell inbox, triggers: assign, comment on watched, @mention parse; wiki_page_watchers + page-update notify. [x]
- E5 time tracking: work_logs table+API, detail-sheet Time section (estimate edit, log work, spent/remaining bar from original_estimate/time_spent). [x]
- E6 releases/components: versions+components tables+CRUD, issues.fix_version_id/component_id (idempotent ALTERs), Releases screen w/ per-version rollup, pickers in detail sheet. [x]
- E7 roadmap: issues.start_date ALTER (epics), /roadmap screen: month-grid timeline, epic bars (start_date..due_date fallback created..+30d), sprint bars. [ ]
- E8 board power-ups: swimlanes (none/assignee/epic), WIP limits (projects.wip_limits JSON, header count/limit + red), bulk edit (multi-select + set status/assignee/delete). [ ]
- E9 custom workflows: project_statuses table (key,label,category todo|in_progress|done,position), defaults seeded, project settings editor, board/backlog/sheet read dynamic statuses; category drives done-rollups. [ ]
- E10 automation: automation_rules table (trigger,conditions,actions JSON), engine on create/status-change/all-subtasks-done, actions set_status/set_assignee/add_label/notify, project Automation screen builder. [ ]
- E11 wiki collab: wiki comment quote anchoring (comment on selection), wiki_page_restrictions (view/edit per user)+API enforcement+restrict dialog. [ ]
- E12 wiki publishing: export MD/HTML endpoints+menu, macros (TOC from headings, ATLAS-123 issue chips), blog posts (wiki_pages.page_type + space Blog tab). [ ]

Testing phase at end: update epics.test.js todo-count, run+fix all suites, new suites per epic area, build, e2e, merge dev, update memory.
