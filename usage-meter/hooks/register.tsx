import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { MeterLimit } from '../types'

// The meter draws itself in the footer's mode slot (right of the prompt
// footer), as short as it can be so both windows fit: `5h 45% · wk 24%`, the
// labels grey and each % green, amber or red by how full it is. Text, not an
// SVG image: the desktop app (2.26454, engine 2.1.293) asks for the slot but
// shows no image there. The terminal has room for the 5-hour reset time too.
// The last reading is kept in the store, so a new session shows the meter
// before its first reply. A surface without the footer slot never asks for it;
// until it does, the same line goes to the plain-text status line.

const WARN_AT = [75, 90]
const AGENT_WARN_AT = 80

const limitsRef = atom({ plugin: 'usage-meter', key: 'limits' } as const, [])

let lastToastAt = 0
let footerSeen = false

const fmtIn = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60000))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 48 ? `${h}h${String(m % 60).padStart(2, '0')}m` : `${Math.round(h / 24)}d`
}

const level = (pct: number) => (pct >= 85 ? 'error' : pct >= 60 ? 'warning' : 'success')

const five = (list: readonly MeterLimit[]) => list.find(l => l.kind === 'five_hour')
const week = (list: readonly MeterLimit[]) => list.find(l => l.kind === 'seven_day')

const resetsIn = (l: MeterLimit | undefined, now: number) => (l?.resetsAt ? fmtIn(Date.parse(l.resetsAt) - now) : null)

// The plain-text line, for a surface with no footer slot.
const showPlain = async ($: EngineInterface) => {
  const list = await read($, limitsRef)
  const f = five(list)
  const w = week(list)
  if (footerSeen || (!f && !w)) return $.ui.status(undefined)
  $.ui.status([f ? `5h ${Math.round(f.percentUsed)}%` : '', w ? `wk ${Math.round(w.percentUsed)}%` : ''].filter(Boolean).join(' · '))
}

// One toast per threshold per window (keyed by when the window resets).
const warn = async ($: EngineInterface) => {
  const f = five(await read($, limitsRef))
  if (!f) return
  const crossed = [...WARN_AT].reverse().find(n => f.percentUsed >= n)
  if (crossed === undefined) return
  const key = `warned:${f.resetsAt ?? 'window'}:${crossed}`
  if (await $.store.get(key)) return
  await $.store.set(key, true)
  const r = resetsIn(f, await $.clock.now())
  $.ui.toast(`5-hour window at ${Math.round(f.percentUsed)}%${r ? ` · resets in ${r}` : ''}`, { timeoutMs: 8000 })
}

// Before a session's first reply there is no reading: show the last one, minus
// any window that has reset since (its old % would be wrong).
const restore = async ($: EngineInterface) => {
  const saved = (await $.store.get('last')) as MeterLimit[] | undefined
  if (!Array.isArray(saved)) return
  const now = await $.clock.now()
  const live = saved.filter(l => !l.resetsAt || Date.parse(l.resetsAt) > now)
  if (live.length > 0) {
    await update($, limitsRef, () => live)
    await showPlain($)
  }
}

const take = async ($: EngineInterface, fresh: readonly SessionRateLimit[]) => {
  if (fresh.length === 0) return
  const list: MeterLimit[] = fresh.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, ...(l.resetsAt ? { resetsAt: l.resetsAt } : {}) }))
  await update($, limitsRef, () => list)
  // The windows are the account's, not the session's: the next session starts from this.
  await $.store.set('last', list)
  await showPlain($)
  await warn($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const fresh = (await $.session.usage()).rateLimits
    if (fresh.length > 0) await take($, fresh)
    else await restore($)
    // Keep "resets in" current, and drop the plain line once the footer draws the bars.
    $.clock.every(60_000, () => $.ui.invalidate('ui.render'))
    $.clock.every(5_000, () => void showPlain($))
    // Old warning keys pile up otherwise.
    const keys = (await $.store.keys()).filter(k => k.startsWith('warned:'))
    for (const k of keys.slice(0, Math.max(0, keys.length - 20))) await $.store.delete(k)
    return started
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await take($, e.rateLimits)
    return next(e)
  })

  // The footer's mode slot: the engine's own labels (if any), then the meter.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const list = await read($, limitsRef)
    const f = five(list)
    const w = week(list)
    if (!f && !w) return next(e)
    footerSeen = true
    const now = await $.clock.now()
    const { Box, Text } = $.ui.resolve(e)
    const r = e.surface === 'terminal' ? resetsIn(f, now) : null
    // One window: its grey label, its % in the color of how full it is.
    const part = (key: string, label: string, l: MeterLimit) => (
      <Box key={key} flexDirection="row" gap={1}>
        <Text dimColor>{label}</Text>
        <Text color={level(l.percentUsed)}>{`${Math.round(l.percentUsed)}%`}</Text>
      </Box>
    )
    return (
      <Box flexDirection="row" gap={1}>
        {e.props.modes.length > 0 && <Text dimColor>{`${e.props.modes.join(' & ')} ·`}</Text>}
        {f && part('meter:5h', '5h', f)}
        {r && <Text dimColor>{`⟳${r}`}</Text>}
        {f && w && <Text dimColor>·</Text>}
        {w && part('meter:wk', 'wk', w)}
      </Box>
    )
  })

  // Before a wave of subagents or a workflow, say so when the window is low:
  // a toast for the person, and a note Claude reads with the result.
  // A wave starts many agents at once: one toast per wave, not one per agent.
  on('tool.call', { tool: ['Agent', 'Workflow'] }, async ($, e, next) => {
    const ran = await next(e)
    const f = five(await read($, limitsRef))
    if (e.agentId !== undefined || !f || f.percentUsed < AGENT_WARN_AT || ran.deny !== undefined) return ran
    const r = resetsIn(f, await $.clock.now())
    const line = `5-hour usage window is at ${Math.round(f.percentUsed)}%${r ? `, resets in ${r}` : ''}`
    const now = await $.clock.now()
    if (now - lastToastAt > 120_000) {
      lastToastAt = now
      $.ui.toast(`${line}. Parallel agents may hit the limit.`, { timeoutMs: 8000 })
    }
    return { ...ran, context: [...(ran.context ?? []), `[usage-meter] The person's ${line}. Prefer fewer parallel agents until it resets.`] }
  })
}
