import type { EngineInterface, Register } from 'claude-code'

// One record per finished main-loop turn. Each session writes its own file
// (mods-data/turn-timer/<session>.json), so parallel sessions never overwrite
// each other; /timings reads them all.
type Entry = {
  at: number
  project: string
  session: string
  prompt: string
  ms: number
  tools: number
  outTokens: number
  model: string
  end: string
}

type Turn = { turnId: string; prompt: string; tools: number }

const MAX_PER_SESSION = 2000

const fmt = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

const kTok = (n: number) =>
  n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)

// claude-opus-5-5 -> Opus 5.5
const prettyModel = (id: string) => {
  const m = /claude-([a-z]+)-(\d+)-(\d+)/.exec(id)
  return m ? `${m[1]![0]!.toUpperCase()}${m[1]!.slice(1)} ${m[2]}.${m[3]}` : id
}

// A worktree under <repo>/.claude/worktrees/<name> still counts as <repo>.
const projectOf = (dir: string) => {
  const main = dir.replace(/[\\/]\.claude[\\/]worktrees[\\/].*$/i, '')
  return main.split(/[\\/]/).filter(Boolean).pop() ?? main
}

const oneLine = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

const pad2 = (n: number) => String(n).padStart(2, '0')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const stamp = (ms: number) => {
  const d = new Date(ms)
  return `${MONTHS[d.getMonth()]} ${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

const dataDir = async ($: EngineInterface) => {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  return `${home.replace(/\\/g, '/')}/.claude/mods-data/turn-timer`
}

const readAll = async ($: EngineInterface): Promise<Entry[]> => {
  const dir = await dataDir($)
  if (!(await $.fs.exists(dir))) return []
  const files = (await $.fs.list(dir)).filter(f => f.name.endsWith('.json'))
  const all: Entry[] = []
  for (const f of files) {
    try {
      const list = JSON.parse(await $.fs.read(`${dir}/${f.name}`)) as Entry[]
      all.push(...list)
    } catch {
      // a file mid-write or hand-edited: skip it
    }
  }
  return all.sort((a, b) => a.at - b.at)
}

const median = (xs: number[]) => {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]!
}

export const register: Register = on => {
  let turn: Turn | null = null
  let mine: Entry[] | null = null

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'timings',
      description: 'How long your prompts took: this project, or "all"',
      argumentHint: '[all | <count>]',
    })
    return next(e)
  })

  on('turn.start', ($, e, next) => {
    turn = { turnId: e.turnId, prompt: e.text, tools: 0 }
    return next(e)
  })

  on('tool.call', ($, e, next) => {
    if (e.agentId === undefined && turn) turn.tools += 1
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) return done

    const tools = turn?.turnId === e.turnId ? turn.tools : 0
    const prompt = turn?.turnId === e.turnId ? turn.prompt : ''
    turn = null

    const outTokens = e.usage?.output_tokens ?? 0
    const model = e.usage?.model ?? (await $.session.model())
    const end = e.isAborted ? 'interrupted' : e.reason === 'answer' ? 'done' : e.reason

    const parts = [`⏱ ${fmt(e.durationMs)}`]
    if (tools > 0) parts.push(`${tools} tool call${tools === 1 ? '' : 's'}`)
    if (outTokens > 0) parts.push(`${kTok(outTokens)} tokens written`)
    parts.push(prettyModel(model))
    if (end !== 'done') parts.push(`(${end})`)

    // A system row is stored in the transcript (so it is there when the session
    // is reopened) and the model never reads it.
    void $.session
      .append({ message: { type: 'system', content: [{ type: 'text', text: parts.join(' · ') }] } })
      .catch(() => $.ui.log(parts.join(' · ')))

    void (async () => {
      const session = await $.session.id()
      const dir = await dataDir($)
      const file = `${dir}/${session}.json`
      if (mine === null) {
        mine = (await $.fs.exists(file))
          ? ((JSON.parse(await $.fs.read(file)) as Entry[]) ?? [])
          : []
      }
      mine.push({
        at: await $.clock.now(),
        project: projectOf(await $.session.cwd()),
        session,
        prompt: oneLine(prompt, 140),
        ms: e.durationMs,
        tools,
        outTokens,
        model,
        end,
      })
      mine = mine.slice(-MAX_PER_SESSION)
      await $.fs.write(file, JSON.stringify(mine))
    })().catch(err => $.ui.log(`turn-timer: could not save history (${String(err)})`, { to: 'debug' }))

    return done
  })

  on('command.run', { command: 'timings' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const isAll = arg === 'all'
    const count = Number.parseInt(arg, 10) > 0 ? Number.parseInt(arg, 10) : 15
    const project = projectOf(await $.session.cwd())
    const all = await readAll($)
    const rows = isAll ? all : all.filter(x => x.project === project)
    if (rows.length === 0) {
      return { text: `No timings saved yet${isAll ? '' : ` for ${project}`}. They are recorded after each turn.` }
    }

    const real = rows.filter(x => x.prompt !== '')
    const lines: string[] = []
    lines.push(`Turn timings · ${isAll ? 'all projects' : project} · last ${Math.min(count, rows.length)} of ${rows.length}`)
    lines.push('')
    for (const x of rows.slice(-count)) {
      const where = isAll ? `${x.project.padEnd(14).slice(0, 14)} ` : ''
      lines.push(`${stamp(x.at)}  ${fmt(x.ms).padStart(8)}  ${where}${x.prompt === '' ? '(continued)' : oneLine(x.prompt, 70)}`)
    }
    const ms = real.map(x => x.ms)
    const longest = real.reduce((a, b) => (b.ms > a.ms ? b : a), real[0] ?? rows[0]!)
    lines.push('')
    lines.push(
      `Average ${fmt(ms.reduce((a, b) => a + b, 0) / Math.max(1, ms.length))} · median ${fmt(median(ms))} · ` +
        `total ${fmt(rows.reduce((a, b) => a + b.ms, 0))}`,
    )
    lines.push(`Longest ${fmt(longest.ms)} on ${stamp(longest.at)}: "${oneLine(longest.prompt, 60)}"`)
    if (isAll) {
      const by = new Map<string, number[]>()
      for (const x of real) by.set(x.project, [...(by.get(x.project) ?? []), x.ms])
      lines.push('')
      for (const [name, xs] of [...by].sort((a, b) => b[1].length - a[1].length)) {
        lines.push(`${name.padEnd(16)} ${String(xs.length).padStart(4)} prompts · median ${fmt(median(xs))} · total ${fmt(xs.reduce((a, b) => a + b, 0))}`)
      }
    }
    return { text: '```\n' + lines.join('\n') + '\n```' }
  })
}
