// Timings tests: `claude plugin test` in this folder. The clock, the cost
// ledger, the files and the panes are the test's.
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const NOW = new Date(2026, 9, 12, 14, 0).getTime()
const HOME = 'C:/Users/test'
const FOLDER = `${HOME}/.claude/mods-data/timings/gcdAtlas`
const PANE_PROPS = { title: 'Timings', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const

const world = (on: On, files: Record<string, string> = {}) => {
  const clock = mock.clock(on, { now: NOW })
  const ledger = { usd: 1 }
  const panes = new Set<string>()
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
  on('session.cwd', () => ({ value: 'C:/x/gcdAtlas' }))
  on('session.usage', () => ({ value: { startedAt: NOW - 3 * 3_600_000, context: { window: 200_000 }, rateLimits: [], cost: { usd: ledger.usd } } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer, usage: e.usage }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.panes', () => ({ value: [...panes].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  on('ui.open', ($, e) => {
    panes.add(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    panes.delete(e.id)
    return { value: undefined }
  })
  // The engine's own drawing: a prompt row shows its text; elsewhere nothing.
  on('ui.render', ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return e.component === 'UserMessage' ? <Text>{(e.props as { text: string }).text}</Text> : <Box key="engine" />
  })
  return { clock, ledger, files, panes }
}

const usage = (fresh: number, cached: number, out: number) => ({ input_tokens: fresh, cache_creation_input_tokens: 0, cache_read_input_tokens: cached, output_tokens: out, model: 'claude-opus-5-5' })
const start = ($: Engine) => $.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })

// One prompt of 3m 12s that cost $0.84, with a subagent's tokens inside it.
const onePrompt = async ($: Engine, ledger: { usd: number }, text = 'fix the footer colors\nand the divider') => {
  await $.turn.start({ text, turnId: 't1' })
  await $.turn.complete({ answer: 'ok', durationMs: 1000, isAborted: false, turnId: 'a1', agentId: 'agent-1', reason: 'answer', usage: usage(20_000, 180_000, 5_000) } as never)
  ledger.usd = 1.84
  await $.turn.complete({ answer: 'done', durationMs: 192_000, isAborted: false, turnId: 't1', reason: 'answer', usage: usage(30_000, 950_000, 15_000) } as never)
}

const strings = (n: unknown): string[] =>
  typeof n === 'string' ? [n] : n && typeof n === 'object' ? ((n as { children?: unknown[] }).children ?? []).flatMap(strings) : []
const pageText = async (ui: { drawn: () => Promise<unknown> }) => strings(await ui.drawn()).join(' ').replace(/\s+/g, ' ')
const pane = ($: Engine) => $.ui.mount({ plugin: 'timings', surface: 'desktop', component: 'Pane', requestId: 'timings', props: PANE_PROPS })

test("a finished prompt is kept: its time, its tokens (its subagents' too) and its cost, in this chat's file", async ($, on) => {
  const { ledger, files } = world(on)
  await start($)
  await onePrompt($, ledger)
  const saved = JSON.parse(files[`${FOLDER}/session-1.json`]!) as { prompts: Record<string, unknown>[] }
  expect(saved.prompts).toEqual([
    {
      turnId: 't1', at: NOW, prompt: 'fix the footer colors', match: `37:fix the footer colors\nand the divider`, durationMs: 192_000,
      tokensIn: 50_000, tokensCached: 1_130_000, tokensOut: 20_000, usd: 0.84,
    },
  ])
})

test("the prompt's row in the chat gets a line under it: time, tokens and cost", async ($, on) => {
  const { ledger } = world(on)
  await start($)
  const row = (text: string) => $.ui.mount({ plugin: 'timings', surface: 'desktop', component: 'UserMessage', props: { text, origin: { kind: 'composer' }, isExpanded: false } as never })
  const text = 'fix the footer colors\nand the divider'
  expect(strings(await (await row(text)).drawn()).join('')).toBe(text)
  await onePrompt($, ledger, text)
  expect(strings(await (await row(text)).drawn()).join('')).toBe(`${text}\n⏱ 3m 12s · 1.2M tokens · $0.84`)
  // Another prompt's row is left alone.
  expect(strings(await (await row('something else')).drawn()).join('')).toBe('something else')
})

test("the footer's 🔸 button opens the pane on a press, another closes it", async ($, on) => {
  const { ledger, panes } = world(on)
  await start($)
  await onePrompt($, ledger)
  const footer = await $.ui.mount({ plugin: 'timings', surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
  expect((await footer.find({ key: 'timings:t' }))?.props).toMatchObject({ label: '🔸', plain: true })
  await footer.press({ key: 'timings:t' })
  expect(panes.has('timings')).toBe(true)
  await footer.press({ key: 'timings:t' })
  expect(panes.has('timings')).toBe(false)
})

test('the pane lists each prompt with its time, tokens and cost, and totals at the bottom', async ($, on) => {
  const { ledger } = world(on)
  await start($)
  await onePrompt($, ledger)
  expect(((await $.command.run({ command: 'timings', args: '' } as never)) as { text?: string }).text).toBe('Timings opened.')
  const text = await pageText(await pane($))
  expect(text).toMatch(/# Prompt Time Tokens Cost 1 fix the footer colors 3m 12s 1\.2M \$0\.84/)
  // The total's numbers sit in the table's columns, under a rule; the details below.
  expect(text).toMatch(/\$0\.84 ─+ Total · 1 prompt 3m 12s 1\.2M \$0\.84 /)
  expect(text).toMatch(/Chat open 3h 00m Tokens 50k fresh · 1\.1M cached · 20k out Cost \$0\.84 at API prices/)
})

test('a restarted chat keeps its history from its file', async ($, on) => {
  const kept = { sessionId: 'session-1', project: 'gcdAtlas', startedAt: NOW - 3_600_000, prompts: [{ turnId: 'old', at: NOW - 3_000_000, prompt: 'earlier prompt', match: '14:earlier prompt', durationMs: 60_000, tokensIn: 1000, tokensCached: 0, tokensOut: 500, usd: 0.1 }] }
  world(on, { [`${FOLDER}/session-1.json`]: JSON.stringify(kept) })
  await start($)
  await $.command.run({ command: 'timings', args: '' } as never)
  expect(await pageText(await pane($))).toMatch(/1 earlier prompt 1m 00s 2k \$0\.10/)
})

test("Past chats lists this project's chats, newest first, with their totals", async ($, on) => {
  const other = { sessionId: 'session-0', project: 'gcdAtlas', startedAt: new Date(2026, 9, 10, 9, 30).getTime(), prompts: [{ turnId: 'x', at: 0, prompt: 'set up the repo', match: '', durationMs: 600_000, tokensIn: 10_000, tokensCached: 0, tokensOut: 0, usd: 1.5 }] }
  const { ledger } = world(on, { [`${FOLDER}/session-0.json`]: JSON.stringify(other) })
  await start($)
  await onePrompt($, ledger)
  await $.command.run({ command: 'timings', args: '' } as never)
  const ui = await pane($)
  await ui.press({ key: 'view:past' })
  const text = await pageText(ui)
  expect(text).toMatch(/Chats in gcdAtlas Worked Tokens Cost ▸ Mon Oct 12 11:00a · 1 prompt · fix the footer colors 3m 12s 1\.2M \$0\.84 Sat Oct 10 9:30a · 1 prompt · set up the repo 10m 00s 10k \$1\.50/)
  expect(text).toMatch(/─+ Total · 2 chats 13m 12s 1\.2M \$2\.34$/)
})
