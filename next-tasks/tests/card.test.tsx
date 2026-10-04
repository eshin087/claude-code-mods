// Next Tasks: auto-open once, dock toggle, fold on typing, expiry, quiet while
// the dock is folded. `claude plugin test` here; Haiku is answered by the test.
import { expect, mock, test } from 'claude-code/testing'
import type { On, Register } from 'claude-code'

const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 120, scroll: { offset: 0, bodyRows: 8 }, view: {} }
const SUGGESTIONS = JSON.stringify([
  { title: 'Add a seam test', why: 'stops the flicker regression', prompt: 'Write a test for tile seams.' },
  { title: 'Write an ADR', why: 'records the tiles decision', prompt: 'Draft an ADR for tiles in repo vs R2.' },
  { title: 'Profile far tiles', why: 'finds the slow path', prompt: 'Profile far-tile blits.' },
])

// A stand-in for the dock: "press:<mod>" writes the dock's signal, "fold" folds it.
const DOCK: { name: string; register: Register } = {
  name: 'mod-hub',
  register: on => {
    on('prompt.submit', async ($, e, next) => {
      if (e.text === 'fold') {
        await $.state.set({ plugin: 'mod-hub', key: 'isCollapsed' }, true)
        return { text: e.text }
      }
      if (!e.text.startsWith('press:')) return next(e)
      const cur = (await $.state.get({ plugin: 'mod-hub', key: 'signal' })).value
      await $.state.set({ plugin: 'mod-hub', key: 'signal' }, { seq: (cur?.seq ?? 0) + 1, target: e.text.slice(6) })
      return { text: e.text }
    })
  },
}

const PROBE: { name: string; register: Register } = {
  name: 'probe',
  register: on => {
    on('tool.call', { tool: 'mcp__probe__read' }, async $ => ({
      result: { card: (await $.state.get({ plugin: 'next-tasks', key: 'card' })).value ?? null },
    }))
  },
}

const world = (on: On) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: 'C:/x/gcdAtlas' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('model.complete', () => ({
    value: { isAnswered: true, text: SUGGESTIONS, usage: { input_tokens: 2000, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
  }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  return clock
}

type Engine = Parameters<Parameters<typeof test>[1] & ((...a: never[]) => unknown)>[0]
type Card = { isOpen: boolean; items: unknown[] } | null
const peek = async ($: Engine) => ((await $.tool.call({ tool: 'mcp__probe__read' } as never)).result as { card: Card }).card
const say = ($: Engine, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } } as never)
// A click on the dock is no prompt; here it rides one marked as a mod's, which Next Tasks never counts as typing.
const press = ($: Engine, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'plugin', name: 'test' } } as never)

const longTurn = async ($: Engine, clock: ReturnType<typeof mock.clock>, ms: number) => {
  await $.turn.start({ text: 'build the tile streamer', turnId: 't1' })
  await $.turn.complete({ answer: 'Built it.', durationMs: ms, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await clock.advance(50)
}

test('opens on its own once after a turn of a minute or more', { plugins: [PROBE] }, async ($, on) => {
  const clock = world(on)
  await $.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })
  await longTurn($, clock, 90_000)
  const card = await peek($)
  expect(card?.items.length).toBe(3)
  expect(card?.isOpen).toBe(true)
})

test('a short turn makes no suggestions', { plugins: [PROBE] }, async ($, on) => {
  const clock = world(on)
  await $.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })
  await longTurn($, clock, 20_000)
  expect(await peek($)).toBe(null)
})

test('1. Next: the dock press folds and reopens the card', { plugins: [DOCK, PROBE] }, async ($, on) => {
  const clock = world(on)
  await $.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })
  await longTurn($, clock, 90_000)
  await press($, 'press:next-tasks')
  expect((await peek($))?.isOpen).toBe(false)
  await press($, 'press:next-tasks')
  expect((await peek($))?.isOpen).toBe(true)
})

test('your next prompt folds the card to the badge; 3 prompts later it is gone', { plugins: [PROBE] }, async ($, on) => {
  const clock = world(on)
  await $.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })
  await longTurn($, clock, 90_000)
  await say($, 'thanks')
  expect((await peek($))?.isOpen).toBe(false)
  expect((await peek($))?.items.length).toBe(3)
  await say($, 'quick question')
  expect(await peek($)).not.toBe(null)
  await say($, 'another')
  expect(await peek($)).toBe(null)
})

test('3. while the dock is folded the card is not drawn', { plugins: [DOCK, PROBE] }, async ($, on) => {
  const clock = world(on)
  await $.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })
  await longTurn($, clock, 90_000)
  const ui = await $.ui.mount({ plugin: 'next-tasks', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await ui.find({ key: 'do:0' })).toBeDefined()
  await press($, 'fold')
  expect(await ui.find({ key: 'do:0' })).toBeUndefined()
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`[${surface}] the card is one line per task: a bordered number and the task; ✕ clears it`, { plugins: [PROBE] }, async ($, on) => {
    const clock = world(on)
    await $.session.start({ cwd: 'C:/x/gcdAtlas', surface, isInteractive: true })
    await longTurn($, clock, 90_000)
    const ui = await $.ui.mount({ plugin: 'next-tasks', surface, component: 'AbovePrompt', props: BAND_PROPS })
    for (const [i, title] of ['Add a seam test', 'Write an ADR', 'Profile far tiles'].entries()) {
      const num = await ui.find({ key: `num:${i}` })
      expect(num?.props.label).toBe(String(i + 1))
      expect(num?.props.plain).toBeUndefined()
      expect(num?.props.hotkey).toBeUndefined()
      const task = await ui.find({ key: `do:${i}` })
      expect(task?.props.label).toBe(title)
      expect(task?.props.plain).toBe(true)
    }
    expect((await ui.find({ key: 'dismiss' }))?.props.label).toBe('✕')
    await ui.press({ key: 'dismiss' })
    expect(await peek($)).toBe(null)
    expect(await ui.find({ key: 'do:0' })).toBeUndefined()
  })
}

test('pressing a bordered number does that task', { plugins: [PROBE] }, async ($, on) => {
  const clock = world(on)
  let sent = ''
  on('prompt.fill', ($, e) => {
    sent = e.text
    return { value: { isFilled: true } }
  })
  await $.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })
  await longTurn($, clock, 90_000)
  const ui = await $.ui.mount({ plugin: 'next-tasks', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
  await ui.press({ key: 'num:1' })
  expect(sent).toBe('Draft an ADR for tiles in repo vs R2.')
  expect(await peek($)).toBe(null)
})

test('a card left loading by a reload is cleared when the mod loads again', { plugins: [PROBE] }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: 'C:/x/gcdAtlas' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  // Haiku never answers: the request is still in flight when the "reload" comes.
  on('model.complete', () => new Promise(() => undefined))
  await $.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })
  await longTurn($, clock, 90_000)
  expect((await peek($)) as unknown as { isLoading: boolean }).toMatchObject({ isLoading: true })
  await $.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })
  expect(await peek($)).toBe(null)
})

test('clicking N with nothing yet asks for suggestions', { plugins: [DOCK, PROBE] }, async ($, on) => {
  const clock = world(on)
  on('model.fork', () => ({
    value: { isAnswered: true, text: SUGGESTIONS, usage: { input_tokens: 0, output_tokens: 300, cache_read_input_tokens: 50000, cache_creation_input_tokens: 0 } },
  }))
  await $.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })
  expect(await peek($)).toBe(null)
  await press($, 'press:next-tasks')
  await clock.advance(50)
  expect((await peek($))?.items.length).toBe(3)
  expect((await peek($))?.isOpen).toBe(true)
})

test('an opened card folds to N after 10 seconds with no answer; each opening gets its own 10 seconds', { plugins: [DOCK, PROBE] }, async ($, on) => {
  const clock = world(on)
  await $.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })
  await longTurn($, clock, 90_000)
  await clock.advance(9_000)
  expect((await peek($))?.isOpen).toBe(true)
  await clock.advance(1_100)
  expect((await peek($))?.isOpen).toBe(false)
  // Reopened with N: a fresh 10 seconds, and the old timer is spent.
  await press($, 'press:next-tasks')
  await clock.advance(6_000)
  expect((await peek($))?.isOpen).toBe(true)
  await clock.advance(4_100)
  expect((await peek($))?.isOpen).toBe(false)
  expect((await peek($))?.items.length).toBe(3)
})
