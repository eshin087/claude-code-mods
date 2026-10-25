import type { EngineInterface, Register, Timer } from 'claude-code'

import type { InboxRecord, InboxState } from '../types'

// Which chats are waiting on you, across every chat and project on this
// computer. Each chat keeps one small file, ~/.claude/mods-data/inbox/<session>.json,
// saying where it stands (a permission prompt up, a question asked, a reply
// finished and unanswered, working, idle) and why. Every chat reads the whole
// folder, so /inbox in any chat lists what waits in all of them, and a
// notification goes out once when a chat starts waiting.

const PANE = 'inbox'
// A chat that closed without saying so must not haunt the list forever.
const STALE_MS = 12 * 3_600_000
// A reply this long is one you probably walked away from: its end is worth a notification.
const LONG_TURN_MS = 2 * 60_000
// The pane, while open, re-reads the folder this often.
const PANE_REFRESH_MS = 5_000
const TITLE_MAX = 60
const REASON_MAX = 140

const ACCENT = '#22d3ee'
const AMBER = '#facc15'
const GREEN = '#4ade80'
const GREY = '#9ca3af'

const STATES: readonly InboxState[] = ['approval', 'question', 'done', 'working', 'idle']
const LABEL: Record<InboxState, string> = { approval: 'Approval', question: 'Question', done: 'Done', working: 'Working', idle: 'Idle' }
const COLOR: Record<InboxState, string> = { approval: AMBER, question: ACCENT, done: GREEN, working: GREY, idle: GREY }

// This chat's own record: the freshest copy, written to its file on every change.
let me: InboxRecord | null = null
// Every chat's record from the folder, this one's replaced by `me`. Render reads only this.
let records: InboxRecord[] = []
let paneTimer: Timer | null = null
let isPaneOpen = false

// The tool calls under way, by id, so a permission prompt can be tied to its call
// and cleared when that call (and not another running beside it) goes ahead.
const running = new Map<string, string>()
let approvalFor: { id?: string; tool?: string } | null = null
let questionFor: string | null = null

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)
// The first line of a text, its markdown marks taken off: a title or a reason.
const firstLine = (text: string, max: number) => {
  const line = (text.trim().split(/\r?\n/)[0] ?? '').replace(/^[#>*\-\s]+/, '').replace(/\*\*|__|`/g, '').trim()
  return cut(line, max)
}

// 45s, 12m, 1h 05m: how long a chat has waited.
const waited = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}
// 3m 12s: how long a reply took, for its notification.
const took = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

// Same as the timings mod: a worktree's chats belong to the repository it was made from.
const projectOf = (dir: string) => {
  const main = dir.replace(/[\\/]\.claude[\\/]worktrees[\\/].*$/i, '')
  return main.split(/[\\/]/).filter(Boolean).pop() ?? main
}

const folderOf = async ($: EngineInterface) => {
  // CLAUDE_CONFIG_DIR (set when Claude's folder lives on another drive) wins over ~/.claude
  const dir = ((await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${(await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'}/.claude`).replace(/\\/g, '/')
  return `${dir}/mods-data/inbox`
}

// What a tool call is, in a few words: "Bash: npm run pr -- merge", "Edit: register.tsx".
const describe = (tool: string, input: unknown) => {
  const args = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const text = (key: string) => (typeof args[key] === 'string' ? (args[key] as string) : '')
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool)
  if (mcp) return `${mcp[2]} (${mcp[1]})`
  if (text('command')) return `${tool}: ${firstLine(text('command'), 80)}`
  const file = text('file_path') || text('notebook_path') || text('path')
  if (file) return `${tool}: ${file.split(/[\\/]/).pop()}`
  if (text('url')) return `${tool}: ${text('url').replace(/^https?:\/\//, '').split('/')[0]}`
  if (tool === 'ExitPlanMode') return 'its plan'
  return tool
}
const verbOf = (tool: string) => (/^(Bash|PowerShell)$/.test(tool) ? 'run' : tool === 'ExitPlanMode' ? 'go ahead with' : 'use')

// The first question an AskUserQuestion call asks.
const questionOf = (input: unknown) => {
  const qs = input && typeof input === 'object' ? (input as { questions?: unknown }).questions : undefined
  const first = Array.isArray(qs) ? (qs[0] as { question?: unknown } | undefined) : undefined
  return typeof first?.question === 'string' ? firstLine(first.question, REASON_MAX) : 'Claude asked you something'
}

const isRecord = (r: unknown): r is InboxRecord => {
  if (!r || typeof r !== 'object') return false
  const x = r as Record<string, unknown>
  return (
    typeof x.sessionId === 'string' &&
    typeof x.project === 'string' &&
    typeof x.title === 'string' &&
    typeof x.reason === 'string' &&
    STATES.includes(x.state as InboxState) &&
    typeof x.since === 'number' &&
    typeof x.updatedAt === 'number'
  )
}

// The chats worth showing: idle ones never; anything unwritten for 12 hours is a
// chat that closed without saying so.
const visible = (list: readonly InboxRecord[], now: number) => list.filter(r => r.state !== 'idle' && now - r.updatedAt <= STALE_MS)

// This chat's record, from memory, else its file (a resumed chat, a reloaded mod), else new.
// After a /clear the session id changes: that is a new chat with a record of its own.
const mine = async ($: EngineInterface) => {
  const sessionId = await $.session.id()
  if (me && me.sessionId === sessionId) return me
  const now = await $.clock.now()
  let saved: InboxRecord | null = null
  try {
    const parsed: unknown = JSON.parse(await $.fs.read(`${await folderOf($)}/${sessionId}.json`))
    saved = isRecord(parsed) ? parsed : null
  } catch {
    saved = null
  }
  me = saved ?? { sessionId, project: projectOf(await $.session.cwd()), title: '', state: 'idle', reason: '', since: now, updatedAt: now }
  return me
}

const save = async ($: EngineInterface, r: InboxRecord) => {
  me = r
  records = [...records.filter(x => x.sessionId !== r.sessionId), r]
  try {
    const folder = await folderOf($)
    // Whatever is newest by the time the write goes out: two changes close together
    // must not leave the older one in the file.
    const latest = me && me.sessionId === r.sessionId ? me : r
    await $.fs.write(`${folder}/${r.sessionId}.json`, JSON.stringify(latest))
  } catch {
    // A folder we can't write to: this chat just stays out of the other chats' lists.
  }
  $.ui.invalidate('ui.render')
}

const notify = async ($: EngineInterface, r: InboxRecord, text: string) => {
  try {
    await $.ui.notify(text, { title: r.title ? `${r.project} · ${r.title}` : r.project })
  } catch {
    // A hook above refused it: /inbox still says so.
  }
}

// Moves this chat to a state: `from`, when given, the states it may move from.
// Only a real change of state is written, and only that change raises its
// notification, so nothing is ever announced twice. The check and the change
// sit with no wait between them, so two events arriving together can't both pass.
const moveTo = async ($: EngineInterface, state: InboxState, reason: string, opts: { notice?: string; from?: readonly InboxState[] } = {}) => {
  const now = await $.clock.now()
  const r = await mine($)
  if (r.state === state || (opts.from && !opts.from.includes(r.state))) return
  const next: InboxRecord = { ...r, state, reason: cut(reason, REASON_MAX), since: now, updatedAt: now }
  me = next
  await save($, next)
  if (opts.notice) await notify($, next, opts.notice)
}

const setTitle = async ($: EngineInterface, title: string) => {
  const now = await $.clock.now()
  const r = await mine($)
  if (!title || r.title === title) return
  await save($, { ...r, title, updatedAt: now })
}

// Every record in the folder. A file half written by another chat, or one this
// mod didn't write, is skipped this round and read again on the next.
const loadAll = async ($: EngineInterface) => {
  const folder = await folderOf($)
  const list: InboxRecord[] = []
  for (const entry of await $.fs.list(folder).catch(() => [])) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
    try {
      const parsed: unknown = JSON.parse(await $.fs.read(`${folder}/${entry.name}`))
      if (isRecord(parsed)) list.push(parsed)
    } catch {
      // Half written or not ours: left out.
    }
  }
  records = me ? [...list.filter(r => r.sessionId !== me!.sessionId), me] : list
}

// Re-reads the folder; redraws while the pane shows it.
const refresh = async ($: EngineInterface) => {
  await loadAll($)
  if (isPaneOpen) $.ui.invalidate('ui.render')
}

const togglePane = async ($: EngineInterface) => {
  if ((await $.ui.panes()).some(p => p.id === PANE)) {
    await $.ui.close({ id: PANE })
    // A plugin's own close does not reach its own ui.close hook: stop the clock here.
    isPaneOpen = false
    paneTimer?.cancel()
    paneTimer = null
    return 'Inbox closed.'
  }
  await refresh($)
  const opened = await $.ui.open({ id: PANE, title: 'Inbox' })
  if (!opened.isPlaced) {
    $.ui.toast(`The inbox could not open (${opened.reason}).`)
    return `Could not open the inbox (${opened.reason}).`
  }
  isPaneOpen = true
  paneTimer?.cancel()
  paneTimer = $.clock.every(PANE_REFRESH_MS, () => void refresh($).catch(() => undefined))
  $.ui.invalidate('ui.render')
  return 'Inbox opened.'
}

// After a tool call ends (it ran, or was refused): a permission prompt or a
// question that was about this call is over, and the reply goes on.
const afterCall = async ($: EngineInterface, id: string, tool: string) => {
  if (questionFor === id) {
    questionFor = null
    await moveTo($, 'working', '', { from: ['question'] })
  }
  const a = approvalFor
  if (a && (a.id === id || (a.id === undefined && (a.tool === undefined || a.tool === tool)))) {
    approvalFor = null
    await moveTo($, 'working', '', { from: ['approval'] })
  }
}

// A prompt already up (an approval or a question) is the one the person sees: a
// second one beside it changes nothing until that one is answered.
const NOT_WAITING: readonly InboxState[] = ['working', 'done', 'idle']

const startApproval = async ($: EngineInterface, tool: string, input: unknown, reason?: string) => {
  if (!NOT_WAITING.includes((await mine($)).state)) return
  // The call it's about: the newest under way of that tool (the prompt names none by id).
  const ids = [...running.entries()].filter(([, t]) => t === tool || tool === '').map(([id]) => id)
  approvalFor = { id: ids.at(-1), tool: tool || undefined }
  const what = describe(tool, input)
  await moveTo($, 'approval', reason ?? `wants to ${verbOf(tool)} ${what}`, { notice: `Needs your approval: ${reason ?? what}`, from: NOT_WAITING })
}

const startQuestion = ($: EngineInterface, text: string) => moveTo($, 'question', text, { notice: `Asks you: ${text}`, from: NOT_WAITING })

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'inbox', description: 'Which of your chats, in every project, are waiting on you and why' })
    // A fresh process has no prompt up and no reply under way, whatever the file last said.
    me = null
    const r = await mine($)
    if (r.state !== 'idle') await save($, { ...r, state: 'idle', reason: '', since: await $.clock.now(), updatedAt: await $.clock.now() })
    await refresh($)
    return next(e)
  })

  // The chat's own title, where the engine passes one (a renamed or titled chat).
  on('classic.SessionStart', async ($, e, next) => {
    const done = await next(e)
    if (e.session_title) await setTitle($, cut(e.session_title.trim(), TITLE_MAX))
    return done
  })
  on('classic.UserPromptSubmit', async ($, e, next) => {
    const done = await next(e)
    if (e.session_title) await setTitle($, cut(e.session_title.trim(), TITLE_MAX))
    return done
  })

  on('command.run', { command: 'inbox' }, async $ => {
    return { text: await togglePane($) }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const done = await next(e)
    isPaneOpen = false
    paneTimer?.cancel()
    paneTimer = null
    return done
  })

  // Your prompt starts a reply: whatever waited on you is answered.
  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    running.clear()
    approvalFor = null
    questionFor = null
    const r = await mine($)
    if (!r.title && e.text.trim()) await setTitle($, firstLine(e.text, TITLE_MAX))
    await moveTo($, 'working', '')
    return next(e)
  })

  // The main reply finished: your turn, until your next prompt. A stopped reply
  // means you're there already. A long one gets a notification.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) return done
    running.clear()
    approvalFor = null
    questionFor = null
    if (e.isAborted) {
      await moveTo($, 'idle', '')
      return done
    }
    const reason = firstLine(e.answer, REASON_MAX) || (e.reason === 'answer' ? 'Finished' : 'Stopped on an error')
    await moveTo($, 'done', reason, { notice: e.durationMs >= LONG_TURN_MS ? `Done after ${took(e.durationMs)}: ${reason}` : undefined })
    return done
  })

  // Each tool call: AskUserQuestion is a question until it's answered; any call a
  // permission prompt was about is over once the call goes ahead or is refused.
  on('tool.call', async ($, e, next) => {
    const id = e.tool_use_id
    const tool = String(e.tool)
    running.set(id, tool)
    if (e.tool === 'AskUserQuestion' && e.agentId === undefined) {
      questionFor = id
      await startQuestion($, questionOf(e))
    }
    try {
      return await next(e)
    } finally {
      running.delete(id)
      await afterCall($, id, tool).catch(() => undefined)
    }
  })

  // A permission prompt is about to show (unless a settings hook answered it).
  on('classic.PermissionRequest', async ($, e, next) => {
    const done = await next(e)
    if (done.decision || done.block) return done
    if (e.tool_name === 'AskUserQuestion') await startQuestion($, questionOf(e.tool_input))
    else await startApproval($, e.tool_name, e.tool_input)
    return done
  })

  // The engine's own "needs your attention" notices: a backup for the prompt above,
  // and an MCP server's form. A plugin's own notification (ours too) is left alone.
  on('classic.Notification', async ($, e, next) => {
    const done = await next(e)
    if (e.notification_type === 'permission_prompt') await startApproval($, '', undefined, firstLine(e.message, REASON_MAX) || 'needs your permission')
    else if (e.notification_type === 'elicitation_dialog') await startQuestion($, firstLine(e.message, REASON_MAX) || 'An MCP server asks you something')
    return done
  })

  on('classic.Elicitation', async ($, e, next) => {
    const done = await next(e)
    if (!done.block) await startQuestion($, firstLine(e.message, REASON_MAX) || `${e.mcp_server_name} asks you something`)
    return done
  })
  on('classic.ElicitationResult', async ($, e, next) => {
    const done = await next(e)
    await moveTo($, 'working', '', { from: ['question'] })
    return done
  })

  // The chat is closing: it leaves the list (idle is never shown). The record
  // stays as a small file; nothing in $.fs deletes one.
  on('session.end', async ($, e, next) => {
    try {
      const r = await mine($)
      const now = await $.clock.now()
      if (r.sessionId === e.sessionId) await save($, { ...r, state: 'idle', reason: 'closed', since: now, updatedAt: now })
    } catch {
      // The session is going either way.
    }
    // After a /clear the chat goes on under a new id: a new record.
    me = null
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const now = await $.clock.now()
    const shown = visible(records, now)
    const oldestFirst = (a: InboxRecord, b: InboxRecord) => a.since - b.since
    const needs = shown.filter(r => r.state === 'approval' || r.state === 'question').sort(oldestFirst)
    const yours = shown.filter(r => r.state === 'done').sort(oldestFirst)
    const working = shown.filter(r => r.state === 'working').length
    const cols = e.props.bodyColumns
    const nameWidth = Math.max(16, Math.min(40, Math.floor(cols * 0.35)))

    // One chat: ▸ for this one, project · title, the state, how long, why.
    const row = (r: InboxRecord) => (
      <Box key={`chat:${r.sessionId}`} flexDirection="row" gap={1}>
        <Box width={1} flexShrink={0}>
          <Text color={ACCENT}>{r.sessionId === me?.sessionId ? '▸' : ' '}</Text>
        </Box>
        <Box width={nameWidth} flexShrink={0}>
          <Text wrap="truncate-end">{r.title ? `${r.project} · ${r.title}` : r.project}</Text>
        </Box>
        <Box width={8} flexShrink={0}>
          <Text bold color={COLOR[r.state]}>
            {LABEL[r.state]}
          </Text>
        </Box>
        <Box width={7} flexShrink={0}>
          <Text color={GREY}>{waited(now - r.since)}</Text>
        </Box>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text wrap="truncate-end">{r.reason}</Text>
        </Box>
      </Box>
    )
    const group = (key: string, heading: string, list: InboxRecord[]) =>
      list.length > 0 && (
        <Box key={key} flexDirection="column">
          <Text bold>{heading}</Text>
          {list.map(row)}
        </Box>
      )

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1}>
          <Text bold color={ACCENT}>
            Inbox
          </Text>
          <Box flexGrow={1} />
          <Button key="close" label="Close" role="dismiss" onPress={() => togglePane($)} />
        </Box>
        {needs.length === 0 && yours.length === 0 && <Text color={GREY}>Nothing is waiting on you.</Text>}
        {group('needs', 'Needs you', needs)}
        {group('yours', 'Your turn', yours)}
        {working > 0 && <Text color={GREY}>{`${working} ${working === 1 ? 'chat' : 'chats'} working`}</Text>}
      </Box>
    )
  })
}
