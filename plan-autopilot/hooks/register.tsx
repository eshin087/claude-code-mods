import type { Register } from 'claude-code'

// Planning on a cheaper model, building on Opus, without switching by hand.
//
// A turn that starts in plan mode runs every step on PLAN_MODEL. When the plan
// is approved (ExitPlanMode succeeds), that turn is ended and the build is
// submitted as a fresh turn, which runs on the session's own model. Switching
// only at turn boundaries is what a manual /model switch does, so the request
// history is never sent to a model mid-turn.

const PLAN_MODEL = 'claude-sonnet-5-5'
const PLAN_LABEL = 'Sonnet 5.5'
// Above this the conversation may not fit the planning model's window; stay put.
const MAX_CONTEXT_TOKENS = 150_000
const BUILD_PROMPT = 'Plan approved. Go ahead and build it.'

const isOpus = (model: string) => /opus/i.test(model)

export const register: Register = on => {
  let mode = 'default'
  const planTurns = new Set<string>()
  let current: string | null = null

  on('classic.UserPromptSubmit', ($, e, next) => {
    if (typeof e.permission_mode === 'string') mode = e.permission_mode
    return next(e)
  })

  on('classic.PostToolUse', ($, e, next) => {
    if (e.agent_id === undefined && typeof e.permission_mode === 'string') mode = e.permission_mode
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    current = e.turnId
    if (mode === 'plan' && isOpus(await $.session.model())) {
      const { context } = await $.session.usage()
      if ((context.tokens ?? 0) <= MAX_CONTEXT_TOKENS) {
        planTurns.add(e.turnId)
        $.ui.status(`🧭 🟦 planning on ${PLAN_LABEL} · builds on Opus after you approve`)
      }
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined && planTurns.has(e.turnId)) {
      return yield* next({ ...e, model: PLAN_MODEL })
    }
    return yield* next(e)
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined) {
      if (planTurns.delete(e.turnId)) $.ui.status(undefined)
      current = null
    }
    return next(e)
  })

  on('tool.call', { tool: 'ExitPlanMode' }, async ($, e, next) => {
    const ran = await next(e)
    const turnId = current
    const isApproved = ran.deny === undefined && ran.isError === undefined
    if (e.agentId !== undefined || !isApproved || turnId === null || !planTurns.has(turnId)) return ran

    mode = 'default'
    $.ui.status(undefined)
    $.ui.toast(`Plan approved: building on ${await $.session.model()}`, { timeoutMs: 6000 })
    // Let the tool result land first, then end the planning turn and start the
    // build as a new turn on the session's model.
    $.clock.after(50, () => {
      void $.turn
        .abort({ turnId })
        .catch(() => undefined)
        .then(() => $.prompt.submit({ text: BUILD_PROMPT, asUser: true }))
    })
    return ran
  })
}
