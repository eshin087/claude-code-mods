# 5-Hour Usage Meter

**What it does:** keeps your subscription's usage windows visible, so you know whether there's room for a big job or a wave of agents.

**Where you see it:**
- **Footer, right of the prompt:** `• 5h ━── 38% W ╸─ 18%`. The app gives this slot only about 20 characters, so the bars are short.
  - **5h** is cyan and **W** (weekly) is violet. The small dot and each % are green under 60%, yellow at 60-85% and red above.
- **Hover the footer meter** to open a card above the prompt: long bars, exact %, the time until each window resets, and the color key.
- If the app has no footer slot for mods, the same short line shows as plain text in the status line instead.
- **Toasts** at 75% and 90% of the 5-hour window (once per window).
- **Before an agent wave or workflow** at 80% or more: a toast, and a note telling Claude to use fewer parallel agents.

**How it works:** every API response reports your rate-limit windows. The app passes them to mods whenever they move by a whole point. "Resets in" refreshes every minute.

**Cost:** none.

**Data saved:** only which warnings were already shown (in the mod's own store).

**Notes:** it shows nothing until the first reply of a session, and nothing on API-key or non-subscription accounts.
