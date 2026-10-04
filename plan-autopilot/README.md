# Plan → Opus Autopilot

**What it does:** your "plan cheap, build on Opus" habit, without switching models by hand.

**Where you see it:**
- **In Plan mode:** the status line shows `🧭 🟦 planning on Sonnet 5.5 · builds on Opus after you approve`.
- **When you approve the plan:** a toast `Plan approved: building on claude-opus-5-5`, then a new turn starts with "Plan approved. Go ahead and build it.", running on your session's model.

**How it works:**
- A turn that starts while the session is in Plan mode sends every request to Sonnet 5.5, as long as the session's model is Opus.
- When the plan is approved, that turn is ended and the build is sent as a fresh turn on the session's model.
- Switching only between turns is what a manual model switch does, so a turn is never moved to another model halfway through.

**Cost:** saves money while planning (Sonnet is cheaper than Opus). The first build turn after a switch re-reads the conversation without the prompt cache, once.

**Data saved:** none.

**Settings:** `PLAN_MODEL` at the top of `hooks/register.tsx`.

**Notes:**
- It skips the switch when the conversation is over 150k tokens, in case it would not fit the planning model's window.
- If you're not on Opus, it does nothing.
