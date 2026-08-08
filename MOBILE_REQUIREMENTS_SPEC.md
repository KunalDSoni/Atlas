# Atlas Mobile App - Requirements Specification

**Last Updated:** 2026-08-08  
**Purpose:** Track mobile implementation progress against web/backend capabilities  
**Status:** ~40% Complete - Core navigation & basic features implemented, majority of features pending

---

## 📱 Technology Stack

### Mobile (React Native + Expo)
| Component | Technology | Version |
|-----------|-----------|---------|
| **Framework** | React Native | 0.86.0 |
| **Build Tool** | Expo | ~57.0.8 |
| **Navigation** | React Navigation (Native Stack) | 7.3.14 / 7.18.6 |
| **State Management** | React Query (TanStack) | ^5.101.4 |
| **Language** | TypeScript | ~6.0.3 |
| **Storage** | Expo Secure Store | ~57.0.1 |
| **Testing** | Jest + React Native Testing Library | ^29.7.0 / ^14.0.1 |
| **Authentication** | Custom Auth Context (localStorage/secure store) | - |

### Web (React + TypeScript)
| Component | Technology | Version |
|-----------|-----------|---------|
| **Framework** | React | 18.3.1 |
| **Build Tool** | Vite | ^7.3.6 |
| **Routing** | React Router DOM | ^7.18.1 |
| **Styling** | TailwindCSS | ^4.3.3 |
| **UI Components** | Radix UI | ^1.6.2 |
| **Language** | TypeScript | ^5.9.3 |
| **Testing** | Vitest + Playwright | ^2.0.5 / ^1.61.1 |

### Backend (Node.js)
| Component | Technology |
|-----------|-----------|
| **Runtime** | Node.js |
| **Framework** | Express.js |
| **Database** | PostgreSQL (via Prisma/Knex) |
| **Authentication** | JWT Tokens |

---

## ✅ Mobile Features - IMPLEMENTED

### 1. **Authentication** ✅
- **Login/Logout Flow** - Credential-based auth with JWT
- **Session Management** - Auth context with secure token storage
- **Status:** Basic auth working; token refresh might be pending

**Files:**
- `src/auth/AuthContext.tsx` - Auth state management
- `src/api/auth.ts` - Login endpoint
- `src/screens/LoginScreen.tsx` - Login UI

---

### 2. **Projects Management** ✅
- **View Projects** - List of user's projects
- **Project Details** - Basic project info display
- **Status:** Partial - Can view, cannot create/edit

**Files:**
- `src/screens/ProjectListScreen.tsx` - Project list UI
- `src/api/projects.ts` - Project API calls

---

### 3. **Kanban Board** ✅
- **View Board** - Display issues organized by status columns
- **Drag & Drop** - Move issues between statuses
- **Real-time Updates** - Issues update on status change
- **Status:** Implemented

**Files:**
- `src/screens/BoardScreen.tsx` - Board UI with columns
- `src/components/IssueCard.tsx` - Issue card component
- `src/api/issues.ts` - Issue API calls

---

### 4. **Issue Management** ✅
- **View Issues** - List all issues in project/board
- **Create Issues** - Create new issues with basic fields
- **View Issue Details** - Full issue detail view
- **Edit Issue Details** - Update title, description, assignee
- **Status:** Partial implementation
  - ✅ Can view, create, edit basic fields
  - ❌ Comments not implemented in mobile
  - ❌ Attachments not implemented
  - ❌ Issue linking not implemented
  - ❌ Watchers not implemented

**Files:**
- `src/screens/IssueDetailScreen.tsx` - Issue detail & edit
- `src/screens/CreateIssueScreen.tsx` - Create issue form
- `src/components/StatusPicker.tsx` - Status selection
- `src/components/AssigneePicker.tsx` - Assignee selection
- `src/api/issues.ts` - Issue API calls

---

### 5. **Status & Workflow** ✅
- **View Workflow States** - See available statuses
- **Update Issue Status** - Change issue status on board
- **Status:** Partial - Status update via drag-drop works, hardcoded states

**Files:**
- `src/components/StatusPicker.tsx` - Status selection UI
- `src/api/statuses.ts` - Status API calls

---

### 6. **Team Members** ✅
- **View Project Members** - List team members in project
- **Assign Issues** - Assign issues to team members
- **Status:** Basic implementation

**Files:**
- `src/components/AssigneePicker.tsx` - Assignee selection UI
- `src/api/members.ts` - Members API calls

---

### 7. **Navigation** ✅
- **Bottom Tab Navigation** - Main navigation structure
- **Stack Navigation** - Screen-level navigation
- **Authentication Flow** - Conditional rendering (auth vs main)
- **Status:** Implemented with React Navigation

**Files:**
- `src/navigation/RootNavigator.tsx` - Root navigation structure
- `src/navigation/MainStack.tsx` - Authenticated routes
- `src/navigation/AuthStack.tsx` - Auth routes

---

## ❌ Mobile Features - MISSING

### HIGH PRIORITY (Core Functionality)

| Feature | Web Status | Backend API | Mobile Status | Effort | Notes |
|---------|-----------|-----------|-------|--------|-------|
| **Comments & Discussion** | ✅ Full | ✅ `/api/comments` | ❌ Not implemented | 4-6h | Threaded comments with CRUD |
| **Search** | ✅ Full | ✅ `/api/search` | ❌ Not implemented | 3-4h | Full-text search of issues |
| **Watchers & Followers** | ✅ Full | ✅ `/api/watchers` | ❌ Not implemented | 2-3h | Watch/unwatch issues, get notified |
| **Notifications** | ✅ Partial | ✅ `/api/notifications` | ❌ Not implemented | 3-4h | In-app notification center |
| **Sprints** | ✅ Full | ✅ `/api/sprints` | ❌ Not implemented | 5-7h | View/create sprints, assign issues |
| **Filters & Saved Filters** | ✅ Partial | ✅ `/api/filters` (via search) | ❌ Not implemented | 4-5h | Save/load search filters |
| **Epics** | ✅ Full | ✅ `/api/issues` (epic parent) | ❌ Not implemented | 3-4h | View epics, child issue rollups |
| **Attachments** | ✅ Full | ✅ `/api/attachments` | ❌ Not implemented | 3-4h | Upload/download file attachments |
| **Issue Linking** | ✅ Full | ✅ `/api/links` | ❌ Not implemented | 3-4h | Link related issues |
| **Activity & Audit Trail** | ✅ Full | ✅ `/api/activity` `/api/audit-log` | ❌ Not implemented | 2-3h | View issue change history |
| **Mentions** | ✅ Partial | ✅ `/api/comments` (with mention parsing) | ❌ Not implemented | 3-4h | @mention in comments/descriptions |
| **Labels & Tagging** | ✅ Full | ✅ `/api/issues` (labels field) | ❌ Not implemented | 2-3h | Add/remove labels on issues |
| **Priorities** | ✅ Full | ✅ `/api/issues` (priority field) | ⚠️ Partial | 1-2h | Display/edit priority (UI ready in picker) |
| **Custom Fields** | ✅ Full | ✅ `/api/custom-fields` | ❌ Not implemented | 4-5h | View/edit custom fields per project |

### MEDIUM PRIORITY (Extended Features)

| Feature | Web Status | Backend API | Mobile Status | Effort | Notes |
|---------|-----------|-----------|-------|--------|-------|
| **Releases** | ✅ Full | ✅ `/api/releases` | ❌ Not implemented | 3-4h | Create/view releases |
| **Reports & Analytics** | ✅ Full | ✅ `/api/reports` | ❌ Not implemented | 5-7h | Burndown charts, velocity, dashboards |
| **Workflows** | ✅ Partial | ✅ `/api/workflows` | ❌ Not implemented | 3-4h | Custom workflow state management |
| **Profile & Settings** | ✅ Full | ✅ `/api/profile` `/api/settings` | ❌ Not implemented | 2-3h | User profile, notification preferences |
| **Project Settings** | ✅ Full | ✅ `/api/projects` (settings sub-route) | ❌ Not implemented | 3-4h | Manage project config, members |
| **Activity Feed** | ✅ Full | ✅ `/api/activity` | ❌ Not implemented | 2-3h | Dashboard activity feed |
| **Issue Templates** | ❌ Not in web | N/A | ❌ Not implemented | N/A | Not in roadmap |
| **Offline Mode** | ❌ Not in web | N/A | ❌ Not implemented | 4-5h | Offline issue creation/editing sync |

### LOW PRIORITY (Admin/Advanced)

| Feature | Web Status | Backend API | Mobile Status | Effort | Notes |
|---------|-----------|-----------|-------|--------|-------|
| **Admin Panel** | ✅ Exists | ✅ `/api/admin` | ❌ Not implemented | 4-5h | User management, system settings |
| **AI-Assisted Planning** | ❌ Planned | ✅ `/api/ai` | ❌ Not implemented | N/A | Rovo-like features |
| **Slack Integration** | ❌ Not implemented | ❌ Not implemented | ❌ Not implemented | N/A | Out of scope |
| **Teams Integration** | ❌ Not implemented | ❌ Not implemented | ❌ Not implemented | N/A | Out of scope |
| **Webhooks** | ❌ Admin only | ✅ `/api/webhooks` | ❌ Not implemented | N/A | Out of scope for mobile |
| **Automations** | ✅ Partial | ✅ `/api/automations` | ❌ Not implemented | 3-4h | Auto-transitions, notifications |

---

## 🔌 Backend APIs Available (for Mobile Implementation)

### Authentication & Profile
```
POST   /api/auth/login                    - User login
POST   /api/auth/logout                   - User logout
POST   /api/auth/refresh                  - Refresh JWT token
GET    /api/profile                       - Get current user profile
PUT    /api/profile                       - Update user profile
GET    /api/settings                      - Get user settings
PUT    /api/settings                      - Update user settings
```

### Projects
```
GET    /api/projects                      - List user's projects
POST   /api/projects                      - Create new project
GET    /api/projects/:id                  - Get project details
PUT    /api/projects/:id                  - Update project
DELETE /api/projects/:id                  - Delete project
GET    /api/projects/:id/members          - List project members
POST   /api/projects/:id/members          - Add member to project
```

### Issues
```
GET    /api/issues                        - List issues (with filters)
POST   /api/issues                        - Create new issue
GET    /api/issues/:id                    - Get issue details
PUT    /api/issues/:id                    - Update issue
DELETE /api/issues/:id                    - Delete issue
GET    /api/issues/:id/watchers           - Get watchers on issue
POST   /api/issues/:id/watchers           - Add watcher
DELETE /api/issues/:id/watchers/:userId   - Remove watcher
```

### Comments & Discussion
```
GET    /api/issues/:id/comments           - List comments on issue
POST   /api/issues/:id/comments           - Create new comment
PUT    /api/comments/:id                  - Edit comment
DELETE /api/comments/:id                  - Delete comment
```

### Workflow & Status
```
GET    /api/statuses                      - List workflow statuses
GET    /api/projects/:id/workflows        - Get project workflow
POST   /api/workflows                     - Create workflow
PUT    /api/workflows/:id                 - Update workflow
```

### Attachments
```
POST   /api/issues/:id/attachments        - Upload file attachment
GET    /api/issues/:id/attachments        - List attachments
DELETE /api/attachments/:id               - Delete attachment
```

### Sprints
```
GET    /api/sprints                       - List sprints
POST   /api/sprints                       - Create sprint
GET    /api/sprints/:id                   - Get sprint details
PUT    /api/sprints/:id                   - Update sprint
POST   /api/sprints/:id/issues            - Add issue to sprint
DELETE /api/sprints/:id/issues/:issueId   - Remove issue from sprint
```

### Search & Filters
```
GET    /api/search                        - Full-text search
GET    /api/filters                       - List saved filters
POST   /api/filters                       - Create saved filter
GET    /api/filters/:id                   - Get saved filter
PUT    /api/filters/:id                   - Update saved filter
DELETE /api/filters/:id                   - Delete saved filter
```

### Activity & Audit
```
GET    /api/activity                      - List recent activity
GET    /api/audit-log                     - List audit log entries
GET    /api/issues/:id/activity           - Activity for specific issue
```

### Notifications
```
GET    /api/notifications                 - List notifications
PUT    /api/notifications/:id             - Mark as read
DELETE /api/notifications/:id             - Delete notification
POST   /api/notifications/subscribe       - Subscribe to notifications
```

### Additional APIs
```
GET    /api/links                         - Issue link types
POST   /api/issues/:id/links              - Link issues
DELETE /api/links/:id                     - Delete link

GET    /api/releases                      - List releases
POST   /api/releases                      - Create release
PUT    /api/releases/:id                  - Update release

GET    /api/reports/sprint-burndown       - Sprint burndown data
GET    /api/reports/velocity              - Team velocity data
GET    /api/reports/issue-age             - Issue age analytics

GET    /api/custom-fields                 - List custom fields
POST   /api/custom-fields                 - Create custom field
PUT    /api/custom-fields/:id             - Update custom field
```

---

## 📋 Implementation Roadmap

### Phase 1 - MVP (Core Features) - Weeks 1-2
**Target: ~60% feature parity with web**

- [ ] Comments & Discussion (4-6h)
- [ ] Search Issues (3-4h)
- [ ] Issue Details Full Edit (2-3h)
- [ ] Watchers (2-3h)
- [ ] Labels & Priorities UI (2-3h)
- [ ] **Total: ~13-22h**

### Phase 2 - Extended Features - Weeks 3-4
**Target: ~80% feature parity with web**

- [ ] Sprints (5-7h)
- [ ] Filters & Saved Searches (4-5h)
- [ ] Notifications (3-4h)
- [ ] Activity Feed (2-3h)
- [ ] Attachments (3-4h)
- [ ] **Total: ~17-23h**

### Phase 3 - Advanced Features - Weeks 5-6
**Target: ~95% feature parity with web**

- [ ] Epics & Roadmap (3-4h)
- [ ] Issue Linking (3-4h)
- [ ] Reports & Analytics (5-7h)
- [ ] Custom Fields (4-5h)
- [ ] Settings & Profile (2-3h)
- [ ] **Total: ~17-23h**

### Phase 4 - Polish & Optimization
- [ ] Offline mode (4-5h)
- [ ] Performance optimization
- [ ] Comprehensive testing
- [ ] App store submission

---

## 🧪 Testing Status

### Unit Tests
- ✅ Auth context tests
- ✅ API client tests
- ✅ Navigation tests
- ⚠️ Component tests - Basic coverage
- ❌ Screen tests - Limited coverage
- ❌ Integration tests - Missing

### E2E Tests
- ❌ None implemented yet
- Recommendation: Add Detox or similar for E2E after MVP

---

## 📊 Feature Completion Summary

| Category | Implemented | Partial | Missing | % Complete |
|----------|------------|---------|---------|-----------|
| **Authentication** | 1 | 0 | 0 | 100% |
| **Projects** | 1 | 1 | 1 | 33% |
| **Issues** | 3 | 3 | 2 | 60% |
| **Collaboration** | 0 | 0 | 5 | 0% |
| **Navigation** | 2 | 1 | 0 | 67% |
| **Workflow** | 0 | 1 | 1 | 25% |
| **Reporting** | 0 | 0 | 3 | 0% |
| **Admin** | 0 | 0 | 2 | 0% |
| **TOTAL** | 7 | 6 | 14 | ~40% |

---

## 🚀 Next Steps

1. **Priority 1:** Implement Comments (high-demand feature)
2. **Priority 2:** Add Search functionality
3. **Priority 3:** Implement Watchers & Notifications
4. **Priority 4:** Add Sprint management
5. **Priority 5:** Implement Filters & saved searches

---

## 📝 Notes

- Mobile should mirror web functionality but with touch-optimized UX
- Use React Native-specific components instead of web equivalents
- Consider performance on lower-end devices (optimize list rendering)
- Secure storage for tokens using Expo Secure Store
- Test on both iOS simulator and Android emulator
- Consider offline sync capability for better UX on poor connections

---

**Created:** 2026-08-08  
**Last Modified:** 2026-08-08
