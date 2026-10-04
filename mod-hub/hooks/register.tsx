import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { HubMod, HubTask } from '../types'

// Two jobs. The hub: every mod in the mods folder, its README, and an on/off
// switch. A switched-off mod is named in ~/.claude/mods-data/mod-hub/off.json
// (this computer only) and the hub refuses it at `plugin.register`, so no mod
// file changes and git sees nothing.
// The dock: one line above the prompt with the running task's progress and a
// toggle button per mod, badged with what is worth a look. A press for another
// mod is written to `signal`; that mod hooks the write and toggles its own
// panel, so presses land at once, even mid-turn (slash commands wait for idle).

const PANE = 'mods'
const SELF = 'mod-hub'
const ON = `{ "modules": ["./register.tsx"] }\n`
// What the old switch wrote into a switched-off mod's hooks.json; moved to off.json on sight.
const LEGACY_OFF = './off.tsx'
const REFUSAL = 'switched off in /mods'

const mods = atom({ plugin: 'mod-hub', key: 'mods' } as const, [])
const expanded = atom({ plugin: 'mod-hub', key: 'expanded' } as const, null)
const rootRef = atom({ plugin: 'mod-hub', key: 'root' } as const, '')
const signal = atom({ plugin: 'mod-hub', key: 'signal' } as const, null)
const isCollapsed = atom({ plugin: 'mod-hub', key: 'isCollapsed' } as const, false)
const isOpen = atom({ plugin: 'mod-hub', key: 'isOpen' } as const, false)
const peek = atom({ plugin: 'mod-hub', key: 'peek' } as const, null)
const tasksRef = atom({ plugin: 'mod-hub', key: 'tasks' } as const, [])
const tasksOpen = atom({ plugin: 'mod-hub', key: 'tasksOpen' } as const, false)

// Other mods' values the dock reads (each owner writes its own).
const MISSION = { plugin: 'mission-control', key: 'summary' } as const
const MISSION_OPEN = { plugin: 'mission-control', key: 'isOpen' } as const
const NEXT = { plugin: 'next-tasks', key: 'card' } as const
const COACH_UNSEEN = { plugin: 'coach', key: 'unseen' } as const
const COACH_OPEN = { plugin: 'coach', key: 'isOpen' } as const
const PRS = { plugin: 'pr-desk', key: 'desk' } as const
const PRS_OPEN = { plugin: 'pr-desk', key: 'isOpen' } as const
const COACH_STATS = { plugin: 'coach', key: 'stats' } as const
const MISSION_FULL = { plugin: 'mission-control', key: 'mission' } as const

// Each tab's color, used for its hover card's frame and title.
const ACCENT = { plan: '#22d3ee', next: '#facc15', coach: '#a78bfa', prs: '#4ade80', tasks: '#fb923c', mods: '#f472b6' } as const
const TRACK = '#3f3f46'
const COACH_TIP = { plugin: 'coach', key: 'lastTip' } as const
const LIMITS = { plugin: 'usage-meter', key: 'limits' } as const

// The one popup's width in cells, and the colors a level maps to.
const CARD_W = 52
const LEVEL_HEX = { success: '#4ade80', warning: '#facc15', error: '#f87171', none: '#6b7280' } as const
// The desktop app's own view tools (its Background tasks pane among them).
const VIEW = 'ccd_view'

const fmt = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

const fmtIn = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60000))
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

const parentOf = (dir: string) => dir.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]+$/, '')

const readJson = async ($: EngineInterface, path: string) => {
  try {
    return JSON.parse(await $.fs.read(path)) as Record<string, unknown>
  } catch {
    return null
  }
}

const dataDir = async ($: EngineInterface) => {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  return `${home.replace(/\\/g, '/')}/.claude/mods-data/mod-hub`
}

// The mods switched off on this computer, by name.
const readOff = async ($: EngineInterface) => {
  const saved = await readJson($, `${await dataDir($)}/off.json`)
  return Array.isArray(saved?.off) ? saved.off.filter((n): n is string => typeof n === 'string') : []
}

const writeOff = async ($: EngineInterface, names: string[]) =>
  $.fs.write(`${await dataDir($)}/off.json`, `${JSON.stringify({ off: [...new Set(names)].sort() }, null, 2)}\n`)

// The engine asks only the mods loaded before a mod whether it may load, so the
// hub must come first in CLAUDE_CODE_PLUGIN_DIRS (the installers put it there).
// The folders listed ahead of it, which it cannot keep off.
const foldersAheadOfHub = async ($: EngineInterface) => {
  const isWindows = /^[A-Za-z]:/.test($.plugin.root)
  const norm = (p: string) => {
    const path = p.trim().replace(/\\/g, '/').replace(/\/+$/, '')
    return isWindows ? path.toLowerCase() : path
  }
  const dirs = ((await $.env.get('CLAUDE_CODE_PLUGIN_DIRS')) ?? '').split(isWindows ? ';' : ':').map(norm)
  const at = dirs.indexOf(norm($.plugin.root))
  return at < 0 ? [] : dirs.slice(0, at).map(d => d.slice(d.lastIndexOf('/') + 1))
}

const aheadWarning = (names: string) =>
  `Can't keep ${names} off: loaded before mod-hub. Run install.ps1 (or install.sh) again to put mod-hub first, then start a new session.`

const scan = async ($: EngineInterface) => {
  const root = parentOf($.plugin.root)
  const entries = await $.fs.list(root)
  const off = await readOff($)
  const ahead = await foldersAheadOfHub($)
  const isWindows = /^[A-Za-z]:/.test(root)
  const found: HubMod[] = []
  const legacy: { name: string; file: string }[] = []
  for (const entry of entries) {
    const dir = `${root}/${entry.name}`
    const manifest = await readJson($, `${dir}/.claude-plugin/plugin.json`)
    if (!manifest) continue
    const name = typeof manifest.name === 'string' ? manifest.name : entry.name
    const hooks = await readJson($, `${dir}/hooks/hooks.json`)
    const modules = Array.isArray(hooks?.modules) ? (hooks.modules as unknown[]) : []
    if (modules.includes(LEGACY_OFF) && name !== SELF) legacy.push({ name, file: `${dir}/hooks/hooks.json` })
    const readme = (await $.fs.exists(`${dir}/README.md`)) ? await $.fs.read(`${dir}/README.md`) : null
    found.push({
      folder: entry.name,
      name,
      description: typeof manifest.description === 'string' ? manifest.description : '',
      version: typeof manifest.version === 'string' ? manifest.version : '',
      isOn: !off.includes(name) && !legacy.some(l => l.name === name),
      isAheadOfHub: ahead.includes(isWindows ? entry.name.toLowerCase() : entry.name),
      readme,
    })
  }
  // A mod the old switch turned off (its hooks.json names the off.tsx stub):
  // the list first, so the reload the hooks.json write sets off refuses it.
  if (legacy.length > 0) {
    await writeOff($, [...off, ...legacy.map(l => l.name)])
    for (const l of legacy) await $.fs.write(l.file, ON)
  }
  found.sort((a, b) => (a.name === SELF ? -1 : b.name === SELF ? 1 : a.name.localeCompare(b.name)))
  await update($, mods, () => found)
  await update($, rootRef, () => root)
  return found
}

// Does what the pressed button said, even when a page left open elsewhere is behind.
const toggle = async ($: EngineInterface, mod: HubMod) => {
  if (mod.name === SELF) return
  const rest = (await readOff($)).filter(n => n !== mod.name)
  await writeOff($, mod.isOn ? [...rest, mod.name] : rest)
  // hooks.json rewritten as it is: its new timestamp makes every watching
  // session reload the mod, and the reload asks plugin.register again.
  const file = `${await read($, rootRef)}/${mod.folder}/hooks/hooks.json`
  const text = await $.fs.read(file).catch(() => null)
  if (text !== null) await $.fs.write(file, text)
  await scan($)
  const isStuck = mod.isOn && mod.isAheadOfHub
  $.ui.toast(isStuck ? aheadWarning(mod.name) : `${mod.name} switched ${mod.isOn ? 'off' : 'on'}.`, { timeoutMs: isStuck ? 12000 : 5000 })
}

const toggleHub = async ($: EngineInterface) => {
  if ((await $.ui.panes()).some(p => p.id === PANE)) {
    await $.ui.close({ id: PANE })
    // A plugin's own close does not reach its own ui.close hook: reset the flag here.
    await update($, isOpen, () => false)
    return 'Mod Hub closed.'
  }
  const list = await scan($)
  const opened = await $.ui.open({ id: PANE, title: 'Mods' })
  if (opened.isPlaced) await update($, isOpen, () => true)
  return opened.isPlaced ? `Mod Hub: ${list.filter(m => m.isOn).length} of ${list.length} mods on.` : `Could not open the pane (${opened.reason}).`
}

const send = ($: EngineInterface, target: string) => update($, signal, s => ({ seq: (s?.seq ?? 0) + 1, target }))

// Every mod shows itself: the panels open as tabs, the next-task card opens.
const review = async ($: EngineInterface) => {
  await collapse($, false)
  await update($, signal, s => ({ seq: (s?.seq ?? 0) + 1, target: '*', action: 'review' as const }))
  if (!(await $.ui.panes()).some(p => p.id === PANE)) await toggleHub($)
  $.ui.toast('Review: Mods, Plan, Coach and PRs are open as tabs; next tasks are on their way.', { timeoutMs: 8000 })
}

// A review queued from outside (mods-data/mod-hub/review.json with { "pending": true })
// runs once, a few seconds after the mods load, so every mod is listening.
const reviewIfQueued = async ($: EngineInterface) => {
  const file = `${await dataDir($)}/review.json`
  if (!(await $.fs.exists(file))) return
  try {
    const queued = JSON.parse(await $.fs.read(file)) as { pending?: boolean; session?: string }
    if (queued.pending !== true) return
    // A review meant for one session is left for that session.
    if (queued.session && queued.session !== (await $.session.id())) return
  } catch {
    return
  }
  await $.fs.write(file, JSON.stringify({ pending: false }))
  $.clock.after(3000, () => void review($).catch(() => undefined))
}

const collapse = async ($: EngineInterface, value: boolean) => {
  await update($, isCollapsed, () => value)
  await $.store.set('collapsed', value)
}

// A solid rounded bar (track, then fill up to pct) as SVG, for surfaces that draw it.
const svgBar = (pct: number, width: number, color: string) => {
  const fill = Math.max(0, Math.min(width, Math.round(pct * width)))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="8" viewBox="0 0 ${width} 8">` +
    `<rect y="1.5" width="${width}" height="5" rx="2.5" fill="${TRACK}"/>` +
    (fill > 0 ? `<rect y="1.5" width="${Math.max(fill, 5)}" height="5" rx="2.5" fill="${color}"/>` : '') +
    '</svg>'
}

const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n)}%`)
const usd = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `$${n.toFixed(2)}`)

// Background shells, monitors and workflows as the last reply left them (the
// classic Stop hook reports them); running agents are listed live.
let shells: HubTask[] = []

const textOfResult = (r: { content: readonly unknown[] }) =>
  r.content.map(c => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : '')).join(' ').trim()

// Whether the app's Background tasks pane is open; null where the app can't say.
const isTasksPaneOpen = async ($: EngineInterface): Promise<boolean | null> => {
  try {
    const r = await $.mcp.call(VIEW, 'get_layout', {})
    if (r.isError) return null
    const layout = JSON.parse(textOfResult(r)) as { open_panes?: unknown }
    return Array.isArray(layout.open_panes) && layout.open_panes.includes('tasks')
  } catch {
    return null
  }
}

const refreshTasks = async ($: EngineInterface) => {
  const agents = await $.agent.list().catch(() => [])
  const merged: HubTask[] = [
    ...agents.map(a => ({ id: a.id, kind: a.type, label: a.description || a.name || a.type, status: a.status })),
    ...shells,
  ]
  if (JSON.stringify(merged) !== JSON.stringify(await read($, tasksRef))) await update($, tasksRef, () => merged)
  const isPaneOpen = await isTasksPaneOpen($)
  if (isPaneOpen !== null && isPaneOpen !== (await read($, tasksOpen))) await update($, tasksOpen, () => isPaneOpen)
}

// T: open the app's own Background tasks pane, or close it when it is open.
const toggleTasks = async ($: EngineInterface) => {
  const wasOpen = (await isTasksPaneOpen($)) ?? (await read($, tasksOpen))
  try {
    const r = await $.mcp.call(VIEW, wasOpen ? 'close_pane' : 'show_pane', { pane: 'tasks' })
    if (r.isError) throw new Error(textOfResult(r) || 'the app refused')
    await update($, tasksOpen, () => !wasOpen)
  } catch (err) {
    $.ui.toast(`Background tasks pane: ${err instanceof Error ? err.message : String(err)}. Open it from the app's menu instead.`, { timeoutMs: 7000 })
  }
}

const pressTab = async ($: EngineInterface, id: string) => {
  if (id === 'plan') await send($, 'mission-control')
  else if (id === 'next') await send($, 'next-tasks')
  else if (id === 'coach') await send($, 'coach')
  else if (id === 'prs') await send($, 'pr-desk')
  else if (id === 'tasks') await toggleTasks($)
  else if (id === 'mods') await toggleHub($)
}

const isModOn = (list: HubMod[], name: string) => list.length === 0 || list.some(m => m.name === name && m.isOn)

export const register: Register = on => {
  // A switched-off mod never loads: the engine asks the hub about every mod
  // loaded after it, at session start and at each reload.
  on('plugin.register', async ($, e, next) => {
    if (e.name !== SELF && (await readOff($)).includes(e.name)) return { refuse: REFUSAL }
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'mods', description: 'Mod Hub: what each mod does, and switch mods on or off (toggles)' })
    await $.command.register({ name: 'mods-review', description: 'Open every mod panel at once (Mods, Plan, Coach, PRs, next tasks)' })
    const wasCollapsed = (await $.store.get('collapsed')) === true
    await update($, isCollapsed, () => wasCollapsed)
    const list = await scan($).catch(() => [] as HubMod[])
    const stuck = list.filter(m => !m.isOn && m.isAheadOfHub)
    if (stuck.length > 0) $.ui.toast(aheadWarning(stuck.map(m => m.name).join(', ')), { timeoutMs: 12000 })
    await reviewIfQueued($).catch(() => undefined)
    // The T tab: running agents, and whether the app's tasks pane is open.
    $.clock.every(5000, () => void refreshTasks($).catch(() => undefined))
    void refreshTasks($).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'mods' }, async $ => ({ text: await toggleHub($) }))

  on('command.run', { command: 'mods-review' }, async $ => {
    await review($)
    return { text: 'Review mode: every mod panel is open.' }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const done = await next(e)
    await update($, isOpen, () => false)
    return done
  })

  // The dock: one line, closest to the prompt. On surfaces that draw a Client
  // (terminal, desktop) the tabs are a small strip that reports which tab the
  // pointer is over; the dock then draws ONE card for it, always in the same
  // place: above the dock's right end, placed from its left edge (the desktop
  // places absolute boxes from the left). Elsewhere the tabs are plain buttons.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    const SvgEl = 'Svg' in elements && e.surface !== 'terminal' ? elements.Svg : undefined
    // The desktop gets the hover strip; the terminal keeps letter buttons with
    // their shortcut keys. Named `Client` with a literal module path: the
    // engine finds the strip's surface module by reading this source.
    const Client = 'Client' in elements && e.surface === 'desktop' ? elements.Client : undefined

    if (await read($, isCollapsed)) {
      // Folded means quiet: other mods' rows (the next-task card) are left out too.
      return (
        <Box flexDirection="row">
          <Button key="dock:expand" label="◆ ▸" plain onPress={() => collapse($, false)} />
        </Box>
      )
    }

    const below = await next(e)
    const list = await read($, mods)
    const mission = isModOn(list, 'mission-control') ? (await $.state.get(MISSION)).value ?? null : null
    const steps = isModOn(list, 'mission-control') ? (await $.state.get(MISSION_FULL)).value?.steps ?? [] : []
    const card = isModOn(list, 'next-tasks') ? (await $.state.get(NEXT)).value ?? null : null
    const desk = isModOn(list, 'pr-desk') ? (await $.state.get(PRS)).value ?? null : null
    const hasCoach = isModOn(list, 'coach')
    const coach = hasCoach ? (await $.state.get(COACH_STATS)).value ?? null : null
    const coachTip = hasCoach ? (await $.state.get(COACH_TIP)).value ?? null : null
    const coachNew = hasCoach && (await $.state.get(COACH_UNSEEN)).value === true
    const limits = isModOn(list, 'usage-meter') ? (await $.state.get(LIMITS)).value ?? [] : []
    const tasks = await read($, tasksRef)
    const peeking = await read($, peek)
    const open = {
      plan: (await $.state.get(MISSION_OPEN)).value === true,
      coach: (await $.state.get(COACH_OPEN)).value === true,
      prs: (await $.state.get(PRS_OPEN)).value === true,
      mods: await read($, isOpen),
      tasks: await read($, tasksOpen),
    }
    const prBad = (desk?.prs ?? []).filter(p => p.checks === 'failing' || p.mergeable === 'CONFLICTING')
    const running = tasks.filter(t => /run|pend|progress|start/i.test(t.status))
    const now = await $.clock.now()

    // A bar: solid SVG where the surface draws SVG, characters on the terminal.
    const meter = (fraction: number, cells: number, color: string) => {
      if (SvgEl) {
        return <SvgEl source={svgBar(fraction, cells * 7, color)} alt={`${Math.round(fraction * 100)}%`} width={cells * 7} height={8} />
      }
      const full = Math.max(0, Math.min(cells, Math.round(fraction * cells)))
      return (
        <Box flexDirection="row">
          <Text color={color}>{'━'.repeat(full)}</Text>
          <Text color={TRACK}>{'━'.repeat(cells - full)}</Text>
        </Box>
      )
    }
    const level = (v: number | null, good: number, ok: number, higherIsBetter: boolean) =>
      v === null ? undefined : higherIsBetter ? (v >= good ? 'success' : v >= ok ? 'warning' : 'error') : v <= good ? 'success' : v <= ok ? 'warning' : 'error'
    // One line of a card: never wraps; whatever does not fit ends in "…".
    const line = (key: string, ...parts: RenderElement[]) => (
      <Box key={key} flexDirection="row" gap={1} flexWrap="nowrap" overflow="hidden">
        {parts}
      </Box>
    )
    const cell = (text: string, width: number, color?: string, bold?: boolean) => (
      <Box width={width} flexShrink={0}>
        <Text color={color} bold={bold} wrap="truncate-end">
          {text}
        </Text>
      </Box>
    )
    const rest = (text: string, dim = true, color?: string) => (
      <Box flexShrink={1} minWidth={0}>
        <Text dimColor={dim} color={color} wrap="truncate-end">
          {text}
        </Text>
      </Box>
    )

    // Each card: its title and its lines. Built only for the tab being looked at.
    const build = (id: string): { title: string; lines: RenderElement[] } | null => {
      if (id === 'plan' && mission) {
        const out: RenderElement[] = [
          line(
            'bar',
            meter(mission.pct, 16, ACCENT.plan),
            cell(`${Math.round(mission.pct * 100)}%`, 5, undefined, true),
            rest(mission.isFinished ? `done in ${fmt(mission.elapsedMs)}` : `step ${mission.stepNo}/${mission.total}${mission.left ? ` · ${mission.left} left` : ''}`),
          ),
        ]
        if (!mission.isFinished && mission.now !== '') out.push(line('now', rest(`Now: ${mission.now}`)))
        steps.slice(0, 8).forEach((st, i) =>
          out.push(
            line(
              `step:${i}`,
              cell(st.status === 'done' ? '✓' : st.status === 'doing' ? '▶' : '○', 1, st.status === 'done' ? 'success' : st.status === 'doing' ? ACCENT.plan : undefined),
              rest(`${i + 1}. ${st.text}`, st.status === 'todo', st.status === 'doing' ? ACCENT.plan : undefined),
            ),
          ),
        )
        if (mission.accuracy) {
          out.push(line('acc', rest(`Past estimates: off by ~${mission.accuracy.avgErrorPct}% on average (${mission.accuracy.tasks} tasks)`)))
        }
        return { title: `◎ ${mission.title}`, lines: out }
      }
      if (id === 'next') {
        const out: RenderElement[] = []
        if (!card) out.push(line('none', rest('None yet. Click N to ask for three now.')))
        else if (card.isLoading) out.push(line('loading', rest('Working out three next tasks…')))
        else if (card.items.length === 0) out.push(line('error', rest(card.error ?? 'No suggestions came back.', false, 'warning')))
        else {
          card.items.forEach((item, i) => out.push(line(`item:${i}`, cell(`${i + 1}`, 1, ACCENT.next, true), rest(item.title, false))))
          out.push(line('hint', rest('Click N to show them; click a task to do it.')))
        }
        return { title: 'Next tasks', lines: out }
      }
      if (id === 'coach') {
        const lastIn = coach?.last ? coach.last.input + coach.last.cacheRead + coach.last.cacheWrite : 0
        const hit = coach?.last && lastIn > 0 ? (coach.last.cacheRead / lastIn) * 100 : null
        const ctx = coach && coach.contextTokens !== null && coach.contextWindow ? (coach.contextTokens / coach.contextWindow) * 100 : null
        const five = limits.find(l => l.kind === 'five_hour')
        const week = limits.find(l => l.kind === 'seven_day')
        const resets = five?.resetsAt ? fmtIn(Date.parse(five.resetsAt) - now) : null
        const habit = (label: string, ok: boolean | null) => cell(`${ok === null ? '·' : ok ? '✓' : '✗'} ${label}`, label.length + 2, ok === null ? undefined : ok ? 'success' : 'error')
        return {
          title: 'Coach',
          lines: [
            line('cache', cell('Cache', 8), meter((hit ?? 0) / 100, 10, LEVEL_HEX[level(hit, 80, 50, true) ?? 'none']), cell(pct(hit), 5, level(hit, 80, 50, true), true), rest(hit === null ? '' : hit >= 80 ? 'reused well' : hit >= 50 ? 'partly re-read' : 're-read: costly')),
            line('ctx', cell('Context', 8), meter((ctx ?? 0) / 100, 10, LEVEL_HEX[level(ctx, 50, 75, false) ?? 'none']), cell(pct(ctx), 5, level(ctx, 50, 75, false), true), rest(ctx === null ? '' : ctx <= 50 ? 'room to spare' : ctx <= 75 ? 'getting full' : 'compact soon')),
            line('cost', cell('Cost', 8), cell(usd(coach?.costUsd), 8, '#facc15', true), rest(coach && coach.turns > 0 && coach.costUsd !== null ? `${usd(coach.costUsd / coach.turns)}/turn · ${coach.turns} turns` : '')),
            line(
              'limits',
              cell('Limits', 8),
              rest(
                [five ? `5h ${Math.round(five.percentUsed)}%${resets ? ` (resets ${resets})` : ''}` : '', week ? `W ${Math.round(week.percentUsed)}%` : ''].filter(Boolean).join(' · ') || 'after the first reply',
                false,
              ),
            ),
            line(
              'habits',
              cell('Habits', 8),
              habit('Plan', coach ? coach.planUsed || null : null),
              habit('Branch', coach && coach.commits > 0 ? coach.commitsOnMain === 0 : null),
              habit('Tests', coach && coach.edits > 0 ? coach.testsRun > 0 && coach.editsSinceTest < 5 : null),
              habit('PR', coach && coach.commits > 0 ? coach.prsOpened > 0 : null),
            ),
            line('next', cell('Do next', 8, ACCENT.coach, true), rest(coachTip ?? 'Nothing to flag right now', false)),
          ],
        }
      }
      if (id === 'prs') {
        const out: RenderElement[] = []
        if (!desk) out.push(line('loading', rest('Checking GitHub…')))
        else if (desk.prs.length === 0) out.push(line('none', rest('No open PRs of yours.')))
        for (const p of (desk?.prs ?? []).slice(0, 5)) {
          const bad = p.checks === 'failing' || p.mergeable === 'CONFLICTING'
          const state = p.checks === 'failing' ? '✗ checks failing' : p.mergeable === 'CONFLICTING' ? '✗ conflicts' : p.checks === 'pending' ? '… checks running' : '✓ ready'
          out.push(line(`pr:${p.number}`, cell(`#${p.number}`, 5, undefined, true), cell(state, 17, bad ? 'error' : p.checks === 'pending' ? 'warning' : 'success'), rest(p.repo.split('/')[1] ?? p.repo)))
          out.push(line(`pr:${p.number}:title`, cell('', 5), rest(p.title)))
        }
        if (desk) out.push(line('when', rest(`checked ${fmt(now - desk.at)} ago · click PR for preview links`)))
        return { title: `Pull requests${desk ? ` · ${desk.prs.length} open` : ''}`, lines: out }
      }
      if (id === 'tasks') {
        const out: RenderElement[] = []
        if (tasks.length === 0) out.push(line('none', rest('Nothing in the background.')))
        for (const t of tasks.slice(0, 8)) {
          const isRunning = running.includes(t)
          out.push(line(`task:${t.id}`, cell('●', 1, isRunning ? 'warning' : 'success'), cell(t.kind, 9, undefined, true), rest(t.label, !isRunning)))
        }
        out.push(line('hint', rest(`Click T to ${open.tasks ? 'close' : 'open'} the Background tasks pane.`)))
        return { title: `Background tasks${running.length > 0 ? ` · ${running.length} running` : ''}`, lines: out }
      }
      if (id === 'mods') {
        return {
          title: `Mods · ${list.filter(m => m.isOn).length} on · ${list.filter(m => !m.isOn).length} off`,
          lines: [
            ...list.map(m => line(`mod:${m.folder}`, cell(m.isOn ? '●' : '○', 1, m.isOn ? 'success' : 'error'), cell(m.name, 16, undefined, m.isOn), rest(m.description))),
            line('hint', rest('Click M to switch mods on or off.')),
          ],
        }
      }
      return null
    }

    const tabs: { id: keyof typeof ACCENT; letter: string; hotkey: string; dot: 'open' | 'new' | null; press: () => unknown }[] = []
    const add = (id: keyof typeof ACCENT, letter: string, hotkey: string, isTabOpen: boolean, isNew: boolean, press: () => unknown) =>
      tabs.push({ id, letter, hotkey, dot: isTabOpen ? 'open' : isNew ? 'new' : null, press })
    if (mission) add('plan', 'P', 'p', open.plan, false, () => send($, 'mission-control'))
    if (isModOn(list, 'next-tasks')) add('next', 'N', 'n', card?.isOpen === true, !!card && card.items.length > 0 && !card.isOpen, () => send($, 'next-tasks'))
    if (hasCoach) add('coach', 'C', 'c', open.coach, coachNew, () => send($, 'coach'))
    if (isModOn(list, 'pr-desk')) add('prs', 'PR', 'r', open.prs, prBad.length > 0, () => send($, 'pr-desk'))
    add('tasks', 'T', 't', open.tasks, running.length > 0, () => toggleTasks($))
    add('mods', 'M', 'm', open.mods, false, () => toggleHub($))

    // The one card, for the tab the pointer is over.
    const shown = Client && peeking && tabs.some(t => t.id === peeking) ? build(peeking) : null
    const accent = shown && peeking ? ACCENT[peeking as keyof typeof ACCENT] : '#9ca3af'
    const popup = shown && (
      <Box
        key="dock:popup"
        position="absolute"
        left={Math.max(0, (e.props.bodyColumns ?? 80) - CARD_W - 1)}
        top={-(shown.lines.length + 3)}
        width={CARD_W}
        flexDirection="column"
        borderStyle="round"
        borderColor={accent}
        backgroundColor="#14161b"
        paddingX={1}
      >
        <Text bold color={accent} wrap="truncate-end">
          {shown.title}
        </Text>
        {shown.lines}
      </Box>
    )

    return (
      <Box flexDirection="column">
        {below}
        <Box key="dock:row" flexDirection="row" gap={1} flexWrap="nowrap" alignItems="center" position="relative">
          {popup}
          <Box key="dock:status" flexDirection="row" gap={1} flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden" alignItems="center">
            {mission && !mission.isFinished && (
              <Box key="dock:progress" flexDirection="row" gap={1} flexShrink={0} alignItems="center">
                <Text color={ACCENT.plan}>◎</Text>
                {meter(mission.pct, 10, ACCENT.plan)}
                <Text bold>{Math.round(mission.pct * 100)}%</Text>
                <Text dimColor>
                  {mission.stepNo}/{mission.total}
                  {mission.left ? ` · ${mission.left}` : ''}
                </Text>
              </Box>
            )}
            {mission && !mission.isFinished && mission.now !== '' && (
              <Box key="dock:now" flexShrink={1} minWidth={0}>
                <Text dimColor wrap="truncate-end">
                  {mission.now}
                </Text>
              </Box>
            )}
            {mission && mission.isFinished && <Text color="success">✓ done {fmt(mission.elapsedMs)}</Text>}
          </Box>
          <Box key="dock:buttons" flexDirection="row" gap={1} flexShrink={0} alignItems="center">
            {Client ? (
              <Client key="dock:tabs" module="./tabs.tsx" props={{ tabs: tabs.map(t => ({ id: t.id, letter: t.letter, dot: t.dot })) }} />
            ) : (
              tabs.map(t => (
                <Box key={`tab:${t.id}`} flexDirection="row">
                  <Text color={t.dot === 'open' ? 'success' : t.dot === 'new' ? 'warning' : undefined}>{t.dot ? '●' : ' '}</Text>
                  <Button key={`dock:${t.id}`} label={t.letter} hotkey={t.hotkey} onPress={t.press} />
                </Box>
              ))
            )}
            <Button key="dock:collapse" label="▾" plain onPress={() => collapse($, true)} />
          </Box>
        </Box>
      </Box>
    )
  })

  // The tab strip's reports: which tab the pointer is over, and which was clicked.
  on('ui.message', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.element !== 'dock:tabs') return next(e)
    const data = (e.data ?? {}) as { hover?: unknown; press?: unknown }
    if (typeof data.press === 'string') await pressTab($, data.press)
    if ('hover' in data) {
      const id = typeof data.hover === 'string' && data.hover in ACCENT ? data.hover : null
      await update($, peek, () => id)
    }
    return {}
  })

  // Background shells, monitors and workflows, as the last reply left them.
  on('classic.Stop', async ($, e, next) => {
    shells = (e.background_tasks ?? []).map(t => ({ id: t.id, kind: t.type, label: t.command ?? t.name ?? t.description, status: t.status }))
    await refreshTasks($).catch(() => undefined)
    return next(e)
  })

  // A prompt sent is a fresh start for the card under the pointer.
  on('prompt.submit', async ($, e, next) => {
    if ((await read($, peek)) !== null) await update($, peek, () => null)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const list = await read($, mods)
    const open = await read($, expanded)
    const root = await read($, rootRef)
    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Text bold>Mods</Text>
            <Text dimColor>
              {list.filter(m => m.isOn).length} on · {list.filter(m => !m.isOn).length} off
            </Text>
            <Button key="refresh" label="Refresh" plain onPress={() => scan($)} />
            <Button key="close" label="Close" role="dismiss" onPress={() => toggleHub($)} />
          </Box>
          <Text dimColor wrap="truncate-middle">
            {root}
          </Text>
        </Box>
        {list.map(m => (
          <Box flexDirection="column">
            <Box flexDirection="row" gap={1}>
              <Text color={m.isOn ? 'success' : 'error'}>{m.isOn ? '● ON ' : '○ OFF'}</Text>
              <Text bold>{m.name}</Text>
              <Text dimColor>{m.version}</Text>
              <Button
                key={`details:${m.folder}`}
                label={open === m.folder ? 'Hide details' : 'Details'}
                plain
                onPress={() => update($, expanded, cur => (cur === m.folder ? null : m.folder))}
              />
              {m.name !== SELF && (
                <Button key={`toggle:${m.folder}`} label={m.isOn ? 'Turn off' : 'Turn on'} onPress={() => toggle($, m)} />
              )}
            </Box>
            <Text dimColor={!m.isOn}>{m.description}</Text>
            {open === m.folder && (
              <Box flexDirection="column" marginTop={1} paddingLeft={2}>
                {m.readme ? <Markdown text={m.readme} /> : <Text dimColor>No README.md in this mod's folder.</Text>}
              </Box>
            )}
          </Box>
        ))}
      </Box>
    )
  })
}
