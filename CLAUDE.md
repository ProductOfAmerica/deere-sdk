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
pnpm test:coverage        # same + experimental coverage; leaves out src/types/generated (type-only, nothing runs)
                          # and tests/*.test.ts (naming any exclude drops Node's default test-file exclusion)
pnpm test:fuzz            # fuzz.test.ts alone (pnpm test already includes it)
pnpm test:routing-guard   # hermetic routing guard only, no network
pnpm accept-signatures    # generate-sdk, re-pinning method signatures in the manifest on the way (see `.claude/rules/codegen.md`)
pnpm probe-routes         # LIVE: unauthenticated GETs against Deere's gateway; never part of a build
```

Run a single test file:

```bash
pnpm exec cross-env TSX_TSCONFIG_PATH=tsconfig.test.json node --import tsx/esm --test tests/client.test.ts
```

Filter by test name within a file: append `--test-name-pattern='…'` to the command above. Tests use the Node built-in
runner (`node:test` / `node:assert`), not Jest or Vitest.

### Codegen pipeline (`pnpm generate`)

```
fetch-specs → redact-specs → fix-specs → generate-api-servers → generate-types → generate-sdk
  raw/*.yaml    raw/*.yaml     fixed/*.yaml    api-servers.ts       types/generated    api/*.ts
```

Each stage is independently runnable (e.g. `pnpm fix-specs`).

## Where the rest lives

Guidance for one area loads on demand from these files. The `paths:` list at the top of each rule names the files it
covers.

- `.claude/rules/codegen.md`: the spec pipeline, the api-surface manifest, what to do when the daily sync or
  `generate-sdk` stops, the routing guard, the health and route-probe workflows, hand-edited pipeline inputs, path
  parameters, and spec text in generated code.
- `.claude/rules/client.md`: URL resolution, environments, HATEOAS, the bearer-token guard, retries, timeouts and
  errors.
- The `release` skill (`.claude/skills/release/SKILL.md`): cutting a release, and what has to stay in step when
  `release.yml`, the `version` script or `tests/release-gate.test.ts` change.

A rule loads by itself when Read, Write or Edit, or a Bash read of that one file (`cat`, `head`, `grep` and the like),
touches a file its `paths` match. It arrives with that tool's result, so an Edit to a file not read yet can run before
it is in context. Nothing loads it for `git diff`, `gh pr diff`, the Grep tool, LSP, MCP tools, or files under
`.claude/worktrees/`. So before you change, review or debug code in a rule's area, Read the rule unless it is already
in context.

New guidance goes in the file for its area; this file holds only what every session needs. When you add a source or
test file, add it to its rule's `paths`.

## Architecture invariants

Reasons and details: `.claude/rules/client.md`, and `.claude/rules/codegen.md` for path parameters.

- A request addressed by spec and path (`client.get(spec, path)` and every generated method) gets its URL from
  `resolveRequestUrl` and `API_SERVERS`. There is no scalar `baseUrl` in the client; do not reintroduce it.
- A static-server spec with no mapping for the requested environment throws `UnsupportedEnvironmentError` before any
  HTTP call (in HATEOAS mode a path with a parent resolves only the parent's spec). Never add a fallback: sandbox vs
  prod is a trust boundary.
- Generated methods encode each path parameter with `encodePathParam` (`src/path-pattern.ts`);
  `DeereClient.get(spec, path)` takes the path as written and encodes nothing.
- The client's bearer token is attached only in `requestUrl` (`buildHeaders`), and only for https URLs on `deere.com`
  hosts (`TRUSTED_HOSTS`). An Authorization in a call's `options.headers` is sent as given; one in `defaultHeaders` is
  dropped. Do not reintroduce an internal option that skips the token.
- `requestUrl` retries 429, 500, 502, 503 and 504, its own timeout and network errors, with exceptions for POST and
  PATCH (`retryNonIdempotent`); add no retries for other 4xx. Never classify an abort by
  `error.name === 'AbortError'`.

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

## Testing conventions

Tests use `tests/helpers/mock-fetch.ts` for injecting fetch behaviour (JSON success, error, retry-sequence, spy, network
error, timeout, paginated). Never hit the real API in tests: inject a custom `fetch` via `DeereClientConfig.fetch`.
`fuzz.test.ts` uses `fast-check`. `pnpm test` already includes it; `pnpm test:fuzz` runs it alone, and CI adds that
dedicated step only on Node 24.x. `readme-examples.test.ts` type-checks every `typescript` block in `README.md`
against `src/`. A block that cannot compile on purpose needs `<!-- readme-check: skip: reason -->` above its fence.
It checks types only: an example can compile and still call an API its environment does not serve.

The daily sync runs the whole suite before it commits, so a test that pins a fact about John Deere's specs stops the
sync on the day that fact changes. Pin one only when a person should look before it ships (more in
`.claude/rules/codegen.md`).

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

Ordinary commits and pushes release nothing. Invoke the `release` skill before any release step, and before changing
`release.yml`, the `version` script or `tests/release-gate.test.ts`.

When the daily sync finds changed specs or generated output, it commits them to `main` and tags a minor or a patch (a
breaking run stops instead), so anything else already on `main` ships in that release. A change that needs a major, or
has to ship as its own release, carries its version bump and CHANGELOG entry in the same change and never lands on
`main` ahead of them.

npm publishing uses Trusted Publishing/OIDC via `release.yml`; do not create or restore an `NPM_TOKEN` for CI publishing.
