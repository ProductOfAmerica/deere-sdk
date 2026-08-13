# Spec provenance registry: make staleness a tracked state

Status: all four phases implemented. One open question, see below.

## Why

On 2026-08-12 the API Health Check workflow went red: Deere had renamed the portal slug
`field-operations-api` to `field-operations`. PR #40 fixed that with a hardcoded override
map. Investigating it surfaced that the same class of failure had already happened to a
second spec, silently, three months earlier.

Four symptoms, one defect:

| Symptom | Where it lived |
|---|---|
| A 404 slug was skipped and the run reported success | `fetch-specs.ts` returned `null`, `continue`d, exited 0 |
| `notifications` was rejected for a `swagger:` key, skipped, run reported success | `isOpenApiDocument` requires `openapi`; `fix-specs.ts:645` already rewrites that exact key one stage later |
| The health badge said 28/28 while the pipeline could not use one of them | `check-api-health.ts` carried its own copy of the spec list and its own content heuristic |
| The only artifact recording skipped specs was inert | `specs/raw/summary.json`, write-only, committed copy six weeks stale |

**A failed fetch was not modeled as a state. It was modeled as nothing happening.**
Nothing downstream could distinguish "this is Deere's current contract" from "this is a
copy from March." `generate-sdk.ts` reads whatever bytes sit in `specs/fixed/` and has no
concept of provenance.

The SDK being a day stale is fine. The SDK being stale while reporting fresh is the defect.

## Why the registry records what it records

`sync-api.yml` counts a run as substantive only if `specs/raw/*.yaml`, `specs/fixed/*.yaml`,
`src/api/*.ts`, `src/types/generated/*.ts`, or `scripts/api-surface.yaml` changed. When
nothing substantive changed, the commit step is skipped entirely.

So a rolling per-spec `fetchedAt` timestamp is the wrong shape. It churns nightly, which
means it either never gets committed on quiet nights (exactly why the committed
`summary.json` was stale) or, wired into change detection, forces a patch release every
night forever.

The registry therefore records only **abnormal state and stable identity**, both of which
change on transitions rather than on a clock. A spec that fetches cleanly carries no
volatile field, and a quiet night produces no diff.

## Design

`scripts/spec-registry.yaml`, committed and hand-edited, validated by
`scripts/lib/spec-registry.ts` with the same hard-fail discipline as
`scripts/lib/api-surface.ts`. Per spec:

- **name** (the mapping key) is the internal identity: the raw filename, the generated
  `*Api` class, and the public `SpecName` literal. It never tracks an upstream rename.
- **slug** is where the portal currently serves it. Deere renames these; a human repoints
  this one value and the public surface is untouched.
- **apiId** is a guard, never a key. See below.
- **status: frozen** plus **reason** and **since** marks a spec deliberately not being
  refreshed.

`active` (the default, no `status` key): must fetch and validate, and a failure fails the
run. `frozen`: still fetched, so the log can report whether the freeze could now be lifted,
but never written and never able to fail the run.

One status covers both reasons a spec can be pinned, because the effect is identical: keep
the committed copy, do not fail, stay visible.

### apiId is not an identity key

Every portal document carries an `api_id`, and it is tempting to resolve renamed slugs with
it. Measured 2026-08-13:

```
/devDoc/apiDetails/products               api_id 5cedab22-…  "Operations Center - Products", 8 docs
/devDoc/apiDetails/service-data-products  api_id 5cedab22-…  "Service Data Product - POPS",  1 doc
```

Two unrelated APIs, one id, and the portal's own catalog maps that id to
`service-data-products`. Resolving `products` by api_id would have silently overwritten
`specs/raw/products.yaml` with a different API's contract under the same filename: right
name, wrong content, no error. That is the exact failure class this work exists to prevent.

So the slug is the identity and a rename is a human decision. apiId is only ever compared
against what a fetch returns: a mismatch proves the slug now serves something else, a match
proves nothing.

## Phase 1 (done)

- `scripts/spec-registry.yaml`, all 28 specs, `notifications` frozen.
- `scripts/lib/spec-registry.ts`, loader and validation. Rejects a spec name or slug outside
  `/^[a-z0-9]+(-[a-z0-9]+)*$/` (the name becomes a filename, the slug is interpolated into a
  URL), a malformed apiId, a frozen entry missing `reason` or `since`, a `since` that is not
  a real date, freeze metadata on a non-frozen entry, and two specs claiming one slug.
- `fetch-specs.ts` drives off the registry. Failure outcomes are now distinguished
  (`http` / `rejected` / `network`) instead of collapsing to one "Not found", the gate fails
  the run after the loop so one run names every broken spec, and the diagnostic states both
  remediations.
- Bounded retry (3 attempts, 500ms then 1500ms) on network errors and 5xx only. A 404 is a
  real answer and is never retried. Without it, failing on the first failed refresh would
  make the nightly sync hostage to a single dropped packet.
- `check-api-health.ts` reads the registry instead of its own copy of the list. This is what
  let it keep probing `field-operations-api` after the rename.
- `PORTAL_SLUG_OVERRIDES` from PR #40 removed; the slug is registry data now.

### notifications

Frozen since 2026-05-23, derived from `specs/raw/summary.json` history: `notFound` went from
`[]` on 2026-05-22 to `["notifications"]` on 2026-05-23. `isOpenApiDocument` landed
2026-05-22 in #21. The freeze was self-inflicted, not an upstream outage.

It stays frozen past the phase 4 fix for a second, unrelated reason. Deere edited the
document on 2026-07-14 and it no longer declares `DELETE /notificationEvents/{sourceEvent}`,
which `scripts/api-surface.yaml` still pins to `NotificationsApi.delete`. Accepting the
current document would classify the run breaking and drop a published method. Deere
announced no retirement, their practice is an ACTION REQUIRED notice with six to eight
months of warning, and the API is still marked active, so the endpoint is believed live and
the doc merely tidied. Lifting the freeze needs that confirmed with Deere support; dropping
the method is a major-version decision.

## Phase 2: health check parity (done)

`check-api-health.ts` decided "healthy" with its own heuristic (does every document carry
more than 10 characters). That is a second opinion, and it disagreed with the pipeline: it
reported `notifications` healthy for three months while `fetch-specs` could not consume that
document at all. A badge grading on an easier curve than the build is worse than no badge.

It now calls `validateFetchedSpecDocs`, so health means what the sync means by it. Frozen
specs are reported as their own state, carry a `liftable` flag so a freeze whose cause has
gone away surfaces instead of becoming permanent, and never fail the check.

Badge thresholds now track whether the sync can run: green when every spec is fresh, yellow
when the only shortfall is recorded freezes, red when an active spec is unusable. The old
rule (green on all-healthy, yellow above an arbitrary 20, else red) had no such relationship.

One structural defect fixed alongside: the red branch was unreachable. The check step failed
the job before the badge steps ran, and `commit-health-status` needed that job, so a genuine
outage failed the run and left the badge displaying its last healthy value. The check now
records its exit code without failing, the badge and artifact are written,
`commit-health-status` runs with `if: !cancelled()`, and a final step fails the job.

## Phase 3: portal catalog as a diagnostic (done)

`https://developer.deere.com/dev-doc-landing` embeds the full catalog in its `__NEXT_DATA__`
island: `devDocRoutes`, apiId to `/dev-docs/{slug}`, 85 APIs. Free to fetch, no browser.

**Not** a slug resolver, for two independent reasons. The apiId collision above is the
first. The second was found while implementing: the catalog is not a complete list of
fetchable slugs. `products` has no `/dev-docs/products` route at all, yet
`/devDoc/apiDetails/products` serves 8 valid documents. So absence from the catalog does not
prove a slug is dead. 27 of our 28 slugs appear; `products` is the exception.

Instead `scripts/lib/portal-catalog.ts` explains an already-failed fetch: whether the slug
is still published, what the recorded apiId now maps to (flagged as a lead, not an answer),
and similarly named published slugs. Both caveats are survivable precisely because this only
runs on a spec that has already failed, so a live-but-unlisted slug like `products` never
reaches it, and the worst case is a misleading hint beside a real error.

Consulted lazily, only when something is blocked, so a healthy sync never pays for it. Every
failure path returns null and the run carries on without the hint, which keeps the
undocumented Next.js internal off the critical path.

Replaying the original outage against this shows the two-day silent failure would have been
a one-line registry edit on day one:

```
  field-operations-api: HTTP 404
    - "field-operations-api" is not in the portal catalog (85 published APIs), which is
      consistent with an upstream rename. Not proof: some live slugs are unlisted.
    - the recorded apiId now maps to "field-operations" in the catalog. Treat as a lead,
      not an answer: the portal reuses one apiId across unrelated APIs, so confirm the API
      is the same one before repointing the slug.
    - similarly named published slugs: field-operations
```

## Phase 4: validator parity (done)

`isOpenApiDocument` rejects any document whose version key is not `openapi`.
`fix-specs.ts:645-650` already rewrites `swagger` to `openapi`, with a comment naming
`notifications.yaml`. Two stages of our own pipeline disagree, and the newer stricter one
silently undid a deliberate accommodation.

Accept a document as OpenAPI 3 when it is structurally OpenAPI 3 regardless of which key
carries the version. Verified safe: the live document has top-level
`swagger, info, paths, components`, carries `components` not `definitions`, and its
parameters use `schema:`. Downstream is already prepared, including
`fix-specs.ts:357-365` injecting the servers block it lacks.

Also correct `generate-api-servers.ts:15`, which still documents `notifications` as the
example of `kind: 'unavailable'` while the generated output says `templated`.

## Hardening (done, with phase 4)

`sync-api.yml` bumped `breaking` as a patch, identically to `benign`, and no step gated
commit, push, or tag on the classification. The only thing between a breaking upstream
change and an unsupervised npm publish was `generate-sdk.ts` calling `process.exit(1)`.
Single point of failure on the one path where being wrong is most expensive.

A "Refuse to release a breaking run" step now sits immediately after classification. In
practice it is unreachable, which is the point: it costs nothing and removes the single
point of failure.

## The open question

Is `DELETE /notificationEvents/{sourceEvent}` still live? Deere edited the document on
2026-07-14, announced nothing, and still marks the API active. Their practice is an ACTION
REQUIRED notice with six to eight months of warning, so the endpoint is believed live and
the doc merely tidied. Confirming that needs a Deere support ticket.

This is the class of change no machinery resolves. A dropped operation is either a
retirement (breaking, major) or a doc defect (noise), and the deciding fact is not in the
document. Automate what the document can answer; halt and escalate what it cannot.

Until it is answered, `notifications` ships a `delete` method for an operation its own spec
no longer declares. That is the right call under ambiguity, and it is still an accuracy
debt. A freeze with no expiry becomes permanent by neglect; `since` and the per-run
"fetches cleanly today" line keep it visible, but neither forces the decision.
