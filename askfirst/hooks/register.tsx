import type { EngineInterface, Register } from 'claude-code'

// An "ask me first" switch. While it is on, the system prompt carries one more
// section telling Claude to ask its clarifying questions (with the
// AskUserQuestion tool) before it starts any non-trivial task, so the person no
// longer has to end every prompt with "ask me any questions to help you out".
// /askfirst flips it (or /askfirst on, /askfirst off). The switch is kept in the
// mod's own store, so it holds across chats and restarts; it starts off.

const KEY = 'isOn'
const LABEL = 'ask first'

const SECTION = {
  id: 'askfirst:ask-first',
  scope: 'session',
  text: [
    '# Ask first',
    'The user has switched on "ask me first". Before you start any non-trivial task, ask the clarifying questions you need using the AskUserQuestion tool, then begin once they have answered.',
    '- Ask 2 to 4 questions, each about something that would change what you build or how: scope, behaviour, trade-offs, where things go.',
    '- For each question put the option you recommend first and add " (Recommended)" to its label.',
    '- Skip the questions for trivial requests (a one-line fix, a quick lookup, a plain question) and for requests that already spell out everything you need; then just do the work.',
    '- Ask once, up front. Do not stop again mid-task with more questions unless something you could not have foreseen comes up.',
  ].join('\n'),
} as const

// The store is the one place the switch lives: every chat reads it fresh, so a
// flip in one chat reaches the others on their next prompt.
const isOn = async ($: EngineInterface) => (await $.store.get(KEY)) === true

const setOn = async ($: EngineInterface, value: boolean) => {
  await $.store.set(KEY, value)
  // The footer label follows the switch right away.
  $.ui.invalidate('ui.render')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'askfirst', description: 'Ask me first: Claude asks clarifying questions before non-trivial tasks (on, off, or bare to flip)' })
    return next(e)
  })

  on('command.run', { command: 'askfirst' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    let value: boolean
    if (arg === 'on') value = true
    else if (arg === 'off') value = false
    else if (arg === '') value = !(await isOn($))
    else return { text: 'Usage: /askfirst [on|off] (bare flips it).' }
    await setOn($, value)
    return { text: `Ask-first is ${value ? 'on' : 'off'}.` }
  })

  // The instruction itself: one section after everything the engine composed,
  // on the session side of the cache boundary, only while the switch is on.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!(await isOn($))) return composed
    return { sections: [...composed.sections, SECTION] }
  })

  // A dim "ask first" among the engine's own mode labels while it is on. No
  // button: the desktop footer is already crowded.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (!(await isOn($))) return next(e)
    return next({ ...e, props: { ...e.props, modes: [...e.props.modes, LABEL] } })
  })
}
