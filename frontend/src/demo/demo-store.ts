// The demo build's stand-in for the API: recorded responses held in memory for
// the life of the page. Four writes stick until reload (move, edit, create,
// comment); every other write answers success and changes nothing. Pure — no
// DOM, no network — so it is tested without a browser.

export type Fixtures = Record<string, unknown>;

export class DemoNotFound extends Error {
  constructor(readonly path: string) {
    super(`No sample data for ${path}`);
    this.name = 'DemoNotFound';
  }
}

type Obj = Record<string, unknown>;

/** Unrecorded issue sub-resources that read as "none yet" rather than missing. */
const ISSUE_COLLECTIONS = new Set(['comments', 'activity', 'links', 'watchers', 'worklogs', 'attachments', 'pages', 'children']);
const UUIDISH = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;
const SPRINT_LIST = /^\/projects\/([^/?]+)\/issues\?sprint_id=([^&]+)$/;

/** Fields a list payload carries that a create body usually does not. */
const ISSUE_DEFAULTS: Obj = {
  sprint_id: null, description: null, type: 'task', status: 'todo', priority: 'medium',
  assignee_id: null, parent_id: null, story_points: null, labels: null, due_date: null,
  start_date: null, board_order: 0, comment_count: 0, attachment_count: 0, watcher_count: 0,
  link_count: 0, epic_color: null, epic_key: null, epic_title: null, epic_badge_color: null,
  parent_key: null, parent_title: null, parent_type: null, sprint_name: null, sprint_slug: null,
  subtask_count: 0, subtask_done_count: 0, original_estimate: null, time_spent: null,
  in_progress_minutes_live: null, fix_version_id: null, component_id: null,
  fix_version_name: null, fix_version_status: null, component_name: null, labels_parsed: [],
};

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Every object anywhere inside `value`, nested ones included. */
function* objects(value: unknown): Generator<Obj> {
  if (Array.isArray(value)) {
    for (const v of value) yield* objects(v);
    return;
  }
  if (!isObj(value)) return;
  yield value;
  for (const v of Object.values(value)) yield* objects(v);
}

function segments(path: string): string[] {
  return path.split('?')[0].split('/').filter(Boolean);
}

export function createDemoStore(fixtures: Fixtures, now: () => Date = () => new Date()) {
  const data: Fixtures = structuredClone(fixtures);

  const me = () => (isObj(data['/auth/me']) ? data['/auth/me'] : {});
  const users = (): Obj[] => (Array.isArray(data['/users']) ? (data['/users'] as Obj[]) : []);
  const projects = (): Obj[] => (Array.isArray(data['/projects']) ? (data['/projects'] as Obj[]) : []);

  /** Every recorded copy of an issue matching `match`. */
  function copies(match: (o: Obj) => boolean): Obj[] {
    const out: Obj[] = [];
    for (const value of Object.values(data)) {
      for (const o of objects(value)) {
        if (typeof o.id === 'string' && typeof o.issue_key === 'string' && match(o)) out.push(o);
      }
    }
    return out;
  }

  /** The fullest copy — a list row beats an epic's child summary. */
  function richest(match: (o: Obj) => boolean): Obj | undefined {
    return copies(match).sort((a, b) => Object.keys(b).length - Object.keys(a).length)[0];
  }

  function assigneeFields(assigneeId: unknown): Obj {
    const u = users().find((x) => x.id === assigneeId);
    return { assignee_name: u?.name ?? null, assignee_color: u?.avatar_color ?? null };
  }

  /** Keep `?sprint_id=` lists in step with where the issue now lives. */
  function syncSprintLists(issue: Obj) {
    for (const [key, value] of Object.entries(data)) {
      const m = key.match(SPRINT_LIST);
      if (!m || m[1] !== issue.project_id || !Array.isArray(value)) continue;
      const at = value.findIndex((o) => isObj(o) && o.id === issue.id);
      const belongs = issue.sprint_id === decodeURIComponent(m[2]);
      if (belongs && at === -1) value.push(structuredClone(issue));
      if (!belongs && at !== -1) value.splice(at, 1);
    }
  }

  function updateIssue(id: string, patch: Obj): unknown {
    const fields: Obj = { ...patch, updated_at: now().toISOString() };
    if ('assignee_id' in patch) Object.assign(fields, assigneeFields(patch.assignee_id));
    for (const o of copies((x) => x.id === id)) Object.assign(o, fields);
    const issue = richest((x) => x.id === id);
    if (!issue) return { id, ...fields };
    syncSprintLists(issue);
    return structuredClone(issue);
  }

  function createIssue(projectId: string, body: Obj): unknown {
    const key = (projects().find((p) => p.id === projectId)?.key as string | undefined) ?? 'DEMO';
    const numbers = copies((o) => o.project_id === projectId).map((o) => Number(o.issue_number) || 0);
    const n = Math.max(0, ...numbers) + 1;
    const stamp = now().toISOString();
    const user = me();
    const issue: Obj = {
      ...ISSUE_DEFAULTS,
      ...body,
      ...assigneeFields(body.assignee_id ?? null),
      id: crypto.randomUUID(),
      project_id: projectId,
      issue_key: `${key}-${n}`,
      issue_number: n,
      reporter_id: user.id ?? null,
      reporter_name: user.name ?? null,
      reporter_color: user.avatar_color ?? null,
      created_at: stamp,
      updated_at: stamp,
    };
    const list = data[`/projects/${projectId}/issues`];
    if (Array.isArray(list)) list.push(issue);
    syncSprintLists(issue);
    if (typeof body.parent_id === 'string') {
      for (const o of copies((x) => x.id === body.parent_id)) o.subtask_count = Number(o.subtask_count ?? 0) + 1;
    }
    return structuredClone(issue);
  }

  function addComment(issueId: string, text: string): unknown {
    const stamp = now().toISOString();
    const user = me();
    const comment: Obj = {
      id: crypto.randomUUID(),
      issue_id: issueId,
      author_id: user.id ?? '',
      body: text,
      created_at: stamp,
      updated_at: stamp,
      author_name: user.name ?? 'Demo user',
      author_color: user.avatar_color ?? '#0c66e4',
    };
    const key = `/issues/${issueId}/comments`;
    if (!Array.isArray(data[key])) data[key] = [];
    (data[key] as Obj[]).push(comment);
    for (const o of copies((x) => x.id === issueId)) o.comment_count = Number(o.comment_count ?? 0) + 1;
    return structuredClone(comment);
  }

  function read(path: string): unknown {
    if (path in data) return structuredClone(data[path]);
    const parts = segments(path);
    if (parts[0] === 'issues') {
      if (parts.length === 3 && parts[1] === 'by-key') {
        const key = decodeURIComponent(parts[2]).toUpperCase();
        const hit = richest((o) => String(o.issue_key).toUpperCase() === key);
        if (hit) return structuredClone(hit);
      } else if (parts.length === 2) {
        const hit = richest((o) => o.id === parts[1]);
        if (hit) return structuredClone(hit);
      } else if (parts.length === 3 && ISSUE_COLLECTIONS.has(parts[2])) {
        return [];
      }
    }
    throw new DemoNotFound(path);
  }

  function write(method: string, path: string, body: Obj = {}): unknown {
    const m = method.toUpperCase();
    const parts = segments(path);
    if (parts[0] === 'issues' && m === 'PUT' && parts.length === 2) return updateIssue(parts[1], body);
    if (parts[0] === 'issues' && m === 'PUT' && parts.length === 3 && parts[2] === 'move') return updateIssue(parts[1], body);
    if (parts[0] === 'projects' && m === 'POST' && parts.length === 3 && parts[2] === 'issues') return createIssue(parts[1], body);
    if (parts[0] === 'issues' && m === 'POST' && parts.length === 3 && parts[2] === 'comments') return addComment(parts[1], String(body.body ?? ''));
    if (parts[0] === 'issues' && m === 'POST' && parts[1] === 'resolve') return { issues: [] };
    if (m === 'DELETE') return { ok: true };
    const id = [...parts].reverse().find((p) => UUIDISH.test(p)) ?? crypto.randomUUID();
    return { ...body, id };
  }

  return { read, write };
}
