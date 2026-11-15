---
name: package-release
description: Publish one package from dsh-extension-lab with scoped commits, patch versioning, and a package tag.
---

# Package Release

Use this procedure only when the user explicitly asks to publish a package. The CLI performs the release; do not manually repeat its Git operations.

## Commands

1. Preflight without modifying files:

   ```sh
   pnpm release --package <package-name> --dry-run
   ```

2. Review the package, next version, working-tree paths, build command, and tag shown by the preflight. Resolve any incorrect or unexpected target-package changes before proceeding.
3. Publish with one command:

   ```sh
   pnpm release --package <package-name>
   ```

4. For an explicit version, use `--version X.Y.Z`. Otherwise the CLI increments the patch segment.
5. During the formal command, provide two distinct single-line commit messages: first for package code/build output/version, then for the marketplace index.

## Supplying commit messages

Interactive prompts need a real TTY. They are the default, but any of these work instead:

```sh
# Explicit messages, no TTY required (CI, pipes, agents)
pnpm release --package <package-name> --message "feat(<pkg>): ..." --market-message "chore(marketplace): publish <pkg>@<version>"

# Accept the generated defaults: feat(<pkg>): release <version> / chore(marketplace): publish <pkg>@<version>
pnpm release --package <package-name> --yes
```

Pass both `--message` and `--market-message`, or neither. Without either flag, `--yes`, or a TTY, the CLI stops **before** building anything and prints these options.

## Scope and safeguards

- First commit stages only `packages/<package>/`; second commit stages only `marketplace.json`.
- Never use `git add .` or include unrelated package changes.
- Existing staged changes, a non-main branch, a behind upstream, duplicate version/tag, or missing marketplace entry must stop release.
- The marketplace version points to the first commit. The package tag `<package>-v<version>` also points to that first commit; the push publishes `main` and the tag.
- Failure handling: before the package commit, the CLI restores `packages/<package>/package.json` (and `marketplace.json` if already rewritten) and unstages them, so nothing is committed, tagged, or pushed.
- If a step fails after the package commit, do not reset or amend automatically. The CLI leaves that commit in place, restores only the uncommitted `marketplace.json` edit, and prints what remains to be finished manually.
- Do not run package tests as part of release. Build only the selected package; follow repository testing approval policy for any test request.
