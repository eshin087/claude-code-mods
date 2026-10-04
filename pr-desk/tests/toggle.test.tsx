// PR Desk: the dock's PRs button toggles the pane. `claude plugin test` here.
import { expect, mock, test } from 'claude-code/testing'
import type { On, Register } from 'claude-code'

// A stand-in for the dock: a prompt "press:<mod>" writes the dock's signal.
const DOCK: { name: string; register: Register } = {
  name: 'mod-hub',
  register: on => {
    on('prompt.submit', async ($, e, next) => {
      if (!e.text.startsWith('press:')) return next(e)
      const cur = (await $.state.get({ plugin: 'mod-hub', key: 'signal' })).value
      await $.state.set({ plugin: 'mod-hub', key: 'signal' }, { seq: (cur?.seq ?? 0) + 1, target: e.text.slice(6) })
      return { text: e.text }
    })
  },
}

const PROBE: { name: string; register: Register } = {
  name: 'probe',
  register: on => {
    on('tool.call', { tool: 'mcp__probe__read' }, async $ => ({
      result: {
        isOpen: (await $.state.get({ plugin: 'pr-desk', key: 'isOpen' })).value ?? false,
        desk: (await $.state.get({ plugin: 'pr-desk', key: 'desk' })).value ?? null,
      },
    }))
  },
}

const world = (on: On) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const panes = new Set<string>()
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.repo', () => ({ value: null }))
  // config.json beside the mod lists three repos.
  on('fs.read', () => ({ value: JSON.stringify({ repos: ['a/one', 'a/two', 'a/three'], vercelTeam: 'team' }) }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  // `gh pr list` answers one open PR; `git worktree list` answers nothing.
  on('process.run', ($, e) => ({
    value: {
      exitCode: 0,
      stderr: '',
      stdout:
        e.argv[0] === 'gh' && e.argv[1] === 'pr' && e.argv[2] === 'list'
          ? JSON.stringify([{ number: 7, title: 'Seven', headRefName: 'release/v0.7', url: 'https://github.com/a/b/pull/7', mergeable: 'MERGEABLE', statusCheckRollup: [], updatedAt: '2026-10-03T00:00:00Z', isDraft: false }])
          : e.argv[0] === 'gh'
            ? JSON.stringify({ comments: [] })
            : '',
    },
  }))
  on('ui.panes', () => ({ value: [...panes].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  on('ui.open', ($, e) => {
    panes.add(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    panes.delete(e.id)
    return { value: undefined }
  })
  return { panes, clock }
}

test('1. PRs: a dock press opens the PR pane (and refreshes), a second press closes it', { plugins: [DOCK, PROBE] }, async ($, on) => {
  const { panes, clock } = world(on)
  await $.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })
  const press = () => $.prompt.submit({ text: 'press:pr-desk', wait: false, origin: { kind: 'composer' } } as never)
  const peek = async () => (await $.tool.call({ tool: 'mcp__probe__read' } as never)).result as { isOpen: boolean; desk: { prs: unknown[] } | null }

  await press()
  expect(panes.has('prs')).toBe(true)
  expect((await peek()).isOpen).toBe(true)
  // The refresh runs in the background once the pane is up.
  await clock.settle()
  const desk = (await peek()).desk as { prs: unknown[]; errors: string[] } | null
  expect(desk?.errors ?? []).toEqual([])
  // The stand-in gh answers one PR per repo, and config.json lists 3 repos.
  expect(desk?.prs.length).toBe(3)
  await press()
  expect(panes.has('prs')).toBe(false)
  expect((await peek()).isOpen).toBe(false)
})
