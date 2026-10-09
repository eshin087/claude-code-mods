import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Mission, MissionStep, MissionSummary } from '../types'

// Claude reports its plan through a tool this mod registers; the mod turns it
// into % done and time left, shown on the working row, in a band above the
// prompt, and in a pane (/mission). Nothing here guesses at the model's
// thinking: the "Now" line is what Claude itself says it is doing.

const TOOL = 'mcp__mission-control__plan'
const PANE = 'mission'
// An unfinished board Claude stops updating goes after this many turns.
const STALE_TURNS = 2
const DEFAULT_MS_PER_UNIT = 120_000
const mission = atom({ plugin: 'mission-control', key: 'mission' } as const, null)
const summaryRef = atom({ plugin: 'mission-control', key: 'summary' } as const, null)
const isOpen = atom({ plugin: 'mission-control', key: 'isOpen' } as const, false)

type PlanInput = {
  title?: string
  steps?: unknown[]
  add?: unknown[]
  start?: number
  done?: number[]
  now?: string
  finished?: boolean
}

type MissionRecord = { project: string; title: string; units: number; activeMs: number; at: number; estimateError?: number }
// Past tasks a project's accuracy averages over.
const ACCURACY_TASKS = 20
// Under a minute left, a few seconds off is a large share: the floor keeps the score fair.
const ERROR_FLOOR_MS = 60_000

type Progress = {
  pct: number
  elapsed: number
  leftMs: number | null
  isRough: boolean
  /** The current step has run past the time its size gives it at this pace. */
  isOver: boolean
  stepNo: number
  total: number
}

const DESCRIPTION = [
  'Mission board: shows the person a live plan, % done and time left while you work.',
  'Use it for any task with 3+ steps or likely to take more than ~2 minutes; skip it for quick answers.',
  'Start: call once with `title` (<= 60 chars) and `steps` (3-8, plain words, each with `size` 1 small / 2 medium / 3 large).',
  'Then call it as you go: `start` with the step number you begin, `done` with step numbers you finished,',
  'and `now`: one plain line (<= 90 chars) on what you are doing or figuring out right now.',
  'Use `add` if the scope grows. Call with `finished: true` when the whole task is complete.',
  'To update, prefer `start`/`done`; sending `steps` again under the same title restates the plan (each step its `text` and `status`) and keeps its clock.',
  'Keep calls brief; they cost the person nothing and replace a long scroll of updates.',
].join(' ')

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short task title. Give it with steps to start a new plan.' },
    steps: {
      type: 'array',
      description: '3-8 steps. Giving steps starts a new plan, or restates the running one under its title.',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          size: { type: 'integer', minimum: 1, maximum: 3 },
          status: { type: 'string', enum: ['todo', 'doing', 'done'] },
        },
        required: ['text'],
      },
    },
    add: {
      type: 'array',
      description: 'Steps to append when the scope grows.',
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, size: { type: 'integer', minimum: 1, maximum: 3 } },
        required: ['text'],
      },
    },
    start: { type: 'integer', description: 'Step number (1-based) you are starting now.' },
    done: { type: 'array', items: { type: 'integer' }, description: 'Step numbers (1-based) now finished.' },
    now: { type: 'string', description: 'One plain line: what you are doing or working out right now.' },
    finished: { type: 'boolean', description: 'True when the whole task is complete.' },
  },
}

const oneLine = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

const fmt = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

const fmtLeft = (ms: number) => {
  const m = Math.round(ms / 60000)
  if (m < 1) return '<1m'
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

const bar = (pct: number, width: number) => {
  const full = Math.round(pct * width)
  return '█'.repeat(full) + '░'.repeat(Math.max(0, width - full))
}

const projectOf = (dir: string) => {
  const main = dir.replace(/[\\/]\.claude[\\/]worktrees[\\/].*$/i, '')
  return main.split(/[\\/]/).filter(Boolean).pop() ?? main
}

// Claude sometimes sends steps in another shape: a `title` instead of `text`,
// plain strings, a `status` on each. Every step it names is read, so a plan is
// never emptied by its own wording.
const STEP_TEXT = ['text', 'title', 'content', 'name', 'step'] as const

const parseStep = (raw: unknown) => {
  const s = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const key = STEP_TEXT.find(k => typeof s[k] === 'string' && (s[k] as string).trim() !== '')
  const text = typeof raw === 'string' ? raw : key ? (s[key] as string) : ''
  const size = Number(s.size)
  const status = String(s.status ?? '').toLowerCase().replace(/[\s_-]/g, '')
  return {
    text: oneLine(text, 80),
    size: Number.isFinite(size) && size > 0 ? Math.min(3, Math.max(1, Math.round(size))) : null,
    status: /^(done|complete|completed|finished)$/.test(status)
      ? ('done' as const)
      : /^(doing|inprogress|active|running|started|current)$/.test(status)
        ? ('doing' as const)
        : /^(todo|pending|notstarted|open)$/.test(status)
          ? ('todo' as const)
          : null,
  }
}

// `old`: the plan being restated, whose steps keep their size and times when the text matches.
const toSteps = (list: unknown[], old: MissionStep[] = []): MissionStep[] =>
  list
    .map(parseStep)
    .filter(p => p.text !== '')
    .slice(0, 12)
    .map(p => {
      const prev = old.find(o => o.text === p.text)
      const status = p.status ?? prev?.status ?? 'todo'
      return {
        text: p.text,
        size: p.size ?? prev?.size ?? 1,
        status,
        ...(status !== 'todo' && prev?.startActive !== undefined ? { startActive: prev.startActive } : {}),
        ...(status === 'done' && prev?.status === 'done' && prev.doneActive !== undefined ? { doneActive: prev.doneActive } : {}),
      }
    })

const activeAt = (m: Mission, now: number) => m.activeMs + (m.runningSince === null ? 0 : now - m.runningSince)

const progress = (m: Mission, now: number): Progress => {
  const elapsed = activeAt(m, now)
  const units = m.steps.reduce((a, s) => a + s.size, 0) || 1
  const doneSteps = m.steps.filter(s => s.status === 'done')
  const doneUnits = doneSteps.reduce((a, s) => a + s.size, 0)
  const lastDone = Math.max(0, ...doneSteps.map(s => s.doneActive ?? 0))

  // Pace (ms per unit of size): what this mission has shown so far, blended
  // with earlier missions while little is done; a flat default before either.
  const observed = doneUnits > 0 && lastDone > 0 ? lastDone / doneUnits : null
  const trust = Math.min(1, (doneUnits / units) * 2)
  const pace =
    observed !== null && m.calibration !== null
      ? observed * trust + m.calibration * (1 - trust)
      : observed ?? m.calibration ?? DEFAULT_MS_PER_UNIT
  const isRough = observed === null && m.calibration === null

  const cur = m.steps.find(s => s.status === 'doing')
  const spent = cur ? elapsed - (cur.startActive ?? elapsed) : 0
  const partial = cur ? Math.min(0.9, spent / (pace * cur.size)) * cur.size : 0

  const pct = m.isFinished ? 1 : Math.min(0.99, (doneUnits + partial) / units)
  const leftMs = m.isFinished ? 0 : Math.max(0, (units - doneUnits - partial) * pace)
  const stepNo = cur ? m.steps.indexOf(cur) + 1 : Math.min(m.steps.length, doneSteps.length + 1)
  const isOver = !m.isFinished && cur !== undefined && spent > pace * cur.size
  return { pct, elapsed, leftMs, isRough, isOver, stepNo, total: m.steps.length }
}

const summary = (m: Mission, p: Progress) => {
  if (m.isFinished) return `done in ${fmt(p.elapsed)}`
  const left = p.leftMs === null ? 'estimating' : `${p.isRough ? '≈' : '~'}${fmtLeft(p.leftMs)} left`
  return `step ${p.stepNo}/${p.total} · ${fmt(p.elapsed)} · ${left}`
}

const dataDir = async ($: EngineInterface) => {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  return `${home.replace(/\\/g, '/')}/.claude/mods-data/mission-control`
}

const loadRecords = async ($: EngineInterface): Promise<MissionRecord[]> => {
  const dir = await dataDir($)
  if (!(await $.fs.exists(dir))) return []
  const out: MissionRecord[] = []
  for (const f of await $.fs.list(dir)) {
    if (!f.name.endsWith('.json')) continue
    try {
      out.push(...(JSON.parse(await $.fs.read(`${dir}/${f.name}`)) as MissionRecord[]))
    } catch {
      // skip a file that does not parse
    }
  }
  return out.sort((a, b) => a.at - b.at)
}

const calibrationFor = (records: MissionRecord[], project: string) => {
  const all = records.filter(r => r.units > 0 && r.activeMs > 0)
  const mine = all.filter(r => r.project === project)
  const pool = (mine.length >= 3 ? mine : all).slice(-20).map(r => r.activeMs / r.units)
  if (pool.length === 0) return null
  return [...pool].sort((a, b) => a - b)[Math.floor(pool.length / 2)]!
}

// How far off the board's time-left estimates were, scored at the finish: the
// median, over every estimate given, of |estimated - actual time left| / actual.
const scoreEstimates = (m: Mission, totalMs: number) => {
  const errors = (m.estimates ?? [])
    .filter(e => e.atActive < totalMs)
    .map(e => Math.abs(e.leftMs - (totalMs - e.atActive)) / Math.max(totalMs - e.atActive, ERROR_FLOOR_MS))
  if (errors.length === 0) return null
  return [...errors].sort((a, b) => a - b)[Math.floor(errors.length / 2)]!
}

// The project's average miss over its last scored tasks, for "Past estimates: off by ~X%".
const accuracyOf = (records: MissionRecord[], project: string) => {
  const scored = records.filter(r => r.project === project && typeof r.estimateError === 'number').slice(-ACCURACY_TASKS)
  if (scored.length === 0) return null
  const avg = scored.reduce((a, r) => a + (r.estimateError ?? 0), 0) / scored.length
  return { avgErrorPct: Math.round(avg * 100), tasks: scored.length }
}

// Saves the finished task, then shows the project's accuracy with it counted.
const finishRecord = async ($: EngineInterface, m: Mission) => {
  await saveRecord($, m)
  const accuracy = accuracyOf(await loadRecords($), m.project)
  await update($, mission, cur => (cur && cur.id === m.id ? { ...cur, accuracy } : cur))
  await publish($)
}

const saveRecord = async ($: EngineInterface, m: Mission) => {
  const file = `${await dataDir($)}/${await $.session.id()}.json`
  const list = (await $.fs.exists(file)) ? (JSON.parse(await $.fs.read(file)) as MissionRecord[]) : []
  const err = scoreEstimates(m, m.activeMs)
  list.push({
    project: m.project,
    title: m.title,
    units: m.steps.reduce((a, s) => a + s.size, 0),
    activeMs: m.activeMs,
    at: await $.clock.now(),
    ...(err === null ? {} : { estimateError: Math.round(err * 1000) / 1000 }),
  })
  await $.fs.write(file, JSON.stringify(list.slice(-500)))
}

// What the dock shows; written on every change and once a second while running.
const publish = async ($: EngineInterface) => {
  const m = await read($, mission)
  // A board with no steps (left by an older version) shows nothing until Claude posts its plan.
  if (!m || m.steps.length === 0) {
    if ((await read($, summaryRef)) !== null) await update($, summaryRef, () => null)
    return
  }
  const p = progress(m, await $.clock.now())
  const fresh: MissionSummary = {
    title: m.title,
    pct: p.pct,
    stepNo: p.stepNo,
    total: p.total,
    left: m.isFinished || p.leftMs === null ? null : `${p.isRough ? '≈' : '~'}${fmtLeft(p.leftMs)}`,
    elapsedMs: p.elapsed,
    isFinished: m.isFinished,
    now: m.now,
    accuracy: m.accuracy ?? null,
  }
  await update($, summaryRef, () => fresh)
}

const togglePane = async ($: EngineInterface) => {
  if ((await $.ui.panes()).some(p => p.id === PANE)) {
    await $.ui.close({ id: PANE })
    // A plugin's own close does not reach its own ui.close hook: reset the flag here.
    await update($, isOpen, () => false)
    return 'Mission pane closed.'
  }
  const opened = await $.ui.open({ id: PANE, title: 'Mission' })
  if (opened.isPlaced) await update($, isOpen, () => true)
  else $.ui.toast(`Mission pane could not open (${opened.reason}).`)
  return opened.isPlaced ? 'Mission pane opened.' : `Could not open the pane (${opened.reason}).`
}

let touched = false
let idleTurns = 0

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({ name: 'plan', description: DESCRIPTION, inputSchema: SCHEMA })
    await $.command.register({ name: 'mission', description: 'Open the Mission Control pane (plan, % done, time left)' })
    // Once a second while a mission runs, so elapsed and time left tick in the dock and pane.
    $.clock.every(1000, async () => {
      const m = await read($, mission)
      if (m && m.runningSince !== null && !m.isFinished) await publish($)
    })
    await publish($)
    return next(e)
  })

  // A short reminder beside each prompt the person sends, so long tasks get a board.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'plugin') return next(e)
    const m = await read($, mission)
    if (m?.isFinished) {
      await update($, mission, () => null)
      await publish($)
    }
    const open = m && !m.isFinished
      ? ` The board currently shows "${m.title}" (${m.steps.filter(s => s.status === 'done').length}/${m.steps.length} steps done): update it if you continue that work, or post new steps for a new task.`
      : ''
    const note =
      `[mission-control] For multi-step work (3+ steps or over ~2 minutes), first post a short plan with ${TOOL}, ` +
      `then update it as steps start and finish, with a one-line "now". Skip it for quick answers.${open}`
    return next({ ...e, context: [...(e.context ?? []), note] })
  })

  on('turn.start', async ($, e, next) => {
    touched = false
    const now = await $.clock.now()
    await update($, mission, m => (m && !m.isFinished && m.runningSince === null ? { ...m, runningSince: now } : m))
    await publish($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const now = await $.clock.now()
    await update($, mission, m =>
      m && m.runningSince !== null ? { ...m, activeMs: activeAt(m, now), runningSince: null } : m,
    )
    const m = await read($, mission)
    idleTurns = touched ? 0 : idleTurns + 1
    if (m && !m.isFinished && idleTurns >= STALE_TURNS) await update($, mission, () => null)
    await publish($)
    return next(e)
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    if (e.agentId !== undefined) return { result: 'The mission board follows the main session only; nothing changed.' }
    const input = e as unknown as PlanInput
    touched = true
    idleTurns = 0
    const now = await $.clock.now()
    let m = await read($, mission)

    if (Array.isArray(input.steps) && input.steps.length > 0) {
      const title = oneLine(input.title ?? 'Current task', 60)
      const parsed = input.steps.map(parseStep).filter(p => p.text !== '')
      // Nothing readable in the list: the board stays as it was.
      if (parsed.length === 0) return { result: 'Nothing changed: give each step its words in `text`, e.g. { "text": "Fix the parser", "size": 2 }.' }
      // The running plan sent again (same title, or steps carrying a status):
      // the new list replaces its steps, and it keeps its clock and trail.
      if (m && !m.isFinished && (title === m.title || parsed.some(p => p.status !== null))) {
        m = { ...m, title, steps: toSteps(input.steps, m.steps) }
      } else {
        const project = projectOf(await $.session.cwd())
        const records = await loadRecords($).catch(() => [])
        m = {
          id: String(now),
          title,
          project,
          steps: toSteps(input.steps),
          now: '',
          notes: [],
          activeMs: 0,
          runningSince: now,
          isFinished: false,
          calibration: calibrationFor(records, project),
          estimates: [],
          accuracy: accuracyOf(records, project),
        }
      }
    }
    if (!m) return { result: 'No plan yet: call again with a title and steps.' }

    const t = activeAt(m, now)
    const steps = m.steps.map(s => ({ ...s }))
    if (Array.isArray(input.add)) steps.push(...toSteps(input.add))
    for (const n of input.done ?? []) {
      const s = steps[n - 1]
      if (s && s.status !== 'done') Object.assign(s, { status: 'done', doneActive: t, startActive: s.startActive ?? t })
    }
    if (typeof input.start === 'number') {
      const k = input.start - 1
      // Plans run in order: starting step k closes the ones before it.
      steps.forEach((s, i) => {
        if (i < k && s.status !== 'done') Object.assign(s, { status: 'done', doneActive: t, startActive: s.startActive ?? t })
        if (i > k && s.status === 'doing') s.status = 'todo'
      })
      const s = steps[k]
      if (s && s.status !== 'done') Object.assign(s, { status: 'doing', startActive: t })
    }
    // Steps that arrived already done or under way (a restated list) count from now.
    for (const s of steps) {
      if (s.status !== 'todo') s.startActive ??= t
      if (s.status === 'done') s.doneActive ??= t
    }

    let upd: Mission = {
      ...m,
      steps,
      title: input.title && !input.steps ? oneLine(input.title, 60) : m.title,
      runningSince: m.runningSince ?? now,
    }
    if (typeof input.now === 'string' && input.now.trim() !== '') {
      const text = oneLine(input.now, 90)
      const last = upd.notes.at(-1)
      upd = { ...upd, now: text, notes: last?.text === text ? upd.notes : [...upd.notes, { atActive: t, text }].slice(-12) }
    }
    // The time left the board shows now: kept, to score against the real finish.
    if (input.finished !== true) {
      const est = progress(upd, now).leftMs
      if (est !== null) upd = { ...upd, estimates: [...(upd.estimates ?? []), { atActive: t, leftMs: Math.round(est) }].slice(-40) }
    }
    if (input.finished === true) {
      upd = {
        ...upd,
        steps: upd.steps.map(s => (s.status === 'done' ? s : { ...s, status: 'done', doneActive: t, startActive: s.startActive ?? t })),
        isFinished: true,
        activeMs: t,
        runningSince: null,
        now: '',
      }
      const done = upd
      void finishRecord($, done).catch(() => undefined)
    }

    const final = upd
    await update($, mission, () => final)
    await publish($)
    const p = progress(final, now)
    return { result: `Board updated: ${Math.round(p.pct * 100)}%, ${summary(final, p)}.` }
  })

  // The working row ("Working…" on the desktop) carries the progress while Claude
  // works (the dock leaves its own progress out meanwhile). The desktop draws an
  // animated, colored row with a "plan ›" link (hooks/row.tsx, on its own frame
  // clock); elsewhere the row's text is rewritten. Named `Client` with a
  // literal module path: the engine finds the row's module by reading this source.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    await read($, summaryRef)
    const m = await read($, mission)
    if (!m || m.isFinished || m.runningSince === null || m.steps.length === 0 || e.props.message !== null) return next(e)
    const p = progress(m, await $.clock.now())
    const elements = $.ui.resolve(e)
    const Client = 'Client' in elements && e.surface === 'desktop' ? elements.Client : undefined
    if (Client) {
      const { Box } = elements
      const row = {
        pct: p.pct,
        stepNo: p.stepNo,
        total: p.total,
        elapsed: fmt(p.elapsed),
        left: p.leftMs === null ? null : `${p.isRough ? '≈' : '~'}${fmtLeft(p.leftMs)} left`,
        pace: p.isRough ? 'rough' : p.isOver ? 'slow' : 'ok',
        isPlanOpen: await read($, isOpen),
      }
      return (
        <Box flexDirection="row">
          <Client key="mission:row" module="./row.tsx" width="100%" props={row} />
        </Box>
      )
    }
    const message = `${Math.round(p.pct * 100)}% · ${summary(m, p)}`
    return next({ ...e, props: { ...e.props, message } })
  })

  // A click on the working row's "plan ›" toggles the Mission pane.
  on('ui.message', { component: 'Spinner' }, async ($, e, next) => {
    if (e.element !== 'mission:row') return next(e)
    if ((e.data as { open?: unknown } | null)?.open === 'plan') await togglePane($)
    return {}
  })

  on('command.run', { command: 'mission' }, async $ => ({ text: await togglePane($) }))

  // A press on the dock's Plan button.
  on('state.set', { plugin: 'mod-hub', key: 'signal' }, async ($, e, next) => {
    const done = await next(e)
    // Only a write that landed: update() retries a missed one, which would toggle twice.
    const sig = e.value as { target?: string; action?: string } | null
    if (done.value?.isSet !== true || !sig) return done
    if (sig.target === 'mission-control') await togglePane($)
    // Review: show the panel, never close it.
    else if (sig.action === 'review' && !(await $.ui.panes()).some(p => p.id === PANE)) await togglePane($)
    return done
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const done = await next(e)
    await update($, isOpen, () => false)
    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    await read($, summaryRef)
    const m = await read($, mission)
    if (!m) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No mission yet. Claude posts a plan here when it starts a multi-step task.</Text>
          <Button key="close" label="Close" role="dismiss" onPress={() => togglePane($)} />
        </Box>
      )
    }
    const p = progress(m, await $.clock.now())
    const width = Math.max(10, Math.min(30, (e.props.bodyColumns ?? 40) - 8))
    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>{m.title}</Text>
          <Box flexDirection="row" gap={1}>
            <Text color={m.isFinished ? 'success' : 'claude'}>{bar(p.pct, width)}</Text>
            <Text bold>{Math.round(p.pct * 100)}%</Text>
          </Box>
          <Text dimColor>
            elapsed {fmt(p.elapsed)}
            {m.isFinished ? ' · finished' : p.leftMs === null ? '' : ` · ${p.isRough ? 'about' : '~'} ${fmtLeft(p.leftMs)} left`}
            {p.isRough && !m.isFinished ? ' (rough until a step finishes)' : ''}
          </Text>
          {m.accuracy && (
            <Text dimColor>
              Past estimates here: off by ~{m.accuracy.avgErrorPct}% on average ({m.accuracy.tasks} {m.accuracy.tasks === 1 ? 'task' : 'tasks'})
            </Text>
          )}
        </Box>
        <Box flexDirection="column">
          {m.steps.map((s, i) => {
            const took =
              s.status === 'done' && s.doneActive !== undefined && s.startActive !== undefined && s.doneActive > s.startActive
                ? `  ${fmt(s.doneActive - s.startActive)}`
                : s.status === 'doing' && s.startActive !== undefined
                  ? `  ${fmt(p.elapsed - s.startActive)}…`
                  : ''
            return (
              <Text
                dimColor={s.status === 'done'}
                bold={s.status === 'doing'}
                color={s.status === 'doing' ? 'claude' : undefined}
                wrap="truncate-end"
              >
                {s.status === 'done' ? '✓' : s.status === 'doing' ? '▶' : '○'} {i + 1}. {s.text}
                {took}
              </Text>
            )
          })}
        </Box>
        {m.notes.length > 0 && (
          <Box flexDirection="column">
            <Text bold>Trail</Text>
            {m.notes.slice(-8).map(n => (
              <Text dimColor={n.text !== m.now} wrap="truncate-end">
                {fmt(n.atActive).padStart(7)}  {n.text}
              </Text>
            ))}
          </Box>
        )}
        <Box flexDirection="row" gap={1}>
          <Button key="close" label="Close" role="dismiss" onPress={() => togglePane($)} />
          {m.isFinished && <Button key="clear" label="Clear" onPress={async () => { await update($, mission, () => null); await publish($) }} />}
        </Box>
      </Box>
    )
  })
}
