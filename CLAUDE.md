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
pnpm accept-signatures    # generate-sdk, re-pinning method signatures in the manifest on the way (see below)
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

A manifest key with entries and no file under `specs/fixed` fails the same way, with every one of its entries
missing and the spec named in `absentSpecs` (`resolveSurface` in `scripts/lib/api-surface.ts`). It used to be
skipped, and the generator dropped the whole class. No pipeline stage deletes a spec file, so every way here is a
file deleted by hand (the raw file of a frozen spec is one). `fix-specs` applies a relocation while it processes the
`into` spec's raw file, so a relocation into a spec with no file is skipped without a word; that spec's manifest key
is then what reports it. Editing entries is the wrong fix here. Either:

- restore the spec: its file under `specs/raw`, then the offline stages, which write `specs/fixed` from it; or
- remove the API, a major-version decision. Delete `specs/raw/<spec>.yaml`, `specs/fixed/<spec>.yaml`,
  `src/api/<spec>.ts` and `src/types/generated/<spec>.ts`, the spec's key in this manifest and its entry in
  `scripts/spec-registry.yaml`; run the offline stages, then `pnpm generate-routing-snapshot`, which drops its
  rows; and lower the spec-count floor in `tests/generate-api-servers.test.ts`. The raw file matters most:
  `fix-specs` processes every file under `specs/raw` without consulting the registry, so while it is there the
  spec comes back, and with its key gone the run is additive and re-adds every method under a newly proposed name.
  Nothing else deletes these files, and `tsc` fails on a stale wrapper once `generate-api-servers` has dropped the
  spec from `SpecName`. The API table in README.md lists the class too, and no check catches that row.

Each entry also pins its method's **signature**: the parameters and return type as one line of text, built by
`methodSignature` (`scripts/lib/sdk-gen-utils.ts`) from the same pieces as the emitted method. Before this, a
parameter John Deere added, removed or retyped was published in the next patch release with nobody having looked.
A path parameter appears as a bare `string`, and query members and enum values are sorted, so a rename or a reorder
upstream changes no signature. What a named schema contains is not pinned: a field added to or dropped from a
`components['schemas']` type still ships as a patch. `listAll` is covered through its `list`. A signature is written
for a new operation and by `pnpm accept-signatures`, never by hand.

Every run is classified into `sync-report.json` (gitignored) for the workflow:

- **benign**: no new operation, none missing, no signature changed. Patch release if specs or generated output
  changed, else none.
- **additive**: new operations, nothing missing or changed. Minor release; `generate-sdk` rewrites the manifest,
  folding the new entries in with their proposed names and their signatures.
- **breaking**: a manifest entry lost its operation (including every entry of a spec whose file is gone, listed in
  `absentSpecs`), or a method's signature is not the one pinned (an entry with no signature counts). `generate-sdk`
  exits before it writes a class or the manifest, and the sync fails there
  and surfaces them; a human reconciles before any release.

**When a signature stops the sync.** Nothing was committed, tagged or published, and each daily run stops again
until it is resolved. The job summary lists each method with its pinned and its current signature.

1. Reproduce it on a branch: `pnpm fetch-specs`, then the offline stages. This is the one place outside the sync
   where `fetch-specs` belongs, because here the person is the classifier. `generate-sdk` stops with the same list;
   if Deere has changed again since, go by the local output.
2. To see what the change does to the code, run `pnpm accept-signatures && pnpm lint:fix` and read the diff of
   `src/api` and of the manifest.
3. Then one of:
   - **Repair**, when the spec documents something the API does not do. Restore the manifest
     (`git restore scripts/api-surface.yaml`), add a guarded fix to `scripts/fix-specs.ts` with its test (skip when
     the defect is absent, throw when it is reworded), and rerun the offline stages until `generate-sdk` passes.
     Commit only the fix and its test, not the fetched specs or the regenerated output: the fix is a no-op on the
     committed specs, so `codegen-drift` passes, and the next sync releases as usual.
   - **Accept**, when the change is real. Keep the re-pinned manifest, run the routing guard and
     `pnpm generate-routing-snapshot`, and commit what the sync would have: `specs/raw`, `specs/fixed`, the
     regenerated `src`, the manifest and the snapshot. Choose the version by what the change does to callers. It
     is a major if code written against the old signature can stop compiling or starts doing something else: an
     argument removed, inserted or made required (a method's first query parameter counts, because it inserts
     `params` ahead of `options`), a query member removed or made required, an enum value removed, a parameter
     or body type changed to anything but a wider one, a return type the old one's callers cannot use as they
     did. It is a minor if it only adds or widens: a new optional member in a `params` the method already had,
     a new enum value, a wider parameter or body type, a return type that was `unknown` or `void` and now has a
     name. Before a major, check `removeInMajor` in `scripts/lib/spec-relocations.ts`. Release by hand.

A generator change that alters signatures stops the offline chain the same way. Run `pnpm accept-signatures`, commit
the manifest with the regenerated output, and release by hand so the change does not go out inside the next sync
patch. `pnpm accept-signatures` is the only thing that rewrites a pinned signature, and it never accepts a missing
operation.

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
  query param and takes `options?: RequestOptions` last, forwarding it to the raw method (without it a caller cannot
  pass a signal, timeout or headers), plus a field in `SafeFacades` (`src/safe/index.ts`). Consumers reach it through
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

### Path parameters are encoded by the generated methods

Every generated method fills each `{param}` of its path through `encodePathParam` (`src/path-pattern.ts`), the one
value a generated class imports from hand-written code. It percent-encodes the argument into exactly one segment,
leaving `@` and `:` as they are, and refuses what cannot be a segment (anything but a string, finite number, bigint
or boolean; the empty string; `.` and `..`; malformed text) with a `DeereError` using `CLIENT_ERROR_STATUS` and
statusText `'InvalidPathParameter'`. Before it existed an argument was written into the path as it came, and one
containing `/` or `..` addressed a different resource.

Routing depends on this, not only safety: `pathOverrides` and the HATEOAS map recognise a request path by its segment
count, so a parameter that spilled into two segments also lost its override or its parent. `DeereClient.get(spec,
path)` takes the path as written and encodes nothing. The package root exports `encodePathParam` for callers who
build such a path, because `encodeURIComponent` leaves `..` alone; `warmLinkCache` paths must carry values the same
way the request will. `tests/generated-structure.test.ts` pins how every generated method builds its request: each
`${...}` in its `path` is either an `encodePathParam` call on the method's own parameter or the query-string suffix,
and that `path` is the one thing the client is handed as the path.

The same test pins what follows the path, per client method, because the two kinds differ: `get`, `delete` and
`getAll` take the options next, while `post`, `put` and `patch` take a body first. A write whose spec declares no
request body is therefore generated with `undefined` in the body slot (`clientCallArguments` in
`scripts/lib/sdk-gen-utils.ts`). Leaving the slot out, as the generator once did, put the caller's options there:
they were sent as the request body and none of them was applied. A read that declares a request body stops the
generator, since `DeereClient` has no parameter to carry one.

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

### Bearer-token guard in `requestUrl`

`DeereClient.requestUrl` is the one place the `Authorization: Bearer …` header is attached (`buildHeaders`), and every
request passes through it: resolver-built URLs, `fetchUrl` and `followLink`, pagination, and links discovered in HATEOAS
mode. The token goes **only** to an https URL whose host matches `TRUSTED_HOSTS = /^([a-z0-9-]+\.)*deere\.com$/i`
(`isTrustedUrl`). Any other URL is requested with no Authorization header.

The check used to live in `fetchUrl`, with an internal `_noAuth` option that told `requestUrl` to skip the token. Every
other caller got the token by default, so a link discovered in HATEOAS mode was sent it whatever host it named. Do not
reintroduce a per-caller opt-out: the decision belongs where the request is made. Rules to preserve when touching
`buildHeaders`:

- A caller's `options.headers` Authorization always wins: it is sent as given, to any host, and replaces the token.
- The header name is compared without regard to case. Two keys differing only in case are sent as one header carrying
  both values.
- `defaultHeaders` cannot set Authorization; the constructor drops it, since it would reach every host contacted.

Links the client follows on its own are held to the same test, through `untrustedLinkProblem`. `resolveHateoasUrl`
refuses a discovered link that fails it with `HateoasError`, and `paginate` refuses a `nextPage` link with a `DeereError`
(`CLIENT_ERROR_STATUS`, statusText `'UntrustedLink'`). They are refused, not followed without the token, because the
request would still be sent there with the caller's `options.headers` and, for a POST, its body. A URL the caller
passes to `fetchUrl` or `followLink` is different: it is requested as asked, without the token when it is not trusted.
`tests/fetch-url-security.test.ts` checks that every URL the resolver can build is trusted, so a spec whose servers
leave deere.com fails there instead of producing unexplained 401s.

### Retry policy

`requestUrl` retries on `{429, 500, 502, 503, 504}`, its own timeout, and `TypeError`/"fetch" network errors.
Exponential backoff with full jitter; respects `Retry-After` on 429 (capped by `maxDelay`). Auth errors (401/403) and
client errors (400/404/422) never retry. `maxRetries: 0` disables. Do not add retries for 4xx: `handleError`
intentionally turns 401/403 into `AuthError` and everything else into `DeereError`.

`retryNonIdempotent` (config, default `true`) decides whether POST and PATCH are retried like the rest. With `false`
they are retried only on 429: after a 500/502/503/504, a network error or a timeout the request may already have been
carried out. That a 429 means the request was not handled is how rate limiters behave, not something HTTP promises.
The rule is an allow-list, `IDEMPOTENT_METHODS`, so a method it does not know (`fetchUrl` passes on whatever the caller
wrote, compared in upper case) is treated as POST is. The default becomes `false` in 4.0, and a test in
`tests/retry.test.ts` fails once `package.json` reaches major 4 until the constructor is changed.

Whatever `retryNonIdempotent` says, an attempt that got a success status (`succeeded` in `requestUrl`) is sent again
after a timeout or network error during its body read only when the method is in `IDEMPOTENT_METHODS`: the server has
carried the request out, so a second POST would do the work twice. Before the timeout covered the body, a dropped
connection mid-body was enough to resend a POST.

Client-side errors (thrown from the resolver before any HTTP) use `CLIENT_ERROR_STATUS = -1` so they can't be confused
with the timeout error, `status === 0 && statusText === 'Timeout'`.

### Timeout and cancellation

Each attempt gets its own `AbortController`, and fetch is handed that signal and no other. Two things abort it: the
timeout, and the caller's `options.signal` through a listener that the attempt's `finally` removes. A local `timedOut`
flag says which. The error fetch rejects with does not, so never classify by `error.name === 'AbortError'`: doing that
is what once had a cancellation retried and reported as a timeout.

- A timeout is retried, and ends as `DeereError('Request timeout', 0, 'Timeout')`. It covers the whole attempt, the
  body read included (an error body too): the timer is cleared only in the attempt's `finally`. A body that outlasts it
  is retried for an idempotent method and never for a POST or PATCH that got a success status (see "Retry policy").
  One that fires while `handleError` reads an error body surfaces as that HTTP error, without its body, because the
  `DeereError` check comes first in the catch. A body that ignores the abort and completes anyway is returned. A
  `timeout` above what a timer can hold (`Infinity` is the documented way to turn
  it off) arms no timer, because Node would set that timer for 1 ms.
- A timeout that is not a duration is refused, because Node arms a timer for 1 ms when handed 0, a negative number,
  NaN or a non-number. Accepted: a number or string whose `Number()` is above 0, kept as given (a numeric string worked
  before and still does); `null` and `undefined` mean the default. The constructor throws a plain `Error`, like
  `validateEnvironment`. A per-call value rejects with `DeereError(..., CLIENT_ERROR_STATUS, 'InvalidTimeout')` from
  `checkCallTimeout`, called at the top of `request()` and `paginate()` (ahead of HATEOAS resolution, so the error is
  not wrapped in `HateoasError`) and in `requestUrl()` outside the retry loop (for `fetchUrl` and `followLink`).
- A caller abort is never retried and rejects with `signal.reason` as it is, not a `DeereError`. `sleep` takes the
  signal, so a backoff ends at once. `resolveHateoasUrl` throws the reason too, where any other failure of the parent
  lookup or fetch becomes a `HateoasError`.
- A listener is never called for a signal that has already aborted, so `requestUrl` checks before every attempt and
  `sleep` checks before it waits.
- The HATEOAS parent fetch is given the call's `signal` and `timeout`, never its `headers`: an Authorization among
  them would replace the client's token on a request the caller never saw.
- The fetch is not raced against the signal. A custom `fetch` that ignores `init.signal` runs its attempt to the end;
  the client then sends nothing further.

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

### Spec text is untrusted where it is emitted

The specs come from John Deere's portal and the sync publishes what the generators write without a person reading it,
so text from a spec must never be able to end the literal, comment or identifier it is written into. A summary
containing a comment terminator used to become a class member that ran when the generated module loaded; a run that
only changes a description classifies as benign and is released. `scripts/lib/emit.ts` is the one place this is
handled, and a generator never builds quotes or a comment around spec text itself:

- Text that stays data is escaped: `tsStringLiteral` for anything quoted (parameter names, enum values, schema names,
  URLs, map keys) and `jsDocText` for anything placed in a comment.
- Text that becomes syntax is checked and the run stops when it does not fit: `assertPathKey` for path keys (which are
  written unescaped into a template literal and supply parameter identifiers), `assertEnvironmentName` for environment
  names (substituted into a hostname at run time). A failure means upstream published a new shape; widen the grammar
  there once a person has looked.
- `generate-api-servers` classifies a spec as `unavailable` when its server URL is not a plain https base on deere.com
  (no credentials, query or fragment, and `{environment}` named exactly once in a template), and refuses a path-level
  one outright. The resolver appends the request path to that string, so anything else would send requests to another
  host, to the wrong path, or not at all.

`tests/generated-structure.test.ts` is the second line of defence and does not rely on the list of emit sites: it fails
if a committed generated file contains anything of a kind no generator emits (a class member, a top-level statement, a
computed value in a table, a default parameter value, or a statement or call in a method body other than the few every
method is built from). It does not look inside string or template literals. It runs only in CI, which gates no
release: the sync commits and tags, and the release workflow publishes, without running the suite. When a generator
starts emitting a new shape on purpose (a value import, a call to a helper), that test is where it gets allowed; allow
the exact import or callee, not the kind.

Hand-written core: `src/client.ts`, `src/environment-resolver.ts`, `src/errors.ts`, `src/path-pattern.ts`,
`src/index.ts`, and `src/safe/**` (the `deere.safe.*` facades).

`scripts/api-surface.yaml` sits between the two: `generate-sdk` rewrites it wholesale on additive runs, so only its
`op:` and `name:` values are meant to be hand-edited (the rename/removal approval point described above) and per-entry
hand comments do not survive. Its `signature:` values are machine-written: `pnpm accept-signatures` is how one
changes. `scripts/canonicalize-specs.ts` is a rerunnable, idempotent one-off that renormalizes
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
(openapi-ts/openapi-typescript#2841), whether that ships as a major or a minor. Two tests use the same API and need
porting at the same time: `readme-examples.test.ts`, confined to its `typecheckBlocks` function, and
`generated-structure.test.ts`, which only parses.

CI's `codegen-drift` job reruns the offline stages listed under "Generated-code boundary" on the committed specs,
then the routing guard and `pnpm generate-routing-snapshot`, and fails if anything changes; keep it in lockstep with
`sync-api.yml`'s stages. A failure means a dependency bump altered codegen output, a generator, registry or manifest
change was committed without its regenerated output, a generated file was hand-edited, or a biome safe fix touched a
hand-written file. Reproduce it with the same offline commands and commit the result; when a dependency bump is the
cause, decide whether the new output is acceptable before regenerating. A failure at its "Generate SDK" step that
lists signatures means a change altered a method's signature without re-pinning it: `pnpm accept-signatures`.

## Code intelligence (`typescript-lsp`)

The server loads the workspace's TypeScript, so a fresh clone needs `pnpm install` before it works. A worktree under
`.claude/worktrees/` entered mid-session needs no install for it: types resolve upward into the main checkout's
`node_modules`, so the worktree's code is checked against the main checkout's dependency versions (pnpm scripts
there still fail until `pnpm install`). Reference results cover only the tsconfig projects the server has loaded,
and the root `tsconfig.json` is `src`-only: before trusting a caller count, touch any file under `tests/` (its
`tsconfig.json` spans `src`, `scripts` and `tests`) and repeat the first query, which returns before the project
finishes loading.

## Releases

Ordinary commits and pushes release nothing. To release, update `CHANGELOG.md`, then:

```bash
npm version patch         # or minor, major; auto-commits and creates the tag
git push --follow-tags    # pushes the commit and the tag together
```

CI sees the tag → type-checks and tests that commit → creates GitHub Release → publishes to npm. A test failure
stops before the release is created; fix it with a new commit and a new tag.

npm publishing uses Trusted Publishing/OIDC via `release.yml`; do not create or restore an `NPM_TOKEN` for CI publishing.

**Gotcha:** GitHub sometimes does not fire the `push` event for a tag pushed via `git push --follow-tags`, so `release.yml` never auto-triggers. If you don't see a "Create Release" run within a minute of pushing the tag, dispatch it manually:

```bash
gh workflow run release.yml --ref vX.Y.Z
```

`release.yml` also accepts `workflow_dispatch`, so this produces an identical run against the tag's commit.
