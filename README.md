# Atlas — Project Management

A full-stack Jira clone with Kanban boards, sprint management, role-based access control, and comprehensive dashboards. Built with React, Node.js, and modular API architecture for extensibility.

**Feature Status:** See [JIRA_FEATURE_COMPARISON.md](docs/JIRA_FEATURE_COMPARISON.md) for detailed feature matrix (35+ completed, 15+ in progress, 30+ planned).

## Quick Start

**Option A: Self-contained (no server needed)**
Open `atlas.html` directly in your browser. All data is in-memory and resets on refresh.

**Option B: Full-stack with database**
```bash
# 1. Build the frontend (Vite + React + TypeScript + Tailwind + shadcn/ui)
cd frontend && npm install && npm run build

# 2. Run the backend, which serves the built app
cd ../backend && npm install && node server.js
# Open http://localhost:3001
```

For frontend development with hot reload, run the backend and then
`cd frontend && npm run dev` — Vite proxies `/api` to port 3001.

### The public landing page

`/` serves a public marketing page to signed-out visitors and redirects
signed-in users to `/dashboard`. `/login` is still the sign-in form; it is
just no longer the front door.

To enable the one-click demo button, set `DEMO_EMAIL` (see `.env.example`).
The demo account is created with role `user`, and its workspace re-seeds on
the first visit after `DEMO_RESET_HOURS`. Leaving `DEMO_EMAIL` unset disables
`POST /api/auth/demo` entirely, and the button falls back to `/login`.

## Feature Overview

### ✅ Fully Implemented
- **Core Board & Sprint Management** — Kanban boards, sprint planning, drag-and-drop issue movement
- **Issue Tracking** — Create, edit, search issues with full history and audit trail
- **User & Permission Management** — Role-based access control (Admin, Board Admin, User, Client)
- **Comments & Collaboration** — Issue comments with threading and permissions
- **Attachments & Linking** — File uploads and issue relationship linking
- **Epics & Roadmaps** — Portfolio view with epic-to-issue hierarchy
- **Reporting** — Sprint burndown, velocity tracking, issue status reports
- **Wiki & Documentation** — Wiki pages, spaces, and attachments
- **Product Management** — Features, outcomes, objectives, roadmap, themes, customer management
- **Service Desk Basics** — Request types, queues, SLA tracking, customer portal
- **API & Webhooks** — RESTful API with webhook support for event notifications
- **Admin Dashboard** — User counts, project counts, role breakdown, audit logs

### 🚧 Partially Implemented
- **Board Customization** — Columns fixed to workflow states; swimlanes/grouping not yet available
- **Automation** — Manual workflow transitions work; automatic triggers and conditions incomplete
- **Notifications** — Watchers tracked; email/in-app delivery rules need development
- **Filters** — Basic filtering works; saved filter persistence unclear
- **Goal Alignment** — OKRs exist but issue-to-goal linking incomplete
- **Time Tracking** — Worklog CRUD exists; reporting needs work
- **Mobile App** — Separate Expo project (see `mobile/README.md`); feature parity needs verification

### ❌ Not Yet Implemented
- **AI-Assisted Planning** — No Rovo AI features (auto-assign, task breakdown, priority suggestions)
- **OAuth/SSO** — No Google, GitHub, Microsoft login integrations
- **Third-Party Integrations** — Slack, GitHub, Figma, Confluence not integrated
- **No-Code Automation Builder** — Drag-and-drop rule creation UI not built
- **Advanced Metrics** — Cycle time, escape rate, defect density reports missing
- **Real-Time Updates** — WebSocket real-time dashboard updates not implemented
- **Custom Dashboards** — Dashboard builder and widget system not available
- **LDAP Sync** — No corporate directory integration
- **Data Export** — CSV export and backup functionality not yet available

## Mobile app

The `mobile/` directory contains an Expo (React Native) app that talks to this repo's backend API. See `mobile/README.md` (or the phase 1 plan under `docs/superpowers/plans/`) for setup.

To build an installable Android APK for testing:

```bash
cd mobile
npx eas build --platform android --profile preview
```

This requires an Expo account (`npx eas login`) the first time it's run.

## Default Credentials

⚠️ **Demo data only.** These accounts are seeded when `SEED_DEMO_DATA=true` and all share
a published password. Set `SEED_DEMO_DATA=false` for any real deployment — see
[SECURITY.md](SECURITY.md).

All demo accounts use password: `password123`

| Name | Email | Role |
|------|-------|------|
| Kunal Soni | kunal@example.com | Admin |
| Sarah Chen | sarah@example.com | Board Admin |
| Alex Rivera | alex@example.com | User |
| Priya Patel | priya@example.com | Client |
| James Wilson | james@example.com | User |

## Going Live (first run on a real deployment)

With `SEED_DEMO_DATA=false` — which is what `render.yaml` sets, and what any real
deployment should use — **none of the accounts above exist**. The database boots
with exactly one user, built from these variables:

| Variable | Purpose |
|---|---|
| `ADMIN_EMAIL` | the only account that exists on first boot — sign in with this |
| `ADMIN_PASSWORD` | its password; change it after the first login |
| `ADMIN_NAME` | display name |
| `SESSION_SECRET` | signs sessions; must be set and must not be the dev default |
| `DB_DRIVER` + `MYSQL_*` (or `DATABASE_URL`) | where the data lives |

Sign in as `ADMIN_EMAIL` and you land on an empty dashboard with a **Create
project** button, in the sidebar switcher and in the dashboard zero state. Create
the first project there; every other screen stays empty until one exists. Project
creation requires the `admin` or `board_admin` role, matching
`requireBoardAdmin` on `POST /api/projects`.

To verify this path before shipping, run `cd frontend && npm run test:e2e:empty` —
it boots the real backend unseeded and drives the first-run flow in a browser.

## Testing

| Command | Scope |
|---|---|
| `cd backend && npm test` | jest — backend routes and frontend logic |
| `cd frontend && npm run test:e2e` | Playwright against a **seeded** instance |
| `cd frontend && npm run test:e2e:empty` | Playwright against a **fresh install** (zero projects) |
| `cd frontend && npm run lint` | `tsc -b --noEmit` |

All four run in CI on every push and PR to `main`.

## Project Structure

```
atlas/
├── atlas.html              # Self-contained single-file version
├── backend/
│   ├── server.js           # Express server (modular route imports)
│   ├── database.js         # SQLite schema + seed data
│   ├── migrations.js       # Ordered schema migrations (sqlite + mysql)
│   ├── package.json
│   ├── middleware/
│   │   └── auth.js         # Auth middleware (session token only)
│   └── routes/
│       ├── auth.js          # POST /login, /logout, GET /me
│       ├── users.js         # CRUD user management (admin)
│       ├── profile.js       # GET/PUT profile, password, email
│       ├── settings.js      # GET/PUT user preferences
│       ├── projects.js      # CRUD projects + members + stats
│       ├── sprints.js       # CRUD sprints with issue stats
│       ├── issues.js        # CRUD issues + move + epics
│       ├── comments.js      # CRUD comments (author/admin permissions)
│       └── admin.js         # Admin dashboard stats
└── frontend/               # Vite + React + TypeScript + Tailwind + shadcn/ui
    ├── components.json     # shadcn/ui config
    ├── src/
    │   ├── main.tsx        # entry
    │   ├── App.tsx         # routing + providers
    │   ├── index.css       # design tokens (light + dark)
    │   ├── components/ui/  # shadcn/ui components
    │   ├── components/app/ # Atlas components (shell, charts, dialogs)
    │   ├── context/        # auth + theme providers
    │   ├── hooks/          # shared data hooks
    │   ├── lib/            # api client, types, domain, formatting
    │   └── screens/        # one file per screen
    └── build/              # Vite output — served by the backend
```

## URLs

Every project screen and every issue has a permanent, shareable URL. The project
key is the first path segment and is the source of truth for which project is
open — `/atlas/board` means project ATLAS whoever opens it.

```
/                        → the remembered project's board
/atlas                   → /atlas/board
/atlas/board             /atlas/backlog    /atlas/epics
/atlas/roadmap           /atlas/sprints    /atlas/releases
/atlas/reports           /atlas/automation /atlas/servicedesk/*
/atlas/ATLAS-3           an issue of any type — epic, story, task or bug

/dashboard  /product/*  /wiki/*  /portal  /admin/*  /profile  /settings
```

Issue keys match `^[A-Z][A-Z0-9]*-\d+$` and screen segments are lowercase, so
`/atlas/board` and `/atlas/ATLAS-3` never collide and there is no reserved-word
list to maintain. Type is deliberately *not* in the path: an issue's type is
mutable, so a `/task/ATL-3` URL would break on an ordinary edit.

Clicking a card opens the drawer and pushes the issue's URL; pasting that URL
into a fresh tab renders the full page instead. Both are the same route and the
same component — the difference is only whether history state carries a
`background` location to layer over.

**Two files spell routes, and nothing else does:** `frontend/src/lib/urls.ts`
and `backend/utils/links.js`. Build links through them.

Project keys are frozen after creation. `issue_key` is denormalised and every
shared link embeds the key, so a rename would strand both.

Pre-scheme paths (`/board`, `/board?issue=<uuid>`, …) still resolve — old
notification rows and bookmarks hold them. See `components/app/legacy-redirect.tsx`.

## API Reference

### Auth Module
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Login with email/password |
| POST | `/api/auth/logout` | Logout (invalidate session) |
| GET | `/api/auth/me` | Get current user from session |

### Users Module (Admin)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users` | List all users |
| POST | `/api/users` | Create user |
| GET | `/api/users/:id` | Get user by ID |
| PUT | `/api/users/:id` | Update user |
| DELETE | `/api/users/:id` | Deactivate user |

### Profile Module
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/profile` | Get profile with stats & projects |
| PUT | `/api/profile` | Update profile fields |
| PUT | `/api/profile/password` | Change password |
| PUT | `/api/profile/email` | Change email |

### Settings Module
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/settings` | Get user preferences |
| PUT | `/api/settings` | Update preferences |

### Projects Module
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects` | List projects with counts |
| POST | `/api/projects` | Create project |
| PUT | `/api/projects/:id` | Update project |
| DELETE | `/api/projects/:id` | Delete project (cascade) |
| GET | `/api/projects/:id/stats` | Dashboard statistics |
| GET | `/api/projects/:id/members` | List members |
| POST | `/api/projects/:id/members` | Add member |
| PUT | `/api/projects/:id/members/:userId` | Update member role |
| DELETE | `/api/projects/:id/members/:userId` | Remove member |

### Sprints Module
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects/:id/sprints` | List sprints with stats |
| POST | `/api/projects/:id/sprints` | Create sprint |
| GET | `/api/sprints/:id` | Get sprint |
| PUT | `/api/sprints/:id` | Update sprint (completed: name/goal only) |
| POST | `/api/sprints/:id/reopen` | Reopen a completed sprint (board admin, requires `end_date`) |
| DELETE | `/api/sprints/:id` | Delete a planning sprint (issues → next open sprint, else backlog) |

#### Sprint lifecycle rules

Atlas follows Jira's sprint rules, and enforces them on the server for every
caller — session or personal API token alike. Scripts get the same answers the
UI does:

| Attempt | Response |
|---|---|
| Assign an issue to a **completed** sprint (`POST`/`PUT` issue, `PUT` move) | **409** — reopen the sprint first |
| Change a completed sprint's dates or status via `PUT` | **409** — reopen it first |
| Rename a completed sprint, or edit its goal | **200** |
| Delete an **active** or **completed** sprint | **409** — complete it, or leave it closed |
| Reopen while another sprint in the project is active | **409** |

Moving an issue *out* of a completed sprint, or to the backlog, is always
allowed — only new work into a closed sprint is refused. Resubmitting an issue's
unchanged `sprint_id` is not treated as a new assignment, so editing other fields
on work that sits in a completed sprint keeps working.

#### Automatic sprint scheduling

Sprints run on a fixed calendar in every project. There is no setting:

| Window | Runs |
|---|---|
| First | the 1st through the 15th |
| Second | the 16th through the last day of the month |

Atlas creates each window's sprint, activates it when the window opens, completes
the outgoing one, and moves unfinished work into the incoming sprint. An issue
leaves a closing sprint when it is unfinished **or** still has an unfinished
subtask — which is also what keeps the "finish the subtasks first" rule above
satisfiable rather than deadlocking the handover. Every rule in the table above
still applies; nothing about completing or reopening a sprint by hand changes.

Sprints you create yourself keep working alongside the generated ones. A manual
sprint left in `planning` is untouched; a manual sprint that is *active* when a
window opens is completed like any other outgoing sprint, since only one sprint
can be active at a time.

Two details worth knowing:

- **There is no cron.** Atlas reconciles against the calendar on the next read of
  a sprint endpoint, so a boundary takes effect the first time someone opens the
  board or the sprints screen after it passes — not at midnight exactly.
- **Boundaries are IST** (`Asia/Kolkata`). A window turns over at local midnight
  there — the 16th begins when the team's day does, not at 05:30. It is one
  constant, `SPRINT_TIMEZONE` in `backend/utils/sprint-windows.js`; projects
  carry no timezone of their own (it lives on users), so that constant is what a
  per-project setting would replace.

Generated sprints are marked by `sprints.auto_key` (`2026-09-1`); a null means a
person made it. Every automatic action is in the audit log under the actor
`Atlas scheduler`, with the number of issues it moved.

### Issues Module
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects/:id/issues` | List issues (?sprint_id= filter) |
| POST | `/api/projects/:id/issues` | Create issue |
| GET | `/api/issues/:id` | Get issue with enriched data (adds `previous_sprints`) |
| PUT | `/api/issues/:id` | Update issue fields |
| DELETE | `/api/issues/:id` | Delete issue (cascade comments) |
| PUT | `/api/issues/:id/move` | Move issue (drag & drop) |
| GET | `/api/projects/:id/epics` | List epics with child rollups (counts + points) |
| GET | `/api/issues/:id/children` | List an epic's child issues |

### Comments Module
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/issues/:id/comments` | List comments |
| POST | `/api/issues/:id/comments` | Add comment |
| PUT | `/api/comments/:id` | Edit comment (author/admin) |
| DELETE | `/api/comments/:id` | Delete comment (author/admin) |

### Admin Module
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/stats` | User counts, project counts, role breakdown |

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS v4 + shadcn/ui (light & dark)
- **Backend**: Node.js + Express 5
- **Database**: sql.js (SQLite) for local dev, MySQL for production — set `DB_DRIVER`
- **Auth**: Session tokens (`x-auth-token`), scrypt-hashed passwords

## Schema changes

The baseline tables live in `SCHEMA_SQL` / `MYSQL_SCHEMA_SQL` in `backend/database.js`.
Everything after that goes in `backend/migrations.js` as a new entry appended to the
`MIGRATIONS` array — never edit or reorder an id that has already shipped.

Each migration declares both a `sqlite` and a `mysql` form and runs once, tracked in
the `schema_migrations` table. The runner applies pending migrations automatically on
startup, so you no longer need to delete `data.db` when the schema changes.

## Development Roadmap

### Phase 1: Core Completion (Foundation)
1. **Board Customization** — Add swimlanes, grouping by assignee/epic, configurable columns
2. **Filter Persistence** — Save and load custom filter views
3. **Automation Triggers** — Event-based actions (on status change, on assignment, etc.)
4. **Mobile Feature Parity** — Ensure Expo app matches web feature set

### Phase 2: Collaboration & Automation (Engagement)
1. **Notification Rules** — Email/in-app delivery, configurable per project
2. **Slack Integration** — Create issues, update status, post notifications
3. **Automation Builder UI** — No-code workflow builder
4. **Real-Time Updates** — WebSocket support for live dashboard and board updates

### Phase 3: Intelligence & Insights (Value)
1. **AI-Assisted Planning** — Task breakdown, assignee suggestions using LLM
2. **Advanced Metrics** — Cycle time, escape rate, defect density, burnup charts
3. **Trend Detection** — Identify bottlenecks, at-risk items, velocity trends
4. **Custom Dashboards** — Draggable widgets, user-saved views

### Phase 4: Enterprise & Compliance (Scale)
1. **OAuth/SSO** — Google, GitHub, Microsoft, SAML integrations
2. **LDAP Sync** — Corporate directory user sync
3. **Data Compliance** — GDPR/CCPA controls, data residency options
4. **Backup & Export** — Project backup, CSV/PDF export, audit log export

See [JIRA_FEATURE_COMPARISON.md](docs/JIRA_FEATURE_COMPARISON.md) for complete feature matrix with status.

## Security

Authenticate by sending the token from `POST /api/auth/login` as `x-auth-token`.
Identity and role come from that session only — `x-user-id` / `x-user-role` are ignored.

Read [SECURITY.md](SECURITY.md) before deploying: it covers the security model, a
deployment hardening checklist, how to report a vulnerability, and known limitations.

## Roles & Permissions

| Permission | Admin | Board Admin | User | Client |
|-----------|-------|-------------|------|--------|
| Manage users | ✅ | ❌ | ❌ | ❌ |
| Create projects | ✅ | ❌ | ❌ | ❌ |
| Manage sprints | ✅ | ✅ | ❌ | ❌ |
| Create issues | ✅ | ✅ | ✅ | ❌ |
| Drag & drop issues | ✅ | ✅ | ✅ | ❌ |
| View board | ✅ | ✅ | ✅ | ✅ |
