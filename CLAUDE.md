# CLAUDE.md

## What this is

Unofficial TypeScript SDK for John Deere Operations Center API. 28 APIs, roughly 200 generated methods. Mostly generated
code: specs are pulled from John Deere's portal, patched, and fed through a codegen pipeline into `src/api/*.ts`,
`src/types/generated/*`, `src/api-servers.generated.ts`, and `src/hateoas-map.ts`.

## Commands

```bash
pnpm install              # bootstrap
pnpm build                # tsc → dist/
pnpm typecheck            # src only (no emit)
pnpm typecheck:test       # src + scripts + tests (CI and the daily sync run it too)
pnpm lint                 # biome check
pnpm lint:fix             # biome check --write (run before committing)
pnpm test                 # node --test tests/*.test.ts (CI, the daily sync and release.yml run it)
pnpm test:coverage        # same + experimental coverage
pnpm test:fuzz            # fuzz.test.ts alone (pnpm test already includes it)
pnpm test:routing-guard   # hermetic routing guard only, no network
pnpm probe-routes         # LIVE: unauthenticated GETs against Deere's gateway; never part of a build
```

Run a single test file:

```bash
cross-env TSX_TSCONFIG_PATH=tsconfig.test.json node --import tsx/esm --test tests/client.test.ts
```

Filter by test name within a file: append `--test-name-pattern='…'` to the command above. Tests use the Node built-in
runner (`node:test` / `node:assert`), not Jest or Vitest.

### Codegen pipeline (`pnpm generate`)

```
fetch-specs → redact-specs → fix-specs → generate-api-servers → generate-types → generate-sdk
  raw/*.yaml    raw/*.yaml     fixed/*.yaml    api-servers.ts       types/generated    api/*.ts
```

Each stage is independently runnable (e.g. `pnpm fix-specs`). `fetch-specs` validates **every** document the portal
returns for a slug. A slug can return more than one document; when it does, they are structurally merged into a single
spec (`mergeSpecDocs` in `scripts/lib/spec-merge.ts`). The primary document is pinned by the repo-owned
`PRIMARY_ENDPOINT_NAME` table (falling back to the slug-named document, else a loud error); the primary owns the merged
`info` and its committed `components` names, so a portal reorder cannot silently rename the public type surface. The
merged (or single) document is then canonicalized to a deterministic key order, so an upstream reorder of
`paths`/`components` yields a byte-identical raw file instead of a misleading diff. Redaction runs per document before
parse; `redact-specs` stays downstream as an idempotent safety net.

Servers reconciliation is family-aware. Documents that differ only as environment instances or doc defects of
the shared `https://{environment}.deere.com/platform` family resolve to the primary's servers block (`fix-specs`
normalizes it to the templated form downstream); a genuinely different family (a deere host on a non-platform
path, or mixed families) refuses to merge, preserving the per-family host trust boundary, unless
`scripts/routing-overrides.yaml` acknowledges the divergence with evidence.

#### The api-surface manifest (`scripts/api-surface.yaml`)

Committed and version-controlled. It maps each operation's **identity** (HTTP method + normalized path) to the
public method name the generator emits, so an upstream `paths` reorder cannot rebind a published method to a
different endpoint (on 2026-06-24 one rebound `FieldOperationsApi.get` and took the daily sync red). Identity
normalizes every `{param}` to `{_}`, so a param rename (`{orgId}` becomes `{organizationId}`) keeps the method name.
The one exception is sibling operations that differ **only** by param name (crop-types declares both
`GET /cropTypes/{name}` and `GET /cropTypes/{id}`): those match by exact raw path, so a rename inside such a set
surfaces as breaking for a human to reconcile. `listAll` never appears in the manifest; it is always derived from a
`list` collection GET. New operations receive deterministic proposed names (verb plus the capitalized last
non-param segment, with a documented tiebreak chain; no positional counters).

Editing the `name:` values is how you approve an upstream change: repoint an entry's `op:` to a renamed path
(the name, hence the public method, is preserved), or delete an entry to drop a removed endpoint's method (a
major-version decision). A manifest entry with no matching operation fails the sync with per-entry diagnostics
rather than silently dropping the method.

Every run is classified into `sync-report.json` (gitignored) for the workflow:

- **benign**: no new and no missing operations. Patch release if specs or generated output changed, else none.
- **additive**: new operations, none missing. Minor release; `generate-sdk` rewrites the manifest, folding the
  new entries in with their proposed names.
- **breaking**: a manifest entry lost its operation. The sync fails and surfaces the missing operations; a human
  reconciles the manifest before any release.

CI's `sync-api.yml` runs the pipeline daily, reads the classification, and bumps accordingly: additive cuts a
minor, benign spec churn a patch; a breaking run does not release. Before committing, the sync runs the routing
guard (`tests/routing-guard.test.ts`), which fails when a path in `scripts/routing-snapshot.yaml` resolves to a
different base, when a listed path disappears, or when a new path resolves anywhere but its spec's default base.
New paths on the default base pass, and the sync's next step (`pnpm generate-routing-snapshot`) appends them, so
an additive run completes on its own. Anything the guard fails on needs a human: re-measure, record any override
with its evidence in `scripts/routing-overrides.yaml`, run `pnpm generate-routing-snapshot`, and review the diff.

After the snapshot refresh, and still before anything is committed, the sync runs the whole suite (`pnpm test`) on
the regenerated tree. `release.yml` runs `typecheck:test` and the suite again on the tagged commit before it builds,
because the sync rebases before pushing and a hand-pushed tag never went through the sync. So the sync commits only a
tree whose suite passed, and nothing is published with a red suite. What can still happen: main moves while the sync
runs, so the rebased commit is not the one that was tested. If that commit fails the suite, `release.yml` refuses it,
which leaves a tag and a CHANGELOG entry for a version that was never published; fix the cause and cut the next
version.

The other side of running the suite there: a test that writes down a fact about John Deere's specs stops the sync on
the day the fact changes. Pin such a fact only when a person should look before it ships (the host an environment
reaches, a new environment name, a published method name). Do not pin one that changes no behaviour: the per-spec
environment counts that used to be asserted were removed for that reason. There is no retry: a sync that fails at
"Run tests" is re-run once by hand, and a second failure is real.

Two other daily workflows watch Deere's side, separate from CI: `api-health.yml` (05:00 UTC, same validator as
`fetch-specs`, drives the health badge) and `probe-routes.yml` (05:30 UTC). The probe is report-only for outages
and timeouts. It goes red only when a shipped route answers a deterministic 404/403 while its controls validate,
meaning Deere removed the route: lift a freeze and cut the major, add a routing override, or drop the method.

When Deere moves an operation to another spec document without changing it, the manifest still binds its method to
the old spec and the run reads as breaking. Neither freezing the old spec (nothing would ever lift it) nor dropping
the method (the route still works) is right. Instead register a relocation in `scripts/lib/spec-relocations.ts`:
`fix-specs` copies the operation from the new document back into the owning spec, marked `deprecated` in favour of
the new spec's method, and throws as soon as the entry stops matching Deere's documents (moved back, published in
both, dropped, or a shared component diverging). Each entry names `removeInMajor`; a test fails once
`package.json` reaches that major, so the major release deletes the entry and its manifest entry together.

#### Other hand-edited pipeline inputs (`scripts/`)

No generator rewrites these, so their comments survive. Each file's header is the full reference.

- `spec-registry.yaml`: which specs `fetch-specs` and `check-api-health.ts` fetch, and each one's portal slug. The key
  is the internal name (raw/fixed filename, `*Api` class, public `SpecName`) and never tracks an upstream rename;
  repoint `slug:` instead. An active spec fails the run if it can't be fetched or validated, or if its slug now serves
  a different contract (under half the committed operations survive). `status: frozen` (with `reason:` and `since:`)
  keeps the committed raw file: still fetched for the log, never written, never fails. Check here first when a spec
  isn't picking up upstream changes.
- `routing-overrides.yaml`: base URLs where Deere's spec is wrong or silent, per spec or per path. `fix-specs` writes
  them as `servers` blocks; path-level ones surface as `pathOverrides` in `API_SERVERS`. The loader rejects an entry
  without `evidence:`, so record what was measured and when. `acknowledgedDivergentServers: true` is the only way a
  slug whose documents declare mixed server families will merge.
- `embed-contracts.yaml`: response fields Deere returns but its spec omits (e.g. `?embed=measurementTypes`), patched
  into `specs/fixed` before type generation. Each entry needs a hand-written wrapper in `src/safe/` that forces the
  query param, plus a field in `SafeFacades` (`src/safe/index.ts`). Consumers reach it through
  `deere.safe.<resource>`; the generator needs no change.

## Architecture

### URL resolution is spec-driven (v2.0)

This is the load-bearing design decision of the SDK. Every HTTP method on `DeereClient` takes a `SpecName` as its first
argument:

```ts
client.get('organizations', '/organizations/123')
client.post('equipment-measurement', '/orgs/.../measurements', body)
```

Generated `*Api` classes pass their own `spec` field internally, so consumers of `Deere` never see it. Flow:

```
deere.equipment.getEquipment(id)
  → this.client.get('equipment', '/equipment/...')
    → resolveRequestUrl('equipment', path, env)          // src/environment-resolver.ts
       → API_SERVERS['equipment']                        // src/api-servers.generated.ts
          → templated   → (pathOverrides match ?? urlTemplate).replace('{environment}', env)
          → static      → urlByEnvironment[env]  or throw UnsupportedEnvironmentError
          → unavailable → throw NoServerConfigError
    → requestUrl('GET', url, …)                          // fetch + retry + timeout
```

`API_SERVERS` is derived at build time from each spec's `servers` block. **There is no scalar `baseUrl` in the client.**
Different spec families live on different hosts (`api.deere.com/platform`, `equipmentapi.deere.com/isg`, etc.) and
v1's "route everything through one baseUrl" approach 404'd equipment endpoints silently. Do not reintroduce it.

A templated spec can carry `pathOverrides` for paths Deere serves from a different base than the spec declares
(`/notifications/{sourceEvent}` is on `/isg` while the rest of its spec is on `/platform`). They come from
`scripts/routing-overrides.yaml` with measured evidence, never from a guess.

### No silent environment fallbacks

`environment-resolver.ts` refuses to guess. If a static-server spec doesn't declare a mapping for the requested
environment, it throws `UnsupportedEnvironmentError` *before* any HTTP call. Treat sandbox vs prod as a trust boundary:
silently falling back could delete real customer data. Env mapping lives in `generate-api-servers.ts`; widen it there,
not at the call site.

V1 friendly env names (`sandbox`, `production`, …) are rejected at construction time with a migration hint (see
`V1_LEGACY_ENV_NAMES` in `client.ts`).

### HATEOAS mode and cross-spec parent lookups

When `hateoas: true`, `resolveHateoasUrl` (in `client.ts`) matches the concrete path against `HATEOAS_MAP`, fetches the
parent resource, and follows its HAL link by rel name. Cached per session via `LinkCache`; `warmLinkCache()` pre-fetches
on demand.

The subtle part: `HATEOAS_MAP[pattern].parentSpec` records which spec owns the *parent*. A child in `equipment.yaml` may
live under `/organizations/{orgId}`, but that parent is declared in `organizations.yaml` and hosted on a different
subdomain. Fetching the parent through the child's spec would hit the wrong host. The parent-fetch always routes through
`effectiveParentSpec`.

`HATEOAS_MAP` is regenerated by `generate-sdk.ts`. To add a new cross-spec relationship, edit the generator, not the
output file.

### Bearer-token hostname guard in `fetchUrl`

`DeereClient.fetchUrl` (and `followLink`) is the one entry point for absolute URLs. It attaches the
`Authorization: Bearer …` header **only** to hosts matching `TRUSTED_HOSTS = /^([a-z0-9-]+\.)*deere\.com$/i`.
Third-party URLs (e.g. a HAL link that somehow points off-domain, or a user-supplied webhook URL) get no Authorization
header. This is a deliberate token-leakage safeguard. If you touch `requestUrl`'s header-building logic, preserve the
`_noAuth` path and the rule "user-supplied `options.headers.Authorization` always wins."

### Retry policy

`requestUrl` retries on `{429, 500, 502, 503, 504}`, abort/timeout, and `TypeError`/"fetch" network errors. Exponential
backoff with full jitter; respects `Retry-After` on 429 (capped by `maxDelay`). Auth errors (401/403) and client
errors (400/404/422) never retry. `maxRetries: 0` disables. Do not add retries for 4xx: `handleError` intentionally
turns 401/403 into `AuthError` and everything else into `DeereError`.

Client-side errors (thrown from the resolver before any HTTP) use `CLIENT_ERROR_STATUS = -1` so they can't be confused
with the `status === 0 && statusText === 'Timeout'` sentinel that's the only retryable locally-thrown case.

### Error hierarchy

Lives in `src/errors.ts` (separate from `client.ts` to break a circular import with `environment-resolver.ts`).
`client.ts` re-exports everything for backward compat with consumers importing from `'deere-sdk'` root. The two
resolver errors live in `environment-resolver.ts` instead, so `src/index.ts` exports them itself. A name is not
public until `src/index.ts` lists it: these two were documented from 2.0.0 onward without being exported.

## Generated-code boundary

Never hand-edit these. They get clobbered on the next generate run:

- `src/api/*.ts` (except `src/api/index.ts` which is also generated but safe to regen)
- `src/types/generated/**`
- `src/types/index.ts` (written by `generate-sdk`)
- `src/api-servers.generated.ts`
- `src/hateoas-map.ts`
- `src/deere.ts` (the big class with one field per API)
- `specs/fixed/**`

To change any of them, edit the corresponding generator in `scripts/`, re-run the offline stages
(`pnpm redact-specs && pnpm fix-specs && pnpm generate-api-servers && pnpm generate-types && pnpm generate-sdk &&
pnpm lint:fix`), and commit the regenerated output in the same change. Not `pnpm generate`: it starts with
`fetch-specs`, which pulls live specs and would carry upstream changes past the sync's classification and version
bump. Spec host logic lives in `scripts/generate-api-servers.ts`, generated method shape in
`scripts/generate-sdk.ts`, and spec-level patches in `scripts/fix-specs.ts`.

Hand-written core: `src/client.ts`, `src/environment-resolver.ts`, `src/errors.ts`, `src/path-pattern.ts`,
`src/index.ts`, and `src/safe/**` (the `deere.safe.*` facades).

`scripts/api-surface.yaml` sits between the two: `generate-sdk` rewrites it wholesale on additive runs, so only its
`name:` values are meant to be hand-edited (the rename/removal approval point described above) and per-entry hand
comments do not survive. `scripts/canonicalize-specs.ts` is a rerunnable, idempotent one-off that renormalizes
committed `specs/raw/*.yaml` to the key order `fetch-specs` now emits, so live fetches diff cleanly against them.

## Testing conventions

Tests use `tests/helpers/mock-fetch.ts` for injecting fetch behaviour (JSON success, error, retry-sequence, spy, network
error, timeout, paginated). Never hit the real API in tests: inject a custom `fetch` via `DeereClientConfig.fetch`.
`fuzz.test.ts` uses `fast-check`. `pnpm test` already includes it; `pnpm test:fuzz` runs it alone, and CI adds that
dedicated step only on Node 24.x. `readme-examples.test.ts` type-checks every `typescript` block in `README.md`
against `src/`. A block that cannot compile on purpose needs `<!-- readme-check: skip: reason -->` above its fence.
It checks types only: an example can compile and still call an API its environment does not serve.

CI runs the test matrix on Node 20/22/23/24/25. Node 18 was dropped 2026-05-15 because tsx ≥4.22.0 calls
`Array.prototype.toReversed()` (ES2023, Node 20+). Node 18 hit EOL April 2025. Keep the code Node-20-compatible
(no fresh-platform-API-only features beyond Node 20).

TypeScript is pinned to 6.x (`^6.0.3`). openapi-typescript 7.x, which `generate-types` runs, loads the classic
TypeScript JS API (`ts.factory`) at runtime, and the TypeScript 7 package no longer exposes it: the 7.0.2 bump (#39)
broke type generation for every spec while lint, typecheck, build and tests stayed green. Dependabot ignores
`typescript` >=7. Lift the pin once an openapi-typescript release stops importing TypeScript at runtime
(openapi-ts/openapi-typescript#2841), whether that ships as a major or a minor. `readme-examples.test.ts` uses the
same API, confined to its `typecheckBlocks` function, and needs porting at the same time.

CI's `codegen-drift` job reruns the offline stages listed under "Generated-code boundary" on the committed specs,
then the routing guard and `pnpm generate-routing-snapshot`, and fails if anything changes; keep it in lockstep with
`sync-api.yml`'s stages. A failure means a dependency bump altered codegen output, a generator, registry or manifest
change was committed without its regenerated output, a generated file was hand-edited, or a biome safe fix touched a
hand-written file. Reproduce it with the same offline commands and commit the result; when a dependency bump is the
cause, decide whether the new output is acceptable before regenerating.

## Code intelligence (`typescript-lsp`)

The server loads the workspace's TypeScript, so a fresh clone needs `pnpm install` before it works. A worktree under
`.claude/worktrees/` entered mid-session needs no install for it: types resolve upward into the main checkout's
`node_modules`, so the worktree's code is checked against the main checkout's dependency versions (pnpm scripts
there still fail until `pnpm install`). Reference results cover only the tsconfig projects the server has loaded,
and the root `tsconfig.json` is `src`-only: before trusting a caller count, touch any file under `tests/` (its
`tsconfig.json` spans `src`, `scripts` and `tests`) and repeat the first query, which returns before the project
finishes loading.

## Releases

Ordinary commits and pushes release nothing. To release, commit the `CHANGELOG.md` entry, then:

```bash
npm version patch         # or minor; runs the checks, then commits and tags
git push --follow-tags    # pushes the commit and the tag together
```

What follows about npm's behaviour was measured on npm 11.19.1 (Node 24.22.2, Windows) on 2026-11-12, not on the
npm bundled with the Node 22 that `.nvmrc` names. `npm version` refuses a working tree with uncommitted changes to
tracked files ("Git working directory not clean") before it runs anything, which is why the changelog is committed first; untracked files do not count. It then writes
the new version into `package.json` and runs the `version` script, `pnpm typecheck:test && pnpm test`: the checks
`release.yml` runs before it builds (`tests/release-gate.test.ts` fails if the two drift apart). Only when the script
passes does it commit `package.json` as `X.Y.Z` and create the annotated tag `vX.Y.Z`. A failure exits non-zero and
leaves `package.json` bumped and modified, with no commit and no tag. Running `npm version` again as it stands is
refused, since `package.json` is now dirty, so: `git restore package.json`, commit the fix, run `npm version` again.

The daily sync bumps with `npm version <x.y.z> --no-git-tag-version --ignore-scripts`. `--no-git-tag-version` alone
still runs the script; `--ignore-scripts` skips it because the sync has just run both checks on the same tree, and it
only ever bumps a minor or a patch, so no test that depends on the major can change its result.

**Major releases.** Some tests require a change once `package.json` reaches a given major (a relocation's
`removeInMajor` in `tests/spec-relocations.test.ts`), so `npm version major` on an unchanged tree fails. Do not commit
that change to `main` ahead of the bump: until the tag exists, a daily sync can release it as a minor or a patch. Make
the change, regenerate (including `pnpm generate-routing-snapshot`), write the changelog entry, leave all of it
uncommitted, and let npm bump and check without touching git:

```bash
npm version major --no-git-tag-version   # bumps, runs the version script on this tree; no clean-tree check
git add -A
git commit -m "X.0.0"
git tag -a vX.0.0 -m "X.0.0"             # annotated, as npm makes it: --follow-tags pushes annotated tags only
git push --follow-tags
```

The commit is then exactly the tree the script passed. If the script fails, nothing is committed and `package.json`
stays bumped: run `git restore package.json` before running the command again, because with
`--no-git-tag-version` nothing refuses the dirty tree and a second run bumps from the bumped version (4.0.0 became
5.0.0).

CI sees the tag → type-checks and tests that commit → creates GitHub Release → publishes to npm. A test failure
stops before the release is created; fix it with a new commit and a new tag.

npm publishing uses Trusted Publishing/OIDC via `release.yml`; do not create or restore an `NPM_TOKEN` for CI publishing.

**Gotcha:** GitHub sometimes does not fire the `push` event for a tag pushed via `git push --follow-tags`, so `release.yml` never auto-triggers. If you don't see a "Create Release" run within a minute of pushing the tag, dispatch it manually:

```bash
gh workflow run release.yml --ref vX.Y.Z
```

`release.yml` also accepts `workflow_dispatch`, so this produces an identical run against the tag's commit.
