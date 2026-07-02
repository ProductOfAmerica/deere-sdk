# Identity-keyed codegen pipeline: eliminate the spec-churn breakage class

## Context

The daily "Sync John Deere API" workflow has been red since 2026-06-24 (8 consecutive runs). Root cause, confirmed by local reproduction: on 2026-06-23 JD re-published the field-operations spec with its `paths` reordered and split into two portal documents. `scripts/generate-sdk.ts` derives public method names from spec document order (JD specs carry no operationIds; `inferMethodName` collapses sibling GETs to the same candidate name; collisions resolve first-come-first-served in `Object.entries(spec.paths)` order, `generate-sdk.ts:465-479`). The reorder rebound `FieldOperationsApi.get` from `GET /fieldOperations/{operationId}` to the shapefile endpoint `GET /fieldOps/{operationId}`; the hand-written facade `src/safe/field-operations.ts:186` (which forces `embed: 'measurementTypes'`) stopped compiling, and the sync dies at Build daily.

The near-miss is worse than the outage: for any caller not passing `embed` (e.g. `deere.fieldOperations.get(id)`), the rebinding compiles clean, silently calls the wrong endpoint, and the sync auto-publishes to npm.

Second defect, same class: `scripts/lib/fetched-spec-utils.ts:48-54` keeps only `responseBody[0]` of the portal's JSON array. Live survey (2026-07-01): 7 of 28 slugs return multiple documents, 43 total, 15 silently dropped today (products=8 docs, flags=3, map-layers=3, field-operations-api / files / webhook / machine-locations=2 each). Documents within a slug are distinguished only by `end_point_name` and `id`.

Related hygiene defects found during planning (must fix or the loud-failure design is fiction):
- All four pipeline entrypoints end with `main().catch(console.error)` (fetch-specs.ts:124, fix-specs.ts:823, generate-types.ts:93, generate-sdk.ts:1008): any thrown error logs and **exits 0**. fix-specs additionally swallows per-file failures (`fix-specs.ts:803-816` counts them and continues), so embed-contracts' "abort loudly" is currently silent in CI.
- `.github/workflows/sync-api.yml` never runs `redact-specs` or `generate-api-servers` (steps at lines 50-69), so an upstream servers change never regenerates `src/api-servers.generated.ts` in the daily sync.
- `generate-types.ts:78` and `generate-api-servers.ts:338` embed `new Date().toISOString()` in generated output: deterministic input produces nondeterministic output, dirtying any idempotence check.

Class definition: the pipeline derives meaning (method identity, document selection) from meaningless positional properties of uncontrolled upstream input, and its failure modes are silent. The fix keys all identity to `(HTTP method, normalized path)`, consumes all documents, makes every failure loud, and classifies + gates upstream changes.

## User-approved design decisions

1. **Naming: committed manifest.** New `scripts/api-surface.yaml` maps operation identity to method name, seeded from today's generated names so the public npm surface does not change. New upstream operations get deterministic auto-appended names. A mapped operation missing upstream fails the sync loudly.
2. **Multi-doc: structural merge.** fetch-specs consumes all portal documents per slug and merges them into the existing single `specs/raw/{slug}.yaml`. Filenames stay stable, so `SpecName`, `API_SERVERS`, `embed-contracts.yaml` `spec:` keys, generated class names, and `src/safe/*` are untouched.
3. **Release gate: classified.** Benign (no substantive diff) → no release. Additive (manifest gained entries) → auto **minor**. Breaking (manifest op missing upstream) → job fails with a named diagnostic. Everything else that diffs → patch, as today.

## Architecture

### A. `scripts/lib/api-surface.ts` (new, pure)

Side-effect-free module per repo convention (entrypoints run `main()` on import and are untestable; precedent `scripts/lib/sdk-gen-utils.ts`). Move `normalizePathPattern` here from `generate-sdk.ts:761` (generate-sdk re-imports, so HATEOAS and manifest identity cannot drift).

- Identity: `` `${METHOD} ${normalizePathPattern(path)}` ``. Param renames (`{orgId}` → `{organizationId}`) do not change identity.
- Manifest format (`scripts/api-surface.yaml`, one entry per operation; `listAll` is a derived twin, never an entry):

```yaml
version: 1
specs:
  field-operations-api:
    - op: GET /fieldOperations/{operationId}   # display path; matched via normalizePathPattern
      name: get
```

- **Write policy: full regeneration, never append.** `serializeApiSurface()` emits a fixed header comment (purpose, breaking-failure runbook, "hand-edit only `name:` values; per-entry comments unsupported"), specs sorted, ops sorted by normalized key. Hand-renamed `name:` values round-trip; display paths auto-refresh on regeneration.
- `loadApiSurface()`: loud validation. Duplicate normalized key per spec, duplicate name per spec, name not matching `/^[a-z][a-zA-Z0-9]*$/`, reserved names (`constructor`, `spec`, `client`), or an explicit `listAll` in a spec whose `list` is a collection GET → throw.
- `resolveMethodNames(specName, ops, surface)` → `{ names, newEntries, missing }`. Pure; output invariant under ops-array order (the class-elimination property).
- `proposeName(op, takenNames)`: verb by method (`get`→`get`/`list` by isCollection, `post`→`create`, `put`→`update`, `patch`→`patch`, `delete`→`delete`) + last non-param path segment capitalized **preserving interior camel humps** (`measurementTypes` → `listMeasurementTypes`; deliberate divergence from legacy `toPascalCase`, documented in the manifest header since new names are new surface). Never a bare verb, never a positional counter. Tiebreaks: prepend preceding segments, then `By${Capitalize(lastPathParam)}`. `takenNames` includes implied `listAll` twins. New ops processed sorted by `(spec, opKey)`.
- `classifyRun({newEntries, missing, specsChanged})` → `'benign' | 'additive' | 'breaking'` (pure, tested; workflow consumes the result via sync-report.json).

### B. `scripts/generate-sdk.ts`: manifest-driven naming

- Manifest absent → hard fail pointing at the seed script. Never auto-seed (auto-seeding from freshly fetched specs is precisely the incident).
- Per spec: `resolveMethodNames`. Aggregate `missing` across ALL specs, then print one diagnostic per entry (spec, `METHOD display-path`, bound name, hint: "rename upstream? update the entry's `op:` to keep the name. Endpoint really gone? delete the entry (breaking; major-version consideration)"), write `sync-report.json`, and `process.exit(1)`. This fires before any generated file is written.
- `newEntries` → use proposed names, rewrite `scripts/api-surface.yaml` via `serializeApiSurface`, log additions, record in `sync-report.json` (`{classification, newOperations: [{spec, method, path, name}], missingOperations: []}`, repo root, gitignored; biome ignores json/yaml so `lint:fix` cannot churn either file).
- `generateMethod` consumes a precomputed name; delete `inferMethodName` + the `usedMethodNames` collision loop (after the seed lands; a defensive throw on duplicate names stays).
- `listAll` twin rule unchanged: emitted iff resolved name `=== 'list'` and collection GET (`generate-sdk.ts:560-575`).
- Everything else (parseSpec, deere.ts / index / hateoas-map generation) unchanged.

### C. `scripts/lib/spec-merge.ts` (new, pure)

`mergeSpecDocs(slug, docs: {endPointName, id, doc}[])`:

- **Doc order: repo-owned, never portal-positional.** Primary doc first via a hardcoded `PRIMARY_ENDPOINT_NAME` table (precedent: `ENV_TIER` in generate-api-servers.ts), seeded from committed raw `info.title` identities: products→`varieties`, field-operations-api→`field-operation`, files→`files-api`, plus the other four multi-doc slugs. Remaining docs sorted by `end_point_name`. Unknown multi-doc slug with no table entry and no slug-match heuristic hit → loud error demanding a table entry (prevents a silent primary flip renaming the public type surface). Single-doc slugs bypass merge.
- **Paths**: union. Same literal path in two docs → merge method-by-method; same path+method both present → deep-equal (key-order-insensitive) → keep primary's, else loud error. Different literal paths sharing a normalized pattern AND a method → loud error (manifest identity would be ambiguous).
- **Components** (all categories, generic): absent → add; deep-equal → dedupe keeping primary's; conflict → rename the non-primary doc's copy to `${Name}_${PascalCase(endPointName)}` and rewrite every `#/components/<cat>/<Name>` `$ref` throughout that doc's whole subtree (one doc-wide walk covers paths/responses/parameters/requestBodies automatically). **Fixpoint loop**: renames can invalidate earlier deep-equal decisions, so re-run compare→rename until stable, iteration-capped with a loud error. Primary-doc names never change, structurally protecting `src/safe/*` type refs and `embed-contracts.yaml` targets.
- **Servers**: declaring docs must deep-equal, else loud error; non-declaring docs inherit.
- **info / tags / extras**: primary's; union `tags` by name; stamp `x-source-documents: [{endPointName, id}]` at spec root.

### D. Canonicalization: `scripts/lib/spec-canonicalize.ts` (new, pure)

- `canonicalizeSpec(doc)`: sort `paths` keys and every `components.<category>`'s keys lexicographically; everything else keeps document order. Applied to EVERY slug at fetch time (the incident was an intra-doc reorder in a single-doc pipeline).
- `stringifySpec(doc)`: `yaml.stringify(doc, { lineWidth: 0, defaultKeyType: 'PLAIN', defaultStringType: 'QUOTE_DOUBLE', aliasDuplicateObjects: false })`. Same options as fix-specs plus `aliasDuplicateObjects: false` (dedup'd merged docs share parsed subtrees; without it yaml emits surprise `&anchor`/`*alias` nodes). Redaction stays text-level per-doc BEFORE parse (portal text → `redactSpecContent` → parse → merge → canonicalize → stringify); `lineWidth: 0` keeps `spec-redactor.ts`'s line-anchored regexes valid for the later `redact-specs` re-pass.

### E. Fetch boundary consumes everything

- `scripts/lib/fetched-spec-utils.ts`: validate ALL array elements (require `id`, `name`, `end_point_name`, parseable `yml_content`; redact per doc); any invalid doc fails the whole slug (null → stale file kept, as today).
- `scripts/fetch-specs.ts`: per slug: validate all → parse → merge (>1 doc) → canonicalize → stringify → write `{slug}.yaml`. `summary.json` gains per-slug `docs: [{id, endPointName}]` (write-only file, no consumers).
- `scripts/check-api-health.ts:87,91`: healthy iff array non-empty and every element has content; add per-slug `docCount` (verify the badge jq in the health workflow tolerates the shape).

### F. `.github/workflows/sync-api.yml`: classified gate

- Add the missing `pnpm redact-specs` (after fetch) and `pnpm generate-api-servers` (after fix) steps, mirroring `pnpm generate` order.
- New `Classify sync` step reads `sync-report.json` with jq → outputs `classification`, `added_ops` markdown list.
- Version bump: additive → `MINOR+1` **and `PATCH=0`** (the current script only increments patch; naive minor logic would mint 2.4.12-style versions); otherwise patch. `force_release=true` with benign classification stays patch (guard on `classification == 'additive'`, not on manifest-diff presence).
- Check-for-changes globs: add `scripts/api-surface.yaml` (belt-and-braces; `git add .` already commits it).
- CHANGELOG step: additive runs render `### Added` with one line per new operation (release.yml:49-63 extracts this section into the GitHub release; lines must not start with `## [`, trivially true).
- `if: failure()` summary step pointing at the Generate SDK log and the manifest runbook; generate-sdk writes sync-report.json BEFORE exiting 1 so the step can list missing ops; the step tolerates a missing file.
- Keep stopping at "push tag" (release.yml/publish.yml handoff unchanged and version-agnostic).

### G. Hygiene (prerequisite for everything above being loud and deterministic)

- All four entrypoints: `main().catch(...)` sets a nonzero exit; fix-specs `main()` exits 1 when its per-file `failed` counter is nonzero.
- Remove the `new Date().toISOString()` stamps from generate-types.ts:78 and generate-api-servers.ts:338 (nondeterministic output from deterministic input is the class under repair; git already records dates). This makes `pnpm generate` fully idempotent, so gates need no file exclusions.
- `scripts/generate-types.ts:35`: sort `readdirSync` (types index export order is currently filesystem-order nondeterministic).

## Migration sequencing (the trap to avoid)

The manifest must be seeded from CURRENT COMMITTED `specs/fixed/*` (still pre-reorder: committed field-operations has `/fieldOperations/{operationId}` before `/fieldOps/{operationId}`) using the LEGACY algorithm, so seeded names are exactly today's public API (including `getEquipmentisgtypes2`, `getEquipmentmodels2`). Only after the byte-identity gate passes does any fetch/merge/canonicalization change land. The seed and legacy-naming code are deleted once the gate passes (re-running a seed later would pin possibly-rebound names; git history preserves it).

## Implementation order (worktree branch `fix/spec-identity-pipeline`; TDD per commit)

1. **Hygiene**: entrypoint exit codes, fix-specs failure propagation, timestamp removal, generate-types sort. Entrypoints are untestable by convention; verify by command (`pnpm fix-specs && pnpm generate-api-servers && pnpm generate-types && git diff --stat` → only the two de-timestamped files change, once).
2. **Extract legacy naming verbatim** into `scripts/lib/legacy-method-names.ts` (`inferMethodName` from generate-sdk.ts:205-233 + the collision loop from :465-479 + `toPascalCase`); generate-sdk consumes precomputed names (resolution hoisted to `generateApiClass`). Tests first: `tests/legacy-method-names.test.ts` locks current behavior including order-sensitivity (asserted deliberately; this freezes the bug we're replacing). Gate: regenerate from committed specs → `git diff --exit-code src/api src/deere.ts src/hateoas-map.ts src/types`.
3. **api-surface lib** (tests first: `tests/api-surface.test.ts`): loader validation failures, round-trip `load(serialize(x)) == x`, resolve hit/new/missing buckets, `proposeName` rules + tiebreaks + twin-aware takenNames, `classifyRun`, and the fast-check reorder-immunity property (resolution invariant under ops permutation; style precedent `tests/fuzz.test.ts`). Also export a pure `extractOps(parsedYaml)` used by both seed and generate-sdk.
4. **Seed**: `scripts/seed-api-surface.ts` (refuses if manifest exists) replays legacy naming over committed `specs/fixed` → commit `scripts/api-surface.yaml` (~133 entries; 156 methods minus 23 derived listAll twins). Spot-check in review: `field-operations-api.get` = `GET /fieldOperations/{_}`, `equipment.get` = `GET /equipment` (the collection; name/REST inversion is pre-existing), counter names present verbatim.
5. **Switch generate-sdk to the manifest** (missing → aggregate diagnostic + report + exit 1; new → propose + rewrite manifest + report). Gitignore `sync-report.json`. **Stage gate A (byte identity)**: regenerate from committed specs → `git diff --exit-code src/api src/deere.ts src/hateoas-map.ts src/types scripts/api-surface.yaml` all empty, then full `pnpm build && pnpm typecheck && pnpm typecheck:test && pnpm test`. Then delete `seed-api-surface.ts`, `legacy-method-names.ts`, and their tests.
6. **spec-canonicalize lib** (tests first: shuffle-then-canonicalize byte-equality property, idempotence, non-target keys keep document order).
7. **spec-merge lib + fetch validation** (tests first: `tests/spec-merge.test.ts` covering disjoint union, method-level same-path merge, deep-equal dedupe vs conflict error, normalized-pattern collision error, rename + `$ref` rewrite cascade with the fixpoint case, servers rules, primary table + heuristic + no-match error, a products-shaped 3-doc fixture; extend `tests/fetched-spec-utils.test.ts` for multi-doc/missing-`end_point_name`/one-bad-doc-fails-slug). Update `check-api-health.ts`.
8. **Wire fetch-specs** (merge + canonicalize + summary.json docs metadata).
9. **One-time canonicalization of committed specs** via a tiny `scripts/canonicalize-specs.ts` + regenerate. Isolates order-only churn from merge churn, and its gate is the real-world reorder-immunity proof: `git diff --exit-code scripts/api-surface.yaml` (manifest unchanged though every spec reordered), `src/deere.ts` unchanged, full test suite green.
10. **Workflow**: sync-api.yml changes per F. Verify with local `actionlint`.
11. **First live fetch (stage gate B, human-reviewed within this PR)**: `pnpm generate` against the live portal. Expected: 7 slugs' raw files merge in the 15 dropped documents; manifest auto-appends new operations (**review the proposed names by hand; they become permanent public API on merge**); `FieldOperationsApi.get` still `@generated from GET /fieldOperations/{operationId}`; loud stops (products path dupes, embed-contract sentinel hits, servers conflicts) resolved as deliberate decisions (table/registry edits). Then `pnpm lint:fix && pnpm build && pnpm typecheck && pnpm typecheck:test && pnpm test && pnpm test:fuzz`, and a second `pnpm generate` → classification `benign`, zero diff (idempotence).
12. **Docs + release**: CLAUDE.md pipeline section (manifest, merge, canonicalization, release buckets, breaking-fix runbook "editing api-surface.yaml is how you approve upstream breaking changes"); CHANGELOG entry. After merge to main: `npm version minor && git push --follow-tags` per the repo's release process (the PR itself is the first additive release; the next scheduled sync should then report benign/no-change, which is the end-to-end proof).

## Repo-convention obligations (AGENTS.md, mandatory)

- Before editing each symbol: `mcp__gitnexus__impact({target, direction: "upstream"})` for `generateMethod`, `inferMethodName`, `parseSpec`, `fixSpec`, `validateFetchedSpec`, `fetchApiSpec`; warn on HIGH/CRITICAL.
- Before each commit: `mcp__gitnexus__detect_changes()`; final review vs main with `{scope: "compare", base_ref: "main"}`.
- Reindex after the big regeneration commits (`node .gitnexus/run.cjs analyze`).
- No AI attribution anywhere (commits, PR).

## Risks and mitigations

- **Products 8-doc merge blast radius**: shared boilerplate schemas dedupe via deep-equal; true conflicts rename only non-primary copies (primary = varieties, whose names the committed types already use). Fixpoint keeps the rewrite sound. If the live run shows pathological rename counts, the fallback lever is "equal modulo consistently-renamed refs" dedupe; do not build speculatively.
- **embed-contracts vs merged field-operations**: measurement-type doc redefining a patched schema either dedupes (deep-equal), renames (different), or, if JD now documents a patched field on the primary, hits the sentinel abort, which fix-specs now propagates as exit 1 → loud sync failure with the registry's own remediation text. All three outcomes are correct by design; (c) is a registry edit, not a code change.
- **First live run unattended is forbidden**: auto-proposed names become permanent public API; the sync stays red until the PR lands, which is safe (it has been red since 06-24 and cannot publish anything).
- **Whole-slug 404 upstream keeps the stale raw file** (unchanged behavior, invisible to the sync): accepted gap; the separate api-health workflow covers slug-level availability. A *document* vanishing from a multi-doc slug surfaces as missing manifest ops → breaking, loud.
- **HATEOAS map growth from new paths**: automatic; generator collision warnings print during stage gate B; review in the PR diff.

## Verification

```bash
# unit + property suites (new)
cross-env TSX_TSCONFIG_PATH=tsconfig.test.json node --import tsx/esm --test tests/api-surface.test.ts
cross-env TSX_TSCONFIG_PATH=tsconfig.test.json node --import tsx/esm --test tests/spec-canonicalize.test.ts
cross-env TSX_TSCONFIG_PATH=tsconfig.test.json node --import tsx/esm --test tests/spec-merge.test.ts

# stage gate A: seeded manifest reproduces today's public API byte-for-byte (commits 2 and 5)
pnpm generate-sdk
git diff --exit-code -- src/api src/deere.ts src/hateoas-map.ts src/types scripts/api-surface.yaml

# reorder-immunity, real-world (commit 9): canonicalize committed specs, regenerate, manifest must not move
pnpm canonicalize-specs && pnpm fix-specs && pnpm generate-api-servers && pnpm generate-types && pnpm generate-sdk
git diff --exit-code -- scripts/api-surface.yaml && git diff --stat src/deere.ts   # expect empty

# stage gate B: live pipeline (commit 11)
pnpm generate
grep -B1 -A4 "async get(" src/api/field-operations-api.ts   # @generated from GET /fieldOperations/{operationId}
pnpm lint:fix && pnpm build && pnpm typecheck && pnpm typecheck:test && pnpm test && pnpm test:fuzz

# idempotence (timestamps removed in commit 1, so this is exact)
pnpm generate && git status --porcelain   # empty after the second run; sync-report.json classification = benign

# whole suite + workflow lint
pnpm lint && pnpm build && pnpm typecheck && pnpm typecheck:test && pnpm test && pnpm test:fuzz
actionlint .github/workflows/sync-api.yml
```

Plus GitNexus `detect_changes` before each commit. The workflow's classification branches can only be fully exercised by scheduled runs; the first post-merge sync (expected: benign, no release) is the final end-to-end check.

## Amendments (2026-07-02, during execution)

These record where the implementation refined or diverged from the design above. The superseded passages are left intact as a historical design record; where an amendment conflicts with the original text, the amendment is authoritative.

1. **Sibling identity exception (supersedes the line-61 merge rule; qualifies the line-30 identity rule).** Two entries that share a normalized key are legal when their raw paths differ, and such siblings are matched by exact literal path, not by normalized key alone. A param rename on one of them (for example `{name}` becoming `{id}`) therefore surfaces as a breaking change rather than being silently absorbed. This qualifies line 30's claim that param renames never change identity: it holds for a lone operation, but two siblings sharing one normalized pattern stay distinct by their literal paths. It supersedes line 61's rule that different literal paths sharing a normalized pattern plus a method are always a loud merge error. Motivated by crop-types, which declares both `GET /cropTypes/{name}` and `GET /cropTypes/{id}`: these normalize identically yet are distinct operations that must retain distinct names.

2. **Platform-family servers reconciliation (extends the line-63 servers rule).** Declaring docs within the John Deere `platform` server family resolve to the primary doc's servers block instead of refusing on any textual difference. Junk placeholder server blocks inherit the primary's block with a warning. Genuinely different server families (a real host-family divergence) still refuse to merge, as line 63 originally specified. Motivated by machine-locations, whose `api` versus `partnerapi` platform variants are the same family, and by products, whose placeholder server blocks are not a real divergence.

3. **Corrected accounting (supersedes the "~133 entries; 156 methods" counts near line 102).** The seeded manifest holds 123 entries, which expand to 146 operations once the 23 derived `listAll` twins are counted (123 + 23 = 146 operations pre-fetch). After the 56 additive operations from the previously dropped portal documents land, the manifest holds 179 entries and 202 operations; the 56 new ops are all `listFoo`-named rather than bare `list`, so they add no twins (146 + 56 = 202).
