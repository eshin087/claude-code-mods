# PR Desk

**What it does:** your open pull requests in one place, with the Vercel preview link ready to click.

**Where you see it:** the dock's **PRs 2✗** button (count of open PRs; ✗ when one is failing or conflicting) toggles a pane, as does `/prs`. Each of your open PRs in the repos listed in `config.json` (and whichever repo the session is in) shows:
- number and title (marked if draft)
- checks: ✓ passing / ✗ failing / … running
- merge state: mergeable / conflicts with base
- branch, worktree folder (for the current repo), and last update
- **preview** and **PR** links

It refreshes every 3 minutes while open, every 15 minutes in the background (so the badge stays current), or on **Refresh**.

**How it works:** runs `gh pr list --author @me` per repo. The preview link is read from the Vercel bot's PR comment. If none is found, it builds Vercel's branch alias and marks it "(guessed)".

**Cost:** none. Uses your GitHub CLI login. No model calls.

**Data saved:** none.

**Settings:** copy `config.example.json` to `config.json` and list your repos (`owner/name`) and your Vercel team slug (for preview links when the Vercel bot comment isn't found). `config.json` stays out of git, so private repo names never reach the public repo.

**Notes:** only PRs authored by you are listed, so outside PRs (like forks) never show up here.
