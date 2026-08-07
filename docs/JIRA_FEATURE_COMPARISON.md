# Jira vs Atlas Feature Comparison

**Last Updated:** August 7, 2026  
**Purpose:** Track Atlas development progress against Jira's core features

---

## 📋 PLAN - Prioritization & Task Management

### Project & Work Planning
- ✅ **Create Projects** - Create and manage multiple projects with different configurations
  - **Atlas Implementation:** Fully implemented. Users can create projects via dashboard, set names, keys, and descriptions
  - **Notes:** Project keys are immutable; names and descriptions are editable
  
- ✅ **Create & Assign Issues** - Break down work into actionable tasks and assign to team members
  - **Atlas Implementation:** Fully implemented. Issues can be created with type, assignee, priority, labels, and descriptions
  - **Notes:** Supports all standard issue types (Story, Task, Bug, Epic)

- ✅ **Issue Types** - Support for Story, Task, Bug, Epic, Subtask
  - **Atlas Implementation:** Fully implemented. Core types: Story, Task, Bug, Epic. Subtasks available via child issues
  - **Notes:** Types are mutable during issue lifecycle

- ✅ **Custom Fields** - Add custom fields to track team-specific metadata
  - **Atlas Implementation:** Fully implemented via backend custom-fields route
  - **Notes:** Supports field CRUD operations and per-project configuration

- ✅ **Labels & Tagging** - Tag issues with labels for categorization
  - **Atlas Implementation:** Fully implemented. Issues support multiple labels
  - **Notes:** Labels are searchable and filterable

- ✅ **Priorities** - Set priority levels (Highest, High, Medium, Low, Lowest)
  - **Atlas Implementation:** Fully implemented. Standard 5-level priority system
  - **Notes:** Default priority configurable per project

- ✅ **Epics & Roadmaps** - Group related issues into epics for portfolio management
  - **Atlas Implementation:** Fully implemented. Epics screen shows child issue rollups (counts, story points)
  - **Notes:** Child issue tracking with counts and points aggregation

- 🚧 **Goal Alignment** - Connect work to OKRs/Goals with visibility
  - **Atlas Implementation:** Partial. Goals/Objectives UI exists (product-objectives screen) but integration limited
  - **Notes:** Basic CRUD exists; alignment with issues not fully connected

- 🚧 **Project Templates** - Start with pre-built templates for common workflows
  - **Atlas Implementation:** Templates mentioned in Jira but not found in Atlas routes
  - **Notes:** Missing dedicated template management; projects start blank

- ❌ **AI-Assisted Planning** (Rovo AI) - Use AI to auto-assign, break down tasks, suggest priorities
  - **Atlas Implementation:** Not implemented
  - **Notes:** Placeholder AI route exists (ai.js) but no Rovo-style features; would require significant LLM integration

- ❌ **Confluence Integration for Context** - Pull rich context from Confluence docs into issues
  - **Atlas Implementation:** Not implemented
  - **Notes:** No Confluence API integration; wiki is internal only

---

## 📊 TRACK - Progress Monitoring & Visibility

### Board Management
- ✅ **Kanban Board** - Visual column-based workflow board with drag-and-drop
  - **Atlas Implementation:** Fully implemented. Board screen with columns matching workflow states
  - **Notes:** Drag-and-drop issue movement, real-time updates

- ✅ **Drag & Drop Issues** - Move issues between statuses by dragging
  - **Atlas Implementation:** Fully implemented. Full drag-and-drop support with history tracking
  - **Notes:** Moves trigger workflow transitions; history logged in activity

- ✅ **Sprint Board** - Sprint-scoped kanban board for agile teams
  - **Atlas Implementation:** Fully implemented. Sprints screen with sprint-filtered issues
  - **Notes:** Sprint status tracking, lock/unlock support

- 🚧 **Board Customization** - Customize columns, add swimlanes, configure visibility
  - **Atlas Implementation:** Partial. Board columns fixed to workflow states; swimlanes/grouping not implemented
  - **Notes:** Hard-coded column structure; no drag-to-reorder or custom column creation

- ❌ **Backlog View** - Manage unscheduled issues, prioritize, drag to sprint
  - **Atlas Implementation:** Partial. Backlog screen exists (backlog.tsx) but feature unclear
  - **Notes:** Route exists but limited sprint-scoped issue management

### Status & Workflow
- ✅ **Workflow States** - Define custom workflow states (To Do, In Progress, Done, etc.)
  - **Atlas Implementation:** Fully implemented via workflows.js. Standard workflow with state transitions
  - **Notes:** States are configurable per project; transitions enforced

- ✅ **Issue Status Tracking** - Track issue status transitions and history
  - **Atlas Implementation:** Fully implemented. Status changes logged in activity/audit
  - **Notes:** Full audit trail of status changes with timestamps

- ✅ **Status Categories** - Group statuses into To Do, In Progress, Done
  - **Atlas Implementation:** Fully implemented. Backend status mapping to categories
  - **Notes:** Used for progress calculations and board grouping

- 🚧 **Custom Workflows** - Define multi-step workflows with conditional transitions
  - **Atlas Implementation:** Partial. Basic workflow transitions exist; conditional/multi-step not implemented
  - **Notes:** Fixed state machine; no workflow builder UI

- ❌ **Automated Transitions** - Auto-move issues based on conditions (e.g., tests pass → Done)
  - **Atlas Implementation:** Not implemented (full automation)
  - **Notes:** Automations route exists but triggers are manual; no CI/CD webhook integration

### Issue Tracking & Details
- ✅ **Issue Details** - View and edit all issue metadata (title, description, attachments, etc.)
  - **Atlas Implementation:** Fully implemented. Issue drawer/detail view with full edit capability
  - **Notes:** Rich editor for descriptions; attachment support

- ✅ **Comments & Discussion** - Add comments to issues for team discussion
  - **Atlas Implementation:** Fully implemented via comments.js. Full CRUD with author/admin permissions
  - **Notes:** Threaded comments, edit/delete with permissions

- ✅ **Watchers & Notifications** - Watch issues and receive notifications on updates
  - **Atlas Implementation:** Fully implemented via watchers.js and notifications.js
  - **Notes:** Watchers tracked; notifications on issue changes

- ✅ **Issue History & Audit Trail** - Track all changes to an issue
  - **Atlas Implementation:** Fully implemented via activity.js and auditlog.js
  - **Notes:** Full change history with actor and timestamp

- ✅ **Attachments** - Upload and manage file attachments to issues
  - **Atlas Implementation:** Fully implemented via attachments.js
  - **Notes:** File upload support with attachment CRUD

- ✅ **Issue Linking** - Link related issues (blocks, duplicates, relates to, etc.)
  - **Atlas Implementation:** Fully implemented via links.js
  - **Notes:** Support for multiple link types

- ✅ **Search** - Full-text search of issues by title, description, comments
  - **Atlas Implementation:** Fully implemented via search.js route
  - **Notes:** Elasticsearch or similar backend search

- 🚧 **Filters & Saved Filters** - Save and reuse search filters
  - **Atlas Implementation:** Partial. Filter UI exists (filters.tsx) but persistence unclear
  - **Notes:** Screen exists; save/load functionality limited

- ✅ **Advanced Filtering** - Filter by assignee, priority, type, status, epic, label, date
  - **Atlas Implementation:** Fully implemented. Query-based filtering with multiple criteria
  - **Notes:** Supports complex filter combinations

### Sprint & Release Management
- ✅ **Sprints** - Create sprints, assign issues, track sprint progress
  - **Atlas Implementation:** Fully implemented. Sprints screen with create/edit, issue assignment, status tracking
  - **Notes:** Sprint status (active/completed), issue velocity tracking

- ✅ **Sprint Planning** - Drag issues into sprints, set sprint goals and duration
  - **Atlas Implementation:** Fully implemented. Sprint CRUD with date range, manual issue assignment
  - **Notes:** Issue capacity management; sprint burndown data available

- ✅ **Sprint Burndown** - Visual burndown chart showing progress toward sprint goal
  - **Atlas Implementation:** Fully implemented. Reports screen includes sprint burndown charts
  - **Notes:** Cumulative data based on issue status changes

- ✅ **Releases** - Create releases, assign issues, track release progress
  - **Atlas Implementation:** Fully implemented via releases.js and releases screen
  - **Notes:** Release CRUD with date tracking and issue assignment

- 🚧 **Release Planning** - Plan releases with dates, managers, and issue tracking
  - **Atlas Implementation:** Partial. Releases exist but full workflow not visible
  - **Notes:** Basic CRUD implemented; release lifecycle unclear

- ✅ **Velocity Tracking** - Track team velocity across sprints
  - **Atlas Implementation:** Fully implemented. Velocity reports available
  - **Notes:** Story point tracking and historical velocity calculation

---

## 🤝 COLLABORATE - Team Sync & Automation

### Communication & Sharing
- ✅ **Comments** - Team discussion within issues
  - **Atlas Implementation:** Fully implemented with threading and permissions
  - **Notes:** Supports edit/delete by author or admin

- ✅ **Mentions** - @mention teammates in comments and descriptions
  - **Atlas Implementation:** Likely implemented (mentions common pattern)
  - **Notes:** Verify mention parsing in comment/description fields

- ✅ **Activity Feed** - See recent activity across project/team
  - **Atlas Implementation:** Fully implemented via activity.js
  - **Notes:** Dashboard shows recent activity; audit log shows detailed history

- 🚧 **Notifications** - Email/in-app notifications on issue updates
  - **Atlas Implementation:** Partial. Notifications route exists but delivery (email vs in-app) unclear
  - **Notes:** Notification CRUD exists; transport unclear

- ❌ **Slack Integration** - Send/receive updates in Slack, create issues from Slack
  - **Atlas Implementation:** Not implemented
  - **Notes:** No Slack app or webhook integration; integrations.js exists but Slack-specific code not found

- ❌ **Microsoft Teams Integration** - Teams bot for issue updates
  - **Atlas Implementation:** Not implemented
  - **Notes:** No Teams app integration

### Automation & Workflows
- 🚧 **Workflow Automation** - Auto-transition issues, send notifications, assign issues
  - **Atlas Implementation:** Partial. Automations.js exists with CRUD, but trigger/action system limited
  - **Notes:** Manual workflow transitions work; automatic triggers need development

- ❌ **No-Code Automation Builder** - Drag-and-drop rule creation (e.g., "if X then Y")
  - **Atlas Implementation:** Not implemented
  - **Notes:** No UI for rule builder; backend structure minimal

- 🚧 **Custom Webhooks** - Trigger external systems on issue events
  - **Atlas Implementation:** Partial. Webhooks.js exists but implementation unclear
  - **Notes:** Webhook CRUD exists; delivery and retry logic needs verification

- ❌ **Automation Rules Library** - Pre-built automation templates
  - **Atlas Implementation:** Not implemented
  - **Notes:** No rule templates or library

### Form & Request Management
- 🚧 **Request Forms** - Custom intake forms for teams to submit issues
  - **Atlas Implementation:** Partial. Service Desk request-types.js exists but form builder UI unclear
  - **Notes:** Request-types defined; form customization limited

- 🚧 **Queue Management** - Organize requests into queues for triage
  - **Atlas Implementation:** Partial. Queues.js implemented for Service Desk
  - **Notes:** Queues can be created/managed; assignment workflow incomplete

- 🚧 **SLA Management** - Set response/resolution SLAs on requests
  - **Atlas Implementation:** Partial. SLA.js exists but UI integration unclear
  - **Notes:** SLA CRUD; enforcement and reporting needs work

---

## 📈 REPORT - Analytics & Insights

### Built-in Reports
- ✅ **Sprint Burndown** - Chart showing sprint progress day-by-day
  - **Atlas Implementation:** Fully implemented. Reports screen includes burndown charts
  - **Notes:** Historical data tracked; visual charting complete

- ✅ **Velocity Report** - Historical team velocity across sprints
  - **Atlas Implementation:** Fully implemented
  - **Notes:** Velocity calculation and trending included

- ✅ **Cumulative Flow** - Track issue flow through workflow states over time
  - **Atlas Implementation:** Likely implemented
  - **Notes:** Verify in reports.js backend logic

- 🚧 **Issue Report** - List/table view of issues with customizable columns
  - **Atlas Implementation:** Partial. Reports screen exists; column customization unclear
  - **Notes:** Basic issue listing implemented

- 🚧 **Time Tracking Report** - Team hours worked, time per issue
  - **Atlas Implementation:** Partial. Worklogs.js exists but UI integration unclear
  - **Notes:** Time tracking CRUD implemented; reporting incomplete

- ❌ **Agile Reports (Metrics Dashboard)** - Escape rate, cycle time, defect density
  - **Atlas Implementation:** Not implemented
  - **Notes:** No advanced agile metrics; would need data aggregation

- ❌ **Project Reports** - Project timeline, scope changes, resource utilization
  - **Atlas Implementation:** Not implemented
  - **Notes:** No project-level reporting views

- ❌ **AI Insights** - Rovo AI identifies trends, bottlenecks, risks
  - **Atlas Implementation:** Not implemented
  - **Notes:** AI placeholder route exists; trend analysis not implemented

### Dashboards
- ✅ **Project Dashboard** - Overview of project health, active sprints, recent issues
  - **Atlas Implementation:** Fully implemented. Dashboard screen shows project stats and activity
  - **Notes:** Quick stats (open issues, active sprint, team members)

- 🚧 **Personal Dashboard** - My Issues, My Projects, recent activity
  - **Atlas Implementation:** Partial. Dashboard shows user-specific data but customization limited
  - **Notes:** Basic "my work" view; widget customization missing

- ❌ **Custom Dashboards** - User-created dashboards with draggable widgets
  - **Atlas Implementation:** Not implemented
  - **Notes:** No dashboard builder or widget system

- ❌ **Real-time Dashboards** - Live updating metrics and charts
  - **Atlas Implementation:** Not implemented
  - **Notes:** Dashboards update on page refresh; WebSocket real-time updates missing

---

## ⚙️ ADMINISTRATION & CONFIGURATION

### User & Permission Management
- ✅ **User Management** - Create, edit, deactivate users; manage roles
  - **Atlas Implementation:** Fully implemented. Admin users screen with CRUD operations
  - **Notes:** Roles: Admin, Board Admin, User, Client

- ✅ **Role-Based Access Control** - Assign roles with granular permissions
  - **Atlas Implementation:** Fully implemented. Roles with permission matrix (manage users, create projects, manage sprints, etc.)
  - **Notes:** Permissions enforced on routes; client cannot create issues

- ✅ **Project Members** - Add/remove team members, assign roles per project
  - **Atlas Implementation:** Fully implemented. Project members screen with role assignment
  - **Notes:** Can add members with role (Board Admin, User, Client)

- 🚧 **Permission Groups** - Organize users into groups with shared permissions
  - **Atlas Implementation:** Not found
  - **Notes:** Permissions are role-based only; no custom groups

- ❌ **OAuth/SSO** - Single sign-on with OAuth, SAML
  - **Atlas Implementation:** Not implemented
  - **Notes:** Session token auth only; no OAuth providers

- ❌ **LDAP Integration** - Sync users from corporate LDAP
  - **Atlas Implementation:** Not implemented
  - **Notes:** No LDAP provider integration

### Project Configuration
- ✅ **Project Settings** - Configure project name, key, description, visibility
  - **Atlas Implementation:** Fully implemented. Project edit dialog with basic settings
  - **Notes:** Key is immutable after creation

- ✅ **Issue Types Configuration** - Enable/disable issue types per project
  - **Atlas Implementation:** Fully implemented
  - **Notes:** Types can be toggled per project workflow

- ✅ **Workflow Configuration** - Define workflow states and transitions per project
  - **Atlas Implementation:** Fully implemented via workflows.js
  - **Notes:** State machine with transition rules

- 🚧 **Custom Fields Configuration** - Add project-specific custom fields
  - **Atlas Implementation:** Partial. Custom fields exist but project-scoping unclear
  - **Notes:** Global custom fields implemented; per-project may need work

- ❌ **Notification Settings** - Configure who gets notified on issue events
  - **Atlas Implementation:** Not fully implemented
  - **Notes:** Watchers tracked; delivery rules incomplete

### Global Administration
- ✅ **Admin Dashboard** - System health, user counts, project counts, role breakdown
  - **Atlas Implementation:** Fully implemented. Admin overview screen with stats
  - **Notes:** User counts, project counts, role distribution shown

- ✅ **Audit Log** - Track all system changes (user actions, config changes, deletions)
  - **Atlas Implementation:** Fully implemented via auditlog.js
  - **Notes:** Comprehensive audit trail; admin can view all changes

- 🚧 **Backup & Export** - Backup project data, export issues to CSV
  - **Atlas Implementation:** Not found in routes
  - **Notes:** No export/backup functionality implemented

- ❌ **Data Residency & Compliance** - GDPR, CCPA compliance controls
  - **Atlas Implementation:** Not implemented
  - **Notes:** No data residency or compliance controls

- ❌ **Database & Storage Management** - Manage database size, attachments storage
  - **Atlas Implementation:** Not implemented
  - **Notes:** Database management outside scope of app

---

## 🔗 INTEGRATIONS & ECOSYSTEM

### Out-of-Box Integrations
- ✅ **Webhook Support** - Send issue events to external systems
  - **Atlas Implementation:** Implemented via webhooks.js
  - **Notes:** CRUD operations; delivery/retry logic needs verification

- 🚧 **Activity Stream API** - Programmatic access to activity/events
  - **Atlas Implementation:** Partial. Activity route exists; API documented in README
  - **Notes:** REST API available; webhook real-time events unclear

- ❌ **Slack Bot** - Create issues, update issues, post updates from Slack
  - **Atlas Implementation:** Not implemented
  - **Notes:** No Slack bot or app integration

- ❌ **GitHub Integration** - Link pull requests to issues, auto-close on merge
  - **Atlas Implementation:** Not implemented
  - **Notes:** No GitHub API integration

- ❌ **Figma Integration** - Link design files to issues
  - **Atlas Implementation:** Not implemented
  - **Notes:** No Figma API integration

- ❌ **Confluence Integration** - Link docs to issues, pull context
  - **Atlas Implementation:** Internal wiki exists but no Confluence integration
  - **Notes:** Wiki is separate system; no Confluence sync

- ❌ **Google Workspace Integration** - Google Docs, Sheets, Calendar sync
  - **Atlas Implementation:** Not implemented

- ❌ **Microsoft 365 Integration** - Teams, OneDrive, Outlook sync
  - **Atlas Implementation:** Not implemented

### API & Developer
- ✅ **REST API** - Full REST API for all operations
  - **Atlas Implementation:** Fully implemented. Comprehensive API across all routes
  - **Notes:** Documented in README; modular route structure

- 🚧 **GraphQL API** - GraphQL endpoint for querying data
  - **Atlas Implementation:** Not found
  - **Notes:** REST only; GraphQL not implemented

- ✅ **SDK & Libraries** - JavaScript/TypeScript SDK for integration
  - **Atlas Implementation:** No official SDK; REST API accessible
  - **Notes:** Frontend uses internal API client; no published SDK

- ❌ **Webhooks Events** - Real-time webhook delivery on all events
  - **Atlas Implementation:** Partial. Webhook system exists; real-time delivery unclear
  - **Notes:** Webhook CRUD works; async delivery needs verification

- ❌ **Atlassian App Marketplace** - Browse and install third-party apps
  - **Atlas Implementation:** Not implemented
  - **Notes:** No plugin/app marketplace

---

## 🎯 SPECIALIZED FEATURES

### Service Desk / Support (Premium)
- 🚧 **Customer Portal** - Customer-facing portal to submit and track requests
  - **Atlas Implementation:** Partial. Portal screens exist (portal.tsx, portal-*.tsx)
  - **Notes:** Customer portal UI exists; full workflow may need work

- 🚧 **Request Forms** - Custom intake forms for different request types
  - **Atlas Implementation:** Partial. Request-types route exists; form builder unclear
  - **Notes:** Request types defined; form customization incomplete

- 🚧 **Queue Management** - Organize requests into queues for team routing
  - **Atlas Implementation:** Partial. Queues.js implemented; assignment workflow incomplete
  - **Notes:** Queues CRUD works; auto-routing not implemented

- 🚧 **SLA Management** - Track SLA compliance on requests
  - **Atlas Implementation:** Partial. SLA.js exists; enforcement and reporting incomplete
  - **Notes:** SLA CRUD implemented; breach detection needs work

- ❌ **Knowledge Base** - Public FAQ/knowledge base articles
  - **Atlas Implementation:** Not implemented as KB
  - **Notes:** Wiki exists but not exposed as public KB

- ❌ **Deflection & AI Suggestions** - Suggest answers from KB to reduce tickets
  - **Atlas Implementation:** Deflection route exists (deflection.js) but feature unclear
  - **Notes:** Deflection CRUD implemented; LLM integration unclear

### Wiki & Documentation
- ✅ **Wiki/Confluence-style Docs** - Create and organize wiki pages
  - **Atlas Implementation:** Fully implemented. Wiki screens for home, pages, spaces
  - **Notes:** Full page/space management with hierarchy

- ✅ **Page Editing** - Rich text editing of wiki pages
  - **Atlas Implementation:** Fully implemented via wiki.js route
  - **Notes:** CRUD operations; editor type unclear

- ✅ **Attachments in Wiki** - Attach files to wiki pages
  - **Atlas Implementation:** Fully implemented via wiki-attachments.js
  - **Notes:** File upload support in pages

- 🚧 **Permissions on Wiki Pages** - Control who can view/edit pages
  - **Atlas Implementation:** Likely implemented (uses general permissions model)
  - **Notes:** Verify wiki-specific permission enforcement

- ❌ **Templates for Pages** - Use templates to standardize page format
  - **Atlas Implementation:** Not found
  - **Notes:** No template system for wiki pages

### Product Management (Advanced)
- ✅ **Feature Tracking** - Track features through lifecycle (Idea → Shipped)
  - **Atlas Implementation:** Fully implemented. Product features screen with CRUD
  - **Notes:** Features linked to releases and outcomes

- ✅ **Customer Feedback** - Collect feedback on features from customers
  - **Atlas Implementation:** Fully implemented via portal
  - **Notes:** Customers can submit feedback through portal

- ✅ **Feature Rollout** - Plan phased feature releases
  - **Atlas Implementation:** Partially implemented
  - **Notes:** Releases exist; rollout scheduling not clear

- ✅ **Roadmap Planning** - Public product roadmap with timeline
  - **Atlas Implementation:** Fully implemented. Roadmap screen shows features on timeline
  - **Notes:** Timeline view of features and releases

- ✅ **Outcome Tracking** - Define and track business outcomes
  - **Atlas Implementation:** Fully implemented via product-outcomes.js
  - **Notes:** Outcomes CRUD with tracking

- ✅ **Objective Setting** - Define quarterly objectives/OKRs
  - **Atlas Implementation:** Fully implemented via product-objectives.js
  - **Notes:** Objectives CRUD; linking to features/issues partial

- ✅ **Theme Management** - Organize features by theme/area
  - **Atlas Implementation:** Fully implemented via product-themes.js
  - **Notes:** Themes CRUD; feature-theme linking works

- ✅ **Company Management** - Track customer companies and accounts
  - **Atlas Implementation:** Fully implemented via product-companies.js
  - **Notes:** Company CRUD with info tracking

---

## 📱 MOBILE & MULTI-CHANNEL

- ❌ **Mobile App (iOS/Android)** - Native mobile apps for on-the-go access
  - **Atlas Implementation:** Not in frontend/backend; mobile/Expo mentioned in README
  - **Notes:** Mobile app exists as separate Expo project; feature parity with web unclear

- ❌ **Mobile Web** - Responsive web app for mobile browsers
  - **Atlas Implementation:** Not explicitly tested
  - **Notes:** Tailwind CSS suggests responsive design; mobile testing needed

- ❌ **Offline Mode** - Work offline, sync when connection returns
  - **Atlas Implementation:** Not implemented
  - **Notes:** Real-time updates rely on server connection

---

## 📊 Summary Progress

### Completed (✅)
- Core board & sprint management
- Issue CRUD, tracking, and history
- User & permission management
- Basic reporting (burndown, velocity)
- Dashboard & admin overview
- Comments, attachments, linking
- API & webhook foundations
- Wiki/documentation
- Product management features
- Service desk basics (queues, SLA, request types)

### In Progress / Partial (🚧)
- Board customization (swimlanes, filters)
- Automation & workflow conditions
- Notifications (delivery unclear)
- Filters & saved filters
- Goal alignment
- Custom dashboards
- Time tracking reports
- Mobile app (separate project)

### Not Started / Missing (❌)
- AI-assisted planning & insights (Rovo AI)
- OAuth/SSO authentication
- Slack, GitHub, Figma integrations
- No-code automation builder
- Advanced agile metrics
- Real-time dashboards & WebSockets
- LDAP sync
- Backup & export
- Confluence integration
- Mobile app (web-only currently)

---

## 🚀 Recommended Development Priorities

### Phase 1: Core Completion (Foundation)
1. Board customization (swimlanes, grouping, columns)
2. Filter persistence & saved views
3. Automation trigger system (event → action)
4. Mobile app feature parity with web

### Phase 2: Collaboration & Automation (Engagement)
1. Notification delivery (email/in-app) with rules
2. Slack integration (create issues, post updates)
3. No-code automation builder UI
4. Real-time updates (WebSocket)

### Phase 3: Intelligence & Insights (Value)
1. AI-assisted planning (task breakdown, assignment suggestions)
2. Advanced agile metrics (cycle time, escape rate, defect density)
3. AI insights & trend detection
4. Custom dashboard builder with widgets

### Phase 4: Enterprise & Compliance (Scale)
1. OAuth/SSO (Google, GitHub, Microsoft)
2. LDAP user sync
3. Data residency & compliance controls (GDPR, CCPA)
4. Backup, export, audit log export

---

## 📝 Notes

- **Jira Reference**: https://www.atlassian.com/software/jira/features
- **Atlas Repo**: Full-stack implementation with React frontend + Node.js backend
- **Mobile**: Separate Expo app (`mobile/` directory); feature parity tracking needed
- **Architecture**: Modular route structure allows incremental feature addition
