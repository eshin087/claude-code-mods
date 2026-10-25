// Hub tests: `claude plugin test` in this folder. The mods folder and the home
// folder are a small disk in memory: a mod's files are keyed by
// `<folder>/<path>`, this computer's files by `~/<path>`.
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, Register } from 'claude-code'

const HOOKS = '{ "modules": ["./register.tsx"] }\n'
const OFF_LIST = '~/.claude/mods-data/hub/off.json'
const HOME = 'C:/Users/test'
const PANE_PROPS = { title: 'Mods', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const
const MODS = ['hub', 'limits', 'pace']

type DiskOptions = {
  /** This computer's off list, as off.json holds it; no file when absent. */
  off?: string[]
  /** CLAUDE_CODE_PLUGIN_DIRS as folder names, in order; every mod, hub first, when absent. */
  order?: string[]
}

const disk = (on: On, opts: DiskOptions = {}) => {
  const files: Record<string, string> = {}
  for (const name of MODS) {
    files[`${name}/.claude-plugin/plugin.json`] = JSON.stringify({ name, version: '0.1.0', description: `${name} stand-in` })
    files[`${name}/hooks/hooks.json`] = HOOKS
  }
  files['limits/README.md'] = '# Limits\n\nYour limits in the footer.'
  if (opts.off) files[OFF_LIST] = JSON.stringify({ off: opts.off })
  // Every write in order, by key.
  const writes: string[] = []
  const toasts: string[] = []
  const panes = new Set<string>()
  // The mods folder as the hub names it, learned from its listing.
  let base = ''
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const keyOf = (p: string) => {
    const path = norm(p)
    if (path.startsWith(`${HOME}/`)) return `~/${path.slice(HOME.length + 1)}`
    return base !== '' && path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path
  }
  on('fs.list', ($, e) => {
    base = norm(e.path)
    return { value: MODS.map(name => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })) }
  })
  on('fs.exists', ($, e) => ({ value: keyOf(e.path) in files }))
  on('fs.read', ($, e) => {
    const text = files[keyOf(e.path)]
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: text }
  })
  on('fs.write', ($, e) => {
    files[keyOf(e.path)] = e.text
    writes.push(keyOf(e.path))
    return { value: undefined }
  })
  on('env.get', ($, e) => {
    if (e.name === 'USERPROFILE') return { value: HOME }
    if (e.name === 'CLAUDE_CODE_PLUGIN_DIRS') return { value: (opts.order ?? MODS).map(f => `${base}/${f}`).join(';') }
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  mock.clock(on, { now: 1_000_000 })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
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
  const offList = () => (files[OFF_LIST] === undefined ? undefined : (JSON.parse(files[OFF_LIST]!) as { off: string[] }).off)
  return { files, writes, toasts, panes, offList }
}

// A desktop session, and the Mods page as its pane draws it.
const start = async ($: Engine) => {
  await $.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })
  return $.ui.mount({ plugin: 'hub', surface: 'desktop', component: 'Pane', requestId: 'mods', props: PANE_PROPS })
}

type Ui = { find: (q: { key?: string; type?: string }) => Promise<{ props: Record<string, unknown> } | undefined> }
const label = async (ui: Ui, key: string) => (await ui.find({ key }))?.props.label as string | undefined
const strings = (n: unknown): string[] =>
  typeof n === 'string' ? [n] : n && typeof n === 'object' ? ((n as { children?: unknown[] }).children ?? []).flatMap(strings) : []
// What the page shows, as one line with single spaces.
const pageText = async (ui: { drawn: () => Promise<unknown> }) => strings(await ui.drawn()).join(' ').replace(/\s+/g, ' ')
const readme = async (ui: Ui) => (await ui.find({ type: 'Markdown' }))?.props.text as string | undefined

test('/mods opens the page with every mod, on or off; again closes it', async ($, on) => {
  const { panes } = disk(on, { off: ['pace'] })
  await $.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })
  expect(((await $.command.run({ command: 'mods', args: '' } as never)) as { text?: string }).text).toBe('Mods: 2 of 3 on.')
  expect(panes.has('mods')).toBe(true)
  const ui = await $.ui.mount({ plugin: 'hub', surface: 'desktop', component: 'Pane', requestId: 'mods', props: PANE_PROPS })
  const text = await pageText(ui)
  expect(text).toMatch(/Mods 2 on · 1 off/)
  expect(text).toMatch(/● on hub .*● on limits .*○ off pace/)
  // The hub can't switch itself off from its own page.
  expect(await ui.find({ key: 'toggle:hub' })).toBeUndefined()
  expect(await label(ui, 'toggle:limits')).toBe('Turn off')
  expect(await label(ui, 'toggle:pace')).toBe('Turn on')
  await $.command.run({ command: 'mods', args: '' } as never)
  expect(panes.has('mods')).toBe(false)
})

test('Details shows the README; Hide details folds it again', async ($, on) => {
  disk(on)
  const ui = await start($)
  expect(await readme(ui)).toBeUndefined()
  await ui.press({ key: 'details:limits' })
  expect(await readme(ui)).toMatch(/Your limits in the footer\./)
  expect(await label(ui, 'details:limits')).toBe('Hide details')
  await ui.press({ key: 'details:limits' })
  expect(await readme(ui)).toBeUndefined()
})

test('Turn off lists the mod in off.json and only saves its hooks.json again, unchanged; Turn on takes it off the list', async ($, on) => {
  const { files, writes, toasts, offList } = disk(on)
  const ui = await start($)
  writes.length = 0
  await ui.press({ key: 'toggle:pace' })
  expect(offList()).toEqual(['pace'])
  // The list first, then the touch that makes watching sessions reload pace.
  expect(writes).toEqual([OFF_LIST, 'pace/hooks/hooks.json'])
  expect(files['pace/hooks/hooks.json']).toBe(HOOKS)
  expect(toasts.at(-1)).toBe('pace switched off.')
  expect(await label(ui, 'toggle:pace')).toBe('Turn on')
  await ui.press({ key: 'toggle:pace' })
  expect(offList()).toEqual([])
  expect(toasts.at(-1)).toBe('pace switched on.')
  expect(await label(ui, 'toggle:pace')).toBe('Turn off')
})

test('a button does what it said, even when another session changed the list after the page was drawn', async ($, on) => {
  const { files, offList } = disk(on, { off: ['limits'] })
  const ui = await start($)
  // Another session switches pace off; this page still says "Turn off".
  files[OFF_LIST] = JSON.stringify({ off: ['limits', 'pace'] })
  await ui.press({ key: 'toggle:pace' })
  expect(offList()).toEqual(['limits', 'pace'])
})

// Stand-ins that leave a mark when they start, so a test can tell which loaded.
const STARTS: { name: string; register: Register }[] = [
  {
    name: 'pace',
    register: on => {
      on('session.start', async ($, e, next) => {
        await $.fs.write('C:/Users/test/started/pace', 'yes')
        return next(e)
      })
    },
  },
  {
    name: 'limits',
    register: on => {
      on('session.start', async ($, e, next) => {
        await $.fs.write('C:/Users/test/started/limits', 'yes')
        return next(e)
      })
    },
  },
]

test('a mod on the off list is refused when it loads', { plugins: STARTS }, async ($, on) => {
  disk(on, { off: ['pace'] })
  await expect($.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })).rejects.toThrow(/pace: refused by hub: switched off in \/mods/)
})

test('mods not on the off list load as usual', { plugins: STARTS }, async ($, on) => {
  const { files } = disk(on, { off: ['something-else'] })
  await $.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })
  expect(files['~/started/pace']).toBe('yes')
  expect(files['~/started/limits']).toBe('yes')
})

test('a switched-off mod listed ahead of the hub gets a warning: the engine loads it before the hub can refuse it', async ($, on) => {
  const { toasts } = disk(on, { off: ['limits'], order: ['limits', 'hub', 'pace'] })
  const ui = await start($)
  expect(toasts.at(-1)).toMatch(/^Can't keep limits off: loaded before the hub\. Run install\.ps1 \(or install\.sh\) again/)
  // Switching a mod behind the hub works as usual.
  await ui.press({ key: 'toggle:pace' })
  expect(toasts.at(-1)).toBe('pace switched off.')
})
