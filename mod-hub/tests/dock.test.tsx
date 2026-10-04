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

// What the engine answers beneath the plugins in these tests.
const world = (on: On, store: Record<string, unknown> = {}) => {
  mock.clock(on, { now: 1_000_000 })
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
  // The engine draws nothing of its own in the band.
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('fs.list', () => ({ value: [] }))
  on('ui.panes', () => ({ value: [...panes].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  on('ui.open', ($, e) => {
    panes.add(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    panes.delete(e.id)
    return { value: undefined }
  })
  return panes
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

for (const surface of SURFACES) {
  test(`[${surface}] 1. each tab is one bordered letter; its dot turns green while its panel is open`, { plugins: PEERS }, async ($, on) => {
    world(on)
    await $.session.start({ cwd: 'C:/x/gcdAtlas', surface, isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'mod-hub', surface, component: 'AbovePrompt', props: BAND_PROPS })

    // Letters only, drawn with a border (not plain).
    for (const [key, letter] of [['dock:plan', 'P'], ['dock:next', 'N'], ['dock:coach', 'C'], ['dock:prs', 'PR'], ['dock:mods', 'M']] as const) {
      expect(await label(ui, key)).toBe(letter)
      expect((await ui.find({ key }))?.props.plain).toBeUndefined()
    }
    // Amber dots before anything opens: 3 suggestions ready, a new coach tip, a PR with conflicts.
    expect(await dot(ui, 'next')).toEqual({ text: '●', color: 'warning' })
    expect(await dot(ui, 'coach')).toEqual({ text: '●', color: 'warning' })
    expect(await dot(ui, 'prs')).toEqual({ text: '●', color: 'warning' })
    expect((await dot(ui, 'mods')).text).toBe(' ')

    for (const id of ['plan', 'next', 'coach', 'prs', 'mods']) {
      await ui.press({ key: `dock:${id}` })
      expect(await dot(ui, id)).toEqual({ text: '●', color: 'success' })
      await ui.press({ key: `dock:${id}` })
      expect((await dot(ui, id)).color).not.toBe('success')
    }
  })

  test(`[${surface}] 1b. hovering a tab shows its card as a popup floating above the letter`, { plugins: PEERS }, async ($, on) => {
    world(on)
    await $.session.start({ cwd: 'C:/x/gcdAtlas', surface, isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'mod-hub', surface, component: 'AbovePrompt', props: BAND_PROPS })
    const tree = await ui.drawn()
    // Every node in the drawing, depth first.
    const nodes: Node[] = []
    const walk = (n: unknown) => {
      if (n && typeof n === 'object') {
        nodes.push(n as Node)
        for (const c of (n as Node).children ?? []) walk(c)
      }
    }
    walk(tree)
    // A tab box holds [dot, letter, popup]: the popup is hidden until the tab is hovered,
    // then floats above the letter (absolute, so the dock keeps its one line).
    const popupFor = (id: string) => {
      const kids = nodes.find(n => n.props?.key === `tab:${id}`)?.children ?? []
      return kids[kids.length - 1] as Node | undefined
    }
    const cardFor = (id: string) => (popupFor(id)?.children ?? [])[0] as Node | undefined
    for (const id of ['plan', 'next', 'coach', 'prs', 'mods']) {
      const popup = popupFor(id)
      expect(popup?.props?.display).toBe('none')
      expect(popup?.hover?.display).toBe('flex')
      expect(popup?.props?.position).toBe('absolute')
      expect(popup?.props?.right).toBe(0)
      expect(popup?.props?.top as number).toBeLessThan(-3)
      const card = cardFor(id)
      expect(card?.props?.width).toBe(56)
      expect(card?.props?.borderStyle).toBe('round')
    }
    expect(textOf(cardFor('plan'))).toMatch(/Earth phase 2.*64 ?%.*step 3\/5.*~8m left.*Now: +wiring the tile streamer/)
    expect(textOf(cardFor('next'))).toMatch(/Next tasks.*1.*task 1.*because.*2.*task 2.*3.*task 3/)
    expect(textOf(cardFor('prs'))).toMatch(/Pull requests · 2 open.*# ?1.*✗ conflicts.*# ?2.*✓ ready/)
    expect(textOf(cardFor('coach'))).toMatch(/Coach.*Cache.*Context.*Cost.*Habits.*Do next/)
    expect(textOf(cardFor('mods'))).toMatch(/Mods · 0 on · 0 off/)
  })

  test(`[${surface}] 2. shortcut keys: p n c r m on the terminal, none on the desktop`, { plugins: PEERS }, async ($, on) => {
    world(on)
    await $.session.start({ cwd: 'C:/x/gcdAtlas', surface, isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'mod-hub', surface, component: 'AbovePrompt', props: BAND_PROPS })
    const keys: Record<string, string> = {}
    for (const key of ['dock:plan', 'dock:next', 'dock:coach', 'dock:prs', 'dock:mods']) {
      keys[key] = (await ui.find({ key }))?.props.hotkey as string
    }
    // The terminal shows each shortcut; the desktop draws a shortcut as a second
    // letter badge, so there the tabs carry none (one letter each).
    expect(keys).toEqual(
      surface === 'terminal'
        ? { 'dock:plan': 'p', 'dock:next': 'n', 'dock:coach': 'c', 'dock:prs': 'r', 'dock:mods': 'm' }
        : { 'dock:plan': undefined, 'dock:next': undefined, 'dock:coach': undefined, 'dock:prs': undefined, 'dock:mods': undefined },
    )
  })

  test(`[${surface}] 3a. the dock is one row: status shrinks and truncates, buttons never wrap`, { plugins: PEERS }, async ($, on) => {
    world(on)
    await $.session.start({ cwd: 'C:/x/gcdAtlas', surface, isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'mod-hub', surface, component: 'AbovePrompt', props: { ...BAND_PROPS, bodyColumns: 60 } })
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
    expect(await label(ui, 'dock:mods')).toBe('M')
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

test('4a. the dock shows the running task, then a done chip', { plugins: PEERS }, async ($, on) => {
  world(on)
  await $.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'mod-hub', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await ui.find({ type: 'Text', text: '64%' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^3\/5/ }))?.text).toMatch(/^3\/5 · ~8m$/)
  expect(await ui.find({ type: 'Text', text: /wiring the tile streamer/ })).toBeDefined()
})
