import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { NextCard, NextItem } from '../types'

// After a main turn of a minute or more, Haiku reads a short summary of it
// (what you asked, files changed, commands run, the final report) and
// suggests three next tasks. /next asks the same question over the whole
// conversation instead (a fork of the session, served from its prompt cache).

const MIN_TURN_MS = 60_000
const MODEL = 'haiku'

const card = atom({ plugin: 'next-tasks', key: 'card' } as const, null)
const DOCK_FOLDED = { plugin: 'mod-hub', key: 'isCollapsed' } as const
// Suggestions belong to the turn that made them: after this many prompts without new ones, they go.
const MAX_PROMPTS = 3
// An opened card folds back to the dock's N after this long with no answer.
const AUTO_HIDE_MS = 10_000

type TurnLog = { turnId: string; prompt: string; files: Set<string>; commands: string[] }

let turn: TurnLog | null = null
let promptsSince = 0
// Counts card writes, so a fold timer only acts on the opening that set it.
let openings = 0

const INSTRUCTIONS = [
  'Suggest the 3 best next tasks for this software project, given the work just done.',
  'Be concrete and specific to this project; never suggest something already done.',
  'Mix them: 1) continue or finish the current work, 2) a quality step (tests, review, docs, refactor, performance),',
  '3) a forward-looking step (next feature, risk to remove, or something to verify).',
  'Reply with JSON only, no prose: [{"title": "...", "why": "...", "prompt": "..."}].',
  'title: imperative, at most 60 characters. why: at most 90 characters, the payoff.',
  'prompt: the exact instruction to give a coding agent to do it, 1-3 sentences.',
].join(' ')

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text)

const projectOf = (dir: string) => {
  const main = dir.replace(/[\\/]\.claude[\\/]worktrees[\\/].*$/i, '')
  return main.split(/[\\/]/).filter(Boolean).pop() ?? main
}

const parseItems = (text: string): NextItem[] => {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return []
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as Partial<NextItem>[]
    return raw
      .filter(x => typeof x?.title === 'string' && typeof x?.prompt === 'string')
      .slice(0, 3)
      .map(x => ({ title: clip(x.title!.trim(), 60), why: clip((x.why ?? '').trim(), 110), prompt: x.prompt!.trim() }))
  } catch {
    return []
  }
}

const suggestFromSummary = async ($: EngineInterface, log: TurnLog, answer: string) => {
  const project = projectOf(await $.session.cwd())
  await update($, card, () => ({ project, items: [], isLoading: true, source: 'auto' as const, error: null, isOpen: false }))
  const files = [...log.files].slice(0, 25)
  const prompt = [
    `Project: ${project}`,
    `The person asked: ${clip(log.prompt, 1500)}`,
    files.length > 0 ? `Files changed: ${files.join(', ')}` : 'Files changed: none',
    log.commands.length > 0 ? `Commands run: ${log.commands.slice(-12).join(' | ')}` : '',
    `The agent's final report:\n${clip(answer, 3500)}`,
  ]
    .filter(Boolean)
    .join('\n\n')
  const r = await $.model.complete({ model: MODEL, system: INSTRUCTIONS, prompt, maxTokens: 700, timeoutMs: 45_000 })
  const items = r.isAnswered ? parseItems(r.text) : []
  void logAttempt($, { source: 'auto', isAnswered: r.isAnswered, reason: r.isAnswered ? null : r.reason, items: items.length, head: r.isAnswered ? r.text.slice(0, 200) : null }).catch(() => undefined)
  promptsSince = 0
  await update($, card, () =>
    items.length > 0
      ? { project, items, isLoading: false, source: 'auto' as const, error: null, isOpen: true }
      : null,
  )
  if (items.length > 0) foldLater($)
}

const suggestFromConversation = async ($: EngineInterface) => {
  const project = projectOf(await $.session.cwd())
  await update($, card, () => ({ project, items: [], isLoading: true, source: 'full' as const, error: null, isOpen: false }))
  const r = await $.model.fork({ prompt: INSTRUCTIONS })
  const items = r.isAnswered ? parseItems(r.text) : []
  void logAttempt($, { source: 'full', isAnswered: r.isAnswered, reason: r.isAnswered ? null : r.reason, items: items.length, head: r.isAnswered ? r.text.slice(0, 200) : null }).catch(() => undefined)
  promptsSince = 0
  const error = r.isAnswered ? (items.length === 0 ? 'the reply had no usable suggestions' : null) : `no answer (${r.reason})`
  await update($, card, () => ({ project, items, isLoading: false, source: 'full' as const, error, isOpen: true }))
  foldLater($)
}

// The last attempt's outcome, in mods-data/next-tasks/last.json, for when no card shows.
const logAttempt = async ($: EngineInterface, entry: Record<string, unknown>) => {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  const at = new Date(await $.clock.now()).toISOString()
  await $.fs.write(`${home.replace(/\\/g, '/')}/.claude/mods-data/next-tasks/last.json`, JSON.stringify({ at, ...entry }, null, 2))
}

// Called each time the card opens: it folds to N after AUTO_HIDE_MS unless it
// was opened again since (a newer timer owns it) or already folded or taken.
const foldLater = ($: EngineInterface) => {
  const mine = ++openings
  $.clock.after(AUTO_HIDE_MS, () => {
    if (mine === openings) void update($, card, cur => (cur?.isOpen ? { ...cur, isOpen: false } : cur)).catch(() => undefined)
  })
}

const take = async ($: EngineInterface, item: NextItem) => {
  await update($, card, () => null)
  // Put it in the prompt box to review; where the app has no fillable box, send it.
  const filled = await $.prompt.fill({ text: item.prompt }).catch(() => ({ isFilled: false }))
  if (!filled.isFilled) await $.prompt.submit({ text: item.prompt, asUser: true })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'next', description: 'Suggest 3 next tasks from the whole conversation' })
    // A load (or reload) drops whatever request the previous code had in flight;
    // a card still "loading" would wait forever, so it goes.
    await update($, card, c => (c?.isLoading ? null : c))
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'plugin') {
      // Collapse to the dock's badge; stale suggestions go after a few prompts.
      promptsSince += 1
      const isStale = promptsSince >= MAX_PROMPTS
      await update($, card, c => (!c || c.isLoading ? c : isStale ? null : c.isOpen ? { ...c, isOpen: false } : c))
    }
    return next(e)
  })

  on('turn.start', ($, e, next) => {
    turn = { turnId: e.turnId, prompt: e.text, files: new Set(), commands: [] }
    return next(e)
  })

  on('tool.call', { tool: ['Edit', 'Write', 'NotebookEdit', 'Bash', 'PowerShell'] }, ($, e, next) => {
    if (turn && e.agentId === undefined) {
      if (e.tool === 'Edit' || e.tool === 'Write') turn.files.add(e.file_path.replace(/\\/g, '/').split('/').slice(-3).join('/'))
      else if (e.tool === 'NotebookEdit') turn.files.add(e.notebook_path.replace(/\\/g, '/').split('/').pop() ?? '')
      else if (e.tool === 'Bash' || e.tool === 'PowerShell') turn.commands.push(clip(e.command.split('\n')[0] ?? '', 80))
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const log = turn
    if (e.agentId !== undefined) return done
    turn = null
    if (!log || log.turnId !== e.turnId || e.reason !== 'answer' || e.durationMs < MIN_TURN_MS || log.prompt.trim() === '') return done
    // Off the turn's own dispatch, so the reply is never held up.
    $.clock.after(10, () => void suggestFromSummary($, log, e.answer).catch(() => update($, card, () => null)))
    return done
  })

  on('command.run', { command: 'next' }, async $ => {
    $.clock.after(10, () => void suggestFromConversation($).catch(() => update($, card, () => null)))
    return { text: 'Working out 3 next tasks from the whole conversation…' }
  })

  // A press on the dock's Next button: open or fold the card.
  on('state.set', { plugin: 'mod-hub', key: 'signal' }, async ($, e, next) => {
    const done = await next(e)
    // Only a write that landed: update() retries a missed one, which would toggle twice.
    const sig = e.value as { target?: string; action?: string } | null
    if (done.value?.isSet !== true || !sig) return done
    if (sig.target === 'next-tasks') {
      const c = await read($, card)
      // Nothing yet: clicking N asks for suggestions now.
      if (!c) $.clock.after(10, () => void suggestFromConversation($).catch(() => update($, card, () => null)))
      else if (!c.isLoading) {
        await update($, card, cur => (cur ? { ...cur, isOpen: !cur.isOpen } : cur))
        if (!c.isOpen) foldLater($)
      }
    } else if (sig.action === 'review') {
      // Review: open the card, or work out suggestions when there are none yet.
      const c = await read($, card)
      if (c && !c.isLoading) {
        await update($, card, cur => (cur ? { ...cur, isOpen: true } : cur))
        foldLater($)
      } else if (!c) $.clock.after(10, () => void suggestFromConversation($).catch(() => update($, card, () => null)))
    }
    return done
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const c = await read($, card)
    if (!c || !c.isOpen || (await $.state.get(DOCK_FOLDED)).value === true) return next(e)
    const below = await next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Box key="next:card" flexDirection="column" marginBottom={1}>
          <Box flexDirection="row" gap={1}>
            <Text bold color="suggestion">
              Next
            </Text>
            <Box flexGrow={1} />
            <Button key="dismiss" label="✕" plain onPress={() => update($, card, () => null)} />
          </Box>
          {c.error !== null && <Text color="warning">Could not suggest: {c.error}</Text>}
          {c.items.map((item, i) => (
            // A bordered number and the task, one line; either one does the task.
            <Box key={`row:${i}`} flexDirection="row" gap={1} alignItems="center">
              <Button key={`num:${i}`} label={String(i + 1)} onPress={() => take($, item)} />
              <Button key={`do:${i}`} label={item.title} plain onPress={() => take($, item)} />
            </Box>
          ))}
        </Box>
        {below}
      </Box>
    )
  })
}
