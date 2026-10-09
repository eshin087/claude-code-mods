// Mission Control tests: `claude plugin test` in this folder. The clock is
// simulated, so a 30-second task runs in milliseconds.
import { expect, mock, test } from 'claude-code/testing'
import type { On, Register } from 'claude-code'

const TOOL = 'mcp__mission-control__plan'

// A stand-in for the dock: a prompt "press:<mod>" writes the dock's signal,
// as a click on that dock button does.
const DOCK: { name: string; register: Register } = {
  name: 'mod-hub',
  register: on => {
    on('prompt.submit', async ($, e, next) => {
      if (!e.text.startsWith('press:')) return next(e)
      const cur = (await $.state.get({ plugin: 'mod-hub', key: 'signal' })).value
      await $.state.set({ plugin: 'mod-hub', key: 'signal' }, { seq: (cur?.seq ?? 0) + 1, target: e.text.slice(6) })
      return { text: e.text }
    })
  },
}

// The test's own $ has no state noun, so a probe mod reads Mission Control's
// values (any mod may read another's) and hands them back as a tool result.
const PROBE: { name: string; register: Register } = {
  name: 'probe',
  register: on => {
    on('tool.call', { tool: 'mcp__probe__read' }, async $ => ({
      result: {
        summary: (await $.state.get({ plugin: 'mission-control', key: 'summary' })).value ?? null,
        mission: (await $.state.get({ plugin: 'mission-control', key: 'mission' })).value ?? null,
        isOpen: (await $.state.get({ plugin: 'mission-control', key: 'isOpen' })).value ?? false,
      },
    }))
  },
}

// What the engine answers beneath the plugins.
const world = (on: On) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { USERPROFILE: 'C:/Users/test' })
  const panes = new Set<string>()
  const files: Record<string, string> = {}
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: 'C:/x/gcdAtlas' }))
  on('session.id', () => ({ value: 'session-1' }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__mission-control__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  const norm = (path: string) => path.replace(/\\/g, '/')
  on('fs.exists', ($, e) => ({ value: norm(e.path) in files || Object.keys(files).some(f => f.startsWith(`${norm(e.path)}/`)) }))
  on('fs.read', ($, e) => ({ value: files[norm(e.path)] ?? '' }))
  on('fs.write', ($, e) => {
    files[norm(e.path)] = e.text
    return { value: undefined }
  })
  on('fs.list', ($, e) => ({
    value: Object.keys(files)
      .filter(f => f.startsWith(`${norm(e.path)}/`))
      .map(f => ({ name: f.slice(norm(e.path).length + 1), kind: 'file' as const, size: files[f]!.length })),
  }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('ui.panes', () => ({ value: [...panes].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  on('ui.open', ($, e) => {
    panes.add(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    panes.delete(e.id)
    return { value: undefined }
  })
  return { clock, panes, files }
}

type Engine = Parameters<Parameters<typeof test>[1] & ((...a: never[]) => unknown)>[0]

const begin = async ($: Engine) => {
  await $.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'build the thing', turnId: 't1' })
}
const plan = ($: Engine, input: Record<string, unknown>) => $.tool.call({ tool: TOOL, ...input } as never)
const finish = ($: Engine, turnId: string) =>
  $.turn.complete({ answer: 'ok', durationMs: 1000, isAborted: false, turnId, reason: 'answer' } as never)
type Peek = { summary: { pct: number; stepNo: number; total: number; left: string | null; elapsedMs: number; isFinished: boolean; now: string } | null; mission: unknown; isOpen: boolean }
const peek = async ($: Engine) => (await $.tool.call({ tool: 'mcp__probe__read' } as never)).result as Peek
const summary = async ($: Engine) => (await peek($)).summary

test('4a. the progress bar climbs a little every second during a step, never backwards', { plugins: [PROBE] }, async ($, on) => {
  const { clock } = world(on)
  await begin($)
  await plan($, { title: 'Demo', steps: [{ text: 'a', size: 1 }, { text: 'b', size: 1 }, { text: 'c', size: 1 }], start: 1, now: 'starting' })
  const first = await summary($)
  expect(first?.stepNo).toBe(1)
  expect(first?.total).toBe(3)

  const seen: number[] = []
  for (let s = 0; s < 30; s++) {
    await clock.advance(1000)
    const now = await summary($)
    seen.push(now!.pct)
    expect(now!.elapsedMs).toBe((s + 1) * 1000)
  }
  for (let i = 1; i < seen.length; i++) {
    expect(seen[i]! - seen[i - 1]!).toBeGreaterThan(0)
    expect(seen[i]! - seen[i - 1]!).toBeLessThan(0.01)
  }

  await plan($, { done: [1], start: 2, now: 'second step' })
  expect((await summary($))!.pct).toBeGreaterThanOrEqual(1 / 3)
  expect((await summary($))!.stepNo).toBe(2)
  expect((await summary($))!.now).toBe('second step')
})

test('4b. finishing shows the done chip; the next prompt you send clears it', { plugins: [PROBE] }, async ($, on) => {
  const { clock } = world(on)
  await begin($)
  await plan($, { title: 'Demo', steps: [{ text: 'a' }, { text: 'b' }], start: 1 })
  await clock.advance(5000)
  await plan($, { finished: true })
  const done = await summary($)
  expect(done?.isFinished).toBe(true)
  expect(done?.pct).toBe(1)
  expect(done?.left).toBe(null)
  expect(done?.elapsedMs).toBe(5000)

  // The chip stays through the end of the turn and while idle...
  await finish($, 't1')
  await clock.advance(60_000)
  expect((await summary($))?.isFinished).toBe(true)
  // ...and goes with your next prompt.
  await $.prompt.submit({ text: 'thanks, next thing', wait: false, origin: { kind: 'composer' } } as never)
  expect(await summary($)).toBe(null)
})

test('4c. time stops counting while the turn is over (waiting on you)', { plugins: [PROBE] }, async ($, on) => {
  const { clock } = world(on)
  await begin($)
  await plan($, { title: 'Demo', steps: [{ text: 'a' }, { text: 'b' }], start: 1 })
  await clock.advance(10_000)
  await plan($, { now: 'still on a' })
  await finish($, 't1')
  const paused = (await summary($))!.elapsedMs
  await clock.advance(120_000)
  expect((await summary($))!.elapsedMs).toBe(paused)
})

test('4d. a board Claude stops updating for 2 turns is cleared', { plugins: [PROBE] }, async ($, on) => {
  world(on)
  await begin($)
  await plan($, { title: 'Demo', steps: [{ text: 'a' }, { text: 'b' }], start: 1 })
  await finish($, 't1')
  await $.turn.start({ text: 'quick question', turnId: 't2' })
  await finish($, 't2')
  expect((await summary($))).not.toBe(null)
  await $.turn.start({ text: 'another one', turnId: 't3' })
  await finish($, 't3')
  expect(await summary($)).toBe(null)
  expect((await peek($)).mission).toBe(null)
})

test('1. Plan: a dock press opens the mission pane, a second press closes it', { plugins: [DOCK, PROBE] }, async ($, on) => {
  const { panes } = world(on)
  await begin($)
  await plan($, { title: 'Demo', steps: [{ text: 'a' }, { text: 'b' }], start: 1 })
  await $.prompt.submit({ text: 'press:mission-control', wait: false, origin: { kind: 'composer' } } as never)
  expect(panes.has('mission')).toBe(true)
  expect((await peek($)).isOpen).toBe(true)
  await $.prompt.submit({ text: 'press:mission-control', wait: false, origin: { kind: 'composer' } } as never)
  expect(panes.has('mission')).toBe(false)
  expect((await peek($)).isOpen).toBe(false)
})

test('4e. a finished task scores its time-left estimates; P then shows how far off they were', { plugins: [PROBE] }, async ($, on) => {
  const { clock, files } = world(on)
  await begin($)
  // No past tasks: the first guess is the default 2 minutes per unit of size, so 4m.
  await plan($, { title: 'Accuracy', steps: [{ text: 'a', size: 1 }, { text: 'b', size: 1 }] })
  await clock.advance(60_000)
  // Step 1 took 1m: the board now says 1m left, which turns out right.
  await plan($, { done: [1], start: 2 })
  await clock.advance(60_000)
  await plan($, { finished: true })
  await clock.advance(10)
  // Took 2m. The guesses: 4m left at the start (off by 100%), 1m left after step 1 (spot on); the median miss is 100%.
  const saved = JSON.parse(files['C:/Users/test/.claude/mods-data/mission-control/session-1.json']!) as { estimateError?: number }[]
  expect(saved.at(-1)?.estimateError).toBe(1)
  expect((await summary($)) as unknown).toMatchObject({ isFinished: true, accuracy: { avgErrorPct: 100, tasks: 1 } })
  // The next task in this project starts out showing it.
  await plan($, { title: 'Next one', steps: [{ text: 'c', size: 1 }, { text: 'd', size: 1 }] })
  expect((await summary($)) as unknown).toMatchObject({ title: 'Next one', accuracy: { avgErrorPct: 100, tasks: 1 } })
})

// The working row, as the engine hands it to the hooks.
const SPINNER = { word: 'Working', message: null, suffix: '…', mode: 'tool-use' } as const
type RowNode = { type: string; props?: Record<string, unknown>; children?: unknown[] }
const nodesOf = (n: unknown, out: RowNode[] = []): RowNode[] => {
  if (n && typeof n === 'object') {
    out.push(n as RowNode)
    for (const c of (n as RowNode).children ?? []) nodesOf(c, out)
  }
  return out
}
const textOf = (n: unknown): string => (typeof n === 'string' ? n : n && typeof n === 'object' ? ((n as RowNode).children ?? []).map(textOf).join('') : '')
const texts = (n: unknown) => nodesOf(n).filter(x => x.type === 'Text')

// Step 1 took 10 s, so the pace is 10 s per unit; step 2 has run `into` ms.
const midTask = async ($: Engine, clock: { advance: (ms: number) => Promise<void> }, into: number) => {
  await begin($)
  await plan($, { title: 'Ship it', steps: [{ text: 'read the code', size: 1 }, { text: 'wire the row', size: 1 }, { text: 'test it', size: 1 }], start: 1 })
  await clock.advance(10_000)
  await plan($, { done: [1], start: 2, now: 'drawing the bar' })
  await clock.advance(into)
}

test('5a. desktop: the working row is the animated row: %, a short bar, the step, time, and a plan link, all on one line', { plugins: [PROBE] }, async ($, on) => {
  const { clock } = world(on)
  await midTask($, clock, 5_000)
  const ui = await $.ui.mount({ plugin: 'mission-control', surface: 'desktop', component: 'Spinner', props: SPINNER })
  const row = await ui.find({ key: 'mission:row' })
  expect(row?.type).toBe('Client')
  expect(String(row?.props.module)).toMatch(/row\.tsx$/)
  expect(row?.props.props).toMatchObject({ stepNo: 2, total: 3, elapsed: '15s', pace: 'ok', isPlanOpen: false })
  // No summary text: the now line lives in the plan, one click away.
  expect(textOf(await ui.drawn({ in: 'mission:row' }))).toMatch(/^.\d+%━{6}2\/3·15s·~\S+ left·plan ›$/)
})

test('5b. desktop: the row animates on its own frame clock: the spinner turns and the colors move each frame', { plugins: [PROBE] }, async ($, on) => {
  const { clock } = world(on)
  await midTask($, clock, 5_000)
  const ui = await $.ui.mount({ plugin: 'mission-control', surface: 'desktop', component: 'Spinner', props: SPINNER })
  const seen = new Set<string>()
  const palettes = new Set<string>()
  for (let i = 0; i < 6; i++) {
    const drawn = await ui.drawn({ in: 'mission:row' })
    seen.add(textOf(texts(drawn)[0]))
    palettes.add(JSON.stringify(texts(drawn).map(t => t.props?.color)))
    await ui.advance(80)
  }
  expect(seen.size).toBe(6)
  expect(palettes.size).toBe(6)
})

test('5c. desktop: a step that runs past its share turns time left amber, saying so', { plugins: [PROBE] }, async ($, on) => {
  const { clock } = world(on)
  await midTask($, clock, 30_000)
  const ui = await $.ui.mount({ plugin: 'mission-control', surface: 'desktop', component: 'Spinner', props: SPINNER })
  expect((await ui.find({ key: 'mission:row' }))?.props.props).toMatchObject({ pace: 'slow' })
  const late = texts(await ui.drawn({ in: 'mission:row' })).find(t => textOf(t).includes('step running long'))
  expect(late?.props?.color).toBe('#facc15')
})

test('5d. desktop: a click on the row opens the Mission pane, and the link then reads "hide plan"; another click closes it', { plugins: [PROBE] }, async ($, on) => {
  const { clock, panes } = world(on)
  await midTask($, clock, 5_000)
  const ui = await $.ui.mount({ plugin: 'mission-control', surface: 'desktop', component: 'Spinner', props: SPINNER })
  await ui.pointer({ type: 'down', x: 2, y: 0, button: 'left' })
  await ui.pointer({ type: 'up', x: 2, y: 0, button: 'left' })
  expect(panes.has('mission')).toBe(true)
  expect((await ui.find({ key: 'mission:row' }))?.props.props).toMatchObject({ isPlanOpen: true })
  expect(textOf(await ui.drawn({ in: 'mission:row' }))).toMatch(/hide plan$/)
  await ui.pointer({ type: 'down', x: 2, y: 0, button: 'left' })
  await ui.pointer({ type: 'up', x: 2, y: 0, button: 'left' })
  expect(panes.has('mission')).toBe(false)
})

test('5e. terminal: the engine keeps its own working line, its text rewritten with the progress', { plugins: [PROBE] }, async ($, on) => {
  const { clock } = world(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{String((e.props as { message?: string | null }).message ?? '')}</Text>
  })
  await midTask($, clock, 5_000)
  const ui = await $.ui.mount({ plugin: 'mission-control', surface: 'terminal', component: 'Spinner', props: SPINNER })
  expect(await ui.find({ key: 'mission:row' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^\d+% · step 2\/3 · 15s · ~\S+ left$/ })).toBeDefined()
})

// Claude sometimes restates the plan instead of calling start/done: the same
// title, each step as { title, status } (seen 15 times in real chats, each one
// emptying the board to 0/0 before this was handled).
type Step = { text: string; size: number; status: string }
const stepsOf = async ($: Engine) => ((await peek($)).mission as { steps: Step[] } | null)?.steps ?? []

test('6a. a restated plan ({ title, status } steps, same title) keeps the board: steps read, statuses kept, clock and sizes kept', { plugins: [PROBE] }, async ($, on) => {
  const { clock } = world(on)
  await midTask($, clock, 5_000)
  const out = await plan($, {
    title: 'Ship it',
    steps: [{ title: 'read the code', status: 'done' }, { title: 'wire the row', status: 'in_progress' }, { title: 'test it', status: 'pending' }],
    now: 'still drawing the bar',
  })
  expect(String(out.result)).toMatch(/step 2\/3/)
  expect((await stepsOf($)).map(s => `${s.text}:${s.status}:${s.size}`)).toEqual(['read the code:done:1', 'wire the row:doing:1', 'test it:todo:1'])
  // The clock runs on: 10 s of step 1 plus 5 s into step 2.
  expect((await summary($))?.elapsedMs).toBe(15_000)
  expect((await summary($))?.now).toBe('still drawing the bar')
})

test('6b. steps with nothing readable change nothing: the board stays, and Claude is told the shape', { plugins: [PROBE] }, async ($, on) => {
  const { clock } = world(on)
  await midTask($, clock, 5_000)
  const out = await plan($, { title: 'Ship it', steps: [{ label: 'x' }, { status: 'done' }] })
  expect(String(out.result)).toMatch(/^Nothing changed: give each step its words in `text`/)
  expect(await summary($)).toMatchObject({ stepNo: 2, total: 3 })
})

test('6c. plain strings as steps start a plan', { plugins: [PROBE] }, async ($, on) => {
  world(on)
  await begin($)
  await plan($, { title: 'Strings', steps: ['one', 'two', 'three'] })
  expect(await summary($)).toMatchObject({ title: 'Strings', stepNo: 1, total: 3 })
})

test('6d. a new title with plain steps still starts a new plan, its clock from zero', { plugins: [PROBE] }, async ($, on) => {
  const { clock } = world(on)
  await midTask($, clock, 5_000)
  await plan($, { title: 'Something else', steps: [{ text: 'a' }, { text: 'b' }] })
  expect(await summary($)).toMatchObject({ title: 'Something else', stepNo: 1, total: 2, elapsedMs: 0 })
})
