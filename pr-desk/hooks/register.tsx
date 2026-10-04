import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Desk, DeskChecks, DeskPr } from '../types'

// Your repos and Vercel team come from config.json beside this mod (kept out of
// git: copy config.example.json). Without it, only the session's own repo is listed.
type DeskConfig = { repos: string[]; vercelTeam: string | null }
const PANE = 'prs'
const REFRESH_MS = 180_000

const desk = atom({ plugin: 'pr-desk', key: 'desk' } as const, null)
const isLoading = atom({ plugin: 'pr-desk', key: 'isLoading' } as const, false)
const isOpen = atom({ plugin: 'pr-desk', key: 'isOpen' } as const, false)

type GhCheck = { conclusion?: string | null; status?: string | null; state?: string | null }
type GhPr = {
  number: number
  title: string
  headRefName: string
  url: string
  mergeable: string
  statusCheckRollup: GhCheck[] | null
  updatedAt: string
  isDraft: boolean
}

const repoFromRemote = (remote: string | null) => {
  const m = remote ? /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(remote) : null
  return m ? `${m[1]}/${m[2]}` : null
}

const checksOf = (rollup: GhCheck[] | null): DeskChecks => {
  if (!rollup || rollup.length === 0) return 'none'
  const states = rollup.map(c => (c.conclusion ?? c.state ?? c.status ?? '').toUpperCase())
  if (states.some(s => ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(s))) return 'failing'
  if (states.some(s => ['', 'PENDING', 'QUEUED', 'IN_PROGRESS', 'WAITING', 'EXPECTED', 'REQUESTED'].includes(s))) return 'pending'
  return 'passing'
}

// Vercel's branch alias: release/v0.10.2 -> release-v0102
const branchSlug = (branch: string) =>
  branch.toLowerCase().replace(/\//g, '-').replace(/\./g, '').replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-')

const ago = (iso: string, now: number) => {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60000))
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`
}

const gh = async ($: EngineInterface, args: string[]) => {
  const run = await $.process.run(['gh', ...args], { timeoutMs: 30_000 })
  if (run.exitCode !== 0) throw new Error(run.stderr.trim().split('\n')[0] || `gh exited ${run.exitCode}`)
  return run.stdout
}

const loadConfig = async ($: EngineInterface): Promise<DeskConfig> => {
  try {
    const raw = JSON.parse(await $.fs.read(`${$.plugin.root}/config.json`)) as Partial<DeskConfig>
    return {
      repos: Array.isArray(raw.repos) ? raw.repos.filter((r): r is string => typeof r === 'string') : [],
      vercelTeam: typeof raw.vercelTeam === 'string' && raw.vercelTeam !== '' ? raw.vercelTeam : null,
    }
  } catch {
    return { repos: [], vercelTeam: null }
  }
}

const previewFor = async ($: EngineInterface, repo: string, pr: GhPr, vercelTeam: string | null) => {
  try {
    const out = JSON.parse(await gh($, ['pr', 'view', String(pr.number), '-R', repo, '--json', 'comments'])) as {
      comments: { author?: { login?: string }; body: string }[]
    }
    for (const c of out.comments) {
      const m = /([a-z0-9-]+-git-[a-z0-9-]+\.vercel\.app)/i.exec(c.body)
      if (m) return { preview: `https://${m[1]!.toLowerCase()}`, isPreviewGuess: false }
    }
  } catch {
    // fall through to the alias guess
  }
  const project = repo.split('/')[1]!.toLowerCase()
  if (!vercelTeam) return { preview: null, isPreviewGuess: false }
  return { preview: `https://${project}-git-${branchSlug(pr.headRefName)}-${vercelTeam}.vercel.app`, isPreviewGuess: true }
}

const worktrees = async ($: EngineInterface) => {
  const byBranch = new Map<string, string>()
  const run = await $.process.run(['git', 'worktree', 'list', '--porcelain']).catch(() => null)
  if (!run || run.exitCode !== 0) return byBranch
  let path = ''
  for (const line of run.stdout.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) path = line.slice(9)
    if (line.startsWith('branch refs/heads/')) byBranch.set(line.slice(18), path.split(/[\\/]/).pop() ?? path)
  }
  return byBranch
}

const refresh = async ($: EngineInterface) => {
  if (await read($, isLoading)) return
  await update($, isLoading, () => true)
  try {
    const here = repoFromRemote((await $.session.repo())?.remote ?? null)
    const config = await loadConfig($)
    const repos = [...new Map([here, ...config.repos].filter((r): r is string => !!r).map(r => [r.toLowerCase(), r])).values()]
    const trees = await worktrees($)
    const prs: DeskPr[] = []
    const errors: string[] = []
    await Promise.all(
      repos.map(async repo => {
        try {
          const list = JSON.parse(
            await gh($, [
              'pr', 'list', '-R', repo, '--author', '@me', '--state', 'open', '--limit', '30',
              '--json', 'number,title,headRefName,url,mergeable,statusCheckRollup,updatedAt,isDraft',
            ]),
          ) as GhPr[]
          for (const pr of list) {
            const isHere = here !== null && repo.toLowerCase() === here.toLowerCase()
            prs.push({
              repo,
              number: pr.number,
              title: pr.title,
              branch: pr.headRefName,
              url: pr.url,
              ...(await previewFor($, repo, pr, config.vercelTeam)),
              mergeable: pr.mergeable,
              checks: checksOf(pr.statusCheckRollup),
              isDraft: pr.isDraft,
              updatedAt: pr.updatedAt,
              worktree: isHere ? trees.get(pr.headRefName) ?? null : null,
            })
          }
        } catch (err) {
          errors.push(`${repo}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }),
    )
    prs.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    const fresh: Desk = { at: await $.clock.now(), prs, errors }
    await update($, desk, () => fresh)
  } finally {
    await update($, isLoading, () => false)
  }
}

const togglePane = async ($: EngineInterface) => {
  if ((await $.ui.panes()).some(p => p.id === PANE)) {
    await $.ui.close({ id: PANE })
    // A plugin's own close does not reach its own ui.close hook: reset the flag here.
    await update($, isOpen, () => false)
    return 'PR Desk closed.'
  }
  const opened = await $.ui.open({ id: PANE, title: 'PRs' })
  if (opened.isPlaced) {
    await update($, isOpen, () => true)
    void refresh($).catch(err => $.ui.toast(`PR Desk: ${String(err)}`))
  } else {
    $.ui.toast(`PR Desk could not open (${opened.reason}).`)
  }
  return opened.isPlaced ? 'PR Desk opened.' : `Could not open the pane (${opened.reason}).`
}

let ticks = 0

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'prs', description: 'Open PR Desk: your open PRs, preview links, checks and merge state' })
    // Every 3 minutes while the pane is open; every 15 minutes in the background,
    // so the dock's PR badge stays current.
    $.clock.every(REFRESH_MS, async () => {
      ticks += 1
      const open = (await $.ui.panes()).some(p => p.id === PANE)
      if (open || ticks % 5 === 0) await refresh($).catch(() => undefined)
    })
    $.clock.after(5000, () => void refresh($).catch(() => undefined))
    return next(e)
  })

  on('command.run', { command: 'prs' }, async $ => ({ text: await togglePane($) }))

  // A press on the dock's PRs button.
  on('state.set', { plugin: 'mod-hub', key: 'signal' }, async ($, e, next) => {
    const done = await next(e)
    // Only a write that landed: update() retries a missed one, which would toggle twice.
    const sig = e.value as { target?: string; action?: string } | null
    if (done.value?.isSet !== true || !sig) return done
    if (sig.target === 'pr-desk') await togglePane($)
    // Review: show the panel, never close it.
    else if (sig.action === 'review' && !(await $.ui.panes()).some(p => p.id === PANE)) await togglePane($)
    return done
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const done = await next(e)
    await update($, isOpen, () => false)
    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const d = await read($, desk)
    const loading = await read($, isLoading)
    const now = await $.clock.now()
    const repos = [...new Set((d?.prs ?? []).map(p => p.repo))]

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1}>
          <Text bold>Open PRs</Text>
          <Text dimColor>
            {loading ? 'refreshing…' : d ? `${d.prs.length} open · checked ${ago(new Date(d.at).toISOString(), now)}` : 'loading…'}
          </Text>
          <Button key="refresh" label="Refresh" plain onPress={() => refresh($)} />
          <Button key="close" label="Close" role="dismiss" onPress={() => togglePane($)} />
        </Box>
        {d && d.prs.length === 0 && d.errors.length === 0 && <Text dimColor>No open PRs of yours.</Text>}
        {repos.map(repo => (
          <Box flexDirection="column">
            <Text bold color="claude">{repo.split('/')[1]}</Text>
            {d!.prs
              .filter(p => p.repo === repo)
              .map(p => (
                <Box flexDirection="column" marginBottom={1}>
                  <Text bold wrap="truncate-end">
                    #{p.number} {p.title}
                    {p.isDraft ? ' (draft)' : ''}
                  </Text>
                  <Box flexDirection="row" gap={1}>
                    <Text color={p.checks === 'failing' ? 'error' : p.checks === 'passing' ? 'success' : 'warning'}>
                      {p.checks === 'failing' ? '✗ checks failing' : p.checks === 'passing' ? '✓ checks' : p.checks === 'pending' ? '… checks running' : '· no checks'}
                    </Text>
                    <Text color={p.mergeable === 'CONFLICTING' ? 'error' : undefined} dimColor={p.mergeable !== 'CONFLICTING'}>
                      {p.mergeable === 'MERGEABLE' ? 'mergeable' : p.mergeable === 'CONFLICTING' ? 'conflicts with base' : 'merge state unknown'}
                    </Text>
                    <Text dimColor>· {ago(p.updatedAt, now)}</Text>
                  </Box>
                  <Text dimColor wrap="truncate-end">
                    {p.branch}
                    {p.worktree ? ` · worktree ${p.worktree}` : ''}
                  </Text>
                  <Box flexDirection="row" gap={2}>
                    {p.preview && <Link href={p.preview} label={p.isPreviewGuess ? 'preview (guessed)' : 'preview'} />}
                    <Link href={p.url} label="PR" />
                  </Box>
                </Box>
              ))}
          </Box>
        ))}
        {(d?.errors ?? []).map(err => (
          <Text color="warning" wrap="truncate-end">
            {err}
          </Text>
        ))}
      </Box>
    )
  })
}
