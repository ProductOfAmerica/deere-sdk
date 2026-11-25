---
name: release
description: "Cut a deere-sdk release by hand: the CHANGELOG entry, npm version and the tag, releasing through a pull request when the version travels with a change, major releases, and a release.yml run that never started. Use when asked to release, publish, bump the version or tag."
---

# Releases

To release, commit the `CHANGELOG.md` entry, then:

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

**Releasing through a pull request.** When the version has to travel with a change (**Accept** and **Keep** under
"When a signature stops the sync" in `.claude/rules/codegen.md`), bump on the branch instead: `npm version <major|minor|patch>
--no-git-tag-version` writes the version and runs the `version` script on the tree without touching git; commit it
with the CHANGELOG entry. If the script fails, run `git restore package.json` before running it again, or the second
run bumps from the bumped version. Once the pull request is merged, tag its squash commit the same day:

```bash
git tag -a vX.Y.Z <squash-commit> -m "X.Y.Z"
git push origin vX.Y.Z
```

If a daily sync released a later version from `main` before the tag, do not tag X.Y.Z: its changes went out in that
release.

**Major releases.** Some tests require a change once `package.json` reaches a given major (a relocation's
`removeInMajor` in `tests/spec-relocations.test.ts`, a retained enum value's in `tests/spec-retained-enums.test.ts`),
so `npm version major` on an unchanged tree fails. Do not commit
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

**Gotcha:** GitHub sometimes does not fire the `push` event for a tag pushed via `git push --follow-tags`, so `release.yml` never auto-triggers. If you don't see a "Create Release" run within a minute of pushing the tag, dispatch it manually:

```bash
gh workflow run release.yml --ref vX.Y.Z
```

`release.yml` also accepts `workflow_dispatch`, so this produces an identical run against the tag's commit.
