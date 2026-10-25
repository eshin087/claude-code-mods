import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, TurnUsage } from 'claude-code'

import type { ChatSummary, ChatTimings, PromptRecord, PromptTokens } from '../types'

// How long each prompt took, with its tokens and what it would have cost at
// API prices: on the prompt's own row in the chat once its reply finishes
// (⏱ 3m 12s · 1.2M tokens · $0.84), and in a pane, /timings or T in the
// footer (T 1h42m: the chat's working time), with totals at the bottom and the
// project's past chats a click away. Each chat is kept in
// ~/.claude/mods-data/timings/<project>/<session>.json, so a restarted chat
// keeps its history.

const PANE = 'timings'
const ACCENT = '#22d3ee'
const GREY = '#9ca3af'
const REDRAW_MS = 30_000

const chat = atom({ plugin: 'timings', key: 'chat' } as const, null)
const isOpen = atom({ plugin: 'timings', key: 'isOpen' } as const, false)
const view = atom({ plugin: 'timings', key: 'view' } as const, 'chat')
const past = atom({ plugin: 'timings', key: 'past' } as const, [])

const ZERO: PromptTokens = { tokensIn: 0, tokensCached: 0, tokensOut: 0 }

// The prompt under way: when it started, the cost ledger then, and its subagents' tokens so far.
let running: { turnId: string; at: number; text: string; usdAtStart: number | null; extra: PromptTokens } | null = null

const tokensOf = (u: TurnUsage | undefined): PromptTokens =>
  u ? { tokensIn: u.input_tokens + u.cache_creation_input_tokens, tokensCached: u.cache_read_input_tokens, tokensOut: u.output_tokens } : ZERO
const plus = (a: PromptTokens, b: PromptTokens): PromptTokens => ({
  tokensIn: a.tokensIn + b.tokensIn,
  tokensCached: a.tokensCached + b.tokensCached,
  tokensOut: a.tokensOut + b.tokensOut,
})
const totalOf = (t: PromptTokens) => t.tokensIn + t.tokensCached + t.tokensOut

// A prompt's row is found again by its text: its length and its start.
const matchOf = (text: string) => `${text.length}:${text.slice(0, 200)}`
const firstLine = (text: string) => {
  const line = text.trim().split(/\r?\n/)[0] ?? ''
  return line.length > 120 ? `${line.slice(0, 119)}…` : line || '(continued)'
}

// 45s, 3m 12s, 1h 42m; `isShort` drops the space (1h42m) for the footer.
const duration = (ms: number, isShort = false) => {
  const s = Math.max(0, Math.round(ms / 1000))
  const sep = isShort ? '' : ' '
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return isShort ? `${m}m` : `${m}m${sep}${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h${sep}${String(m % 60).padStart(2, '0')}m`
}
const tokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))
const dollars = (n: number | null) => (n === null ? '—' : `$${n.toFixed(2)}`)
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dateOf = (t: number) => {
  const d = new Date(t)
  const h = d.getHours()
  const m = d.getMinutes()
  return `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()} ${h % 12 || 12}:${String(m).padStart(2, '0')}${h < 12 ? 'a' : 'p'}`
}

const projectOf = (dir: string) => {
  const main = dir.replace(/[\\/]\.claude[\\/]worktrees[\\/].*$/i, '')
  return main.split(/[\\/]/).filter(Boolean).pop() ?? main
}

const folderOf = async ($: EngineInterface, project: string) => {
  // CLAUDE_CONFIG_DIR (set when Claude's folder lives on another drive) wins over ~/.claude
  const dir = ((await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${(await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'}/.claude`).replace(/\\/g, '/')
  return `${dir}/mods-data/timings/${project}`
}

const save = async ($: EngineInterface, c: ChatTimings) => $.fs.write(`${await folderOf($, c.project)}/${c.sessionId}.json`, JSON.stringify(c))

const costNow = async ($: EngineInterface) => (await $.session.usage()).cost?.usd ?? null

const workedOf = (c: ChatTimings | null) => (c?.prompts ?? []).reduce((n, p) => n + p.durationMs, 0)

// Every chat of this project with a history file, newest first.
const loadPast = async ($: EngineInterface) => {
  const c = await read($, chat)
  if (!c) return
  const folder = await folderOf($, c.project)
  const list: ChatSummary[] = []
  for (const entry of await $.fs.list(folder).catch(() => [])) {
    if (!entry.name.endsWith('.json')) continue
    try {
      const other = JSON.parse(await $.fs.read(`${folder}/${entry.name}`)) as ChatTimings
      const costs = other.prompts.map(p => p.usd)
      list.push({
        sessionId: other.sessionId,
        startedAt: other.startedAt,
        title: other.prompts[0]?.prompt ?? '(no prompts)',
        prompts: other.prompts.length,
        workedMs: workedOf(other),
        tokens: other.prompts.reduce((n, p) => n + totalOf(p), 0),
        usd: costs.every(u => u === null) ? null : costs.reduce<number>((n, u) => n + (u ?? 0), 0),
      })
    } catch {
      // A file this mod didn't write, or half written: left out.
    }
  }
  list.sort((a, b) => b.startedAt - a.startedAt)
  await update($, past, () => list)
}

const togglePane = async ($: EngineInterface) => {
  if ((await $.ui.panes()).some(p => p.id === PANE)) {
    await $.ui.close({ id: PANE })
    // A plugin's own close does not reach its own ui.close hook: reset the flag here.
    await update($, isOpen, () => false)
    return 'Timings closed.'
  }
  await loadPast($)
  const opened = await $.ui.open({ id: PANE, title: 'Timings' })
  if (opened.isPlaced) await update($, isOpen, () => true)
  else $.ui.toast(`The timings pane could not open (${opened.reason}).`)
  return opened.isPlaced ? 'Timings opened.' : `Could not open the pane (${opened.reason}).`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'timings', description: "Each prompt's time, tokens and cost in this chat, with totals; past chats too" })
    const sessionId = await $.session.id()
    const project = projectOf(await $.session.cwd())
    const file = `${await folderOf($, project)}/${sessionId}.json`
    let saved: ChatTimings | null = null
    try {
      saved = JSON.parse(await $.fs.read(file)) as ChatTimings
    } catch {
      saved = null
    }
    const startedAt = (await $.session.usage()).startedAt
    await update($, chat, () => saved ?? { sessionId, project, startedAt, prompts: [] })
    // The footer's total and the chat's open time move on their own.
    $.clock.every(REDRAW_MS, () => $.ui.invalidate('ui.render'))
    return next(e)
  })

  on('command.run', { command: 'timings' }, async $ => ({ text: await togglePane($) }))

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const done = await next(e)
    await update($, isOpen, () => false)
    return done
  })

  on('turn.start', async ($, e, next) => {
    running = { turnId: e.turnId, at: await $.clock.now(), text: e.text, usdAtStart: await costNow($), extra: ZERO }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const used = tokensOf(done.usage ?? e.usage)
    // A subagent's turn: its tokens go to the prompt that ran it.
    if (e.agentId !== undefined) {
      if (running) running = { ...running, extra: plus(running.extra, used) }
      return done
    }
    if (!running || running.turnId !== e.turnId) return done
    const now = await costNow($)
    const r = running
    running = null
    const record: PromptRecord = {
      ...plus(used, r.extra),
      turnId: r.turnId,
      at: r.at,
      prompt: firstLine(r.text),
      match: matchOf(r.text),
      durationMs: e.durationMs,
      // To the hundredth of a cent: the ledger's difference carries float noise.
      usd: now === null || r.usdAtStart === null ? null : Math.max(0, Math.round((now - r.usdAtStart) * 10_000) / 10_000),
    }
    await update($, chat, c => (c ? { ...c, prompts: [...c.prompts, record] } : c))
    const c = await read($, chat)
    if (c) await save($, c)
    $.ui.invalidate('ui.render')
    return done
  })

  // Each finished prompt's row in the chat gets a line: its time, tokens and cost.
  // The row's text is what's rewritten (drawn on every surface); the stored message stays.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const c = await read($, chat)
    const key = matchOf(e.props.text)
    const r = c?.prompts.findLast(p => p.match === key)
    if (!r) return next(e)
    const usd = r.usd === null ? '' : ` · ${dollars(r.usd)}`
    return next({ ...e, props: { ...e.props, text: `${e.props.text}\n⏱ ${duration(r.durationMs)} · ${tokens(totalOf(r))} tokens${usd}` } })
  })

  // T in the footer: the chat's working time so far, a press opens or closes the pane.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const below = await next(e)
    const { Box, Button } = $.ui.resolve(e)
    // Just an orange diamond: it toggles the pane, and the pane has the times.
    return (
      <Box flexDirection="row" gap={1}>
        {below}
        <Button key="timings:t" label="🔸" plain dimColor onPress={() => togglePane($)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const c = await read($, chat)
    const v = await read($, view)
    const now = await $.clock.now()
    const prompts = c?.prompts ?? []

    // One row of a table: fixed columns, the text column takes the rest and is
    // cut with "…". The head is grey; the total is bold, its numbers in their columns.
    type Cells = { n: string; text: string; time: string; tokens: string; cost: string }
    const row = (key: string, cells: Cells, kind: 'head' | 'body' | 'total' = 'body') => {
      const isHead = kind === 'head'
      const isTotal = kind === 'total'
      return (
        <Box key={key} flexDirection="row" gap={1}>
          <Box width={4} flexShrink={0}>
            <Text color={GREY}>{cells.n}</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Text bold={isTotal} color={isHead ? GREY : undefined} wrap="truncate-end">
              {cells.text}
            </Text>
          </Box>
          <Box width={9} flexShrink={0}>
            <Text bold={isTotal} color={isHead ? GREY : ACCENT}>
              {cells.time}
            </Text>
          </Box>
          <Box width={8} flexShrink={0}>
            <Text bold={isTotal} color={isTotal ? undefined : GREY}>
              {cells.tokens}
            </Text>
          </Box>
          <Box width={8} flexShrink={0}>
            <Text bold={isTotal} color={isTotal ? undefined : GREY}>
              {cells.cost}
            </Text>
          </Box>
        </Box>
      )
    }
    // A thin rule above the total, cut to the pane's width.
    const rule = (
      <Text color={GREY} wrap="truncate-end">
        {'─'.repeat(240)}
      </Text>
    )
    // The details under the table: a grey label column, the value beside it.
    const detail = (key: string, label: string, value: RenderChildren) => (
      <Box key={key} flexDirection="row" gap={1}>
        <Box width={11} flexShrink={0}>
          <Text color={GREY}>{label}</Text>
        </Box>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          {value}
        </Box>
      </Box>
    )
    // 50k fresh · 1.1M cached · 20k out: the numbers full strength, the words grey.
    const breakdown = (t: PromptTokens) => (
      <Text wrap="truncate-end">
        {tokens(t.tokensIn)}
        <Text color={GREY}> fresh · </Text>
        {tokens(t.tokensCached)}
        <Text color={GREY}> cached · </Text>
        {tokens(t.tokensOut)}
        <Text color={GREY}> out</Text>
      </Text>
    )

    const tabs = (
      <Box flexDirection="row" gap={1}>
        <Text bold color={ACCENT}>
          Timings
        </Text>
        <Button key="view:chat" label="This chat" variant={v === 'chat' ? 'primary' : 'secondary'} onPress={() => update($, view, () => 'chat' as const)} />
        <Button key="view:past" label="Past chats" variant={v === 'past' ? 'primary' : 'secondary'} onPress={async () => (await loadPast($), update($, view, () => 'past' as const))} />
        <Box flexGrow={1} />
        <Button key="close" label="Close" role="dismiss" onPress={() => togglePane($)} />
      </Box>
    )

    if (v === 'past') {
      const list = await read($, past)
      const usd = list.every(p => p.usd === null) ? null : list.reduce((n, p) => n + (p.usd ?? 0), 0)
      return (
        <Box flexDirection="column" gap={1}>
          {tabs}
          <Box flexDirection="column">
            {row('head', { n: '', text: `Chats in ${c?.project ?? 'this project'}`, time: 'Worked', tokens: 'Tokens', cost: 'Cost' }, 'head')}
            {list.map(p =>
              row(`chat:${p.sessionId}`, {
                n: p.sessionId === c?.sessionId ? '▸' : '',
                text: `${dateOf(p.startedAt)} · ${p.prompts} ${p.prompts === 1 ? 'prompt' : 'prompts'} · ${p.title}`,
                time: duration(p.workedMs),
                tokens: tokens(p.tokens),
                cost: dollars(p.usd),
              }),
            )}
            {rule}
            {row(
              'total',
              {
                n: '',
                text: `Total · ${list.length} ${list.length === 1 ? 'chat' : 'chats'}`,
                time: duration(list.reduce((n, p) => n + p.workedMs, 0)),
                tokens: tokens(list.reduce((n, p) => n + p.tokens, 0)),
                cost: dollars(usd),
              },
              'total',
            )}
          </Box>
        </Box>
      )
    }

    const sum = prompts.reduce((t, p) => plus(t, p), ZERO)
    const costs = prompts.map(p => p.usd)
    const usd = costs.length === 0 || costs.every(u => u === null) ? null : costs.reduce<number>((n, u) => n + (u ?? 0), 0)
    return (
      <Box flexDirection="column" gap={1}>
        {tabs}
        <Box flexDirection="column">
          {row('head', { n: '#', text: 'Prompt', time: 'Time', tokens: 'Tokens', cost: 'Cost' }, 'head')}
          {prompts.length === 0 && <Text color={GREY}>No finished prompts yet in this chat.</Text>}
          {prompts.map((p, i) =>
            row(`prompt:${p.turnId}`, { n: String(i + 1), text: p.prompt, time: duration(p.durationMs), tokens: tokens(totalOf(p)), cost: dollars(p.usd) }),
          )}
          {rule}
          {row(
            'total',
            {
              n: '',
              text: `Total · ${prompts.length} ${prompts.length === 1 ? 'prompt' : 'prompts'}`,
              time: duration(workedOf(c)),
              tokens: tokens(totalOf(sum)),
              cost: dollars(usd),
            },
            'total',
          )}
        </Box>
        <Box flexDirection="column">
          {detail('open', 'Chat open', <Text>{duration(c ? now - c.startedAt : 0)}</Text>)}
          {detail('tokens', 'Tokens', breakdown(sum))}
          {detail(
            'cost',
            'Cost',
            <Text wrap="truncate-end">
              {dollars(usd)}
              <Text color={GREY}> at API prices (what /cost shows)</Text>
            </Text>,
          )}
        </Box>
      </Box>
    )
  })
}
