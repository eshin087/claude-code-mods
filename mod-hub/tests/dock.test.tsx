// Dock tests: `claude plugin test` in this folder. The dock is one slim line
// above the prompt: the plan's progress while Claude is idle, a done chip once
// it's finished, nothing otherwise. A test can only load code from this mod's
// folder, so Mission Control is a small stand-in that owns the same state keys.
import { expect, mock, test } from 'claude-code/testing'
import type { On, Register } from 'claude-code'

const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 6 }, view: {} }
const SURFACES = ['terminal', 'desktop'] as const

// Mission Control's summary as the real mod writes it: a plan under way at
// start; a prompt "finish" finishes it, "clear" clears it, "none" leaves a
// board with no steps (as an older version could).
const MISSION: { name: string; register: Register } = {
  name: 'mission-control',
  register: on => {
    const running = {
      title: 'Earth phase 2', pct: 0.64, stepNo: 3, total: 5, left: '~8m', elapsedMs: 840000, isFinished: false, now: 'wiring the tile streamer',
      accuracy: { avgErrorPct: 35, tasks: 4 },
    }
    on('session.start', async ($, e, next) => {
      await $.state.set({ plugin: 'mission-control', key: 'summary' }, running)
      return next(e)
    })
    on('prompt.submit', async ($, e, next) => {
      const ref = { plugin: 'mission-control', key: 'summary' } as const
      if (e.text === 'finish') await $.state.set(ref, { ...running, pct: 1, isFinished: true, now: '', left: null })
      else if (e.text === 'clear') await $.state.set(ref, null)
      else if (e.text === 'none') await $.state.set(ref, { ...running, stepNo: 0, total: 0 })
      else return next(e)
      return { text: e.text }
    })
  },
}

// What the engine answers beneath the plugins.
const world = (on: On) => {
  mock.clock(on, { now: 1_000_000 })
  const panes = new Set<string>()
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  // The engine draws nothing of its own in the band; keyed so a test can find
  // where the dock puts the engine's node.
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.toast', () => ({ value: undefined }))
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
  return { panes }
}

type Node = { type: string; props?: Record<string, unknown>; children?: unknown[] }
const textOf = (n: unknown): string =>
  typeof n === 'string' ? n : n && typeof n === 'object' ? ((n as Node).children ?? []).map(textOf).join(' ') : ''
const nodesOf = (n: unknown, out: Node[] = []): Node[] => {
  if (n && typeof n === 'object') {
    out.push(n as Node)
    for (const c of (n as Node).children ?? []) nodesOf(c, out)
  }
  return out
}
// The props the engine won't have on any Box above its own node (2.1.293).
const REFUSED_ABOVE_ENGINE = ['display', 'overflow', 'position', 'width', 'height', 'minWidth', 'minHeight', 'top', 'left', 'right', 'bottom']
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
// Only the engine's own node: the dock added nothing.
const isBare = (drawn: unknown) => (drawn as Node).props?.key === 'engine'
const say = ($: { prompt: { submit: (a: never) => Promise<unknown> } }, text: string) =>
  $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } } as never)

for (const surface of SURFACES) {
  test(`[${surface}] 1. idle with a plan under way: one line, the bar, %, step and time left, then the now line; no tabs, buttons or fold`, { plugins: [MISSION] }, async ($, on) => {
    world(on)
    await $.session.start({ cwd: 'C:/x/gcdAtlas', surface, isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'mod-hub', surface, component: 'AbovePrompt', props: BAND_PROPS })
    const drawn = await ui.drawn()
    expect(await ui.find({ key: 'dock:row' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '64%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '· 3/5 · ~8m' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /wiring the tile streamer/ })).toBeDefined()
    expect(nodesOf(drawn).filter(n => n.type === 'Button' || n.type === 'Client').length).toBe(0)
    // The bar: an SVG on the desktop, characters on the terminal.
    expect(nodesOf(drawn).some(n => n.type === 'Svg')).toBe(surface === 'desktop')
  })

  test(`[${surface}] 2. the engine's own node in the band is never under a Box the engine refuses it under`, { plugins: [MISSION] }, async ($, on) => {
    world(on)
    await $.session.start({ cwd: 'C:/x/gcdAtlas', surface, isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'mod-hub', surface, component: 'AbovePrompt', props: BAND_PROPS })
    const refused = async () =>
      (aboveEngine(await ui.drawn()) ?? [{ type: 'missing' }])
        .filter(n => n.type === 'missing' || Object.keys(n.props ?? {}).some(k => REFUSED_ABOVE_ENGINE.includes(k)))
        .map(n => `${n.type} ${Object.keys(n.props ?? {}).filter(k => REFUSED_ABOVE_ENGINE.includes(k)).join(',')}`)
    expect(await refused()).toEqual([])
    await say($, 'finish')
    expect(await refused()).toEqual([])
  })
}

test('3. while Claude works the dock adds nothing: the working row carries the progress', { plugins: [MISSION] }, async ($, on) => {
  world(on)
  await $.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'mod-hub', surface: 'desktop', component: 'AbovePrompt', props: { ...BAND_PROPS, isWorking: true } })
  expect(isBare(await ui.drawn())).toBe(true)
})

test('4. a finished plan shows ✓ done with its time, even while the next turn starts', { plugins: [MISSION] }, async ($, on) => {
  world(on)
  await $.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'mod-hub', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
  await say($, 'finish')
  expect(textOf(await ui.find({ key: 'dock:done' }))).toBe('✓ done 14m00s')
  expect(await ui.find({ key: 'dock:progress' })).toBeUndefined()
  expect(await ui.find({ key: 'dock:now' })).toBeUndefined()
  const working = await $.ui.mount({ plugin: 'mod-hub', surface: 'desktop', component: 'AbovePrompt', props: { ...BAND_PROPS, isWorking: true } })
  expect(textOf(await working.find({ key: 'dock:done' }))).toBe('✓ done 14m00s')
})

test('5. no plan, or a board with no steps: nothing above the prompt but the engine\'s own', { plugins: [MISSION] }, async ($, on) => {
  world(on)
  await $.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'mod-hub', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
  await say($, 'none')
  expect(isBare(await ui.drawn())).toBe(true)
  await say($, 'clear')
  expect(isBare(await ui.drawn())).toBe(true)
})

test('7. /mods opens the Mods page and closes it again', { plugins: [MISSION] }, async ($, on) => {
  const { panes } = world(on)
  await $.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })
  expect((await $.command.run({ command: 'mods', args: '' } as never)) as unknown).toMatchObject({ text: 'Mod Hub: 0 of 0 mods on.' })
  expect(panes.has('mods')).toBe(true)
  await $.command.run({ command: 'mods', args: '' } as never)
  expect(panes.has('mods')).toBe(false)
})
