# JQL v2 and SLA-aware queues — epic 53

Status: implemented 2026-07-22. Closes the largest hole left by the service desk
wave, recorded in `2026-07-21-service-desk-design.md` under "Slice 2 — what
actually shipped":

> **JQL v2 and the stored `due_at` are not built.** Queues run on JQL v1, so
> `sla = breached`, `waiting_for_customer` and `request_type` are not
> expressible and the seeded demo queues use only what v1 supports.

An agent cannot build the one queue SLAs exist to justify — the breached one.
The four seeded queues (`All open`, `Unassigned`, `Assigned to me`, `Resolved`)
are exactly the four expressible in v1, which is the tell.

> Integration note: this was originally designed on `main` as Epic 51 and
> migration 018. The implementation branch had already shipped stable entity
> URLs plus Outcome tracking and Portal v2 as migrations 018–020 and roadmap
> Epics 51–52. Append-only history wins: the implementation is Epic 53 and
> migration 021; no shipped migration or seeded roadmap ordinal was rewritten.

## What existed before this epic

`utils/jql.js` (104 lines) splits on `\s+AND\s+`, regex-matches each clause as
`field op value`, and returns `{ where, params }` — SQL fragments against the
aliases `i` (issues) and `p` (projects). Three surfaces consume it:

| Surface | Use |
|---|---|
| `routes/search.js` | global search, when `isJqlLike()` says the text is a query |
| `routes/queues.js` | queue rows, and the `SUM(CASE WHEN … THEN 1 ELSE 0 END)` sidebar counts |
| wiki `[jql: …]` macro | renders a live issue table through the search endpoint |

Its limits are structural, not incidental: no `OR`, no grouping, no set
membership, and a `FIELDS` map whose non-column cases are an `if (def.special
=== …)` chain that every new field has to be threaded into.

## Decisions

**1. A real parser, not more regex.** Recursive descent over a token stream,
producing an AST that a separate compiler turns into SQL. Splitting on `OR` the
way v1 splits on `AND` cannot express precedence or grouping, and each new
operator makes the regex less able to say where a query went wrong.

**2. `sla` matches any active clock; per-metric fields exist too.** A request
carries up to two clocks (`first_response`, `resolution`). `sla = breached`
matches a request where ANY clock that has not stopped is in that state — the
headline queue. `first_response = breached` and `resolution = at_risk` address
one clock each. The values are `ok`, `at_risk`, `breached` and `paused`, the
last of which is orthogonal to the other three — see "SLA state in SQL".

**3. Both `due_at` and `at_risk_at` are stored, computed in JS.** This extends
decision 2 of the service desk spec, which stored only `due_at`. `slaState()`
derives breach from `started_at`, `paused_total_minutes` and the goal's
`target_minutes`; SQL cannot repeat that without dialect-specific date math
(`julianday` vs `TIMESTAMPDIFF`) in two implementations that must agree forever.
Storing the at-risk boundary as well as the due boundary means every SLA state
compiles to a timestamp comparison — identical in both dialects, indexable, and
`AT_RISK_RATIO` stays in `utils/sla.js` as the single authority.

The cost is two derived columns recomputed on every lifecycle transition, and
tests proving they never disagree with the badge.

**4. No autocomplete.** The queue editor gets inline parse errors and the field
list. Suggestion UI is a larger surface than this epic earns.

## Grammar

```
orExpr  := andExpr (OR andExpr)*
andExpr := unary (AND unary)*
unary   := NOT? primary
primary := '(' orExpr ')' | clause
clause  := field ('=' | '!=') value
         | field NOT? IN '(' value (',' value)* ')'
         | field IS NOT? EMPTY
value   := bare-token | "quoted string" | 'quoted string'
```

Precedence `NOT` > `AND` > `OR`; parentheses override. Keywords are
case-insensitive, as in v1.

**v1 is a strict subset.** Every query v1 accepted parses identically under v2,
including the seeded queue JQL and `assignee = me` / `assignee = unassigned`. A
regression test asserts this over the seeded queries and the parser's own v1
corpus — this is the property that keeps stored queue text working.

## Components

```
backend/utils/jql/
  index.js     re-exports parseJql, isJqlLike, FIELDS — callers do not change
  fields.js    the registry
  parse.js     tokenizer + recursive descent → AST
  compile.js   AST → { where, params }
```

Splitting the file is part of the work: one 400-line module mixing lexing,
parsing and SQL generation is harder to test at its seams than four small ones.

**The registry.** A field declares how it compiles rather than being threaded
into a conditional chain:

```js
{ column: 'i.status', ci: true }                    // plain column
{ values: ['ok','at_risk','breached','paused'],     // enumerated
  compile: (ctx) => ({ sql, params }) }             // subquery fields
```

Fields registered by this epic, on top of v1's `project`, `status`, `type`,
`priority`, `assignee`, `reporter`, `label`:

| Field | Compiles to |
|---|---|
| `sla` | `EXISTS` over `sd_sla_clocks` for the issue, any metric |
| `first_response`, `resolution` | the same, `AND metric = ?` |
| `request_type` | `i.request_type_id IN (SELECT id FROM sd_request_types WHERE LOWER(name) = ?)` |
| `category` | the issue's status category via `project_statuses` |
| `waiting_for_customer` | `project_statuses.waiting_for_customer` for the issue's status |

`values` gives the parser a real error for `sla = brached` instead of a query
that silently matches nothing.

**SLA state in SQL.** Two things have to line up with `slaState()`, and both are
easy to get subtly wrong:

*A stopped clock is final and does not match.* "Active" means `stopped_at IS
NULL`. A first-response clock that breached and then stopped is history — the
request was answered, late — and a work queue asking "what is on fire" should
not return it. `breached_at` still records that it happened, and the service
desk report still counts it.

*Paused is a flag, not a status.* `slaState()` freezes a paused clock at
`paused_at` and reports `{ status, paused }` orthogonally, so a paused clock is
still `ok`, `at_risk` or `breached` — measured at the moment it stopped ticking.
Comparing against `NOW` would let a paused clock drift into breach while nobody
is on the hook for it. Every predicate therefore measures against
`X = COALESCE(paused_at, NOW)`:

| State | Predicate, on a clock with `stopped_at IS NULL` |
|---|---|
| `breached` | `due_at <= X` |
| `at_risk` | `at_risk_at <= X AND due_at > X` |
| `ok` | `at_risk_at > X` |
| `paused` | `paused_at IS NOT NULL` |

So `sla = paused AND sla = breached` is a legitimate query — a request parked
waiting on a customer that was already late when it was parked — and it is the
one an agent chasing stalled work actually wants.

## Migration 021

Adds `due_at` and `at_risk_at` to `sd_sla_clocks` (nullable), both dialects, and
backfills every existing clock by running the same JS that writes them going
forward. `utils/sla-clocks.js` computes them wherever it already writes a clock:
`onRequestRaised`, `pauseClocks`, `resumeClocks`, `stopMetric`, `restartMetric`.
A paused clock's boundaries move forward by the paused interval on resume, which
is exactly the arithmetic `slaState()` already does with `paused_total_minutes`.

Clocks whose goal is missing or mis-configured (`target_minutes <= 0`) keep both
columns NULL — `slaState()` returns null for those, and NULL comparisons match
nothing, so the two agree by construction.

## Error handling

`parseJql` keeps returning `{ error }`, now carrying the column offset:
`Unknown field "stat" at column 8. Try: project, status, type, …`. Unchanged
downstream behaviour: a queue whose stored query no longer parses still appears
in the sidebar so it can be found and fixed, reports no count, and does not take
the rest of the sidebar down with it.

The queue editor renders the error under the textarea on save instead of only a
toast, with the registered field list beside it.

## Testing

| Layer | Covers |
|---|---|
| `parse.test.js` | precedence, grouping, `IN`, `IS EMPTY`, `NOT`, quoting, error offsets |
| `compile.test.js` | SQL + params per field, negation, enumerated-value rejection |
| v1 parity | every seeded query and the v1 corpus produce identical SQL |
| `sla-clocks.test.js` | stored `due_at`/`at_risk_at` agree with `slaState()` across start, pause, resume, stop, restart — including a clock that breached before it was paused, which must stay breached and not drift |
| route tests | `/api/search` and `/api/queues` with v2 queries, counts equal rows |
| MySQL job | migration 021 on both dialects |
| e2e | queue editor shows an inline parse error |

## Seeding

A fifth seeded queue, `Needs attention`, whose query exercises the new grammar
rather than merely the new fields:

```
sla = breached OR (sla = at_risk AND priority IN (high, urgent))
```

Plus a demo request whose first-response clock is past due, so the queue is not
empty in the demo data and the sidebar count is visibly non-zero. Behind
`SEED_DEMO_DATA`, as always.

## Stories

1. Migration 021 + `due_at`/`at_risk_at` computed on every clock transition
2. Tokenizer and recursive-descent parser → AST
3. AST → SQL compiler and the `FIELDS` registry refactor, at v1 parity
4. Register `sla`, `first_response`, `resolution`, `request_type`, `category`, `waiting_for_customer`
5. Queue editor inline parse errors and field help
6. Seeded `Needs attention` queue and the demo clock behind it

## Out of scope (YAGNI)

- **Autocomplete / query builder UI** — decision 4.
- **`ORDER BY` in the query text** — queues already carry `order_by` as a
  column, and search has its own ordering.
- **Saved personal filters** — a queue is the shared object this wave is about;
  nobody has asked to save private ones.
- **Date fields and relative ranges** (`created > -7d`) — no current caller.
  The registry makes it additive when one appears.
- **Renumbering the seeded roadmap** — the restructure proposed in the service
  desk spec stays moot; 42 and 43 are seeded as queues and SLAs.
