import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { HubMod } from '../types'

// Two jobs. The hub: every mod in the mods folder, its README, and an on/off
// switch (switching off points hooks.json at an empty hooks/off.tsx stub).
// The dock: one line above the prompt with the running task's progress and a
// toggle button per mod, badged with what is worth a look. A press for another
// mod is written to `signal`; that mod hooks the write and toggles its own
// panel, so presses land at once, even mid-turn (slash commands wait for idle).

const PANE = 'mods'
const SELF = 'mod-hub'
const ON = `{ "modules": ["./register.tsx"] }\n`
const OFF = `{ "modules": ["./off.tsx"] }\n`
const OFF_STUB = `// Written by mod-hub: this mod is switched off. Turn it back on with /mods.\nexport const register = () => {}\n`

const mods = atom({ plugin: 'mod-hub', key: 'mods' } as const, [])
const expanded = atom({ plugin: 'mod-hub', key: 'expanded' } as const, null)
const rootRef = atom({ plugin: 'mod-hub', key: 'root' } as const, '')
const signal = atom({ plugin: 'mod-hub', key: 'signal' } as const, null)
const isCollapsed = atom({ plugin: 'mod-hub', key: 'isCollapsed' } as const, false)
const isOpen = atom({ plugin: 'mod-hub', key: 'isOpen' } as const, false)

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
const ACCENT = { plan: '#22d3ee', next: '#facc15', coach: '#a78bfa', prs: '#4ade80', mods: '#f472b6' } as const
const TRACK = '#3f3f46'
const COACH_TIP = { plugin: 'coach', key: 'lastTip' } as const

const fmt = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

const parentOf = (dir: string) => dir.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]+$/, '')

const readJson = async ($: EngineInterface, path: string) => {
  try {
    return JSON.parse(await $.fs.read(path)) as Record<string, unknown>
  } catch {
    return null
  }
}

const scan = async ($: EngineInterface) => {
  const root = parentOf($.plugin.root)
  const found: HubMod[] = []
  for (const entry of await $.fs.list(root)) {
    const dir = `${root}/${entry.name}`
    const manifest = await readJson($, `${dir}/.claude-plugin/plugin.json`)
    if (!manifest) continue
    const hooks = await readJson($, `${dir}/hooks/hooks.json`)
    const modules = Array.isArray(hooks?.modules) ? (hooks.modules as unknown[]) : []
    const readme = (await $.fs.exists(`${dir}/README.md`)) ? await $.fs.read(`${dir}/README.md`) : null
    found.push({
      folder: entry.name,
      name: typeof manifest.name === 'string' ? manifest.name : entry.name,
      description: typeof manifest.description === 'string' ? manifest.description : '',
      version: typeof manifest.version === 'string' ? manifest.version : '',
      isOn: !modules.includes('./off.tsx'),
      readme,
    })
  }
  found.sort((a, b) => (a.name === SELF ? -1 : b.name === SELF ? 1 : a.name.localeCompare(b.name)))
  await update($, mods, () => found)
  await update($, rootRef, () => root)
  return found
}

const toggle = async ($: EngineInterface, mod: HubMod) => {
  if (mod.name === SELF) return
  const dir = `${await read($, rootRef)}/${mod.folder}/hooks`
  if (mod.isOn && !(await $.fs.exists(`${dir}/off.tsx`))) await $.fs.write(`${dir}/off.tsx`, OFF_STUB)
  await $.fs.write(`${dir}/hooks.json`, mod.isOn ? OFF : ON)
  await scan($)
  $.ui.toast(`${mod.name} switched ${mod.isOn ? 'off' : 'on'}.`, { timeoutMs: 5000 })
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
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  const file = `${home.replace(/\\/g, '/')}/.claude/mods-data/mod-hub/review.json`
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

const isModOn = (list: HubMod[], name: string) => list.length === 0 || list.some(m => m.name === name && m.isOn)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'mods', description: 'Mod Hub: what each mod does, and switch mods on or off (toggles)' })
    await $.command.register({ name: 'mods-review', description: 'Open every mod panel at once (Mods, Plan, Coach, PRs, next tasks)' })
    const wasCollapsed = (await $.store.get('collapsed')) === true
    await update($, isCollapsed, () => wasCollapsed)
    await scan($).catch(() => undefined)
    await reviewIfQueued($).catch(() => undefined)
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

  // The dock: one line, closest to the prompt. Each tab is one bordered letter
  // with a dot (green: its panel is open; amber: something new). Hovering a tab
  // shows its card as a popup above it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    const SvgEl = 'Svg' in elements ? elements.Svg : undefined
    // The desktop draws a Button's shortcut as a key badge beside its label, which
    // doubles a one-letter tab; the shortcuts stay on the terminal alone.
    const isTerminal = e.surface === 'terminal'

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
    const open = {
      plan: (await $.state.get(MISSION_OPEN)).value === true,
      coach: (await $.state.get(COACH_OPEN)).value === true,
      prs: (await $.state.get(PRS_OPEN)).value === true,
      mods: await read($, isOpen),
    }
    const prBad = (desk?.prs ?? []).filter(p => p.checks === 'failing' || p.mergeable === 'CONFLICTING')
    const now = await $.clock.now()

    // A tab: the dot and its letter, plus its hover card. The card is hidden until the
    // tab is hovered, then floats above the letter as a popup over the chat (absolute,
    // so the dock keeps its one line). It lives inside the tab's keyed Box because
    // that is where the desktop applies hover; it hangs left from the tab's right edge.
    const tab = (id: string, letter: string, hotkey: string, isTabOpen: boolean, isNew: boolean, press: () => unknown, card: RenderElement, rows: number) => (
      <Box key={`tab:${id}`} flexDirection="row" position="relative">
        <Text color={isTabOpen ? 'success' : isNew ? 'warning' : undefined}>{isTabOpen || isNew ? '●' : ' '}</Text>
        {isTerminal ? (
          <Button key={`dock:${id}`} label={letter} hotkey={hotkey} onPress={press} />
        ) : (
          <Button key={`dock:${id}`} label={letter} onPress={press} />
        )}
        <Box display="none" hover={{ display: 'flex' }} position="absolute" right={0} top={-(rows + 1)}>
          {card}
        </Box>
      </Box>
    )

    // A hover card: a framed card in its tab's color.
    const tip = (id: keyof typeof ACCENT, title: string, body: RenderElement) => (
      <Box
        width={56}
        flexDirection="column"
        borderStyle="round"
        borderColor={ACCENT[id]}
        backgroundColor="#14161b"
        paddingX={1}
      >
        <Text bold color={ACCENT[id]}>
          {title}
        </Text>
        {body}
      </Box>
    )
    // A bar: solid SVG where the surface draws SVG, characters on the terminal.
    const meter = (fraction: number, cells: number, color: string) => {
      if (SvgEl && !isTerminal) {
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

    // Plan
    const planRows = mission ? 4 + (!mission.isFinished && mission.now !== '' ? 1 : 0) + Math.min(8, steps.length) : 0
    const planCard =
      mission &&
      tip(
        'plan',
        `◎ ${mission.title}`,
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            {meter(mission.pct, 16, ACCENT.plan)}
            <Text bold>{Math.round(mission.pct * 100)}%</Text>
            <Text dimColor>
              {mission.isFinished ? `done in ${fmt(mission.elapsedMs)}` : `step ${mission.stepNo}/${mission.total}${mission.left ? ` · ${mission.left} left` : ''}`}
            </Text>
          </Box>
          {!mission.isFinished && mission.now !== '' && (
            <Text dimColor wrap="truncate-end">
              Now: {mission.now}
            </Text>
          )}
          {steps.slice(0, 8).map((st, i) => (
            <Text
              color={st.status === 'doing' ? ACCENT.plan : st.status === 'done' ? 'success' : undefined}
              dimColor={st.status === 'todo'}
              bold={st.status === 'doing'}
              wrap="truncate-end"
            >
              {st.status === 'done' ? '✓' : st.status === 'doing' ? '▶' : '○'} {i + 1}. {st.text}
            </Text>
          ))}
        </Box>,
      )

    // Next tasks
    const nextRows = 3 + (!card || card.isLoading || card.items.length === 0 ? 1 : card.items.reduce((n, item) => n + (item.why !== '' ? 2 : 1), 0) + 1)
    const nextCard = tip(
      'next',
      'Next tasks',
      <Box flexDirection="column">
        {!card && <Text dimColor>None yet. They appear after replies over a minute; click N to ask now.</Text>}
        {card?.isLoading && <Text dimColor>Working out three next tasks…</Text>}
        {card && !card.isLoading && card.items.length === 0 && <Text color="warning">{card.error ?? 'No suggestions came back.'}</Text>}
        {card &&
          !card.isLoading &&
          card.items.map((item, i) => (
            <Box flexDirection="column">
              <Text bold wrap="truncate-end">
                <Text color={ACCENT.next}>{i + 1}</Text> {item.title}
              </Text>
              {item.why !== '' && (
                <Text dimColor wrap="truncate-end">
                  {'   '}
                  {item.why}
                </Text>
              )}
            </Box>
          ))}
        {card && !card.isLoading && card.items.length > 0 && <Text dimColor>Click N to show them above the dock; click a line to do it.</Text>}
      </Box>,
    )

    // Coach
    const lastIn = coach?.last ? coach.last.input + coach.last.cacheRead + coach.last.cacheWrite : 0
    const hit = coach?.last && lastIn > 0 ? (coach.last.cacheRead / lastIn) * 100 : null
    const ctx = coach && coach.contextTokens !== null && coach.contextWindow ? (coach.contextTokens / coach.contextWindow) * 100 : null
    const habit = (label: string, ok: boolean | null) => (
      <Text color={ok === null ? undefined : ok ? 'success' : 'error'} dimColor={ok === null}>
        {ok === null ? '·' : ok ? '✓' : '✗'} {label}
      </Text>
    )
    const coachRows = 3 + 5
    const coachCard = tip(
      'coach',
      'Coach',
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Box width={8}>
            <Text>Cache</Text>
          </Box>
          {meter((hit ?? 0) / 100, 12, level(hit, 80, 50, true) ?? TRACK)}
          <Text bold color={level(hit, 80, 50, true)}>
            {pct(hit)}
          </Text>
          <Text dimColor>{hit === null ? '' : hit >= 80 ? 'reused well' : hit >= 50 ? 'partly re-read' : 're-read: costly'}</Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          <Box width={8}>
            <Text>Context</Text>
          </Box>
          {meter((ctx ?? 0) / 100, 12, level(ctx, 50, 75, false) ?? TRACK)}
          <Text bold color={level(ctx, 50, 75, false)}>
            {pct(ctx)}
          </Text>
          <Text dimColor>{ctx === null ? '' : ctx <= 50 ? 'room to spare' : ctx <= 75 ? 'getting full' : 'compact soon'}</Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          <Box width={8}>
            <Text>Cost</Text>
          </Box>
          <Text bold color="#facc15">
            {usd(coach?.costUsd)}
          </Text>
          <Text dimColor>{coach && coach.turns > 0 && coach.costUsd !== null ? `${usd(coach.costUsd / coach.turns)} per turn · ${coach.turns} turns` : ''}</Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          <Box width={8}>
            <Text>Habits</Text>
          </Box>
          {habit('Plan', coach ? coach.planUsed || null : null)}
          {habit('Branch', coach && coach.commits > 0 ? coach.commitsOnMain === 0 : null)}
          {habit('Tests', coach && coach.edits > 0 ? coach.testsRun > 0 && coach.editsSinceTest < 5 : null)}
          {habit('PR', coach && coach.commits > 0 ? coach.prsOpened > 0 : null)}
        </Box>
        <Box flexDirection="row" gap={1}>
          <Box width={8}>
            <Text bold color={ACCENT.coach}>
              Do next
            </Text>
          </Box>
          <Text wrap="truncate-end">{coachTip ?? 'Nothing to flag right now'}</Text>
        </Box>
      </Box>,
    )

    // Pull requests
    const prRows = 3 + (!desk || desk.prs.length === 0 ? 1 : Math.min(6, desk.prs.length)) + (desk ? 1 : 0)
    const prCard = tip(
      'prs',
      `Pull requests${desk ? ` · ${desk.prs.length} open` : ''}`,
      <Box flexDirection="column">
        {!desk && <Text dimColor>Checking GitHub…</Text>}
        {desk && desk.prs.length === 0 && <Text dimColor>No open PRs of yours.</Text>}
        {(desk?.prs ?? []).slice(0, 6).map(p => (
          <Box flexDirection="row" gap={1}>
            <Text bold>#{p.number}</Text>
            <Text color={p.checks === 'failing' || p.mergeable === 'CONFLICTING' ? 'error' : p.checks === 'pending' ? 'warning' : 'success'}>
              {p.checks === 'failing' ? '✗ checks' : p.mergeable === 'CONFLICTING' ? '✗ conflicts' : p.checks === 'pending' ? '… checks' : '✓ ready'}
            </Text>
            <Text dimColor wrap="truncate-end">
              {p.repo.split('/')[1]} · {p.title}
            </Text>
          </Box>
        ))}
        {desk && <Text dimColor>checked {fmt(now - desk.at)} ago · click PR for preview links</Text>}
      </Box>,
    )

    // Mods
    const modsRows = 3 + list.length + 1
    const modsCard = tip(
      'mods',
      `Mods · ${list.filter(m => m.isOn).length} on · ${list.filter(m => !m.isOn).length} off`,
      <Box flexDirection="column">
        {list.map(m => (
          <Box flexDirection="row" gap={1}>
            <Text color={m.isOn ? 'success' : 'error'}>{m.isOn ? '●' : '○'}</Text>
            <Box width={16}>
              <Text bold={m.isOn} dimColor={!m.isOn}>
                {m.name}
              </Text>
            </Box>
            <Text dimColor wrap="truncate-end">
              {m.description}
            </Text>
          </Box>
        ))}
        <Text dimColor>Click M to switch mods on or off.</Text>
      </Box>,
    )

    return (
      <Box flexDirection="column">
        {below}
        <Box flexDirection="row" gap={1} flexWrap="nowrap" alignItems="center">
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
            {mission && planCard && tab('plan', 'P', 'p', open.plan, false, () => send($, 'mission-control'), planCard, planRows)}
            {isModOn(list, 'next-tasks') &&
              tab('next', 'N', 'n', card?.isOpen === true, !!card && card.items.length > 0 && !card.isOpen, () => send($, 'next-tasks'), nextCard, nextRows)}
            {hasCoach && tab('coach', 'C', 'c', open.coach, coachNew, () => send($, 'coach'), coachCard, coachRows)}
            {isModOn(list, 'pr-desk') && tab('prs', 'PR', 'r', open.prs, prBad.length > 0, () => send($, 'pr-desk'), prCard, prRows)}
            {tab('mods', 'M', 'm', open.mods, false, () => toggleHub($), modsCard, modsRows)}
            <Button key="dock:collapse" label="▾" plain onPress={() => collapse($, true)} />
          </Box>
        </Box>
      </Box>
    )
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
