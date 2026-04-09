# Atlas — Project Management

A full-stack Jira clone with Kanban boards, sprint management, role-based access control, and real-time dashboards.

## Quick Start

**Option A: Self-contained (no server needed)**
Open `atlas.html` directly in your browser. All data is in-memory and resets on refresh.

**Option B: Full-stack with database**
```bash
cd backend
npm install
node server.js
# Open http://localhost:3001
```

## Default Credentials

All accounts use password: `password123`

| Name | Email | Role |
|------|-------|------|
| Kunal Soni | kunal@example.com | Admin |
| Sarah Chen | sarah@example.com | Board Admin |
| Alex Rivera | alex@example.com | User |
| Priya Patel | priya@example.com | Client |
| James Wilson | james@example.com | User |

## Project Structure

```
atlas/
├── atlas.html              # Self-contained single-file version
├── backend/
│   ├── server.js           # Express server (modular route imports)
│   ├── database.js         # SQLite schema + seed data
│   ├── package.json
│   ├── middleware/
│   │   └── auth.js         # Auth middleware (session token + legacy headers)
│   └── routes/
│       ├── auth.js          # POST /login, /logout, GET /me
│       ├── users.js         # CRUD user management (admin)
│       ├── profile.js       # GET/PUT profile, password, email
│       ├── settings.js      # GET/PUT user preferences
│       ├── projects.js      # CRUD projects + members + stats
│       ├── sprints.js       # CRUD sprints with issue stats
│       ├── issues.js        # CRUD issues + move (drag & drop)
│       ├── comments.js      # CRUD comments (author/admin permissions)
│       └── admin.js         # Admin dashboard stats
└── frontend/
    └── build/
        └── index.html       # React SPA (served by backend)
```

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
| PUT | `/api/sprints/:id` | Update sprint |
| DELETE | `/api/sprints/:id` | Delete sprint (issues → backlog) |

### Issues Module
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects/:id/issues` | List issues (?sprint_id= filter) |
| POST | `/api/projects/:id/issues` | Create issue |
| GET | `/api/issues/:id` | Get issue with enriched data |
| PUT | `/api/issues/:id` | Update issue fields |
| DELETE | `/api/issues/:id` | Delete issue (cascade comments) |
| PUT | `/api/issues/:id/move` | Move issue (drag & drop) |

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

- **Frontend**: React 18 + Babel (single HTML, no build step)
- **Backend**: Node.js + Express 5
- **Database**: sql.js (SQLite in-memory with file persistence)
- **Auth**: Session-based with token headers

## Roles & Permissions

| Permission | Admin | Board Admin | User | Client |
|-----------|-------|-------------|------|--------|
| Manage users | ✅ | ❌ | ❌ | ❌ |
| Create projects | ✅ | ❌ | ❌ | ❌ |
| Manage sprints | ✅ | ✅ | ❌ | ❌ |
| Create issues | ✅ | ✅ | ✅ | ❌ |
| Drag & drop issues | ✅ | ✅ | ✅ | ❌ |
| View board | ✅ | ✅ | ✅ | ✅ |
