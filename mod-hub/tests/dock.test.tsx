// Dock tests: `claude plugin test` in this folder. A test can only load code
// from this mod's folder, so the other mods are small stand-ins that own the
// same state keys and answer the dock's signal the way the real mods do (each
// real mod's side of the protocol is tested in its own folder).
import { expect, mock, test } from 'claude-code/testing'
import type { On, Register } from 'claude-code'

const BAND_PROPS = { hasSurvey: false, isWorking: true, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 6 }, view: {} }
const SURFACES = ['terminal', 'desktop'] as const

// Stand-ins for the mods with panels. Each owns the same state keys as the
// real mod and flips its open flag when the dock signals it, as the real mods'
// `state.set` hooks do. Each is written out whole: the kit loads an inline
// plugin as a module of its own, so it cannot share helpers with this file.
const PEERS: { name: string; register: Register }[] = [
  {
    name: 'mission-control',
    register: on => {
      on('session.start', async ($, e, next) => {
        await $.state.set({ plugin: 'mission-control', key: 'summary' }, {
          title: 'Earth phase 2', pct: 0.64, stepNo: 3, total: 5, left: '~8m', elapsedMs: 840000, isFinished: false, now: 'wiring the tile streamer',
          accuracy: { avgErrorPct: 35, tasks: 4 },
        })
        return next(e)
      })
      on('state.set', { plugin: 'mod-hub', key: 'signal' }, async ($, e, next) => {
        const done = await next(e)
        if (done.value?.isSet === true && (e.value as { target?: string } | null)?.target === 'mission-control') {
          const cur = (await $.state.get({ plugin: 'mission-control', key: 'isOpen' })).value === true
          await $.state.set({ plugin: 'mission-control', key: 'isOpen' }, !cur)
        }
        return done
      })
    },
  },
  {
    name: 'coach',
    register: on => {
      on('session.start', async ($, e, next) => {
        await $.state.set({ plugin: 'coach', key: 'unseen' }, true)
        return next(e)
      })
      on('state.set', { plugin: 'mod-hub', key: 'signal' }, async ($, e, next) => {
        const done = await next(e)
        if (done.value?.isSet === true && (e.value as { target?: string } | null)?.target === 'coach') {
          const cur = (await $.state.get({ plugin: 'coach', key: 'isOpen' })).value === true
          await $.state.set({ plugin: 'coach', key: 'isOpen' }, !cur)
        }
        return done
      })
    },
  },
  {
    name: 'pr-desk',
    register: on => {
      on('session.start', async ($, e, next) => {
        const pr = { repo: 'a/b', title: 't', branch: 'x', url: 'https://github.com/a/b/pull/1', preview: null, isPreviewGuess: false, checks: 'passing' as const, isDraft: false, updatedAt: '2026-10-03T00:00:00Z', worktree: null }
        await $.state.set({ plugin: 'pr-desk', key: 'desk' }, {
          at: 0,
          errors: [],
          prs: [
            { ...pr, number: 1, mergeable: 'CONFLICTING' },
            { ...pr, number: 2, mergeable: 'MERGEABLE' },
          ],
        })
        return next(e)
      })
      on('state.set', { plugin: 'mod-hub', key: 'signal' }, async ($, e, next) => {
        const done = await next(e)
        if (done.value?.isSet === true && (e.value as { target?: string } | null)?.target === 'pr-desk') {
          const cur = (await $.state.get({ plugin: 'pr-desk', key: 'isOpen' })).value === true
          await $.state.set({ plugin: 'pr-desk', key: 'isOpen' }, !cur)
        }
        return done
      })
    },
  },
  {
    name: 'usage-meter',
    register: on => {
      on('session.start', async ($, e, next) => {
        await $.state.set({ plugin: 'usage-meter', key: 'limits' }, [
          { kind: 'five_hour', percentUsed: 38, resetsAt: new Date(1_000_000 + (2 * 60 + 10) * 60_000).toISOString() },
          { kind: 'seven_day', percentUsed: 18 },
        ])
        return next(e)
      })
    },
  },
  {
    name: 'next-tasks',
    register: on => {
      on('session.start', async ($, e, next) => {
        await $.state.set({ plugin: 'next-tasks', key: 'card' }, {
          project: 'gcdAtlas', isLoading: false, source: 'auto', error: null, isOpen: false,
          items: [1, 2, 3].map(i => ({ title: `task ${i}`, why: 'because', prompt: `do task ${i}` })),
        })
        return next(e)
      })
      on('state.set', { plugin: 'mod-hub', key: 'signal' }, async ($, e, next) => {
        const done = await next(e)
        if (done.value?.isSet === true && (e.value as { target?: string } | null)?.target === 'next-tasks') {
          const c = (await $.state.get({ plugin: 'next-tasks', key: 'card' })).value
          if (c) await $.state.set({ plugin: 'next-tasks', key: 'card' }, { ...c, isOpen: !c.isOpen })
        }
        return done
      })
    },
  },
]

type WorldOptions = { agents?: { id: string; description: string; type: string; status: string }[]; isViewDown?: boolean }

// What the engine answers beneath the plugins in these tests.
const world = (on: On, store: Record<string, unknown> = {}, opts: WorldOptions = {}) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  // The desktop app's own panes, as its ccd_view tools report and change them.
  const appPanes = new Set<string>()
  const toasts: string[] = []
  on('mcp.call', ($, e) => {
    const reply = (text: string, isError = false) => ({ value: { content: [{ type: 'text' as const, text }], isError } })
    if (e.server !== 'ccd_view' || opts.isViewDown) return reply('server ccd_view is not connected', true)
    if (e.tool === 'get_layout') return reply(JSON.stringify({ views: [], open_panes: [...appPanes], transcript_view: 'thinking' }))
    if (e.tool === 'show_pane') appPanes.add(String(e.args.pane))
    if (e.tool === 'close_pane') appPanes.delete(String(e.args.pane))
    return reply('ok')
  })
  on('agent.list', () => ({ value: opts.agents ?? [] }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  // A store in memory the test can look into (mock.store keeps its own).
  on('store.get', ($, e) => ({ value: store[e.key] }))
  on('store.set', ($, e) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(store) }))
  on('store.delete', ($, e) => {
    delete store[e.key]
    return { value: undefined }
  })
  const panes = new Set<string>()
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  // The engine draws nothing of its own in the band; keyed so a test can find
  // where the dock puts the engine's node.
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  // No mods folder and no off list (the hub's on/off has its own tests).
  on('env.get', ($, e) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/test' : undefined }))
  on('fs.list', () => ({ value: [] }))
  on('fs.exists', () => ({ value: false }))
  on('fs.read', ($, e) => {
    throw new Error(`ENOENT: ${e.path}`)
  })
  on('ui.panes', () => ({ value: [...panes].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  on('ui.open', ($, e) => {
    panes.add(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    panes.delete(e.id)
    return { value: undefined }
  })
  return { panes, clock, appPanes, toasts }
}

type Ui = {
  find: (q: { key: string }) => Promise<{ props: Record<string, unknown>; text: string; children: unknown[] } | undefined>
}

const label = async (ui: Ui, key: string) => (await ui.find({ key }))?.props.label as string | undefined

// The dot before a tab's letter: "●" (open: green, new: amber) or a blank.
// A child in a found element is the raw node: its text is in `children`, its hover beside `props`.
type Node = { type: string; props?: Record<string, unknown>; hover?: Record<string, unknown>; children?: unknown[] }
const textOf = (n: unknown): string =>
  typeof n === 'string' ? n : n && typeof n === 'object' ? ((n as Node).children ?? []).map(textOf).join(' ') : ''

// A tab box is [dot, letter, popup]; the dot is its first child.
const dot = async (ui: Ui, id: string) => {
  const first = (await ui.find({ key: `tab:${id}` }))?.children[0] as Node | undefined
  return { text: textOf(first), color: first?.props?.color }
}

// Every node in a drawing, depth first.
const nodesOf = (n: unknown, out: Node[] = []): Node[] => {
  if (n && typeof n === 'object') {
    out.push(n as Node)
    for (const c of (n as Node).children ?? []) nodesOf(c, out)
  }
  return out
}
// The Boxes above the engine's own node in a drawing (its stand-in is keyed `engine`).
const aboveEngine = (n: unknown, path: Node[] = []): Node[] | null => {
  if (!n || typeof n !== 'object') return null
  const node = n as Node
  if (node.props?.key === 'engine') return path
  for (const c of node.children ?? []) {
    const found = aboveEngine(c, [...path, node])
    if (found) return found
  }
  return null
}
const textIn = (found: { children: unknown[] } | undefined) => (found?.children ?? []).map(textOf).join(' ').replace(/\s+/g, ' ')

// The desktop strip's tabs: a dot and the letter padded by a space each side,
// one cell apart. A cell inside each, as the pointer reports it.
const AT = { plan: 1, next: 6, coach: 11, prs: 17, tasks: 22, mods: 27 } as const
type StripTab = { id: string; letter: string; dot: 'open' | 'new' | null }
const stripTabs = async (ui: Ui) => ((await ui.find({ key: 'dock:tabs' }))?.props.props as { tabs: StripTab[] } | undefined)?.tabs ?? []
const dotOf = async (ui: Ui, id: string) => (await stripTabs(ui)).find(t => t.id === id)?.dot ?? null

test('[terminal] 1. each tab is a letter button with its shortcut key; its dot turns green while its panel is open', { plugins: PEERS }, async ($, on) => {
  world(on)
  await $.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'mod-hub', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  for (const [id, letter, hotkey] of [['plan', 'P', 'p'], ['next', 'N', 'n'], ['coach', 'C', 'c'], ['prs', 'PR', 'r'], ['tasks', 'T', 't'], ['mods', 'M', 'm']] as const) {
    const tab = await ui.find({ key: `dock:${id}` })
    expect(tab?.props.label).toBe(letter)
    expect(tab?.props.hotkey).toBe(hotkey)
    expect(tab?.props.plain).toBeUndefined()
  }
  // Amber dots before anything opens: 3 suggestions ready, a new coach tip, a PR with conflicts.
  expect(await dot(ui, 'next')).toEqual({ text: '●', color: 'warning' })
  expect(await dot(ui, 'coach')).toEqual({ text: '●', color: 'warning' })
  expect(await dot(ui, 'prs')).toEqual({ text: '●', color: 'warning' })
  expect((await dot(ui, 'mods')).text).toBe(' ')
  for (const id of ['plan', 'next', 'coach', 'prs', 'tasks', 'mods']) {
    await ui.press({ key: `dock:${id}` })
    expect(await dot(ui, id)).toEqual({ text: '●', color: 'success' })
    await ui.press({ key: `dock:${id}` })
    expect((await dot(ui, id)).color).not.toBe('success')
  }
})

test('[desktop] 1. the tabs are one strip of letters, no shortcut badges; a click toggles its panel and its green dot', { plugins: PEERS }, async ($, on) => {
  world(on)
  await $.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'mod-hub', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
  const strip = await ui.find({ key: 'dock:tabs' })
  expect(strip?.type).toBe('Client')
  expect(String(strip?.props.module)).toMatch(/tabs\.tsx$/)
  expect(await ui.find({ key: 'dock:plan' })).toBeUndefined()
  expect((await stripTabs(ui)).map(t => `${t.letter}:${t.dot}`)).toEqual(['P:null', 'N:new', 'C:new', 'PR:new', 'T:null', 'M:null'])
  // The strip draws each letter as a chip, padded by a space each side.
  const chips = nodesOf(await ui.drawn({ in: 'dock:tabs' })).filter(n => n.type === 'Text').map(textOf)
  expect(chips.filter(t => t.trim() !== '' && t !== '●')).toEqual([' P ', ' N ', ' C ', ' PR ', ' T ', ' M '])
  for (const id of ['plan', 'next', 'coach', 'prs', 'tasks', 'mods'] as const) {
    for (const want of ['open', 'not open']) {
      await ui.pointer({ type: 'down', x: AT[id], y: 0, button: 'left' })
      await ui.pointer({ type: 'up', x: AT[id], y: 0, button: 'left' })
      if (want === 'open') expect(await dotOf(ui, id)).toBe('open')
      else expect(await dotOf(ui, id)).not.toBe('open')
    }
  }
})

test('[desktop] 1b. hovering shows ONE popup, always in the same place, for whichever tab the pointer is over', { plugins: PEERS }, async ($, on) => {
  const { clock } = world(on, {}, { agents: [{ id: 'a1', description: 'review the tiles PR', type: 'general-purpose', status: 'running' }] })
  await $.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })
  await clock.advance(5_000)
  // A band tall enough for every card whole (a short one cuts the card's lines).
  const ui = await $.ui.mount({ plugin: 'mod-hub', surface: 'desktop', component: 'AbovePrompt', props: { ...BAND_PROPS, maxRows: 30, scroll: { offset: 0, bodyRows: 29 } } })
  const root = async () => (await ui.drawn()) as Node
  expect(await ui.find({ key: 'dock:popup' })).toBeUndefined()
  expect((await root()).props?.minHeight).toBeUndefined()
  const lefts = new Set<unknown>()
  const cards: Record<string, string> = {}
  for (const id of ['plan', 'next', 'coach', 'prs', 'tasks', 'mods'] as const) {
    await ui.pointer({ type: 'move', x: AT[id], y: 0 })
    const popups = await ui.findAll({ key: 'dock:popup' })
    expect(popups.length).toBe(1)
    const popup = popups[0]!
    expect(popup.props.position).toBe('absolute')
    expect(popup.props.width).toBe(52)
    expect(popup.props.borderStyle).toBe('round')
    // Just above the dock row, inside the band (which clips absolute boxes).
    expect(popup.props.bottom).toBe(1)
    expect(popup.props.top).toBeUndefined()
    // The band grows to the card (title, lines, 2 border rows) plus the dock row.
    expect((await root()).props?.minHeight).toBe(popup.children.length + 2 + 1)
    lefts.add(popup.props.left)
    cards[id] = textIn(popup)
  }
  // Same place for every tab: the card's right edge sits at the dock's right end.
  expect([...lefts]).toEqual([120 - 52 - 1])
  expect(cards.plan).toMatch(/Earth phase 2.*64%.*step 3\/5 · ~8m left.*Now: wiring the tile streamer.*Past estimates: off by ~35% on average \(4 tasks\)/)
  expect(cards.next).toMatch(/Next tasks.*1 task 1.*2 task 2.*3 task 3/)
  expect(cards.coach).toMatch(/Coach.*Cache.*Context.*Cost.*Limits 5h 38% \(resets 2h10m\) · W 18%.*Habits.*Do next/)
  expect(cards.prs).toMatch(/Pull requests · 2 open.*#1 ✗ conflicts.*#2 ✓ ready/)
  expect(cards.tasks).toMatch(/Background tasks · 1 running.*general-purpose review the tiles PR.*Click T to open/)
  expect(cards.mods).toMatch(/Mods · 0 on · 0 off/)
  // Off the strip, the popup goes and the band shrinks back.
  await ui.pointer({ type: 'leave', x: 0, y: 0 })
  expect(await ui.find({ key: 'dock:popup' })).toBeUndefined()
  expect((await root()).props?.minHeight).toBeUndefined()
})

// The real engine refuses the whole dock ("engine node under a Box with prop
// position") when a positioned Box holds what next(e) returned.
for (const surface of SURFACES) {
  test(`[${surface}] 1c. the engine's own node in the band is never under a positioned Box, card or no card`, { plugins: PEERS }, async ($, on) => {
    world(on)
    await $.session.start({ cwd: 'C:/x/gcdAtlas', surface, isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'mod-hub', surface, component: 'AbovePrompt', props: { ...BAND_PROPS, maxRows: 30, scroll: { offset: 0, bodyRows: 29 } } })
    const positioned = async () => (aboveEngine(await ui.drawn()) ?? [{ type: 'missing' }]).filter(n => n.type === 'missing' || n.props?.position !== undefined).map(n => n.type)
    expect(await positioned()).toEqual([])
    if (surface === 'desktop') {
      await ui.pointer({ type: 'move', x: AT.coach, y: 0 })
      expect(await ui.find({ key: 'dock:popup' })).toBeDefined()
      expect(await positioned()).toEqual([])
    }
  })
}

test("5. T opens the app's Background tasks pane and closes it", { plugins: PEERS }, async ($, on) => {
  const { appPanes } = world(on)
  await $.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'mod-hub', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
  await ui.post({ press: 'tasks' }, { in: 'dock:tabs' })
  expect([...appPanes]).toEqual(['tasks'])
  expect(await dotOf(ui, 'tasks')).toBe('open')
  await ui.post({ press: 'tasks' }, { in: 'dock:tabs' })
  expect([...appPanes]).toEqual([])
  expect(await dotOf(ui, 'tasks')).toBe(null)
})

test("5b. without the app's view tools, T says where to find the pane instead of failing quietly", { plugins: PEERS }, async ($, on) => {
  const { toasts } = world(on, {}, { isViewDown: true })
  await $.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'mod-hub', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
  await ui.post({ press: 'tasks' }, { in: 'dock:tabs' })
  expect(toasts.at(-1)).toMatch(/Background tasks pane: server ccd_view is not connected\. Open it from the app's menu instead\./)
})

for (const surface of SURFACES) {
  test(`[${surface}] 3a. the dock is one row: status shrinks and truncates, buttons never wrap`, { plugins: PEERS }, async ($, on) => {
    world(on)
    await $.session.start({ cwd: 'C:/x/gcdAtlas', surface, isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'mod-hub', surface, component: 'AbovePrompt', props: { ...BAND_PROPS, isWorking: false, bodyColumns: 60 } })
    const status = await ui.find({ key: 'dock:status' })
    const buttons = await ui.find({ key: 'dock:buttons' })
    expect(status?.props.flexDirection).toBe('row')
    expect(status?.props.flexShrink).toBe(1)
    expect(buttons?.props.flexShrink).toBe(0)
    // The bar and numbers never shrink; only the "now" text gives way, cut off with "…".
    const nodesIn = (n: unknown, out: Node[] = []): Node[] => {
      if (n && typeof n === 'object') {
        out.push(n as Node)
        for (const c of (n as Node).children ?? []) nodesIn(c, out)
      }
      return out
    }
    const all = nodesIn(await ui.drawn())
    expect(all.find(n => n.props?.key === 'dock:progress')?.props?.flexShrink).toBe(0)
    const nowBox = all.find(n => n.props?.key === 'dock:now')
    expect(nowBox?.props?.flexShrink).toBe(1)
    expect(((nowBox?.children ?? [])[0] as Node | undefined)?.props?.wrap).toBe('truncate-end')
  })

  test(`[${surface}] 3b. ▾ folds the whole dock to one chip and ◆ ▸ brings it back`, { plugins: PEERS }, async ($, on) => {
    world(on)
    await $.session.start({ cwd: 'C:/x/gcdAtlas', surface, isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'mod-hub', surface, component: 'AbovePrompt', props: BAND_PROPS })
    await ui.press({ key: 'dock:collapse' })
    const after = await ui.findAll({ type: 'Button' })
    expect(after.map(b => b.key)).toEqual(['dock:expand'])
    expect((await ui.findAll({ type: 'Text' })).length).toBe(0)
    await ui.press({ key: 'dock:expand' })
    if (surface === 'terminal') expect(await label(ui, 'dock:mods')).toBe('M')
    else expect((await stripTabs(ui)).map(t => t.letter)).toContain('M')
  })

  test(`[${surface}] 3c. a folded dock stays folded in the next session`, { plugins: PEERS }, async ($, on) => {
    world(on, { collapsed: true })
    await $.session.start({ cwd: 'C:/x/gcdAtlas', surface, isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'mod-hub', surface, component: 'AbovePrompt', props: BAND_PROPS })
    expect((await ui.findAll({ type: 'Button' })).map(b => b.key)).toEqual(['dock:expand'])
  })
}

test('3d. folding writes the choice to the store, unfolding clears it', { plugins: PEERS }, async ($, on) => {
  const store: Record<string, unknown> = {}
  world(on, store)
  await $.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'mod-hub', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
  await ui.press({ key: 'dock:collapse' })
  expect(store.collapsed).toBe(true)
  await ui.press({ key: 'dock:expand' })
  expect(store.collapsed).toBe(false)
})

test('4a. the dock shows the running task while Claude is idle, then a done chip', { plugins: PEERS }, async ($, on) => {
  world(on)
  await $.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'mod-hub', surface: 'desktop', component: 'AbovePrompt', props: { ...BAND_PROPS, isWorking: false } })
  expect(await ui.find({ type: 'Text', text: '64%' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^3\/5/ }))?.text).toMatch(/^3\/5 · ~8m$/)
  expect(await ui.find({ type: 'Text', text: /wiring the tile streamer/ })).toBeDefined()
})

test('4c. while a turn runs, the dock leaves the progress to the working row and keeps to its tabs', { plugins: PEERS }, async ($, on) => {
  world(on)
  await $.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'mod-hub', surface: 'desktop', component: 'AbovePrompt', props: { ...BAND_PROPS, isWorking: true } })
  expect(await ui.find({ key: 'dock:progress' })).toBeUndefined()
  expect(await ui.find({ key: 'dock:now' })).toBeUndefined()
  expect(await ui.find({ key: 'dock:tabs' })).toBeDefined()
})
