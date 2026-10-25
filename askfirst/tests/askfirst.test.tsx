// Ask-first tests: `claude plugin test` in this folder. The store, the
// engine's own prompt and its footer are the test's.
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const ENGINE_SECTIONS = [
  { id: 'intro', text: 'You are Claude Code.', scope: 'shared' },
  { id: 'env', text: 'Working directory: C:/x', scope: 'session' },
] as const

// `saved` stands for the store file on disk: given, the test watches every
// write land in it; left out, the kit's own store mock answers.
const world = (on: On, store?: Record<string, unknown>, saved?: Record<string, unknown>) => {
  if (saved) {
    on('store.get', ($, e) => ({ value: saved[e.key] }))
    on('store.set', ($, e) => {
      saved[e.key] = JSON.parse(JSON.stringify(e.value))
      return { value: undefined }
    })
  } else mock.store(on, store)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  // The engine's own composition: two sections, one on each side of the cache boundary.
  on('prompt.compose', () => ({ sections: ENGINE_SECTIONS }))
  // The engine's footer: its mode labels as text, keyed so a test can find it.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    const modes = (e.props as { modes?: readonly string[] }).modes ?? []
    return <Text key="engine">{modes.join(' · ')}</Text>
  })
}

const start = ($: Engine) => $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true } as never)
const askfirst = async ($: Engine, args = '') => ((await $.command.run({ command: 'askfirst', args } as never)) as { text?: string }).text
// What the engine passes when it composes a prompt for the session's model.
const FACTS = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['desktop'], tools: ['AskUserQuestion'], outputStyle: null, traits: [] } as never
const compose = ($: Engine) => $.prompt.compose(FACTS)
const ids = async ($: Engine) => (await compose($)).sections.map(s => s.id)
const footer = async ($: Engine) => {
  const ui = await $.ui.mount({ plugin: 'askfirst', surface: 'desktop', component: 'SessionMode', props: { modes: ['plan'] } })
  const strings = (n: unknown): string[] =>
    typeof n === 'string' ? [n] : n && typeof n === 'object' ? ((n as { children?: unknown[] }).children ?? []).flatMap(strings) : []
  return strings(await ui.drawn()).join('')
}

test("off by default: the prompt is the engine's alone",async ($, on) => {
  world(on)
  await start($)
  expect(await ids($)).toEqual(['intro', 'env'])
})

test('on: one session section at the end tells Claude to ask with AskUserQuestion first', async ($, on) => {
  world(on, { isOn: true })
  await start($)
  const sections = (await compose($)).sections
  expect(sections.map(s => s.id)).toEqual(['intro', 'env', 'askfirst:ask-first'])
  const mine = sections.at(-1)
  expect(mine?.scope).toBe('session')
  expect(mine?.text).toContain('AskUserQuestion')
  expect(mine?.text).toContain('(Recommended)')
  expect(mine?.text).toContain('2 to 4 questions')
  expect(mine?.text).toMatch(/Skip the questions for trivial requests/)
})

test('bare /askfirst flips the switch each time, and the prompt follows', async ($, on) => {
  world(on)
  await start($)
  expect(await askfirst($)).toBe('Ask-first is on.')
  expect(await ids($)).toContain('askfirst:ask-first')
  expect(await askfirst($)).toBe('Ask-first is off.')
  expect(await ids($)).not.toContain('askfirst:ask-first')
})

test('/askfirst on and /askfirst off set it, whatever it was', async ($, on) => {
  world(on)
  await start($)
  expect(await askfirst($, 'on')).toBe('Ask-first is on.')
  expect(await askfirst($, ' ON ')).toBe('Ask-first is on.')
  expect(await ids($)).toContain('askfirst:ask-first')
  expect(await askfirst($, 'off')).toBe('Ask-first is off.')
  expect(await askfirst($, 'off')).toBe('Ask-first is off.')
  expect(await ids($)).not.toContain('askfirst:ask-first')
  expect(await askfirst($, 'maybe')).toBe('Usage: /askfirst [on|off] (bare flips it).')
})

test('the footer gets a dim "ask first" mode label while on, nothing while off', async ($, on) => {
  world(on)
  await start($)
  expect(await footer($)).toBe('plan')
  await askfirst($, 'on')
  expect(await footer($)).toBe('plan · ask first')
})

test('the switch is kept in the store, so a new chat starts with it', async ($, on) => {
  const saved: Record<string, unknown> = {}
  world(on, undefined, saved)
  await start($)
  await askfirst($, 'on')
  expect(saved).toEqual({ isOn: true })
  await askfirst($, 'off')
  expect(saved).toEqual({ isOn: false })
})

test('a store saved as on (a restart) keeps it on without a command', async ($, on) => {
  world(on, { isOn: true })
  await start($)
  expect(await footer($)).toBe('plan · ask first')
  expect(await askfirst($)).toBe('Ask-first is off.')
})
