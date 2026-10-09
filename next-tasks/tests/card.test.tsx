// Next Tasks: opens on its own after a long turn and stays until a task is
// picked, ✕ or your next prompt. `claude plugin test` here; Haiku is answered
// by the test.
import { expect, mock, test } from 'claude-code/testing'
import type { On, Register } from 'claude-code'

const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 120, scroll: { offset: 0, bodyRows: 8 }, view: {} }
const SUGGESTIONS = JSON.stringify([
  { title: 'Add a seam test', why: 'stops the flicker regression', prompt: 'Write a test for tile seams.' },
  { title: 'Write an ADR', why: 'records the tiles decision', prompt: 'Draft an ADR for tiles in repo vs R2.' },
  { title: 'Profile far tiles', why: 'finds the slow path', prompt: 'Profile far-tile blits.' },
])
const ANSWER = { isAnswered: true, text: SUGGESTIONS, usage: { input_tokens: 2000, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }

const PROBE: { name: string; register: Register } = {
  name: 'probe',
  register: on => {
    on('tool.call', { tool: 'mcp__probe__read' }, async $ => ({
      result: { card: (await $.state.get({ plugin: 'next-tasks', key: 'card' })).value ?? null },
    }))
  },
}

// `complete`: how Haiku answers, when a test needs other than the three suggestions.
const world = (on: On, complete?: () => unknown) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: 'C:/x/gcdAtlas' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('model.complete', complete ?? (() => ({ value: ANSWER })))
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
    return { isFilled: true }
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

test('the card stays with no answer: no auto-hide, still open a minute later', { plugins: [PROBE] }, async ($, on) => {
  const clock = world(on)
  await $.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })
  await longTurn($, clock, 90_000)
  await clock.advance(60_000)
  expect((await peek($))?.isOpen).toBe(true)
  expect((await peek($))?.items.length).toBe(3)
})

test('your next prompt clears the card', { plugins: [PROBE] }, async ($, on) => {
  const clock = world(on)
  await $.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })
  await longTurn($, clock, 90_000)
  const ui = await $.ui.mount({ plugin: 'next-tasks', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await ui.find({ key: 'do:0' })).toBeDefined()
  await say($, 'thanks')
  expect(await peek($)).toBe(null)
  expect(await ui.find({ key: 'do:0' })).toBeUndefined()
})

test('a prompt sent while suggestions are still coming drops them: they belong to the last turn', { plugins: [PROBE] }, async ($, on) => {
  let answer: (v: unknown) => void = () => undefined
  const clock = world(on, () => new Promise(r => (answer = r)))
  await $.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })
  await longTurn($, clock, 90_000)
  expect((await peek($)) as unknown as { isLoading: boolean }).toMatchObject({ isLoading: true })
  await say($, 'next thing')
  answer({ value: ANSWER })
  await clock.advance(50)
  expect(await peek($)).toBe(null)
})

test('/next asks over the whole conversation and opens the card', { plugins: [PROBE] }, async ($, on) => {
  const clock = world(on)
  on('model.fork', () => ({
    value: { isAnswered: true, text: SUGGESTIONS, usage: { input_tokens: 0, output_tokens: 300, cache_read_input_tokens: 50000, cache_creation_input_tokens: 0 } },
  }))
  await $.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })
  expect(await peek($)).toBe(null)
  await $.command.run({ command: 'next', args: '' } as never)
  await clock.advance(50)
  expect((await peek($))?.items.length).toBe(3)
  expect((await peek($))?.isOpen).toBe(true)
})
