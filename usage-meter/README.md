# 5-Hour Usage Meter

**What it does:** keeps your subscription's usage windows visible, so you know whether there's room for a big job or a wave of agents.

**Where you see it:**
- **Footer, right of the prompt:** `5h 45% · wk 24%`. The labels are grey and each % is green under 60%, amber at 60-85% and red above. It's text, as short as possible so both windows fit the desktop's narrow slot (the desktop app 2.26454 shows no picture there).
- **Reset time** of the 5-hour window: on the terminal footer (`5h 45% ⟳2h59m · wk 24%`) and in the 75% and 90% toasts.
- If the app has no footer slot for mods, the same short line shows as plain text in the status line instead.
- **Toasts** at 75% and 90% of the 5-hour window (once per window).
- **Before an agent wave or workflow** at 80% or more: a toast, and a note telling Claude to use fewer parallel agents.

**How it works:** every API response reports your rate-limit windows. The app passes them to mods whenever they move by a whole point. "Resets in" refreshes every minute.

**Cost:** none.

**Data saved:** the last reading and which warnings were already shown (in the mod's own store).

**Notes:** a new session shows the last reading straight away (any window that has reset since is left out) and updates after its first reply. Nothing shows on API-key or non-subscription accounts.
