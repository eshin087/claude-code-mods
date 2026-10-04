# 5-Hour Usage Meter

**What it does:** keeps your subscription's usage windows visible, so you know whether there's room for a big job or a wave of agents.

**Where you see it:**
- **Footer, right of the prompt:** `• 5h ━── 38% W ╸─ 18%`. On desktop it's one small picture with solid bars; the slot is only about 145 px wide, so the bars are short.
  - **5h** is cyan and **W** (weekly) is violet. The small dot and each % are green under 60%, yellow at 60-85% and red above.
- **Reset times** are in the dock's **C** card (*Limits: 5h 38% (resets 2h10m) · W 18%*) and on the terminal footer (`⟳2h10m`).
- If the app has no footer slot for mods, the same short line shows as plain text in the status line instead.
- **Toasts** at 75% and 90% of the 5-hour window (once per window).
- **Before an agent wave or workflow** at 80% or more: a toast, and a note telling Claude to use fewer parallel agents.

**How it works:** every API response reports your rate-limit windows. The app passes them to mods whenever they move by a whole point. "Resets in" refreshes every minute.

**Cost:** none.

**Data saved:** the last reading and which warnings were already shown (in the mod's own store).

**Notes:** a new session shows the last reading straight away (any window that has reset since is left out) and updates after its first reply. Nothing shows on API-key or non-subscription accounts.
