# Routing guard: stop shipping URLs nobody checked

Status: all three PRs implemented (#46, #47, and this one).

Follows `docs/plans/2026-08-13-spec-provenance-registry.md`, which made staleness a tracked
state. That work taught the pipeline when it could not *see* upstream. It says nothing
about whether the URLs it generates are *correct*.

## What prompted this

A live sweep of every path the SDK ships, 122 paths across 4 environments (455 probes,
2026-08-13), found **3 that route to a URL that does not exist**. All three shipped as
typed public methods.

Discriminator, validated with controls on the same hosts each run:

| Response | Meaning |
|---|---|
| `401` | route exists, auth checked before resource lookup |
| `405` | route exists, GET not allowed on it |
| `404` | no such route |
| `403` (nginx HTML) | no such base path |

| Broken path | Cause | Ours? |
|---|---|---|
| `notifications GET /notifications/{sourceEvent}` | `fix-specs` invents a `/platform` servers block; the route is on `/isg` | yes |
| `products GET /activeIngredients` | the merge discards the declaring document's divergent servers block | yes |
| `organizations GET /organizations/{orgId}/users` | an endpoint injected in 2026-01 that no longer exists | yes |

The unifying defect is the one the registry work kept finding: **a guess laundered into a
fact by passing through a generation stage.** `API_SERVERS['notifications']` reads
`kind: 'templated'` with total confidence and carries no trace that Deere never said it.

## PR 1 (done, #46): remove the unwatched endpoint

`injectUndocumentedEndpoints` in `scripts/fix-specs.ts` manufactured
`GET /organizations/{orgId}/users`, its operation, and an `OrganizationUser` schema, and
injected all of it into the organizations spec on every run. `OrganizationsApi.listUsers`
was generated from it and published.

### The evidence, recorded here because the code that held it is being deleted

This was **not** invented. Commit `d0a3b7f` (2026-01-11, "Add organizations.listUsers
endpoint") introduced it under this header:

```
// Undocumented but working endpoints to inject
// These endpoints exist in the API but aren't in the public OpenAPI specs
```

The schema it added carries Deere domain vocabulary that reads like it came off a real
response body, notably `userType`: *"User's type. Examples are customer, dealer,
internal."* Somebody almost certainly observed this endpoint working.

What was missing was **recorded provenance and anything watching it**. No date, no captured
response, no fixture in this repo or in the sibling field-mcp repo, and no probe that would
notice if it stopped working. So when it broke, it stayed broken silently.

### Measured 2026-08-13, before removal

```
/platform/organizations/{orgId}/users     404   no such route
/isg/organizations/{orgId}/users          404
/organizations/{orgId}/users (bare host)  403   no such base path
equipmentapi.../isg/organizations/.../users 404
partnerapi/platform/organizations/.../users 404

controls, same host, same fake orgId:
/platform/organizations/{orgId}           401   route exists
/platform/organizations/{orgId}/farms     401   route exists
/platform/users                           401   route exists
/platform/organizations/{orgId}/staff     401   route exists   <-- not in any spec
/platform/organizations/{orgId}/members   404   control for a genuinely absent sibling
```

Every sibling under the same prefix answers 401. Only `/users` answers 404. And
`/organizations/{orgId}/staff` exists while appearing in no Deere spec and no doc page.

**Most likely: the endpoint was real in January 2026 and Deere has since renamed it
`/users` to `/staff`.**

### Why it was removed rather than repointed

Repointing to `/staff` without seeing a real response would repeat the original mistake:
shipping an unverified claim as a typed fact. The `OrganizationUser` response shape has
never been captured, so a repointed method would carry types nobody has checked, just newer
ones.

Restoring it correctly needs one authenticated `GET /organizations/{orgId}/staff` against a
real org, the response recorded as a fixture, and an entry in the routing-override registry
(PR 2) carrying that evidence and its date. That is a small task for whoever has
credentials, and this document is the pointer to it.

### Also in that PR

The `scripts/api-surface.yaml` entry binding `GET /organizations/{orgId}/users` to
`listUsers` is deleted in the same commit. Without that, the manifest keeps an entry whose
operation has vanished, `classifyRun` returns `breaking`, and `generate-sdk` exits 1.

`OrganizationsApi.listUsers` leaves the public surface, so this is a **major version**.

## PR 2 (done, #47): per-path routing, and the two real routes

A `scripts/routing-overrides.yaml` registry, hand-edited and committed, mirrors
`scripts/lib/spec-registry.ts`'s loader discipline, where **every entry requires dated
evidence**. It replaces `injectDefaultServers` (which blindly assumes `/platform` for any
spec declaring no servers, and fires for exactly one spec: notifications).

Per-path routing is expressed with OpenAPI's own path-level `servers`, read by
`generate-api-servers` and consulted by `resolveRequestUrl`, which already receives the
concrete path. `DeereClient.matchHateoasPattern` already matches concrete paths against
`{param}` patterns; that algorithm gets extracted and shared rather than rewritten.

`isPlatformFamilyUrl` in `scripts/lib/spec-merge.ts` treated a bare deere.com host
as platform-family on purpose, pinned by a passing test naming `active-ingredients`.
Measured, `/` and `/platform` are different routing prefixes (403 vs 404), so that premise
is wrong and the test is reversed. Because fixing it makes `products` refuse to merge, the
registry gains an `acknowledgedDivergentServers` flag as the human reconciliation point,
the same shape as a `frozen` spec or a manifest entry.

## PR 3 (done): the three-layer guard

Layered by what this repo controls. The blocking guards test our own transforms; the
informational one tests Deere's gateway. That split is the point: fail on what you can act
on, report what you cannot.

**1. Invariants** (`tests/routing-guard.test.ts`, hermetic, blocking). No stage may
manufacture routing data. A `servers` block in `specs/fixed/` must trace to either the raw
spec Deere published or an entry in `scripts/routing-overrides.yaml`; a path-level block
must trace to a recorded path override; and every recorded override must still apply to a
real spec and path. This is the test that would have caught both bugs PR 2 fixed.

**2. Routing snapshot** (`scripts/routing-snapshot.yaml`, hermetic, blocking). All 121
paths and the base each resolves to, built by going through `resolveRequestUrl` itself
rather than re-deriving the answer and hoping the two agree. Regenerated by
`pnpm generate-routing-snapshot`, which is deliberately **not** part of `pnpm generate`: a
file the pipeline rewrites on its own approves nothing.

The hand-picked URL assertions elsewhere cover the specs somebody thought about. This
covers every path mechanically, which is the difference between catching a regression in
the spec you considered and one in the spec you did not.

It also runs inside `sync-api.yml`, before the commit step. Without that a Deere-driven
routing change would land on `main` and only then turn CI red; with it, the sync stops and
asks for a human.

**3. Live probe** (`scripts/probe-routes.ts` + `.github/workflows/probe-routes.yml`,
non-blocking). Runs at 05:30 UTC, between the health check and the sync. It tests Deere's
infrastructure, not this repo, so it reports and never fails a build: an alarm that fires
for things you cannot fix is one people learn to ignore.

It **re-validates its own discriminator every run** against a known-good route, a known-bad
route and a known-bad base. If those stop separating it prints `DISCRIMINATOR INVALID` and
reports nothing. The 401-vs-404 mapping is an observation about someone else's gateway, not
a guarantee, and a verdict built on a silently-changed premise would be exactly the failure
this whole effort exists to prevent.

### Verified by breaking each guard on purpose

| Guard | Injected fault | Result |
|---|---|---|
| Invariants | path-level `servers` added to `fields.yaml` with no registry entry | fails, names the spec and path |
| Snapshot | committed snapshot edited to a different base | fails, tells you to regenerate and read the diff |
| Probe | control pointed at a URL returning the wrong code | refuses to report, exits non-zero |

Clean runs: 526/526 tests, and the probe reports 456 of 456 (path, environment) pairs
resolving to a route that exists.
