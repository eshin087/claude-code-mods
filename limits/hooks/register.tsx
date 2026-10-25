import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { FooterPart, LimitWindow, LimitsFile, LimitsReading } from '../types'

// Your 5-hour and weekly limits, with when the 5-hour one resets, in the footer
// next to the model picker, so the usage button is never needed:
//   5h 22% 3h12  ·  w 76%
// The words 5h and w are dim grey, the numbers bright, the % bold, and a dim
// dot sets the two windows apart. A % from 85% up and a countdown under 30
// minutes turn red. The 5-hour window says how long until it resets; the weekly
// one shows no countdown (the pace panel has it).
// Plain text, on one line, alike on the desktop and the terminal: the desktop
// app draws neither an SVG nor a surface module in that slot.
// The figures come from the account endpoint the usage button reads (your
// login rides along, attached by the engine; the mod never sees it), and from
// each reply's own rate-limit headers in between. Every open session shares
// one reading in ~/.claude/mods-data/limits/readings.json, so only one asks the
// endpoint at a time; its short history is what the pace mod works from.

// How often each session looks at the shared reading.
const TICK_MS = 60_000
// A reading or a check younger than this stands: no session asks again.
const FRESH_MS = 3 * 60_000
// After the endpoint fails, wait this long before asking again.
const BACKOFF_MS = 10 * 60_000
// History for the pace mod: 8 days, a reading at most every 2 minutes unless it moved.
const HISTORY_MS = 8 * 24 * 3_600_000
const HISTORY_MAX = 4000
const HISTORY_EVERY_MS = 2 * 60_000

// The words are grey and the numbers keep the bright text color; a % from 85%
// up and a countdown under 30 minutes turn red.
const GREY = '#9ca3af'
const RED = '#f87171'
// The desktop folds any run of whitespace (even no-break spaces) into one; a braille
// blank is not whitespace to it, so it keeps the room between a % and its countdown
// and around the dot between the windows.
const PAD = '\u2800'
const HOT_PCT = 85
const SOON_MS = 30 * 60_000
// The 5-hour countdown shades with the time left: green past 3 hours (a window
// just begun), orange from 1 to 3 hours, red under 1 hour (nearly reset).
const GREEN = '#4ade80'
const ORANGE = '#fb923c'
const fiveColor = (msLeft: number | null) => (msLeft === null ? undefined : msLeft > 3 * 3_600_000 ? GREEN : msLeft > 3_600_000 ? ORANGE : RED)
// The weekly countdown only turns red, under SOON_MS.
const resetColor = (label: string, msLeft: number | null) => (label === '5h' ? fiveColor(msLeft) : msLeft !== null && msLeft < SOON_MS ? RED : undefined)

const reading = atom({ plugin: 'limits', key: 'reading' } as const, null)

const EMPTY: LimitsFile = { latest: null, history: [], checkedAt: 0, error: null, errorAt: null }

const dataFile = async ($: EngineInterface) => {
  // CLAUDE_CONFIG_DIR (set when Claude's folder lives on another drive) wins over ~/.claude
  const dir = ((await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${(await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'}/.claude`).replace(/\\/g, '/')
  return `${dir}/mods-data/limits/readings.json`
}

const load = async ($: EngineInterface): Promise<LimitsFile> => {
  try {
    return { ...EMPTY, ...(JSON.parse(await $.fs.read(await dataFile($))) as Partial<LimitsFile>) }
  } catch {
    return { ...EMPTY }
  }
}

const save = async ($: EngineInterface, file: LimitsFile) => $.fs.write(await dataFile($), JSON.stringify(file))

// The countdown to a reset: 3h27, 45m.
// No "in" and no trailing m past an hour: the footer slot is narrow. Resets
// land a fraction of a second before the minute (03:59:59.7), so it is rounded
// to the nearest minute.
const countdownOf = (iso: string | null, now: number) => {
  const t = iso === null ? NaN : Date.parse(iso)
  if (!Number.isFinite(t) || t <= now) return null
  const m = Math.round((t - now) / 60_000)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

// A window whose reset time has passed has started over.
const current = (w: LimitWindow | null, now: number): LimitWindow | null => {
  if (!w) return null
  const t = w.resetsAt === null ? NaN : Date.parse(w.resetsAt)
  return Number.isFinite(t) && t <= now ? { pct: 0, resetsAt: null } : w
}

const partOf = (label: string, w: LimitWindow, reset: string | null, now: number): FooterPart => {
  const t = w.resetsAt === null ? NaN : Date.parse(w.resetsAt)
  return { label, pct: Math.round(w.pct), reset, msLeft: Number.isFinite(t) ? t - now : null }
}

const footerParts = (r: LimitsReading, now: number) => {
  const five = current(r.five, now)
  const week = current(r.week, now)
  return [five && partOf('5h', five, countdownOf(five.resetsAt, now), now), week && partOf('w', week, null, now)].filter(
    (p): p is FooterPart => p !== null,
  )
}

// The endpoint's window: { utilization: 0-100, resets_at: ISO }.
const windowOf = (raw: unknown): LimitWindow | null => {
  const w = raw as { utilization?: unknown; resets_at?: unknown } | null | undefined
  if (!w || typeof w.utilization !== 'number' || !Number.isFinite(w.utilization)) return null
  return { pct: Math.round(w.utilization * 10) / 10, resetsAt: typeof w.resets_at === 'string' ? w.resets_at : null }
}

// A reply's rate-limit headers, as the engine reads them.
const fromHeaders = (list: readonly SessionRateLimit[], at: number, before: LimitsReading | null): LimitsReading | null => {
  const pick = (kind: string, prev: LimitWindow | null) => {
    const l = list.find(x => x.kind === kind)
    return l ? { pct: l.percentUsed, resetsAt: l.resetsAt ?? prev?.resetsAt ?? null } : prev
  }
  const five = pick('five_hour', before?.five ?? null)
  const week = pick('seven_day', before?.week ?? null)
  return five || week ? { at, five, week } : null
}

const isSame = (a: LimitWindow | null, b: LimitWindow | null) => a?.pct === b?.pct && a?.resetsAt === b?.resetsAt

const show = async ($: EngineInterface, r: LimitsReading | null) => {
  const cur = await read($, reading)
  if (r && (!cur || cur.at !== r.at || !isSame(cur.five, r.five) || !isSame(cur.week, r.week))) await update($, reading, () => r)
}

// Saves a new reading for every session (and the pace mod's history), then shows it.
const record = async ($: EngineInterface, r: LimitsReading, file: LimitsFile, error: string | null) => {
  const last = file.history.at(-1)
  const hasMoved = !last || !isSame(last.five, r.five) || !isSame(last.week, r.week)
  const history = hasMoved || r.at - last.at >= HISTORY_EVERY_MS ? [...file.history, r] : file.history
  await save($, {
    latest: r,
    history: history.filter(h => h.at >= r.at - HISTORY_MS).slice(-HISTORY_MAX),
    checkedAt: file.checkedAt,
    error,
    errorAt: error === null ? null : file.errorAt,
  })
  await show($, r)
}

// Asks the account endpoint, unless a session did lately or it failed lately.
const refresh = async ($: EngineInterface) => {
  const file = await load($)
  const now = await $.clock.now()
  const isFresh = file.latest !== null && now - file.latest.at < FRESH_MS
  const isRecent = now - file.checkedAt < FRESH_MS
  const isBackingOff = file.errorAt !== null && now - file.errorAt < BACKOFF_MS
  if (isFresh || isRecent || isBackingOff) return show($, file.latest)
  // Claimed first, so the other sessions leave this check to this one.
  await save($, { ...file, checkedAt: now })
  const fail = async (error: string) => {
    await save($, { ...file, checkedAt: now, error, errorAt: now })
    await show($, file.latest)
  }
  const auth = await $.session.authorize().catch(() => null)
  if (!auth) return fail('no Anthropic login to read the plan limits with')
  try {
    const base = ((await $.env.get('ANTHROPIC_BASE_URL')) ?? 'https://api.anthropic.com').replace(/\/+$/, '')
    const res = await $.http.fetch(`${base}/api/oauth/usage`, { auth: auth.handle, headers: { 'anthropic-beta': 'oauth-2025-04-20' } })
    if (!res.ok) return fail(`the usage endpoint answered ${res.status}`)
    const body = JSON.parse(res.text) as Record<string, unknown>
    const fresh = { at: now, five: windowOf(body.five_hour), week: windowOf(body.seven_day) }
    if (!fresh.five && !fresh.week) return fail('the usage endpoint named no 5-hour or weekly window')
    await record($, fresh, { ...file, checkedAt: now }, null)
  } catch (err) {
    await fail(`the usage endpoint could not be read: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const file = await load($)
    await show($, file.latest)
    // This session's own reading, when it has had a reply already (a resumed one).
    const own = fromHeaders((await $.session.usage()).rateLimits, await $.clock.now(), file.latest)
    if (own) await record($, own, file, file.error)
    void refresh($).catch(() => undefined)
    // Another session's reading, a due check, and a reset time passing all show within a minute.
    $.clock.every(TICK_MS, () => {
      void refresh($).catch(() => undefined)
      $.ui.invalidate('ui.render')
    })
    return started
  })

  // Each reply's headers: free, and fresher than the last check.
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      const file = await load($)
      const r = fromHeaders(e.rateLimits, await $.clock.now(), file.latest)
      if (r) await record($, r, file, file.error)
    }
    return next(e)
  })

  // The footer's mode slot, right of the prompt by the model picker.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const r = await read($, reading)
    const parts = r ? footerParts(r, await $.clock.now()) : []
    if (parts.length === 0) return next(e)
    const below = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    // The same on the terminal and the desktop. The desktop folds any run of
    // spaces (even no-break ones) into one and ignores a Box's gap, so the
    // windows are set apart by a dim dot, not by spaces. Then whatever the mods
    // beneath add (the timings button, the pace P).
    return (
      <Box flexDirection="row" gap={1}>
        <Box key="limits:line" flexShrink={0}>
          <Text wrap="truncate-end">
            {parts.flatMap((p, i) => [
              ...(i > 0 ? [<Text key={`limits:${p.label}:dot`} color={GREY}>{` ${PAD}·${PAD} `}</Text>] : []),
              <Text key={`limits:${p.label}:label`} color={GREY}>{`${p.label} `}</Text>,
              <Text key={`limits:${p.label}:pct`} bold {...(p.pct >= HOT_PCT ? { color: RED } : {})}>{`${p.pct}%`}</Text>,
              ...(p.reset !== null
                ? [<Text key={`limits:${p.label}:reset`} {...(resetColor(p.label, p.msLeft) ? { color: resetColor(p.label, p.msLeft) } : {})}>{`${PAD}${p.reset}`}</Text>]
                : []),
            ])}
          </Text>
        </Box>
        {below}
      </Box>
    )
  })
}
