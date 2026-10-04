import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { MeterLimit } from '../types'

// The meter draws itself in the footer's mode slot (right of the prompt
// footer). On the desktop that slot fits ~145 px, so the meter is one small SVG
// image: a dot for the worse window, then solid rounded bars filled to the %
// (cyan for the 5-hour window, violet for the week). It is a plain image: the
// interactive kind (with a tooltip) needs a frame the footer does not draw. The
// reset times are in the dock's C card instead. The terminal draws the same in
// characters, with room for the reset time. The last reading is kept in the
// store, so a new session shows the meter before its first reply. A surface
// without the footer slot never asks for it; until it does, a short line goes
// to the plain-text status line.

const WARN_AT = [75, 90]
const AGENT_WARN_AT = 80
const C5H = '#22d3ee'
const CWEEK = '#a78bfa'
const TRACK = '#3f3f46'
const FOOT_5H = 3
const FOOT_W = 2
const LEVEL_HEX = { success: '#4ade80', warning: '#facc15', error: '#f87171' } as const

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

// A thin bar in half-cell steps: filled ━, a half ╸ at the edge, the rest is track.
const bar = (pct: number, cells: number) => {
  const halves = Math.round((Math.max(0, Math.min(100, pct)) / 100) * cells * 2)
  const full = Math.floor(halves / 2)
  const fill = '━'.repeat(full) + (halves % 2 === 1 ? '╸' : '')
  return { fill, rest: '━'.repeat(Math.max(0, cells - fill.length)) }
}

// The desktop footer: 145 x 14 px. Text is drawn in the SVG too, so the width is exact.
const footerSvg = (f: MeterLimit | undefined, w: MeterLimit | undefined, now: number) => {
  const worst = Math.max(f?.percentUsed ?? 0, w?.percentUsed ?? 0)
  const font = `font-family="ui-monospace, Consolas, Menlo, monospace" font-size="11" dominant-baseline="central"`
  const barAt = (x: number, width: number, pct: number, color: string) => {
    const fill = Math.max(0, Math.min(width, Math.round((pct / 100) * width)))
    return `<rect x="${x}" y="4.5" width="${width}" height="5" rx="2.5" fill="${TRACK}"/>` +
      (fill > 0 ? `<rect x="${x}" y="4.5" width="${Math.max(fill, 5)}" height="5" rx="2.5" fill="${color}"/>` : '')
  }
  const tip = [
    f ? `5-hour window: ${Math.round(f.percentUsed)}% used${resetsIn(f, now) ? `, resets in ${resetsIn(f, now)}` : ''}` : '',
    w ? `Weekly: ${Math.round(w.percentUsed)}% used${resetsIn(w, now) ? `, resets in ${resetsIn(w, now)}` : ''}` : '',
    'Green under 60% · yellow 60-85% · red over 85%',
  ].filter(Boolean).join('\n')
  let body = `<circle cx="3" cy="7" r="2.5" fill="${LEVEL_HEX[level(worst)]}"/>`
  if (f) {
    body += `<text x="9" y="7" fill="${C5H}" font-weight="600" ${font}>5h</text>` + barAt(24, 34, f.percentUsed, C5H) +
      `<text x="61" y="7" fill="${LEVEL_HEX[level(f.percentUsed)]}" ${font}>${Math.round(f.percentUsed)}%</text>`
  }
  if (w) {
    body += `<text x="88" y="7" fill="${CWEEK}" font-weight="600" ${font}>W</text>` + barAt(97, 20, w.percentUsed, CWEEK) +
      `<text x="120" y="7" fill="${LEVEL_HEX[level(w.percentUsed)]}" ${font}>${Math.round(w.percentUsed)}%</text>`
  }
  return { source: `<svg xmlns="http://www.w3.org/2000/svg" width="145" height="14" viewBox="0 0 145 14">${body}</svg>`, alt: tip.replace(/\n/g, '. ') }
}

const five = (list: readonly MeterLimit[]) => list.find(l => l.kind === 'five_hour')
const week = (list: readonly MeterLimit[]) => list.find(l => l.kind === 'seven_day')

const resetsIn = (l: MeterLimit | undefined, now: number) => (l?.resetsAt ? fmtIn(Date.parse(l.resetsAt) - now) : null)

// The plain-text line, for a surface with no footer slot.
const showPlain = async ($: EngineInterface) => {
  const list = await read($, limitsRef)
  const f = five(list)
  const w = week(list)
  if (footerSeen || (!f && !w)) return $.ui.status(undefined)
  const parts: string[] = ['•']
  if (f) {
    const b = bar(f.percentUsed, FOOT_5H)
    parts.push(`5h ${b.fill}${b.rest.replace(/━/g, '─')} ${Math.round(f.percentUsed)}%`)
  }
  if (w) {
    const b = bar(w.percentUsed, FOOT_W)
    parts.push(`W ${b.fill}${b.rest.replace(/━/g, '─')} ${Math.round(w.percentUsed)}%`)
  }
  $.ui.status(parts.join(' '))
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
    if (e.surface !== 'terminal') {
      const { Box, Text, Svg } = $.ui.resolve(e)
      const svg = footerSvg(f, w, now)
      return (
        <Box flexDirection="row" gap={1} alignItems="center">
          {e.props.modes.length > 0 && <Text dimColor>{e.props.modes.join(' & ')}</Text>}
          <Svg source={svg.source} alt={svg.alt} width={145} height={14} />
        </Box>
      )
    }
    const { Box, Text } = $.ui.resolve(e)
    const worst = Math.max(f?.percentUsed ?? 0, w?.percentUsed ?? 0)
    const f5 = f ? bar(f.percentUsed, 10) : null
    const fw = w ? bar(w.percentUsed, 6) : null
    const r = resetsIn(f, now)
    return (
      <Box flexDirection="row" gap={1}>
        {e.props.modes.length > 0 && <Text dimColor>{e.props.modes.join(' & ')}  </Text>}
        <Text color={level(worst)}>•</Text>
        {f && f5 && (
          <Box flexDirection="row" gap={1}>
            <Text color={C5H} bold>
              5h
            </Text>
            <Box flexDirection="row">
              <Text color={C5H}>{f5.fill}</Text>
              <Text color={TRACK}>{f5.rest}</Text>
            </Box>
            <Text color={level(f.percentUsed)}>{Math.round(f.percentUsed)}%</Text>
            {r && <Text dimColor>⟳{r}</Text>}
          </Box>
        )}
        {w && fw && (
          <Box flexDirection="row" gap={1}>
            <Text color={CWEEK} bold>
              W
            </Text>
            <Box flexDirection="row">
              <Text color={CWEEK}>{fw.fill}</Text>
              <Text color={TRACK}>{fw.rest}</Text>
            </Box>
            <Text color={level(w.percentUsed)}>{Math.round(w.percentUsed)}%</Text>
          </Box>
        )}
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
