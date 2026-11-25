---
paths:
  - "scripts/**/*"
  - "specs/**/*"
  - "src/api/**/*"
  - "src/types/**/*"
  - "src/safe/**/*"
  - "src/api-servers.generated.ts"
  - "src/hateoas-map.ts"
  - "src/deere.ts"
  - "src/path-pattern.ts"
  - ".github/workflows/sync-api.yml"
  - ".github/workflows/ci.yml"
  - ".github/workflows/api-health.yml"
  - ".github/workflows/probe-routes.yml"
  - "tests/fixtures/**/*"
  - "tests/types/**/*"
  - "tests/api-surface*.test.ts"
  - "tests/contract-continuity.test.ts"
  - "tests/embed-contracts.test.ts"
  - "tests/emit.test.ts"
  - "tests/fetched-spec-utils.test.ts"
  - "tests/fix-specs*.test.ts"
  - "tests/generate-*.test.ts"
  - "tests/generated-*.test.ts"
  - "tests/path-params.test.ts"
  - "tests/path-pattern.test.ts"
  - "tests/portal-catalog.test.ts"
  - "tests/routing-guard.test.ts"
  - "tests/routing-overrides.test.ts"
  - "tests/spec-*.test.ts"
---

# Codegen pipeline, api-surface manifest and daily sync

"The offline stages" below are the commands listed under "Generated-code boundary" in the root `CLAUDE.md`, which also
says why not `pnpm generate`.

`fetch-specs` validates **every** document the portal
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

## The api-surface manifest (`scripts/api-surface.yaml`)

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
     name. Before a major, check `removeInMajor` in `scripts/lib/spec-relocations.ts` and
     `scripts/lib/spec-retained-enums.ts`. Release by hand, with the version and the CHANGELOG entry in the same
     change ("Releasing through a pull request" in `.claude/skills/release/SKILL.md`): the sync bumps from `package.json`, so a sync
     that runs before the tag can only release on top of the new version, never ship the change in a patch of
     the old one.
   - **Keep**, when Deere replaced an enum value and nobody can measure which of the two the API accepts:
     dropping the old one would be a major made on no evidence. Restore the manifest, register the old value in
     `scripts/lib/spec-retained-enums.ts` with the operations it is kept for and what was and was not observed,
     and rerun the offline stages. `fix-specs` puts the value back beside its replacement, stamped
     `x-retained-enum-values`. It skips an entry whose value Deere lists again, and throws when the parameter is
     gone, when the operations that reference it are not the ones listed, or when the enum lists neither value.
     `generate-sdk` then lists only the widened signature; accept it and continue as for **Accept**. It is a
     minor. Each entry names `removeInMajor`, and `tests/spec-retained-enums.test.ts` fails once `package.json`
     reaches that major.

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

## Other hand-edited pipeline inputs (`scripts/`)

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

`scripts/api-surface.yaml` sits between generated and hand-written code: `generate-sdk` rewrites it wholesale on additive runs, so only its
`op:` and `name:` values are meant to be hand-edited (the rename/removal approval point described above) and per-entry
hand comments do not survive. Its `signature:` values are machine-written: `pnpm accept-signatures` is how one
changes. `scripts/canonicalize-specs.ts` is a rerunnable, idempotent one-off that renormalizes
committed `specs/raw/*.yaml` to the key order `fetch-specs` now emits, so live fetches diff cleanly against them.

## Path parameters are encoded by the generated methods

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

## Spec text is untrusted where it is emitted

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
method is built from). It does not look inside string or template literals. It runs with the rest of
the suite: in CI, in the daily sync before it commits, and in the release workflow before it publishes. When a generator
starts emitting a new shape on purpose (a value import, a call to a helper), that test is where it gets allowed; allow
the exact import or callee, not the kind.
