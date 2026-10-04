# Collision Guard

**What it does:** warns when two Claude sessions work on the same repo and touch the same file, or both claim the same version number. Catching that early avoids the merge conflicts and renumbering it otherwise causes.

**Where you see it:**
- **Toast:** `⚠ src/09-render.js was also edited 25m ago by another session (release/v0.10.1 · spacex · "Tesla Roadster…")`.
- Claude gets the same note, so it keeps the change focused and mentions the overlap in its report.
- **Version clash:** when `package.json` gets a version another session (on another branch) already uses.
- **`/collisions`:** other sessions active on this repo in the last 24h, their branch, worktree, version, and the files you both edited.

**How it works:** each session records the files it edits (Edit/Write/NotebookEdit) in its own file, keyed by repo. Worktrees count as the same repo, and paths are compared repo-relative. Before an edit, it reads the other sessions' files. Edits older than 12 hours are ignored.

**Cost:** none. No model calls.

**Data saved:** `~/.claude/mods-data/collision-guard/<repo>/<session>.json`.

**Notes:** it only knows about sessions that also run this mod. It warns, it never blocks.
