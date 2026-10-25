import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, SessionRateLimit } from 'claude-code'

import type { PaceSession } from '../types'

// What this chat has used, and when your 5-hour and weekly limits run out at
// your current pace, in a panel: /pace, or the P button in the footer (P! while
// the pace would run a limit out before it resets). The pace is recent: the last
// hour for the 5-hour window, the last day for the weekly one, worked out from the readings
// the limits mod keeps in ~/.claude/mods-data/limits/readings.json. A toast
// warns once per window when the pace would run a limit out before it resets.

const PANE = 'pace'
// A pace needs this much history in the window: a point or two of rise over a
// short span (right after a reset, say) is no pace to project from.
const FIVE = { lookbackMs: 3_600_000, minSpanMs: 20 * 60_000 } as const
const WEEK = { lookbackMs: 24 * 3_600_000, minSpanMs: 6 * 3_600_000 } as const
// Only a run-out at least this long before the reset is worth a warning.
const WARN_MARGIN_MS = 5 * 60_000
// Readings of one window name the same reset, give or take how the endpoint and the headers round it.
const SAME_RESET_MS = 5 * 60_000
const REFRESH_MS = 30_000

const GREEN = '#4ade80'
const AMBER = '#facc15'
const RED = '#f87171'
const LABEL = '#9ca3af'
const DIM = '#71717a'
const ACCENT = '#22d3ee'

type Win = { pct: number; resetsAt: string | null }
type Reading = { at: number; five: Win | null; week: Win | null }
type Readings = { latest: Reading | null; history: Reading[] }
type Kind = 'five' | 'week'

/** Where a window stands and where it's heading. `perHour` null: too little history yet. */
type Projection = { pct: number; resetsAt: number | null; perHour: number | null; runsOutAt: number | null; isBeforeReset: boolean }

const EMPTY_SESSION: PaceSession = { tokensIn: 0, tokensCached: 0, tokensOut: 0, turns: 0, usd: null, fiveUp: 0, weekUp: 0 }

const isOpen = atom({ plugin: 'pace', key: 'isOpen' } as const, false)
const session = atom({ plugin: 'pace', key: 'session' } as const, EMPTY_SESSION)

// The limits mod's readings, re-read every REFRESH_MS and after each reply.
let readings: Readings = { latest: null, history: [] }
// This chat's last reading of each window, to count how far it rose.
let seen: Partial<Record<Kind, Win>> = {}

// Claude's folder: CLAUDE_CONFIG_DIR when set (it may live on another drive), else ~/.claude
const home = async ($: EngineInterface) => ((await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${(await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'}/.claude`).replace(/\\/g, '/')

// This chat's working time and prompts, from the timings mod's file (none without it).
const timingsOf = async ($: EngineInterface): Promise<{ workedMs: number; prompts: number } | null> => {
  try {
    const cwd = await $.session.cwd()
    const main = cwd.replace(/[\/]\.claude[\/]worktrees[\/].*$/i, '')
    const project = main.split(/[\/]/).filter(Boolean).pop() ?? main
    const file = JSON.parse(await $.fs.read(`${await home($)}/mods-data/timings/${project}/${await $.session.id()}.json`)) as { prompts?: { durationMs: number }[] }
    const prompts = file.prompts ?? []
    return { workedMs: prompts.reduce((n, p) => n + p.durationMs, 0), prompts: prompts.length }
  } catch {
    return null
  }
}

const loadReadings = async ($: EngineInterface) => {
  try {
    const raw = JSON.parse(await $.fs.read(`${await home($)}/mods-data/limits/readings.json`)) as Partial<Readings>
    readings = { latest: raw.latest ?? null, history: Array.isArray(raw.history) ? raw.history : [] }
  } catch {
    readings = { latest: null, history: [] }
  }
}

const timeOf = (iso: string | null) => (iso === null ? NaN : Date.parse(iso))
const isSameWindow = (a: Win, b: Win) => Math.abs(timeOf(a.resetsAt) - timeOf(b.resetsAt)) < SAME_RESET_MS

// 4:10p, 11p: local time, minutes left out on the hour; the weekday when it isn't today.
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const when = (t: number, now: number) => {
  const d = new Date(Math.round(t / 60_000) * 60_000)
  const h = d.getHours()
  const m = d.getMinutes()
  const clock = `${h % 12 || 12}${m === 0 ? '' : `:${String(m).padStart(2, '0')}`}${h < 12 ? 'a' : 'p'}`
  return d.toDateString() === new Date(now).toDateString() ? clock : `${DAYS[d.getDay()]} ${clock}`
}

const project = (r: Readings, kind: Kind, now: number, span: { lookbackMs: number; minSpanMs: number }): Projection | null => {
  const latest = r.latest?.[kind]
  if (!r.latest || !latest) return null
  const reset = timeOf(latest.resetsAt)
  const resetsAt = Number.isFinite(reset) ? reset : null
  // A window whose reset has passed has started over.
  if (resetsAt !== null && resetsAt <= now) return { pct: 0, resetsAt: null, perHour: null, runsOutAt: null, isBeforeReset: false }
  const first = r.history.find(h => h.at >= now - span.lookbackMs && h[kind] && isSameWindow(h[kind]!, latest))
  const base = { pct: latest.pct, resetsAt, perHour: null, runsOutAt: null, isBeforeReset: false }
  if (!first || r.latest.at - first.at < span.minSpanMs) return base
  const perMs = (latest.pct - first[kind]!.pct) / (r.latest.at - first.at)
  if (perMs <= 0) return { ...base, perHour: 0 }
  const runsOutAt = r.latest.at + (100 - latest.pct) / perMs
  return { ...base, perHour: perMs * 3_600_000, runsOutAt, isBeforeReset: resetsAt !== null && runsOutAt < resetsAt - WARN_MARGIN_MS }
}

const NAME: Record<Kind, string> = { five: '5-hour', week: 'weekly' }

// Once per window, for every chat: the windows already warned about live beside the readings.
const warnIfRunningOut = async ($: EngineInterface) => {
  const now = await $.clock.now()
  const file = `${await home($)}/mods-data/pace/warned.json`
  let warned: string[] = []
  try {
    warned = (JSON.parse(await $.fs.read(file)) as { keys?: string[] }).keys ?? []
  } catch {
    warned = []
  }
  for (const [kind, span] of [['five', FIVE], ['week', WEEK]] as const) {
    const p = project(readings, kind, now, span)
    if (!p?.isBeforeReset || p.runsOutAt === null || p.resetsAt === null) continue
    const key = `${kind}@${Math.round(p.resetsAt / 60_000)}`
    if (warned.includes(key)) continue
    warned = [...warned, key].slice(-20)
    await $.fs.write(file, JSON.stringify({ keys: warned }))
    $.ui.toast(`At this pace your ${NAME[kind]} limit runs out around ${when(p.runsOutAt, now)}, before it resets at ${when(p.resetsAt, now)}. /pace for details.`, { timeoutMs: 12_000 })
  }
}

const togglePane = async ($: EngineInterface) => {
  if ((await $.ui.panes()).some(p => p.id === PANE)) {
    await $.ui.close({ id: PANE })
    // A plugin's own close does not reach its own ui.close hook: reset the flag here.
    await update($, isOpen, () => false)
    return 'Pace closed.'
  }
  await loadReadings($)
  const opened = await $.ui.open({ id: PANE, title: 'Pace' })
  if (opened.isPlaced) await update($, isOpen, () => true)
  else $.ui.toast(`The pace panel could not open (${opened.reason}).`)
  return opened.isPlaced ? 'Pace opened.' : `Could not open the pane (${opened.reason}).`
}

// The rise of each window between this chat's readings, counted while the window stays the same.
const tally = async ($: EngineInterface, limits: readonly SessionRateLimit[]) => {
  const rise: Record<Kind, number> = { five: 0, week: 0 }
  for (const [kind, name] of [['five', 'five_hour'], ['week', 'seven_day']] as const) {
    const l = limits.find(x => x.kind === name)
    if (!l) continue
    const now: Win = { pct: l.percentUsed, resetsAt: l.resetsAt ?? null }
    const before = seen[kind]
    if (before && isSameWindow(before, now) && now.pct > before.pct) rise[kind] = now.pct - before.pct
    seen = { ...seen, [kind]: now }
  }
  if (rise.five > 0 || rise.week > 0) {
    await update($, session, s => ({ ...s, fiveUp: s.fiveUp + rise.five, weekUp: s.weekUp + rise.week }))
  }
}

const tokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))
const pct = (n: number) => `${Math.round(n * 10) / 10}%`
// How long until a time: 45m, 3h27m, 4d 3h.
const left = (t: number, now: number) => {
  const m = Math.max(0, Math.round((t - now) / 60_000))
  if (m < 60) return `${m}m`
  if (m < 24 * 60) return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
  return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`
}
// A 10-cell bar of how much of a window is used.
const bar = (n: number) => {
  const full = Math.max(0, Math.min(10, Math.round(n / 10)))
  return { used: '█'.repeat(full), rest: '░'.repeat(10 - full) }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'pace', description: 'What this chat has used, and when your 5-hour and weekly limits run out at this pace' })
    await loadReadings($)
    $.clock.every(REFRESH_MS, () => {
      void (async () => {
        await loadReadings($)
        // The panel and P (or P!) both draw from the readings.
        $.ui.invalidate('ui.render')
      })().catch(() => undefined)
    })
    return next(e)
  })

  on('command.run', { command: 'pace' }, async $ => ({ text: await togglePane($) }))

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const done = await next(e)
    await update($, isOpen, () => false)
    return done
  })

  // Every reply, subagents' too: its tokens. Your turns: one each.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const u = done.usage ?? e.usage
    if (u || e.agentId === undefined) {
      await update($, session, s => ({
        ...s,
        tokensIn: s.tokensIn + (u ? u.input_tokens + u.cache_creation_input_tokens : 0),
        tokensCached: s.tokensCached + (u?.cache_read_input_tokens ?? 0),
        tokensOut: s.tokensOut + (u?.output_tokens ?? 0),
        turns: s.turns + (e.agentId === undefined ? 1 : 0),
      }))
    }
    return done
  })

  // The cost so far, how far the windows rose, and whether this pace runs one out.
  on('session.measure', async ($, e, next) => {
    const done = await next(e)
    if (e.changed.includes('cost') && e.cost) {
      const usd = e.cost.usd
      await update($, session, s => ({ ...s, usd }))
    }
    if (e.changed.includes('rateLimits')) {
      await tally($, e.rateLimits)
      await loadReadings($)
      await warnIfRunningOut($)
    }
    return done
  })

  // P in the footer, after the limits and before what the mods beneath add (the
  // timings mod's T): a press opens or closes the panel; P! while the pace would
  // run a limit out before it resets.
  // The terminal's P after the limits line. The desktop's footer slot is narrow
  // and the limits and the timings button use it: /pace opens the panel there.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (e.surface === 'desktop') return next(e)
    const below = await next(e)
    const { Box, Button } = $.ui.resolve(e)
    const now = await $.clock.now()
    const isAtRisk = [project(readings, 'five', now, FIVE), project(readings, 'week', now, WEEK)].some(p => p?.isBeforeReset === true)
    return (
      <Box flexDirection="row" gap={1}>
        <Button key="pace:p" label={isAtRisk ? '🔹P!' : '🔹P'} plain dimColor={!isAtRisk} onPress={() => togglePane($)} />
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const s = await read($, session)
    const now = await $.clock.now()
    const timed = await timingsOf($)
    const latest = readings.latest
    const five = project(readings, 'five', now, FIVE)
    const week = project(readings, 'week', now, WEEK)
    const colorOf = (n: number) => (n >= 85 ? RED : n >= 60 ? AMBER : GREEN)

    // The limits table: one row per window, fixed columns, the outlook takes the rest.
    //   Window   Used              Resets in  Pace      At this pace
    //   5-hour   ██████░░░░  64%   2h13m      +24%/h    runs out ~9:13p
    const cell = (key: string, width: number, child: RenderChildren) => (
      <Box key={key} width={width} flexShrink={0}>
        {child}
      </Box>
    )
    const head = (
      <Box key="head" flexDirection="row" gap={1}>
        {cell('window', 8, <Text color={LABEL}>Window</Text>)}
        {cell('used', 16, <Text color={LABEL}>Used</Text>)}
        {cell('resets', 10, <Text color={LABEL}>Resets in</Text>)}
        {cell('pace', 9, <Text color={LABEL}>Pace</Text>)}
        <Text color={LABEL} wrap="truncate-end">
          At this pace
        </Text>
      </Box>
    )
    const limitRow = (key: string, label: string, p: Projection | null, unit: 'h' | 'day') => {
      if (!p) return null
      const b = bar(p.pct)
      const rate = p.perHour === null ? null : unit === 'h' ? p.perHour : p.perHour * 24
      const outlook =
        rate === null
          ? { text: 'not enough history yet', color: DIM }
          : rate <= 0 || p.runsOutAt === null
            ? { text: 'not rising', color: DIM }
            : p.isBeforeReset
              ? { text: `runs out ~${when(p.runsOutAt, now)}, before the reset`, color: AMBER }
              : { text: 'lasts until the reset', color: GREEN }
      return (
        <Box key={key} flexDirection="row" gap={1}>
          {cell('window', 8, <Text bold>{label}</Text>)}
          {cell(
            'used',
            16,
            <Text>
              <Text color={colorOf(p.pct)}>{b.used}</Text>
              <Text color={DIM}>{b.rest}</Text>
              <Text bold color={colorOf(p.pct)}>{` ${pct(p.pct)}`}</Text>
            </Text>,
          )}
          {cell('resets', 10, <Text>{p.resetsAt === null ? '—' : left(p.resetsAt, now)}</Text>)}
          {cell('pace', 9, <Text color={rate !== null && rate > 0 ? undefined : DIM}>{rate === null ? '—' : rate <= 0 ? '0' : `+${pct(rate)}/${unit}`}</Text>)}
          <Text color={outlook.color} wrap="truncate-end">
            {outlook.text}
          </Text>
        </Box>
      )
    }
    // This chat's figures: a grey label column, the value beside it.
    const detail = (key: string, label: string, value: RenderChildren) => (
      <Box key={key} flexDirection="row" gap={1}>
        {cell('label', 8, <Text color={LABEL}>{label}</Text>)}
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          {value}
        </Box>
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1}>
          <Text bold color={ACCENT}>
            Pace
          </Text>
          {latest && <Text color={DIM}>{`updated ${when(latest.at, now)}`}</Text>}
          <Box flexGrow={1} />
          <Button key="close" label="Close" role="dismiss" onPress={() => togglePane($)} />
        </Box>
        {latest ? (
          <Box flexDirection="column">
            {head}
            {limitRow('limit:five', '5-hour', five, 'h')}
            {limitRow('limit:week', 'Weekly', week, 'day')}
          </Box>
        ) : (
          <Text color={DIM}>No reading yet: the limits mod shows one after the first reply.</Text>
        )}
        <Box flexDirection="column">
          <Text bold>This chat</Text>
          {detail(
            'tokens',
            'Tokens',
            <Text wrap="truncate-end">
              {tokens(s.tokensIn)}
              <Text color={LABEL}> fresh · </Text>
              {tokens(s.tokensCached)}
              <Text color={LABEL}> cached · </Text>
              {tokens(s.tokensOut)}
              <Text color={LABEL}> out</Text>
            </Text>,
          )}
          {detail(
            'cost',
            'Cost',
            <Text wrap="truncate-end">
              {s.usd === null ? '$0.00' : `$${s.usd.toFixed(2)}`}
              <Text color={LABEL}>{` at API prices · ${s.turns} ${s.turns === 1 ? 'turn' : 'turns'}`}</Text>
            </Text>,
          )}
          {timed !== null && timed.prompts > 0 &&
            detail(
              'worked',
              'Worked',
              <Text wrap="truncate-end">
                {left(timed.workedMs, 0)}
                <Text color={LABEL}>{` over ${timed.prompts} ${timed.prompts === 1 ? 'prompt' : 'prompts'} · each one in /timings`}</Text>
              </Text>,
            )}
          {detail(
            'used',
            'Used',
            <Text wrap="truncate-end">
              {`5-hour +${pct(s.fiveUp)}`}
              <Text color={LABEL}> · </Text>
              {`weekly +${pct(s.weekUp)}`}
            </Text>,
          )}
        </Box>
        <Text color={DIM}>
          Pace: the 5-hour window's over the last hour, the weekly one's over the last day. "Used" counts any chat that ran at the same time.
        </Text>
      </Box>
    )
  })
}
