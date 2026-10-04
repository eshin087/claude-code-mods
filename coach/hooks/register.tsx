import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register } from 'claude-code'

import type { CoachStats, CoachTokens } from '../types'

// Watches the session's own numbers (token usage per turn, cache reads,
// context fill, cost, subagents) and its habits (branch, tests, commits, PRs,
// plans), all from events the app already reports: no model calls. After a
// turn it adds one tip to the chat only when a rule fires; /coach shows it all.

const PANE = 'coach'
const COOLDOWN_TURNS = 6
const stats = atom({ plugin: 'coach', key: 'stats' } as const, null)
const lesson = atom({ plugin: 'coach', key: 'lesson' } as const, 0)
const tipIndex = atom({ plugin: 'coach', key: 'tip' } as const, 0)
const unseen = atom({ plugin: 'coach', key: 'unseen' } as const, false)
const isOpen = atom({ plugin: 'coach', key: 'isOpen' } as const, false)
const lastTip = atom({ plugin: 'coach', key: 'lastTip' } as const, null)
const isMore = atom({ plugin: 'coach', key: 'isMore' } as const, false)

const ZERO: CoachTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
const TEST_RE = /\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\bvitest\b|\bjest\b|\bpytest\b|playwright\s+test|\bcargo\s+test\b|\bgo\s+test\b|\bdotnet\s+test\b|\bnode\s+\S*tests?[\\/]\S+/i
const COMMIT_RE = /\bgit\b(\s+-c\s+\S+)*\s+commit\b/i
const PR_RE = /\bgh\s+pr\s+create\b/i
const PERF_RE = /qa:perf|qa:scale|lighthouse|\bbench(mark)?\b|\bperf\b/i

type Lesson = { id: string; title: string; idea: string; realWorld: string; tryNext: string }

const LESSONS: Lesson[] = [
  {
    id: 'adr',
    title: 'Architecture Decision Records (ADRs)',
    idea: 'Write each significant decision down: context, options, the choice, and its consequences. One short page per decision, kept in the repo.',
    realWorld: 'Teams use docs/adr/0001-*.md so newcomers learn why, not just what. It is a staple question in architect interviews.',
    tryNext: 'Next time you pick between two approaches (say R2 vs tiles in the repo), ask Claude to draft an ADR before building.',
  },
  {
    id: 'test-pyramid',
    title: 'The test pyramid',
    idea: 'Many fast unit tests at the base, fewer integration tests, very few slow end-to-end tests at the top.',
    realWorld: 'Browser and Playwright checks are the top of the pyramid. Logic like route maths or parsers deserves fast unit tests underneath, so failures point at the exact function.',
    tryNext: 'Pick one pure function that broke before and ask for unit tests that pin its edge cases.',
  },
  {
    id: 'branching',
    title: 'Branching strategy',
    idea: 'Trunk-based development: short-lived branches merged often (behind feature flags if unfinished) instead of long-running ones.',
    realWorld: 'Protected main + PR + green CI is the default at most companies. Direct commits to main are blocked by branch protection.',
    tryNext: 'Turn on branch protection for main in GitHub (require PR + passing checks). Your merge guard hook is the local version of this.',
  },
  {
    id: 'code-review',
    title: 'Code review that scales',
    idea: 'Small PRs (under ~400 changed lines) with a description of why, what, and how to test get faster, better reviews.',
    realWorld: 'Reviewers look for design and risk, not typos; linters and tests catch the rest. One concern per PR makes reverts safe.',
    tryNext: 'Ask Claude to write the PR description as: Problem · Approach · Risks · How to test · Screenshots.',
  },
  {
    id: 'ci-cd',
    title: 'CI/CD and ephemeral environments',
    idea: 'CI runs checks on every push; CD ships automatically. A preview deploy per PR is an "ephemeral environment".',
    realWorld: 'Your Vercel previews are exactly this. The next step teams take is making merge impossible unless CI is green.',
    tryNext: 'Add a GitHub Actions workflow that runs npm test on every PR and make it a required check.',
  },
  {
    id: 'perf-budget',
    title: 'Performance budgets',
    idea: 'Set explicit limits (frame time, bundle size, memory) and fail the build when they are crossed.',
    realWorld: 'Budgets are measured on a quiet, consistent machine or in CI, never on a busy laptop, or the numbers are noise.',
    tryNext: 'Write the budget down (e.g. 60 fps at 1080p, < 3 MB JS) and have the perf script compare against it.',
  },
  {
    id: 'cohesion',
    title: 'Cohesion and coupling',
    idea: 'A change that touches many files is a hint the boundaries are off: related logic should live together, and modules should depend on each other as little as possible.',
    realWorld: 'Architects ask "which module owns this decision?" When the answer is "several", that is design debt.',
    tryNext: 'Ask Claude which module should own the thing you just changed across many files, and whether to consolidate it.',
  },
  {
    id: 'semver',
    title: 'Semantic versioning and release notes',
    idea: 'MAJOR.MINOR.PATCH = breaking.feature.fix. A changelog entry and a git tag per release make history auditable.',
    realWorld: 'Release numbers are claimed when a release branch is cut, not at merge time, which avoids two branches taking the same number.',
    tryNext: 'Tag releases (git tag v0.11.0) when they merge, so a deploy can always be traced to a commit.',
  },
  {
    id: 'security',
    title: 'Threat modelling in five minutes',
    idea: 'For each feature: what are the assets, who could abuse it, what is the worst case, and what control stops it (STRIDE is a handy checklist).',
    realWorld: 'Secrets live in a secret manager or env vars, tokens get the least privilege they need, and anything from outside is untrusted input.',
    tryNext: 'Before the next feature with an API or user input, ask Claude for a STRIDE pass and the top 3 risks.',
  },
  {
    id: 'requirements',
    title: 'Requirements and acceptance criteria',
    idea: 'Before building: who is it for, what problem it solves, and how you will know it worked.',
    realWorld: 'Tickets carry acceptance criteria ("Given / When / Then"); a PR is done when they pass, not when the code compiles.',
    tryNext: 'Start the next prompt with 2-3 acceptance criteria and ask Claude to check them off at the end.',
  },
  {
    id: 'observability',
    title: 'Observability before fixes',
    idea: 'Logs, metrics and traces tell you what the system did. Reproduce a bug with a failing test before fixing it.',
    realWorld: 'On-call engineers fix faster with structured logs and dashboards than with guesses, and a regression test keeps the bug fixed.',
    tryNext: 'For the next bug, ask Claude to first write a failing test that reproduces it, then fix it.',
  },
]

const TRENDS = [
  'Plan mode for anything bigger than ~30 minutes: review the plan like a design doc before code exists.',
  'Keep CLAUDE.md short and stable: it is sent with every request, and editing it mid-session breaks the prompt cache.',
  'Send broad searches to an Explore subagent: the main conversation stays small, so every later turn is cheaper.',
  'One feature per session and per PR, with a short handoff note; long sessions cost more per turn as context grows.',
  'Parallel work belongs in separate git worktrees, one branch each, so sessions never edit the same checkout.',
  'Lower effort for routine edits; save high or max effort for architecture and hard bugs.',
  'Hooks turn "always do X" into guarantees: a guard you write once beats a reminder you repeat.',
  'Read the diff before you merge: you own the code, not the model.',
]

const LINKS = [
  { label: 'Claude Code docs', href: 'https://docs.claude.com/en/docs/claude-code/overview' },
  { label: 'Claude Code changelog', href: 'https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md' },
  { label: 'Anthropic engineering blog', href: 'https://www.anthropic.com/engineering' },
]

const fromUsage = (u: ModelUsage | undefined): CoachTokens =>
  u ? { input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens } : ZERO

const plus = (a: CoachTokens, b: CoachTokens): CoachTokens => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
})

const totalIn = (t: CoachTokens) => t.input + t.cacheRead + t.cacheWrite
const hitPct = (t: CoachTokens) => (totalIn(t) > 0 ? (t.cacheRead / totalIn(t)) * 100 : null)
const tok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))
const usd = (n: number | null) => (n === null ? '—' : n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`)
const fmt = (ms: number) => {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

const projectOf = (dir: string) => {
  const main = dir.replace(/[\\/]\.claude[\\/]worktrees[\\/].*$/i, '')
  return main.split(/[\\/]/).filter(Boolean).pop() ?? main
}

let costAtStart: number | null = null
let modelBefore: string | null = null

const fresh = async ($: EngineInterface): Promise<CoachStats> => ({
  project: projectOf(await $.session.cwd()),
  model: await $.session.model(),
  effort: null,
  turns: 0,
  main: ZERO,
  last: null,
  sub: { ...ZERO, runs: 0 },
  contextTokens: null,
  contextWindow: null,
  costUsd: null,
  files: [],
  edits: 0,
  editsSinceTest: 0,
  testsRun: 0,
  commits: 0,
  commitsOnMain: 0,
  prsOpened: 0,
  branch: null,
  planUsed: false,
  perfRuns: 0,
  tipsShown: {},
})

const change = async ($: EngineInterface, fn: (s: CoachStats) => CoachStats) => {
  const base = (await read($, stats)) ?? (await fresh($))
  await update($, stats, s => fn(s ?? base))
}

const ready = (s: CoachStats, id: string) => s.turns - (s.tipsShown[id] ?? -99) >= COOLDOWN_TURNS

// At most one tip per turn, the most important rule that fires.
const pickTip = (s: CoachStats, switched: boolean): { id: string; text: string } | null => {
  const last = s.last
  const hit = last ? hitPct(last) : null
  const ctxPct = s.contextTokens !== null && s.contextWindow ? (s.contextTokens / s.contextWindow) * 100 : null
  const subShare = totalIn(s.sub) / Math.max(1, totalIn(s.sub) + totalIn(s.main))

  if (s.commitsOnMain > (s.tipsShown['main-commits'] ?? 0)) {
    return {
      id: 'main-commits',
      text: '🟥 A commit went straight to main. At work, main is protected: branch → PR → review + CI → merge. It also makes a bad change a one-click revert.',
    }
  }
  if (last && s.turns > 1 && hit !== null && totalIn(last) >= 30_000 && hit < 50 && ready(s, 'cache')) {
    return {
      id: 'cache',
      text: switched
        ? `🟨 Cache hit ${Math.round(hit)}% this turn: expected right after a model switch (each model keeps its own cache). It recovers next turn.`
        : `🟥 Cache hit only ${Math.round(hit)}% this turn. Cached input costs ~10% of fresh input; misses come from model switches, CLAUDE.md or memory edits mid-session, /compact, or a long idle gap (the cache expires).`,
    }
  }
  if (ctxPct !== null && ctxPct >= 75 && ready(s, 'context')) {
    return {
      id: 'context',
      text: `🟨 Context ${Math.round(ctxPct)}% full (${tok(s.contextTokens!)} of ${tok(s.contextWindow!)}). Every turn re-reads all of it: slower, pricier, and quality dips near the limit. Finish this step, then /compact with a focus or start a fresh session with a handoff.`,
    }
  }
  if (s.editsSinceTest >= 5 && ready(s, 'untested')) {
    return {
      id: 'untested',
      text: `🟨 ${s.editsSinceTest} edits since tests last ran. The pro habit: run the suite (or add a test) before calling a change done; "it looked right" is not evidence.`,
    }
  }
  if (last && last.costUsd !== null && last.costUsd >= 2 && ready(s, 'cost')) {
    return {
      id: 'cost',
      text: `💸 That turn cost about ${usd(last.costUsd)} at API prices (${tok(totalIn(last))} tokens read). Fresh sessions per feature, Explore subagents for searching, and lower effort for routine edits cut this.`,
    }
  }
  if (last && last.ms >= 10 * 60_000 && !s.planUsed && ready(s, 'plan')) {
    return {
      id: 'plan',
      text: `🟦 ${fmt(last.ms)} of building with no written plan. Architects change plans on paper, where it is cheap: try Plan mode (or an ADR) before the next big step.`,
    }
  }
  if (s.sub.runs >= 3 && subShare >= 0.5 && ready(s, 'subagents')) {
    return {
      id: 'subagents',
      text: `ℹ️ Subagents used ${Math.round(subShare * 100)}% of this session's tokens. Great for parallel or broad work; for a single lookup, a direct search is cheaper.`,
    }
  }
  return null
}

// The single most useful next step, short enough for the dock's hover card.
const topAction = (s: CoachStats): string => {
  const ctxPct = s.contextTokens !== null && s.contextWindow ? (s.contextTokens / s.contextWindow) * 100 : null
  const hit = s.last ? hitPct(s.last) : null
  if (s.commitsOnMain > 0) return 'Move this work to a branch and open a PR before merging'
  if (ctxPct !== null && ctxPct >= 75) return `Context ${Math.round(ctxPct)}% full: compact or start a fresh session soon`
  if (s.editsSinceTest >= 5) return `Run the tests: ${s.editsSinceTest} edits since the last run`
  if (s.last && s.turns > 1 && hit !== null && hit < 50 && totalIn(s.last) >= 30_000) return 'Cache misses: avoid switching models or editing CLAUDE.md mid-session'
  if (s.last && s.last.ms >= 10 * 60_000 && !s.planUsed) return 'Plan the next big step first (Plan mode)'
  if (s.commits > 0 && s.prsOpened === 0) return 'Open a PR so the change gets reviewed'
  return 'Nothing urgent: keep going'
}

const lessonFor = (s: CoachStats | null, offset: number) => {
  const want =
    !s ? 'requirements'
    : s.commitsOnMain > 0 ? 'branching'
    : s.prsOpened > 0 ? 'code-review'
    : s.perfRuns > 0 ? 'perf-budget'
    : s.files.some(f => /package\.json$/.test(f)) ? 'semver'
    : s.files.some(f => /\.env|secret|token|auth/i.test(f)) ? 'security'
    : s.files.length >= 10 ? 'cohesion'
    : s.testsRun > 0 ? 'test-pyramid'
    : s.planUsed ? 'adr'
    : 'requirements'
  const start = Math.max(0, LESSONS.findIndex(l => l.id === want))
  return LESSONS[(start + offset) % LESSONS.length]!
}

const LEVEL_HEX = { success: '#4ade80', warning: '#facc15', error: '#f87171' } as const

// A solid rounded bar (track, then fill) as SVG, for surfaces that draw it.
const svgBar = (fraction: number, width: number, color: string) => {
  const fill = Math.max(0, Math.min(width, Math.round(fraction * width)))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="8" viewBox="0 0 ${width} 8">` +
    `<rect y="1.5" width="${width}" height="5" rx="2.5" fill="#3f3f46"/>` +
    (fill > 0 ? `<rect y="1.5" width="${Math.max(fill, 5)}" height="5" rx="2.5" fill="${color}"/>` : '') +
    '</svg>'
}

const tone = (pct: number | null, good: number, ok: number, higherIsBetter: boolean) =>
  pct === null ? undefined
  : higherIsBetter ? (pct >= good ? 'success' : pct >= ok ? 'warning' : 'error')
  : pct <= good ? 'success' : pct <= ok ? 'warning' : 'error'


const currentBranch = async ($: EngineInterface) => {
  const run = await $.process.run(['git', 'branch', '--show-current']).catch(() => null)
  return run && run.exitCode === 0 ? run.stdout.trim() || null : null
}

const togglePane = async ($: EngineInterface) => {
  if ((await $.ui.panes()).some(p => p.id === PANE)) {
    await $.ui.close({ id: PANE })
    // A plugin's own close does not reach its own ui.close hook: reset the flag here.
    await update($, isOpen, () => false)
    return 'Coach closed.'
  }
  const opened = await $.ui.open({ id: PANE, title: 'Coach' })
  if (opened.isPlaced) {
    await update($, isOpen, () => true)
    await update($, unseen, () => false)
  } else {
    $.ui.toast(`Coach could not open (${opened.reason}).`)
  }
  return opened.isPlaced ? 'Coach opened.' : `Could not open the pane (${opened.reason}).`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'coach', description: 'Coach: cost, cache, context, habits and an architect lesson for this session' })
    if ((await read($, stats)) === null) {
      const s = await fresh($)
      await update($, stats, cur => cur ?? s)
    }
    return next(e)
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    if (e.permission_mode === 'plan') await change($, s => ({ ...s, planUsed: true }))
    return next(e)
  })

  on('classic.PostToolUse', async ($, e, next) => {
    const level = e.effort?.level
    if (e.agent_id === undefined && level) {
      const s = await read($, stats)
      if (s && s.effort !== level) await change($, cur => ({ ...cur, effort: level }))
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    costAtStart = (await $.session.usage()).cost?.usd ?? null
    modelBefore = (await read($, stats))?.last?.model ?? null
    return next(e)
  })

  on(
    'tool.call',
    { tool: ['Edit', 'Write', 'NotebookEdit', 'Bash', 'PowerShell', 'ExitPlanMode', 'mcp__mission-control__plan'] },
    async ($, e, next) => {
      const ran = await next(e)
      if (ran.deny !== undefined || ran.isError === true) return ran
      if (e.tool === 'Edit' || e.tool === 'Write' || e.tool === 'NotebookEdit') {
        const path = (e.tool === 'NotebookEdit' ? e.notebook_path : e.file_path).replace(/\\/g, '/')
        const short = path.split('/').slice(-3).join('/')
        await change($, s => ({
          ...s,
          edits: s.edits + 1,
          editsSinceTest: s.editsSinceTest + 1,
          files: s.files.includes(short) ? s.files : [...s.files, short].slice(-300),
        }))
      } else if (e.tool === 'Bash' || e.tool === 'PowerShell') {
        const cmd = e.command
        const isTest = TEST_RE.test(cmd)
        const isCommit = COMMIT_RE.test(cmd)
        const branch = isCommit ? await currentBranch($) : null
        await change($, s => ({
          ...s,
          testsRun: s.testsRun + (isTest ? 1 : 0),
          editsSinceTest: isTest ? 0 : s.editsSinceTest,
          commits: s.commits + (isCommit ? 1 : 0),
          commitsOnMain: s.commitsOnMain + (isCommit && (branch === 'main' || branch === 'master') ? 1 : 0),
          branch: branch ?? s.branch,
          prsOpened: s.prsOpened + (PR_RE.test(cmd) ? 1 : 0),
          perfRuns: s.perfRuns + (PERF_RE.test(cmd) ? 1 : 0),
        }))
      } else {
        await change($, s => ({ ...s, planUsed: true }))
      }
      return ran
    },
  )

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const u = fromUsage(e.usage)
    if (e.agentId !== undefined) {
      await change($, s => ({ ...s, sub: { ...plus(s.sub, u), runs: s.sub.runs + 1 } }))
      return done
    }
    const usage = await $.session.usage()
    const cost = usage.cost?.usd ?? null
    const turnCost = cost !== null && costAtStart !== null ? Math.max(0, cost - costAtStart) : null
    const model = e.usage?.model ?? (await $.session.model())
    await change($, s => ({
      ...s,
      model,
      turns: s.turns + 1,
      main: plus(s.main, u),
      last: { ...u, ms: e.durationMs, costUsd: turnCost, model },
      contextTokens: usage.context.tokens ?? s.contextTokens,
      contextWindow: usage.context.window,
      costUsd: cost,
    }))
    const latest = await read($, stats)
    if (latest) {
      const action = topAction(latest)
      await update($, lastTip, () => action)
    }
    if (e.reason !== 'answer') return done

    const s = await read($, stats)
    const tip = s ? pickTip(s, modelBefore !== null && modelBefore !== model) : null
    if (s && tip) {
      await change($, cur => ({
        ...cur,
        tipsShown: { ...cur.tipsShown, [tip.id]: tip.id === 'main-commits' ? cur.commitsOnMain : cur.turns },
      }))
      if (!(await read($, isOpen))) await update($, unseen, () => true)
      void $.session
        .append({ message: { type: 'system', content: [{ type: 'text', text: `🎓 Coach · ${tip.text}` }] } })
        .catch(() => $.ui.log(`🎓 Coach · ${tip.text}`))
    }
    return done
  })

  on('command.run', { command: 'coach' }, async $ => ({ text: await togglePane($) }))

  // A press on the dock's Coach button.
  on('state.set', { plugin: 'mod-hub', key: 'signal' }, async ($, e, next) => {
    const done = await next(e)
    // Only a write that landed: update() retries a missed one, which would toggle twice.
    const sig = e.value as { target?: string; action?: string } | null
    if (done.value?.isSet !== true || !sig) return done
    if (sig.target === 'coach') await togglePane($)
    // Review: show the panel, never close it.
    else if (sig.action === 'review' && !(await $.ui.panes()).some(p => p.id === PANE)) await togglePane($)
    return done
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const done = await next(e)
    await update($, isOpen, () => false)
    return done
  })

  // One glance: three colored metric rows, one habits row, one "Do next".
  // Everything else (tokens, subagents, lesson, pro tip, links) sits behind More.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button, Link } = elements
    const SvgEl = 'Svg' in elements && e.surface !== 'terminal' ? elements.Svg : undefined
    const s = await read($, stats)
    const isMoreOpen = await read($, isMore)
    const offset = await read($, lesson)
    const l = lessonFor(s, offset)
    const trend = TRENDS[(await read($, tipIndex)) % TRENDS.length]!

    const hit = s?.last ? hitPct(s.last) : null
    const ctxPct = s && s.contextTokens !== null && s.contextWindow ? (s.contextTokens / s.contextWindow) * 100 : null
    const subShare = s ? totalIn(s.sub) / Math.max(1, totalIn(s.sub) + totalIn(s.main)) : 0
    const perTurn = s && s.turns > 0 && s.costUsd !== null ? s.costUsd / s.turns : null

    const metric = (key: string, label: string, value: string, level: string | undefined, fill: number | null, verdict: string) => (
      <Box key={`m:${key}`} flexDirection="row" gap={1}>
        <Text color={level}>●</Text>
        <Box width={8}>
          <Text bold>{label}</Text>
        </Box>
        <Box width={6}>
          <Text bold color={level}>
            {value}
          </Text>
        </Box>
        {fill !== null && SvgEl && (
          <SvgEl source={svgBar(fill / 100, 84, LEVEL_HEX[level as keyof typeof LEVEL_HEX] ?? '#9ca3af')} alt={`${Math.round(fill)}%`} width={84} height={8} />
        )}
        {fill !== null && !SvgEl && (
          <Box flexDirection="row">
            <Text color={level}>{'━'.repeat(Math.round((fill / 100) * 12))}</Text>
            <Text color="#3f3f46">{'━'.repeat(12 - Math.round((fill / 100) * 12))}</Text>
          </Box>
        )}
        <Text dimColor wrap="truncate-end">
          {verdict}
        </Text>
      </Box>
    )
    const habit = (label: string, ok: boolean | null) => (
      <Text color={ok === null ? undefined : ok ? 'success' : 'error'} dimColor={ok === null}>
        {ok === null ? '·' : ok ? '✓' : '✗'} {label}
      </Text>
    )

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1}>
          <Text bold>Coach</Text>
          <Text dimColor>{s ? `${s.project} · ${s.turns} turns` : 'after the first reply'}</Text>
          <Box flexGrow={1} />
          <Button key="more" label={isMoreOpen ? 'Less' : 'More'} plain onPress={() => update($, isMore, v => !v)} />
          <Button key="close" label="✕" plain onPress={() => togglePane($)} />
        </Box>

        <Box flexDirection="column">
          {metric(
            'cache',
            'Cache',
            hit === null ? '—' : `${Math.round(hit)}%`,
            tone(hit, 80, 50, true),
            hit,
            hit === null ? 'shows after the first reply' : hit >= 80 ? 'reusing context well' : hit >= 50 ? 'partly re-read' : 'mostly re-read (costly)',
          )}
          {metric(
            'context',
            'Context',
            ctxPct === null ? '—' : `${Math.round(ctxPct)}%`,
            tone(ctxPct, 50, 75, false),
            ctxPct,
            ctxPct === null ? '' : ctxPct <= 50 ? 'room to spare' : ctxPct <= 75 ? 'getting full' : 'near the limit: compact soon',
          )}
          {metric('cost', 'Cost', usd(s?.costUsd ?? null), perTurn !== null && perTurn >= 1 ? 'warning' : undefined, null, perTurn === null ? '' : `${usd(perTurn)} per turn`)}
        </Box>

        <Box flexDirection="row" gap={2}>
          <Box width={8}>
            <Text bold>Habits</Text>
          </Box>
          {habit('Plan', s ? s.planUsed || null : null)}
          {habit('Branch', s && s.commits > 0 ? s.commitsOnMain === 0 : null)}
          {habit('Tests', s && s.edits > 0 ? s.testsRun > 0 && s.editsSinceTest < 5 : null)}
          {habit('Commits', s && s.edits > 0 ? s.commits > 0 : null)}
          {habit('PR', s && s.commits > 0 ? s.prsOpened > 0 : null)}
        </Box>

        <Box flexDirection="row" gap={1}>
          <Box width={8}>
            <Text bold color="suggestion">
              Do next
            </Text>
          </Box>
          <Text wrap="wrap">{s ? topAction(s) : 'Nothing yet'}</Text>
        </Box>

        <Box flexDirection="column">
          {s && (
            <Box flexDirection="row" gap={1}>
              <Box width={8}>
                <Text bold>Tokens</Text>
              </Box>
              <Text>{tok(s.main.input)} fresh</Text>
              <Text color="success">{tok(s.main.cacheRead)} cached</Text>
              <Text color="warning">{tok(s.main.cacheWrite)} cache-write</Text>
              <Text color="#22d3ee">{tok(s.main.output)} out</Text>
            </Box>
          )}
          {s && (
            <Box flexDirection="row" gap={1}>
              <Box width={8}>
                <Text bold>Model</Text>
              </Box>
              <Text color="#a78bfa">{s.model}</Text>
              {s.effort && <Text dimColor>effort {s.effort}</Text>}
              {s.sub.runs > 0 && (
                <Text color={subShare >= 0.5 ? 'warning' : undefined} dimColor={subShare < 0.5}>
                  subagents {s.sub.runs} runs · {Math.round(subShare * 100)}% of tokens
                </Text>
              )}
            </Box>
          )}
          <Box flexDirection="row" gap={1}>
            <Box width={8}>
              <Text bold color="claude">
                Lesson
              </Text>
            </Box>
            <Text bold>{l.title}</Text>
          </Box>
          <Box flexDirection="row" gap={1}>
            <Box width={8}>
              <Text> </Text>
            </Box>
            <Text dimColor wrap="wrap">
              {l.idea}
            </Text>
          </Box>
        </Box>

        {isMoreOpen && (
          <Box flexDirection="column" gap={1}>
            <Box flexDirection="column">
              <Box flexDirection="row" gap={1}>
                <Text color="suggestion">Try: {l.tryNext}</Text>
              </Box>
              <Text dimColor>At work: {l.realWorld}</Text>
              <Button key="another" label="Another lesson" plain onPress={() => update($, lesson, n => n + 1)} />
            </Box>
            <Box flexDirection="column">
              <Box flexDirection="row" gap={1}>
                <Text bold color="claude">
                  Pro tip
                </Text>
                <Button key="tip" label="Next tip" plain onPress={() => update($, tipIndex, n => n + 1)} />
              </Box>
              <Text>{trend}</Text>
              <Box flexDirection="row" gap={2}>
                {LINKS.map(link => (
                  <Link href={link.href} label={link.label} />
                ))}
              </Box>
            </Box>
          </Box>
        )}
      </Box>
    )
  })
}
