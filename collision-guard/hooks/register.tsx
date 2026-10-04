import type { EngineInterface, Register, ToolCallResult } from 'claude-code'

// Each session writes what it edits to its own file under
// mods-data/collision-guard/<repo>/<session>.json and reads the others', so
// parallel sessions (and their worktrees) see each other without sharing a file.

type SessionRecord = {
  session: string
  branch: string
  worktree: string
  topic: string
  updatedAt: number
  version: string | null
  files: { [rel: string]: number }
}

type Ctx = { dir: string; root: string; top: string; branch: string; worktree: string; session: string; checkedAt: number }

const FILE_WINDOW_MS = 12 * 3600_000
const SESSION_WINDOW_MS = 24 * 3600_000

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

const oneLine = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

const ago = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60000))
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m ago`
}

const who = (r: SessionRecord) => `${r.branch || 'detached'}${r.worktree ? ` · ${r.worktree}` : ''}${r.topic ? ` · "${oneLine(r.topic, 40)}"` : ''}`

let ctx: Ctx | null = null
let own: SessionRecord | null = null
let topic = ''
const warned = new Set<string>()

const context = async ($: EngineInterface): Promise<Ctx | null> => {
  const now = await $.clock.now()
  if (ctx && now - ctx.checkedAt < 60_000) return ctx
  const repo = await $.session.repo()
  if (!repo) return null
  const git = async (args: string[]) => {
    const run = await $.process.run(['git', ...args]).catch(() => null)
    return run && run.exitCode === 0 ? run.stdout.trim() : ''
  }
  const top = norm((await git(['rev-parse', '--show-toplevel'])) || repo.root)
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  const key = norm(repo.root).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  ctx = {
    dir: `${home.replace(/\\/g, '/')}/.claude/mods-data/collision-guard/${key}`,
    root: norm(repo.root),
    top,
    branch: await git(['branch', '--show-current']),
    worktree: top === norm(repo.root) ? '' : top.split('/').pop() ?? '',
    session: await $.session.id(),
    checkedAt: now,
  }
  return ctx
}

// Repo-relative path, the same for the main checkout and every worktree.
const relOf = (c: Ctx, path: string) => {
  const p = norm(path)
  const wt = /\/\.claude\/worktrees\/[^/]+\/(.+)$/.exec(p)
  if (wt) return wt[1]!
  for (const base of [c.top, c.root]) if (p.startsWith(`${base}/`)) return p.slice(base.length + 1)
  return null
}

const others = async ($: EngineInterface, c: Ctx, now: number) => {
  if (!(await $.fs.exists(c.dir))) return []
  const out: SessionRecord[] = []
  for (const f of await $.fs.list(c.dir)) {
    if (!f.name.endsWith('.json') || f.name === `${c.session}.json`) continue
    try {
      const r = JSON.parse(await $.fs.read(`${c.dir}/${f.name}`)) as SessionRecord
      if (now - r.updatedAt < SESSION_WINDOW_MS) out.push(r)
    } catch {
      // skip a file mid-write
    }
  }
  return out
}

const save = async ($: EngineInterface, c: Ctx, change: (r: SessionRecord) => void) => {
  const file = `${c.dir}/${c.session}.json`
  if (!own) {
    own = (await $.fs.exists(file))
      ? (JSON.parse(await $.fs.read(file)) as SessionRecord)
      : { session: c.session, branch: c.branch, worktree: c.worktree, topic, updatedAt: 0, version: null, files: {} }
  }
  change(own)
  Object.assign(own, { branch: c.branch, worktree: c.worktree, topic: own.topic || topic, updatedAt: await $.clock.now() })
  await $.fs.write(file, JSON.stringify(own))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'collisions', description: 'Other Claude sessions editing this repo, and the files you both touched' })
    return next(e)
  })

  on('turn.start', ($, e, next) => {
    if (!topic && e.text.trim() !== '') topic = oneLine(e.text, 60)
    return next(e)
  })

  on('tool.call', { tool: ['Edit', 'Write', 'NotebookEdit'] }, async ($, e, next) => {
    const path = e.tool === 'NotebookEdit' ? e.notebook_path : e.tool === 'Edit' || e.tool === 'Write' ? e.file_path : ''
    const c = await context($).catch(() => null)
    const rel = c && path ? relOf(c, path) : null
    if (!c || !rel) return next(e)

    const now = await $.clock.now()
    const peers = await others($, c, now).catch(() => [] as SessionRecord[])
    const ran: ToolCallResult = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran

    const notes: string[] = []
    const hits = peers.filter(r => r.files[rel] !== undefined && now - r.files[rel]! < FILE_WINDOW_MS)
    if (hits.length > 0 && !warned.has(rel)) {
      warned.add(rel)
      const first = hits.sort((a, b) => b.files[rel]! - a.files[rel]!)[0]!
      $.ui.toast(`⚠ ${rel} was also edited ${ago(now - first.files[rel]!)} by another session (${who(first)})`, { timeoutMs: 10_000 })
      notes.push(
        `[collision-guard] Another Claude session edited ${rel} recently: ${hits.map(r => `${who(r)}, ${ago(now - r.files[rel]!)}`).join('; ')}. ` +
          'Expect a merge conflict in this file; keep the change focused and mention the overlap to the person when you report.',
      )
    }

    let version: string | null = null
    if (rel === 'package.json') {
      try {
        version = (JSON.parse(await $.fs.read(path)) as { version?: string }).version ?? null
      } catch {
        version = null
      }
      const clash = version ? peers.find(r => r.version === version && r.branch !== c.branch) : undefined
      if (clash && version && !warned.has(`v:${version}`)) {
        warned.add(`v:${version}`)
        $.ui.toast(`⚠ v${version} is already used by another session (${who(clash)})`, { timeoutMs: 10_000 })
        notes.push(`[collision-guard] Version ${version} is already claimed by another session (${who(clash)}). Pick the next free version unless the person says otherwise.`)
      }
    }

    void save($, c, r => {
      r.files[rel] = now
      if (version) r.version = version
    }).catch(() => undefined)

    return notes.length > 0 ? { ...ran, context: [...(ran.context ?? []), ...notes] } : ran
  })

  on('command.run', { command: 'collisions' }, async $ => {
    const c = await context($)
    if (!c) return { text: 'Not in a git repository.' }
    const now = await $.clock.now()
    const peers = await others($, c, now)
    const mine = new Set(Object.keys(own?.files ?? {}))
    if (peers.length === 0) return { text: 'No other Claude sessions have edited this repo in the last 24 hours.' }
    const lines: string[] = []
    for (const r of peers.sort((a, b) => b.updatedAt - a.updatedAt)) {
      const files = Object.entries(r.files).sort((a, b) => b[1] - a[1])
      const shared = files.filter(([f]) => mine.has(f)).map(([f]) => f)
      lines.push(`• ${who(r)} — active ${ago(now - r.updatedAt)}${r.version ? ` · v${r.version}` : ''} · ${files.length} files`)
      if (shared.length > 0) lines.push(`    both edited: ${shared.slice(0, 8).join(', ')}${shared.length > 8 ? ` +${shared.length - 8}` : ''}`)
      else lines.push(`    recent: ${files.slice(0, 5).map(([f]) => f).join(', ')}`)
    }
    return { text: `Other sessions on this repo (${c.branch || 'detached'} here):\n${lines.join('\n')}` }
  })
}
