# Automatic Versioning on Push to Main — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every push to `main` that contains releasable work automatically bumps the version, updates the manifests, tags the commit, and builds the release image — with no human running `npm version` or `git tag` again.

**Architecture:** A pure Node helper computes the next semver from Conventional Commit subjects since the last tag; it is unit-tested under the existing jest harness. A new `release-version.yml` workflow runs that helper on every push to `main`, and when it reports a release is warranted, bumps the three manifests, commits, tags, and invokes the image build. Because a tag pushed by `GITHUB_TOKEN` does not trigger other workflows, `release-build.yml` gains a `workflow_call` trigger and is invoked directly rather than relied on to fire from the tag.

**Tech Stack:** GitHub Actions, Node 20, jest (existing `backend` harness), `npm version`, Conventional Commits.

## Global Constraints

- Version lives in exactly three manifests, which must always agree: `package.json`, `backend/package.json`, `frontend/package.json`. `mobile/package.json` is excluded — it ships to app stores on its own cadence.
- Tags are `v${version}`, e.g. `v14.1.11`. Current tag: `v14.1.10`. Current manifest version: `14.1.10`.
- The existing guard in `release-build.yml` ("Tag matches the package version") must keep passing — it is the safety net if this automation ever computes a version that disagrees with what it wrote.
- Release-triggering commit types: `feat:` → minor, `fix:` and `perf:` → patch, any type with `!` or a `BREAKING CHANGE` body → major. All other types (`docs`, `chore`, `ci`, `test`, `build`, `style`, `refactor`) cut no release.
- A published tag is never moved or deleted. If a release is wrong, the next version supersedes it.
- The release commit's subject must start with `chore(release):` — the workflow uses that prefix to skip its own commits and avoid an infinite loop.
- Bumps use `npm version <v> --no-git-tag-version --allow-same-version` so lockfiles move with manifests. Never hand-edit a version string.
- Repo is **private**; `default_workflow_permissions` is `read`. Workflows must declare `permissions: contents: write` to push.

---

## File Structure

**Create:**
- `backend/scripts/next-version.js` — pure semver computation from commit metadata. No I/O, no git calls, so it is trivially testable.
- `backend/tests/backend/next-version.test.js` — its unit tests, picked up by the existing `npm test` in `backend/`.
- `.github/workflows/release-version.yml` — the push-to-main trigger: compute, bump, commit, tag, invoke build.

**Modify:**
- `.github/workflows/release-build.yml` — add a `workflow_call` trigger and make every `GITHUB_REF_NAME` reference honour an `inputs.tag` override.

**Why `backend/scripts/`:** it already holds standalone operational scripts (`export-to-mysql.js`, `repair-timer-overcounts.js`), and `backend/`'s jest picks up `tests/backend/*.test.js` with no config change. Putting the helper anywhere else means new jest config for one file.

---

## Task 1: The version computation helper

**Files:**
- Create: `backend/scripts/next-version.js`
- Test: `backend/tests/backend/next-version.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `bumpForCommit({ subject, body }) -> 'major' | 'minor' | 'patch' | null`
  - `nextVersion(currentVersion, commits) -> { version: string, bump: string } | null`
    where `commits` is `Array<{ subject: string, body: string }>` and `null` means no release is warranted.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/backend/next-version.test.js`:

```js
/**
 * VERSION COMPUTATION
 *
 * Decides what a push to main is worth. A wrong answer here either burns a
 * version on a docs typo or silently ships a breaking change as a patch, so
 * the mapping from commit type to bump is pinned exactly.
 */
const { bumpForCommit, nextVersion } = require('../../scripts/next-version');

describe('bumpForCommit', () => {
  test.each([
    ['feat: add mentions', 'minor'],
    ['feat(mentions): add picker', 'minor'],
    ['fix: repair the dropdown', 'patch'],
    ['fix(api): repair the dropdown', 'patch'],
    ['perf: batch the enrich queries', 'patch'],
  ])('%s -> %s', (subject, expected) => {
    expect(bumpForCommit({ subject, body: '' })).toBe(expected);
  });

  test.each([
    ['docs: update the spec'],
    ['chore(release): 14.1.10'],
    ['ci: run the mobile suite'],
    ['test: cover the parser'],
    ['build: refresh the bundle'],
    ['style: reformat'],
    ['refactor: extract a helper'],
    ['Merge pull request #32 from x/y'],
    ['no conventional prefix at all'],
  ])('%s -> no release', (subject) => {
    expect(bumpForCommit({ subject, body: '' })).toBeNull();
  });

  test('a bang marks a breaking change whatever the type', () => {
    expect(bumpForCommit({ subject: 'feat!: drop v1 auth', body: '' })).toBe('major');
    expect(bumpForCommit({ subject: 'fix(api)!: rename a field', body: '' })).toBe('major');
    expect(bumpForCommit({ subject: 'chore!: drop node 18', body: '' })).toBe('major');
  });

  test('a BREAKING CHANGE body marks a breaking change', () => {
    expect(bumpForCommit({
      subject: 'feat: new token format',
      body: 'BREAKING CHANGE: stored mentions change shape',
    })).toBe('major');
  });

  test('a body mentioning breaking changes in prose does not', () => {
    expect(bumpForCommit({
      subject: 'fix: guard against breaking changes in the parser',
      body: 'This avoids breaking change handling downstream.',
    })).toBe('patch');
  });
});

describe('nextVersion', () => {
  test('no releasable commits means no release', () => {
    expect(nextVersion('14.1.10', [
      { subject: 'docs: update the spec', body: '' },
      { subject: 'chore: tidy', body: '' },
    ])).toBeNull();
  });

  test('an empty commit list means no release', () => {
    expect(nextVersion('14.1.10', [])).toBeNull();
  });

  test('a fix bumps the patch', () => {
    expect(nextVersion('14.1.10', [{ subject: 'fix: a bug', body: '' }]))
      .toEqual({ version: '14.1.11', bump: 'patch' });
  });

  test('a feat bumps the minor and resets the patch', () => {
    expect(nextVersion('14.1.10', [{ subject: 'feat: a feature', body: '' }]))
      .toEqual({ version: '14.2.0', bump: 'minor' });
  });

  test('a breaking change bumps the major and resets the rest', () => {
    expect(nextVersion('14.1.10', [{ subject: 'feat!: a rewrite', body: '' }]))
      .toEqual({ version: '15.0.0', bump: 'major' });
  });

  test('the highest bump in the batch wins', () => {
    expect(nextVersion('14.1.10', [
      { subject: 'fix: a bug', body: '' },
      { subject: 'feat: a feature', body: '' },
      { subject: 'docs: notes', body: '' },
    ])).toEqual({ version: '14.2.0', bump: 'minor' });
  });

  test('order does not change the result', () => {
    expect(nextVersion('14.1.10', [
      { subject: 'feat: a feature', body: '' },
      { subject: 'fix: a bug', body: '' },
    ])).toEqual({ version: '14.2.0', bump: 'minor' });
  });

  test('a breaking change outranks a feat', () => {
    expect(nextVersion('2.3.4', [
      { subject: 'feat: a feature', body: '' },
      { subject: 'fix!: a breaking fix', body: '' },
    ])).toEqual({ version: '3.0.0', bump: 'major' });
  });

  test('rejects a version that is not three numeric parts', () => {
    expect(() => nextVersion('14.1', [{ subject: 'fix: x', body: '' }]))
      .toThrow('not a semver');
    expect(() => nextVersion('v14.1.10', [{ subject: 'fix: x', body: '' }]))
      .toThrow('not a semver');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/backend/next-version.test.js`
Expected: FAIL — `Cannot find module '../../scripts/next-version'`

- [ ] **Step 3: Write the implementation**

Create `backend/scripts/next-version.js`:

```js
// ===== NEXT VERSION =====
// What is this push to main worth?
//
// Pure computation on purpose: no git, no filesystem, no network. The workflow
// gathers the commits and writes the files; everything decidable lives here so
// it can be tested without a repository.
//
// Conventional Commits, which this repo already follows:
//   feat            -> minor      fix, perf       -> patch
//   type!  or  BREAKING CHANGE in the body        -> major
//   everything else (docs, chore, ci, test, build, style, refactor) -> no release
//
// Docs and chores deliberately cut nothing. Releasing on every commit would
// burn a version on a typo and push a container image for it.

const RANK = { patch: 1, minor: 2, major: 3 };

// A conventional subject: type, optional (scope), optional !, then ': '.
const SUBJECT_RE = /^([a-z]+)(\([^)]*\))?(!)?:\s/;

// Only the literal token, uppercase, as its own word — so prose about
// "breaking change handling" does not cut a major release.
const BREAKING_RE = /(^|\n)BREAKING[ -]CHANGE:/;

/** The bump one commit justifies, or null if it justifies none. */
function bumpForCommit({ subject = '', body = '' } = {}) {
  const match = SUBJECT_RE.exec(subject);
  if (!match) return null;
  const [, type, , bang] = match;

  if (bang || BREAKING_RE.test(body)) return 'major';
  if (type === 'feat') return 'minor';
  if (type === 'fix' || type === 'perf') return 'patch';
  return null;
}

/**
 * The version this batch of commits earns, or null when none of them warrant a
 * release. The highest bump present wins, regardless of order.
 */
function nextVersion(currentVersion, commits) {
  const parts = String(currentVersion).split('.');
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) {
    throw new Error(`"${currentVersion}" is not a semver x.y.z version`);
  }

  let highest = null;
  for (const commit of commits) {
    const bump = bumpForCommit(commit);
    if (bump && (!highest || RANK[bump] > RANK[highest])) highest = bump;
  }
  if (!highest) return null;

  const [major, minor, patch] = parts.map(Number);
  if (highest === 'major') return { version: `${major + 1}.0.0`, bump: 'major' };
  if (highest === 'minor') return { version: `${major}.${minor + 1}.0`, bump: 'minor' };
  return { version: `${major}.${minor}.${patch + 1}`, bump: 'patch' };
}

module.exports = { bumpForCommit, nextVersion };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/backend/next-version.test.js`
Expected: PASS, 26 tests.

- [ ] **Step 5: Confirm nothing else broke**

Run: `cd backend && npx jest tests/backend --silent`
Expected: the full suite passes (1016 passing at time of writing, plus the new file).

- [ ] **Step 6: Commit**

```bash
git add backend/scripts/next-version.js backend/tests/backend/next-version.test.js
git commit -m "feat(release): compute the next version from conventional commits"
```

---

## Task 2: Make the image build callable

**Files:**
- Modify: `.github/workflows/release-build.yml`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `release-build.yml` accepts `workflow_call` with input `tag` (string, required), so Task 3 can invoke it as `uses: ./.github/workflows/release-build.yml`.

**Why this task exists:** GitHub deliberately does not trigger workflows from events created with `GITHUB_TOKEN`. A tag pushed by Task 3's workflow would therefore never start `release-build.yml`, and every automated release would silently produce no image. Calling the workflow directly avoids that, and avoids introducing a personal access token with write scope on a private repo.

- [ ] **Step 1: Add the `workflow_call` trigger**

In `.github/workflows/release-build.yml`, replace:

```yaml
on:
  push:
    tags: ["v*"]
```

with:

```yaml
on:
  push:
    tags: ["v*"]
  # Invoked by release-version.yml. A tag pushed with GITHUB_TOKEN does not
  # start a workflow, so the automated path calls this one directly instead of
  # relying on its own tag push to trigger it.
  workflow_call:
    inputs:
      tag:
        description: The tag to build, e.g. v14.1.11
        required: true
        type: string
```

- [ ] **Step 2: Honour the input everywhere the tag is read**

The workflow reads `GITHUB_REF_NAME` five times across four steps (the guard
uses it twice). When called, `GITHUB_REF_NAME` is `main`, not the tag, so every
one must fall back explicitly.

In the `verify` job, replace the guard step's script:

```yaml
      - name: Tag matches the package version
        env:
          TAG_REF: ${{ inputs.tag || github.ref_name }}
        run: |
          tag="${TAG_REF#v}"
          mismatch=0
          for dir in . backend frontend; do
            found=$(node -p "require('./$dir/package.json').version")
            if [ "$found" != "$tag" ]; then
              echo "::error file=$dir/package.json::$dir/package.json is $found but the tag is $TAG_REF"
              mismatch=1
            fi
          done
          exit $mismatch
```

In the `verify` job, make the checkout take the tag:

```yaml
      - uses: actions/checkout@v4
        with:
          ref: ${{ inputs.tag || github.ref }}
```

In the `build` job, make the checkout take the tag and replace the two remaining
`GITHUB_REF_NAME` uses:

```yaml
      - uses: actions/checkout@v4
        with:
          ref: ${{ inputs.tag || github.ref }}
```

```yaml
      - name: Build and push
        env:
          TAG_REF: ${{ inputs.tag || github.ref_name }}
        run: |
          set -euo pipefail
          docker build --platform linux/arm64 -t "${ECR_REPOSITORY}:${TAG_REF}" .
          docker push "${ECR_REPOSITORY}:${TAG_REF}"
          echo "Pushed ${ECR_REPOSITORY}:${TAG_REF}"

      - name: Confirm the image is arm64
        # A mismatch here fails at runtime with `exec format error`, which reads
        # like a corrupt image rather than a wrong-architecture build.
        env:
          TAG_REF: ${{ inputs.tag || github.ref_name }}
        run: |
          set -euo pipefail
          ARCH=$(docker inspect "${ECR_REPOSITORY}:${TAG_REF}" --format '{{.Architecture}}')
          echo "architecture: ${ARCH}"
          [ "$ARCH" = "arm64" ] || { echo "expected arm64"; exit 1; }

      - name: Summary
        env:
          TAG_REF: ${{ inputs.tag || github.ref_name }}
        run: |
          {
            echo "### Image published"
            echo ""
            echo "\`${ECR_REPOSITORY}:${TAG_REF}\`"
            echo ""
            echo "**Nothing has been deployed.** Run *Release - deploy one customer* to put this in front of a customer."
          } >> "$GITHUB_STEP_SUMMARY"
```

- [ ] **Step 3: Validate the workflow parses**

Run:

```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release-build.yml')); print('valid yaml')"
```

Expected: `valid yaml`

- [ ] **Step 4: Confirm the manual tag path is unchanged**

Run:

```bash
grep -c 'inputs.tag || github.ref' .github/workflows/release-build.yml
```

Expected: `6` — two `ref:` checkouts and four `TAG_REF` env values (guard, build
and push, arm64 check, summary). Every tag read falls back to
`github.ref`/`github.ref_name`, so pushing a tag by hand behaves exactly as
before.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release-build.yml
git commit -m "ci(release): let the image build be called as a reusable workflow"
```

---

## Task 3: Version and tag on every push to main

**Files:**
- Create: `.github/workflows/release-version.yml`

**Interfaces:**
- Consumes: `nextVersion(currentVersion, commits)` from Task 1, via `backend/scripts/next-version.js`. `release-build.yml`'s `workflow_call` input `tag` from Task 2.
- Produces: a `chore(release): X.Y.Z` commit on `main`, a `vX.Y.Z` tag, and an ECR image for it.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/release-version.yml`:

```yaml
# Cut a version for every push to main that earns one.
#
# "Earns one" means the push contains a feat, a fix, a perf, or a breaking
# change. Docs and chores cut nothing — releasing on every commit would burn a
# version on a typo and push a container image for it. The mapping lives in
# backend/scripts/next-version.js and is unit-tested there.
#
# Two GitHub behaviours shape this file:
#
#  1. Events created with GITHUB_TOKEN do not start workflows. The tag pushed
#     below therefore cannot be relied on to trigger release-build.yml, so this
#     workflow calls it directly. The same rule works in our favour for the
#     release commit: it does not re-run CI, so there is no loop.
#  2. Default workflow permissions on this repo are read-only, so the write
#     scope is requested explicitly below.
name: Release - version on main

on:
  push:
    branches: [main]

# One release at a time. Two pushes landing together must not race to compute
# the same next version and then fight over the tag.
concurrency:
  group: release-version
  cancel-in-progress: false

permissions:
  contents: write

jobs:
  version:
    name: Compute and tag
    runs-on: ubuntu-latest
    # Skip this workflow's own release commit. Belt and braces: a GITHUB_TOKEN
    # push does not trigger workflows anyway, but if that ever changes this is
    # what stops the loop.
    if: ${{ !startsWith(github.event.head_commit.message, 'chore(release):') }}
    outputs:
      released: ${{ steps.compute.outputs.released }}
      tag: ${{ steps.compute.outputs.tag }}
    steps:
      - uses: actions/checkout@v5
        with:
          # Tags and full history: the helper needs every commit since the last
          # release to decide the bump.
          fetch-depth: 0

      - uses: actions/setup-node@v5
        with:
          node-version: "20"

      - name: Work out the next version
        id: compute
        run: |
          set -euo pipefail

          current=$(node -p "require('./package.json').version")
          last_tag=$(git tag -l 'v*' --sort=-v:refname \
            | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1 || true)

          if [ -z "$last_tag" ]; then
            echo "No release tag yet; considering the whole history."
            range=""
          else
            echo "Last release tag: $last_tag"
            range="${last_tag}..HEAD"
          fi

          # Records separated by 0x1e, subject and body by 0x00, so a commit
          # body containing newlines cannot be mistaken for a record boundary.
          commits=$(git log $range --no-merges --format='%s%x00%b%x1e')

          result=$(COMMITS="$commits" CURRENT="$current" node -e '
            const { nextVersion } = require("./backend/scripts/next-version");
            const commits = (process.env.COMMITS || "")
              .split("\x1e")
              .map((r) => r.replace(/^\n/, ""))
              .filter((r) => r.trim() !== "")
              .map((r) => {
                const [subject, body = ""] = r.split("\x00");
                return { subject: subject.trim(), body };
              });
            const next = nextVersion(process.env.CURRENT, commits);
            process.stdout.write(JSON.stringify(next));
          ')

          if [ "$result" = "null" ]; then
            echo "No releasable commits since ${last_tag:-the beginning}."
            echo "released=false" >> "$GITHUB_OUTPUT"
            {
              echo "### No release"
              echo ""
              echo "Nothing since \`${last_tag:-the beginning}\` warrants a version — only docs or chores."
            } >> "$GITHUB_STEP_SUMMARY"
            exit 0
          fi

          version=$(echo "$result" | node -pe 'JSON.parse(require("fs").readFileSync(0)).version')
          bump=$(echo "$result" | node -pe 'JSON.parse(require("fs").readFileSync(0)).bump')
          echo "Next version: $version ($bump)"
          echo "released=true" >> "$GITHUB_OUTPUT"
          echo "version=$version" >> "$GITHUB_OUTPUT"
          echo "tag=v$version" >> "$GITHUB_OUTPUT"
          echo "bump=$bump" >> "$GITHUB_OUTPUT"

      - name: Bump the manifests
        if: steps.compute.outputs.released == 'true'
        run: |
          set -euo pipefail
          for dir in . backend frontend; do
            (cd "$dir" && npm version "${{ steps.compute.outputs.version }}" \
              --no-git-tag-version --allow-same-version >/dev/null)
            echo "$dir -> $(node -p "require('./$dir/package.json').version")"
          done

      - name: Commit, tag and push
        if: steps.compute.outputs.released == 'true'
        run: |
          set -euo pipefail
          git config user.name  "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

          git add package.json backend/package.json frontend/package.json \
                  backend/package-lock.json frontend/package-lock.json
          git commit -m "chore(release): ${{ steps.compute.outputs.version }}"

          # Tag the release commit, so the tag points at the code whose
          # manifests say that version. release-build.yml asserts exactly this.
          git tag "${{ steps.compute.outputs.tag }}"
          git push origin HEAD:main
          git push origin "${{ steps.compute.outputs.tag }}"

      - name: Summary
        if: steps.compute.outputs.released == 'true'
        run: |
          {
            echo "### Released ${{ steps.compute.outputs.tag }}"
            echo ""
            echo "Bump: **${{ steps.compute.outputs.bump }}**"
            echo ""
            echo "Building the image now. **Nothing is deployed** — run *Release - deploy one customer* for that."
          } >> "$GITHUB_STEP_SUMMARY"

  build:
    name: Build image
    needs: version
    if: needs.version.outputs.released == 'true'
    uses: ./.github/workflows/release-build.yml
    permissions:
      contents: read
      id-token: write # OIDC for the AWS role; nothing else needs it
    with:
      tag: ${{ needs.version.outputs.tag }}
```

- [ ] **Step 2: Validate the workflow parses**

Run:

```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release-version.yml')); print('valid yaml')"
```

Expected: `valid yaml`

- [ ] **Step 3: Rehearse the computation locally against real history**

This is the part most likely to be wrong, and it can be exercised without
pushing anything. Run from the repo root:

```bash
last_tag=$(git tag -l 'v*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1)
current=$(node -p "require('./package.json').version")
commits=$(git log "${last_tag}..HEAD" --no-merges --format='%s%x00%b%x1e')
COMMITS="$commits" CURRENT="$current" node -e '
  const { nextVersion } = require("./backend/scripts/next-version");
  const commits = (process.env.COMMITS || "").split("\x1e")
    .map((r) => r.replace(/^\n/, "")).filter((r) => r.trim() !== "")
    .map((r) => { const [s, b = ""] = r.split("\x00"); return { subject: s.trim(), body: b }; });
  console.log("commits considered:", commits.length);
  console.log("result:", JSON.stringify(nextVersion(process.env.CURRENT, commits)));
'
```

Expected: it prints the number of commits since `v14.1.10` and either `null`
(when only docs/chores have landed) or `{"version":"...","bump":"..."}`. Confirm
the answer matches what those commit subjects deserve before continuing.

- [ ] **Step 4: Grant the workflow write access**

The repo's default workflow permission is `read`, which is a sensible default
to keep. The `permissions: contents: write` block in the workflow elevates only
this workflow. Confirm the repo does not forbid elevation:

```bash
gh api repos/KunalDSoni/Atlas/actions/permissions/workflow -q '.can_approve_pull_request_reviews, .default_workflow_permissions'
```

Expected: `read` for the default. No change is required — a workflow-level
`permissions:` block may request more than the default on a repo with no
organisation policy. If Task 4's first run fails with `403` on `git push`, and
only then, run:

```bash
gh api -X PUT repos/KunalDSoni/Atlas/actions/permissions/workflow \
  -f default_workflow_permissions=write
```

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release-version.yml
git commit -m "feat(release): cut a version automatically on every push to main"
```

---

## Task 4: Prove it end to end

**Files:** none created or modified by this task beyond a throwaway test commit.

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: a verified release, or a diagnosed failure.

- [ ] **Step 1: Push the automation itself**

The commits from Tasks 1–3 include a `feat(release):` subject, so pushing them
should itself cut a minor release — `14.1.10` becomes `14.2.0`. That is the
first real test.

```bash
git push origin HEAD:main
```

- [ ] **Step 2: Watch the versioning workflow**

```bash
gh run watch "$(gh run list --workflow 'Release - version on main' --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status
```

Expected: the `Compute and tag` job succeeds and reports `Next version: 14.2.0 (minor)`.

- [ ] **Step 3: Confirm the release landed**

```bash
git fetch origin --tags
git log --oneline -1 origin/main            # expect: chore(release): 14.2.0
git tag -l 'v14.2.0'                        # expect: v14.2.0
git show v14.2.0:package.json | grep version # expect: "version": "14.2.0"
```

Expected: the tag exists, points at the release commit, and that commit's
manifests read `14.2.0`. The three must agree — that is the invariant this whole
plan exists to hold.

- [ ] **Step 4: Confirm the image built**

```bash
gh run list --workflow 'Release - version on main' --limit 1 --json conclusion -q '.[0].conclusion'
```

Expected: `success`, with the `Build image` job having run the reusable
`release-build.yml` and its "Tag matches the package version" guard passing.
If the guard fails here, the automation wrote a version that disagrees with the
tag it created — stop and fix Task 3 rather than moving the tag.

- [ ] **Step 5: Confirm a docs-only push cuts nothing**

```bash
git commit --allow-empty -m "docs: confirm a docs push cuts no release"
git push origin HEAD:main
gh run watch "$(gh run list --workflow 'Release - version on main' --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status
git fetch origin --tags && git tag -l 'v14.2.1'
```

Expected: the run succeeds, its summary says "No release", and `v14.2.1` does
**not** exist. This is the behaviour that keeps docs commits from burning
versions and pushing images.

- [ ] **Step 6: Confirm no loop**

```bash
gh run list --workflow 'Release - version on main' --limit 5 --json displayTitle,conclusion \
  -q '.[] | .displayTitle + " -> " + (.conclusion // "running")'
```

Expected: no run whose title begins `chore(release):`. The release commit must
not have started another versioning run.

---

## Self-Review

**Spec coverage.** The request was: every push to main automatically creates a
version. Task 3 is the trigger, Task 1 the decision, Task 2 the missing link
that makes the resulting tag actually build. Task 4 proves all three, including
the negative case.

**One deliberate narrowing, stated rather than hidden.** Pushes containing only
`docs`/`chore`/`ci`/`test`/`build`/`style`/`refactor` cut no version. Taken
literally, "every push creates a version" would mean a README fix burns a
version number and pushes a container image to ECR. To make it literal instead,
change `bumpForCommit` in `backend/scripts/next-version.js` to
`return 'patch'` in place of its final `return null`, and update the tests in
Task 1 that assert those types cut nothing.

**Risks that the plan handles explicitly.** The `GITHUB_TOKEN` tag not
triggering `release-build.yml` (Task 2). An infinite CI loop (the `if:` guard
plus the same token rule, verified in Task 4 Step 6). Concurrent pushes racing
for the same version (the `concurrency` group). Manifests drifting from the tag
(the existing guard, kept and now exercised on every automated release).

**Risk the plan does not remove.** Every releasable push now builds and pushes
an ECR image. That is the point, but it is a cost change: roughly one image per
feat/fix landing on main rather than one per manual tag. If that proves too
frequent, the fix is to batch releases behind a `workflow_dispatch` rather than
to weaken the version rules.
