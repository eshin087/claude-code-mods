// Inbox tests: `claude plugin test` in this folder. The clock, the record files
// of the other chats, the notifications and the panes are the test's.
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { InboxRecord } from '../types'

const NOW = new Date(2026, 9, 15, 15, 0).getTime()
const MIN = 60_000
const HOME = 'C:/Users/test'
const FOLDER = `${HOME}/.claude/mods-data/inbox`
const MINE = `${FOLDER}/session-1.json`
const PANE_PROPS = { title: 'Inbox', isFocused: false, bodyColumns: 140, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const

type Note = { text: string; title?: string }

const world = (on: On, files: Record<string, string> = {}, opts: { settingsAllows?: boolean } = {}) => {
  const clock = mock.clock(on, { now: NOW })
  const notes: Note[] = []
  const panes = new Set<string>()
  // A tool call waits at the bottom until the test lets it go, as one does behind
  // its permission prompt; `reached` settles once a call is there, past every plugin's hook.
  const gate: { release: () => void; wait: Promise<void>; arrive: () => void; reached: Promise<void> } = {
    release: () => undefined,
    wait: Promise.resolve(),
    arrive: () => undefined,
    reached: Promise.resolve(),
  }
  const hold = () => {
    gate.wait = new Promise<void>(resolve => (gate.release = resolve))
    gate.reached = new Promise<void>(resolve => (gate.arrive = resolve))
  }
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
  on('env.get', ($, e) => ({ value: e.name === 'USERPROFILE' ? HOME : undefined }))
  on('fs.read', ($, e) => {
    const text = files[norm(e.path)]
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: text }
  })
  on('fs.write', ($, e) => {
    files[norm(e.path)] = e.text
    return { value: undefined }
  })
  on('fs.list', ($, e) => ({
    value: Object.keys(files)
      .filter(f => f.startsWith(`${norm(e.path)}/`))
      .map(f => ({ name: f.slice(norm(e.path).length + 1), kind: 'file' as const, size: files[f]!.length, mtimeMs: 0, isLink: false })),
  }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.cwd', () => ({ value: 'C:/x/gcdTourney/.claude/worktrees/attack-alts' }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.call', async () => {
    gate.arrive()
    await gate.wait
    return { result: { stdout: 'ok' } } as never
  })
  on('classic.PermissionRequest', () => (opts.settingsAllows ? { decision: { behavior: 'allow' as const } } : {}))
  on('classic.Notification', () => ({}))
  on('classic.UserPromptSubmit', () => ({}))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.notify', ($, e) => {
    notes.push({ text: e.text, title: e.title })
    return { value: { isSent: true as const, channel: 'kitty' as const } }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [...panes].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  on('ui.open', ($, e) => {
    panes.add(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    panes.delete(e.id)
    return { value: undefined }
  })
  // The engine's own footer: a keyed box, so a test can see it is still drawn.
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  return { clock, files, notes, panes, hold, gate }
}

const start = ($: Engine) => $.session.start({ cwd: 'C:/x/gcdTourney/.claude/worktrees/attack-alts', surface: 'desktop', isInteractive: true })
const mine = (files: Record<string, string>) => JSON.parse(files[MINE]!) as InboxRecord
const prompt = ($: Engine, text = 'attack alts\nand fix the bracket', turnId = 't1') => $.turn.start({ text, turnId })
const reply = ($: Engine, answer: string, durationMs: number, turnId = 't1', isAborted = false) =>
  $.turn.complete({ answer, durationMs, isAborted, turnId, reason: isAborted ? 'aborted' : 'answer' } as never)
const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never)
const record = (sessionId: string, r: Partial<InboxRecord>): [string, string] => [
  `${FOLDER}/${sessionId}.json`,
  JSON.stringify({ sessionId, project: 'gcdAtlas', title: '', state: 'idle', reason: '', since: NOW, updatedAt: NOW, ...r }),
]

const strings = (n: unknown): string[] =>
  typeof n === 'string' ? [n] : n && typeof n === 'object' ? ((n as { children?: unknown[] }).children ?? []).flatMap(strings) : []
const textOf = async (ui: { drawn: () => Promise<unknown> }) => strings(await ui.drawn()).join(' ').replace(/\s+/g, ' ')
const pane = ($: Engine) => $.ui.mount({ plugin: 'inbox', surface: 'desktop', component: 'Pane', requestId: 'inbox', props: PANE_PROPS })
const footer = ($: Engine) => $.ui.mount({ plugin: 'inbox', surface: 'desktop', component: 'SessionMode', props: { modes: [] } })

test('a prompt starts working; a permission prompt waits for approval, notified once; the call going ahead clears it', async ($, on) => {
  const { files, notes, hold, gate } = world(on)
  await start($)
  await prompt($)
  expect(mine(files)).toMatchObject({ sessionId: 'session-1', project: 'gcdTourney', title: 'attack alts', state: 'working', since: NOW })
  hold()
  const call = bash($, 'npm run pr -- merge 12')
  await gate.reached
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'npm run pr -- merge 12' } })
  expect(mine(files)).toMatchObject({ state: 'approval', reason: 'wants to run Bash: npm run pr -- merge 12' })
  expect(notes).toEqual([{ title: 'gcdTourney · attack alts', text: 'Needs your approval: Bash: npm run pr -- merge 12' }])
  // The engine's own notice of the same prompt is no second transition.
  await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' })
  expect(notes.length).toBe(1)
  gate.release()
  await call
  expect(mine(files).state).toBe('working')
})

test('a permission prompt is tied to its own call: another call finishing beside it leaves the approval up', async ($, on) => {
  const { files, hold, gate } = world(on)
  await start($)
  await prompt($)
  hold()
  const first = bash($, 'git push')
  await gate.reached
  const read = $.tool.call({ tool: 'Read', file_path: 'C:/x/a.txt' } as never)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'git push' } })
  expect(mine(files).state).toBe('approval')
  gate.release()
  await read
  await first
  expect(mine(files).state).toBe('working')
})

test("the engine's permission notice alone is enough; a plugin's own notification is no prompt", async ($, on) => {
  const { files, notes, hold, gate } = world(on)
  await start($)
  await prompt($)
  await $.classic.Notification({ message: 'Another mod says hi', notification_type: 'plugin_notification' })
  expect(mine(files).state).toBe('working')
  hold()
  const call = bash($, 'rm -rf build')
  await gate.reached
  await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' })
  expect(mine(files)).toMatchObject({ state: 'approval', reason: 'Claude needs your permission to use Bash' })
  expect(notes).toEqual([{ title: 'gcdTourney · attack alts', text: 'Needs your approval: Claude needs your permission to use Bash' }])
  gate.release()
  await call
  expect(mine(files).state).toBe('working')
})

test('a settings hook that answers the request shows no prompt: the chat stays working, nobody is notified', async ($, on) => {
  const { files, notes } = world(on, {}, { settingsAllows: true })
  await start($)
  await prompt($)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' } })
  expect(mine(files).state).toBe('working')
  expect(notes).toEqual([])
})

test('AskUserQuestion is a question until it is answered; its permission request is no approval', async ($, on) => {
  const { files, notes, hold, gate } = world(on)
  await start($)
  await prompt($)
  hold()
  const options = [
    { label: 'Single', description: 'Single elimination' },
    { label: 'Double', description: 'Double elimination' },
  ]
  const questions = [{ question: 'Which bracket layout do you want?', header: 'Layout', options, multiSelect: false }]
  const asked = $.tool.call({ tool: 'AskUserQuestion', questions } as never)
  await gate.reached
  await $.classic.PermissionRequest({ tool_name: 'AskUserQuestion', tool_input: { questions } })
  expect(mine(files)).toMatchObject({ state: 'question', reason: 'Which bracket layout do you want?' })
  expect(notes).toEqual([{ title: 'gcdTourney · attack alts', text: 'Asks you: Which bracket layout do you want?' }])
  gate.release()
  await asked
  expect(mine(files).state).toBe('working')
})

test('the reply finishing is your turn, with its first line; a long reply notifies, a short one does not', async ($, on) => {
  const { files, notes } = world(on)
  await start($)
  await prompt($)
  await reply($, '**Merged** the PR.\n\nDetails below.', 30_000)
  expect(mine(files)).toMatchObject({ state: 'done', reason: 'Merged the PR.' })
  expect(notes).toEqual([])
  await prompt($, 'now the alts', 't2')
  expect(mine(files).state).toBe('working')
  await reply($, 'All alts attacked.', 3 * MIN + 12_000, 't2')
  expect(notes).toEqual([{ title: 'gcdTourney · attack alts', text: 'Done after 3m 12s: All alts attacked.' }])
})

test("a subagent's end is not the chat's; a reply you stopped needs nothing from you", async ($, on) => {
  const { files } = world(on)
  await start($)
  await prompt($)
  await $.turn.complete({ answer: 'report', durationMs: 5000, isAborted: false, turnId: 'a1', agentId: 'agent-1', reason: 'answer' } as never)
  expect(mine(files).state).toBe('working')
  await reply($, '', 4000, 't1', true)
  expect(mine(files).state).toBe('idle')
})

test("the chat's own title wins over its first prompt, and a long first line is cut to 60", async ($, on) => {
  const { files } = world(on)
  await start($)
  await prompt($, 'x'.repeat(100))
  expect(mine(files).title).toBe(`${'x'.repeat(59)}…`)
  await $.classic.UserPromptSubmit({ prompt: 'hi', session_title: 'Attack alts' })
  expect(mine(files).title).toBe('Attack alts')
})

test('the pane: "Needs you" oldest first, then "Your turn", then a count of working chats; idle, stale and broken files left out', async ($, on) => {
  const { files } = world(
    on,
    Object.fromEntries([
      record('a', { project: 'gcdAtlas', title: 'footer colors', state: 'question', reason: 'Which color?', since: NOW - 3 * MIN }),
      record('b', { project: 'mods', title: 'inbox', state: 'approval', reason: 'wants to run Bash: npm test', since: NOW - 10 * MIN }),
      record('c', { project: 'gcdAtlas', title: 'docs', state: 'done', reason: 'Wrote the docs.', since: NOW - 20 * MIN }),
      record('d', { project: 'mods', title: 'pace', state: 'working', since: NOW - MIN }),
      record('e', { project: 'mods', title: 'idle one', state: 'idle' }),
      record('f', { project: 'old', title: 'gone', state: 'approval', reason: 'stale', since: NOW - 13 * 60 * MIN, updatedAt: NOW - 13 * 60 * MIN }),
      [`${FOLDER}/half.json`, '{"sessionId":"half","sta'],
    ]),
  )
  await start($)
  await prompt($)
  await reply($, 'Merged.', 1000)
  expect(((await $.command.run({ command: 'inbox', args: '' } as never)) as { text?: string }).text).toBe('Inbox opened.')
  const text = await textOf(await pane($))
  expect(text).toContain(
    'Needs you mods · inbox Approval 10m wants to run Bash: npm test gcdAtlas · footer colors Question 3m Which color? ' +
      'Your turn gcdAtlas · docs Done 20m Wrote the docs. ▸ gcdTourney · attack alts Done 0s Merged. 1 chat working',
  )
  for (const gone of ['idle one', 'gone', 'half']) expect(text).not.toContain(gone)
  expect(files[MINE]).toBeDefined()
})

test('the pane refreshes every 5 seconds while open, and /inbox again closes it', async ($, on) => {
  const { files, clock, panes } = world(on)
  await start($)
  await $.command.run({ command: 'inbox', args: '' } as never)
  const ui = await pane($)
  expect(await textOf(ui)).toContain('Nothing is waiting on you.')
  const [path, body] = record('z', { project: 'gcdAtlas', title: 'late', state: 'approval', reason: 'wants to use Edit: a.ts', since: NOW })
  files[path] = body
  await clock.advance(5000)
  expect(await textOf(ui)).toContain('gcdAtlas · late Approval 5s wants to use Edit: a.ts')
  await $.command.run({ command: 'inbox', args: '' } as never)
  expect(panes.has('inbox')).toBe(false)
})

test('the footer stays as it is: the inbox draws nothing there, even with chats waiting', async ($, on) => {
  world(on, Object.fromEntries([record('a', { state: 'approval', reason: 'x' })]))
  await start($)
  await prompt($)
  await reply($, 'Done.', 1000)
  const ui = await footer($)
  expect(await ui.find({ key: 'inbox:count' })).toBeUndefined()
  expect(await ui.find({ key: 'engine' })).toBeDefined()
})

test('a closing chat leaves the list: its record turns idle', async ($, on) => {
  const { files } = world(on)
  await start($)
  await prompt($)
  await reply($, 'Done.', 1000)
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 'session-1', resume: {} } as never)
  expect(mine(files)).toMatchObject({ state: 'idle', reason: 'closed' })
})

test('a restarted chat keeps its title and starts idle, whatever its file last said', async ($, on) => {
  const [path, body] = record('session-1', { project: 'gcdTourney', title: 'attack alts', state: 'approval', reason: 'old', since: NOW - 60 * MIN, updatedAt: NOW - 60 * MIN })
  const { files } = world(on, { [path]: body })
  await start($)
  expect(mine(files)).toMatchObject({ title: 'attack alts', state: 'idle' })
})
