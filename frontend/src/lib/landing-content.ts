// Landing page content. Data only — no JSX, no layout.
//
// Capabilities are derived from docs/JIRA_FEATURES_COMPARISON.md (112),
// docs/PRODUCTBOARD_FEATURES_COMPLETE.md (44) and
// docs/PRODUCTBOARD_FEATURES_REMAINING.md (44), de-duplicated across the
// overlap between the two comparisons.
//
// Entries carry no shipped/planned distinction — an approved product
// decision. If that is ever revisited, add `status` to the item shape here
// and render it in capability-index.tsx; nothing else needs to change.

export interface Pillar {
  name: string;
  items: string[];
}

export const LANDING_COPY = {
  nav: {
    brand: 'Atlas',
    links: [
      { label: 'Product', href: '#product' },
      { label: 'Delivery', href: '#delivery' },
      { label: 'Discovery', href: '#discovery' },
      { label: 'All capabilities', href: '#capabilities' },
    ],
    signIn: 'Sign in',
    demo: 'Try the live demo',
  },
  hero: {
    badge: 'New',
    badgeText: 'One workspace, zero handoff',
    headline: 'Your backlog and your roadmap, finally in the same tool',
    sub: "Atlas runs sprint delivery and product discovery on one system of record — so the customer request, the roadmap bet and the ticket that ships it are the same object, not three tools pretending to sync.",
    trust: ['Boards', 'Sprints', 'Roadmaps', 'Insights', 'Wiki', 'Service desk', 'Reporting'],
  },
  frame: {
    // `path` is where the embedded demo goes; `url` is only the address-bar label.
    tabs: [
      { key: 'board', label: 'Board', url: 'open-atlas.xyz/ATL/board', path: '/atl/board' },
      { key: 'roadmap', label: 'Roadmap', url: 'open-atlas.xyz/product/roadmap', path: '/product/roadmap' },
      { key: 'insights', label: 'Insights', url: 'open-atlas.xyz/product/insights', path: '/product/insights' },
    ],
  },
  split: {
    eyebrow: 'Two halves, one record',
    headline: 'The handoff that usually loses everything',
    sub: 'Most teams run discovery in one tool and delivery in another, then spend the week reconciling them. Atlas keeps both on the same objects, so nothing is retyped and nothing goes missing in the gap.',
    delivery: {
      chip: 'Delivery',
      title: 'Ship the work',
      body: 'Everything an engineering team needs to plan a sprint, run it, and prove what happened — boards, estimates, workflow, and the reports that come out the other end.',
      points: [
        'Kanban and sprint boards with drag-and-drop',
        'Backlog grooming, story points, epics and subtasks',
        'JQL search with saved filters',
        'Burndown, velocity, cumulative flow and time tracking',
      ],
    },
    discovery: {
      chip: 'Discovery',
      title: 'Decide the work',
      body: 'Everything a product team needs to know what to build — customer signal collected in one inbox, scored against objectives, and promoted straight onto the roadmap.',
      points: [
        'Customer insights inbox and public ideas portal',
        'Feature lifecycle from idea to measured impact',
        'Objectives, outcomes and prioritisation scoring',
        'Themes, releases and shareable roadmaps',
      ],
    },
  },
  rows: [
    {
      visual: 'board' as const,
      eyebrow: 'Plan and track',
      title: 'A board that matches how your team actually works',
      body: 'Drag work across the columns your workflow defines, not the ones a vendor picked. Every card carries its type, priority, points, labels, assignee and full history — and every change lands in the audit trail.',
      tags: ['Kanban', 'Sprint board', 'Backlog', 'Epics', 'Subtasks', 'Custom fields', 'Labels', 'Issue linking', 'Attachments', 'Stopwatch'],
    },
    {
      visual: 'insights' as const,
      eyebrow: 'Discovery',
      title: 'Every request in one inbox, scored before it becomes a ticket',
      body: 'Feedback arrives from the portal, the service desk and your own team, then gets grouped, weighted by the customers asking, and promoted to a feature with the original evidence still attached.',
      tags: ['Insights inbox', 'Ideas portal', 'Request aggregation', 'Prioritisation', 'Objectives', 'Outcomes', 'Themes', 'Customers', 'Impact'],
    },
    {
      visual: 'report' as const,
      eyebrow: 'Report',
      title: 'The numbers your stand-up actually asks for',
      body: "Burndown, velocity and cumulative flow are generated from the same issues your team is already moving — no separate reporting tool, no weekly export, no spreadsheet that is stale by Tuesday.",
      tags: ['Burndown', 'Velocity', 'Cumulative flow', 'Flow metrics', 'Time tracking', 'Dashboard gadgets', 'Audit log'],
    },
    {
      visual: 'queue' as const,
      eyebrow: 'Support and knowledge',
      title: 'A help desk and a wiki that know about your backlog',
      body: 'Customer requests come in through a portal with real queues and SLA timers. When one turns out to be a bug, it becomes an issue on the board with the conversation still attached — and the answer becomes a wiki page.',
      tags: ['Customer portal', 'Queues', 'SLA timers', 'Request types', 'Deflection', 'Wiki spaces', 'Page permissions', 'Ask wiki'],
    },
    {
      visual: 'api' as const,
      eyebrow: 'Platform',
      title: 'Yours to run, and yours to extend',
      body: 'Role-based permissions down to the project, a full audit log of every change, and a REST API with webhooks so Atlas can drive whatever else you run. Self-hosted on your own database.',
      tags: ['RBAC', 'Audit log', 'REST API', 'Webhooks', 'API tokens', 'Custom fields', 'Automation', 'Self-hosted'],
    },
  ],
  capabilities: {
    eyebrow: 'Everything in the box',
    headlineSuffix: 'capabilities, no add-ons',
    sub: 'The full surface area, grouped the way the product is. Search it.',
    placeholder: 'Search capabilities…',
    empty: 'No capability matches that.',
  },
  cta: {
    headline: 'See it with real data, in one click',
    body: 'The demo drops you straight into a populated workspace — a live board, a roadmap and a full quarter of history. No signup, no credit card.',
  },
  footer: {
    copyright: '© 2026 Atlas',
    links: [
      { label: 'Product', href: '#product' },
      { label: 'Capabilities', href: '#capabilities' },
      { label: 'Sign in', href: '/login' },
    ],
  },
};

export const CAPABILITY_PILLARS: Pillar[] = [
  {
    name: 'Plan',
    items: ['Projects', 'Issues', 'Issue types', 'Subtasks', 'Story points', 'Priorities', 'Labels and tagging', 'Custom fields', 'Epics', 'Backlog', 'Sprint planning', 'Goal alignment', 'Issue linking', 'Bulk actions', 'Project templates', 'AI-assisted planning'],
  },
  {
    name: 'Track',
    items: ['Kanban board', 'Sprint board', 'Drag and drop', 'Board customisation', 'Swimlanes', 'Workflow states', 'Status categories', 'Custom workflows', 'Automated transitions', 'Blocked status', 'Issue detail view', 'Issue history', 'Audit trail', 'Attachments', 'Watchers', 'Search', 'Saved filters', 'JQL advanced filtering', 'Time tracking', 'Issue stopwatch'],
  },
  {
    name: 'Deliver',
    items: ['Sprints', 'Sprint burndown', 'Velocity tracking', 'Cumulative flow', 'Flow metrics', 'Releases', 'Release planning', 'Release coordination', 'Roadmap', 'Capacity planning', 'Resource allocation'],
  },
  {
    name: 'Discover',
    items: ['Product roadmapping', 'Feature lifecycle', 'Feature dependencies', 'Feature adoption', 'Feature impact', 'Request aggregation', 'Themes and initiatives', 'Objectives and OKRs', 'Outcome tracking', 'Prioritisation scoring', 'Customer insights', 'Feedback collection', 'Feedback organisation', 'Feedback portals', 'Segmented portals', 'In-app feedback widget', 'Idea submission', 'Idea management', 'Company management', 'Customer attributes', 'VIP customer views', 'Feedback segmentation', 'Feedback trends', 'AI-generated insights', 'Automated feedback loops', 'Scheduled outreach'],
  },
  {
    name: 'Collaborate',
    items: ['Comments', 'Threaded discussion', 'Mentions', 'Mention notifications', 'Activity feed', 'Notifications', 'Notification rules', 'Team management', 'Cross-functional collaboration', 'Shareable links', 'Command palette', 'Real-time collaboration'],
  },
  {
    name: 'Automate',
    items: ['Workflow automation', 'Automation rules', 'Conditional workflows', 'No-code automation builder', 'Rules library', 'Webhook triggers', 'Request forms'],
  },
  {
    name: 'Report',
    items: ['Project dashboard', 'Personal dashboard', 'Dashboard gadgets', 'Custom dashboards', 'Real-time dashboards', 'Sprint report', 'Issue report', 'Project reports', 'Time tracking report', 'Agile metrics', 'Custom report builder', 'Scheduled reports', 'Comparative analytics', 'Predictive analytics', 'AI insights'],
  },
  {
    name: 'Support and knowledge',
    items: ['Customer portal', 'Help centre', 'Request types', 'Request queues', 'SLA management', 'SLA timers', 'Service desk reporting', 'Deflection suggestions', 'Knowledge base', 'Wiki spaces', 'Wiki pages', 'Page editing', 'Page templates', 'Page permissions', 'Wiki attachments', 'Ask wiki', 'Article suggestions'],
  },
  {
    name: 'Administer',
    items: ['User management', 'Role-based access control', 'Project members', 'Permission groups', 'Project settings', 'Issue type configuration', 'Workflow configuration', 'Custom field configuration', 'Notification settings', 'Admin dashboard', 'Audit log', 'Advanced audit logging', 'Session management', 'Backup and export', 'Data residency', 'Encryption at rest', 'SOC 2 Type II'],
  },
  {
    name: 'Platform and integrations',
    items: ['REST API', 'API tokens', 'Webhooks', 'Webhook events', 'Activity stream API', 'GraphQL API', 'SDKs and libraries', 'OAuth and SSO', 'SAML SSO', 'LDAP sync', 'Slack', 'Microsoft Teams', 'GitHub', 'Figma', 'Confluence', 'Google Workspace', 'Microsoft 365', 'Salesforce', 'Customer data platform', 'App marketplace', 'Mobile app', 'Mobile web', 'Offline mode', 'Voice and video'],
  },
];

/** Computed, never hand-written — the headline can't drift from the list. */
export const CAPABILITY_TOTAL = CAPABILITY_PILLARS.reduce((n, p) => n + p.items.length, 0);
