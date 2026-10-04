// On/off tests: `claude plugin test` in this folder. The mods folder and the
// home folder are a small disk in memory: a mod's files are keyed by
// `<folder>/<path>`, this computer's files by `~/<path>`.
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, Register } from 'claude-code'

const ON = '{ "modules": ["./register.tsx"] }\n'
const OLD_OFF = '{ "modules": ["./off.tsx"] }\n'
const OFF_LIST = '~/.claude/mods-data/mod-hub/off.json'
const HOME = 'C:/Users/test'
const PANE_PROPS = { title: 'Mods', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const
const MODS = ['mod-hub', 'coach', 'next-tasks', 'pr-desk']

type DiskOptions = {
  /** This computer's off list, as off.json holds it; no file when absent. */
  off?: string[]
  /** A mod's hooks.json other than ON. */
  hooks?: Record<string, string>
  /** CLAUDE_CODE_PLUGIN_DIRS as folder names, in order; every mod, hub first, when absent. */
  order?: string[]
}

const disk = (on: On, opts: DiskOptions = {}) => {
  const files: Record<string, string> = {}
  for (const name of MODS) {
    files[`${name}/.claude-plugin/plugin.json`] = JSON.stringify({ name, version: '0.1.0', description: `${name} stand-in` })
    files[`${name}/hooks/hooks.json`] = opts.hooks?.[name] ?? ON
  }
  if (opts.off) files[OFF_LIST] = JSON.stringify({ off: opts.off })
  // Every write in order, by key.
  const writes: string[] = []
  const toasts: string[] = []
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
  on('store.get', () => ({ value: undefined }))
  on('agent.list', () => ({ value: [] }))
  on('mcp.call', () => ({ value: { content: [{ type: 'text' as const, text: 'not connected' }], isError: true } }))
  const offList = () => (files[OFF_LIST] === undefined ? undefined : (JSON.parse(files[OFF_LIST]!) as { off: string[] }).off)
  return { files, writes, toasts, offList }
}

// A desktop session, and the hub's page as the Mods pane draws it.
const start = async ($: Engine) => {
  await $.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })
  return $.ui.mount({ plugin: 'mod-hub', surface: 'desktop', component: 'Pane', requestId: 'mods', props: PANE_PROPS })
}

type Ui = { find: (q: { key: string }) => Promise<{ props: Record<string, unknown> } | undefined>; press: (t: { key: string }) => Promise<unknown> }
const label = async (ui: Ui, key: string) => (await ui.find({ key }))?.props.label as string | undefined

test('6a. Turn off lists the mod in off.json and only rewrites its hooks.json as it was; Turn on takes it off the list', async ($, on) => {
  const { files, writes, toasts, offList } = disk(on)
  const ui = await start($)
  expect(await label(ui, 'toggle:pr-desk')).toBe('Turn off')
  writes.length = 0
  await ui.press({ key: 'toggle:pr-desk' })
  expect(offList()).toEqual(['pr-desk'])
  // The list first, then the touch that makes watching sessions reload pr-desk.
  expect(writes).toEqual([OFF_LIST, 'pr-desk/hooks/hooks.json'])
  expect(files['pr-desk/hooks/hooks.json']).toBe(ON)
  expect(Object.keys(files).filter(f => f.endsWith('off.tsx'))).toEqual([])
  expect(toasts.at(-1)).toBe('pr-desk switched off.')
  expect(await label(ui, 'toggle:pr-desk')).toBe('Turn on')
  await ui.press({ key: 'toggle:pr-desk' })
  expect(offList()).toEqual([])
  expect(files['pr-desk/hooks/hooks.json']).toBe(ON)
  expect(toasts.at(-1)).toBe('pr-desk switched on.')
  expect(await label(ui, 'toggle:pr-desk')).toBe('Turn off')
})

test('6b. a button does what it said, even when another session changed the list since the page was drawn', async ($, on) => {
  const { files, toasts, offList } = disk(on, { off: ['coach'] })
  const ui = await start($)
  // Another session switches pr-desk off; this page still says "Turn off".
  files[OFF_LIST] = JSON.stringify({ off: ['coach', 'pr-desk'] })
  await ui.press({ key: 'toggle:pr-desk' })
  expect(offList()).toEqual(['coach', 'pr-desk'])
  expect(files['pr-desk/hooks/hooks.json']).toBe(ON)
  expect(toasts.at(-1)).toBe('pr-desk switched off.')
})

// Stand-ins that leave a mark when they start, so a test can tell which loaded.
const STARTS: { name: string; register: Register }[] = [
  {
    name: 'pr-desk',
    register: on => {
      on('session.start', async ($, e, next) => {
        await $.fs.write('C:/Users/test/started/pr-desk', 'yes')
        return next(e)
      })
    },
  },
  {
    name: 'coach',
    register: on => {
      on('session.start', async ($, e, next) => {
        await $.fs.write('C:/Users/test/started/coach', 'yes')
        return next(e)
      })
    },
  },
]

test('6c. a mod on the off list is refused when it loads', { plugins: STARTS }, async ($, on) => {
  disk(on, { off: ['pr-desk'] })
  await expect($.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })).rejects.toThrow(/pr-desk: refused by mod-hub: switched off in \/mods/)
})

test('6d. mods not on the off list load as usual', { plugins: STARTS }, async ($, on) => {
  const { files } = disk(on, { off: ['next-tasks'] })
  await $.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })
  expect(files['~/started/pr-desk']).toBe('yes')
  expect(files['~/started/coach']).toBe('yes')
})

test('6e. a mod the old switch turned off (hooks.json naming off.tsx) moves to off.json, and its hooks.json is restored', async ($, on) => {
  const { files, writes, offList } = disk(on, { off: ['coach'], hooks: { 'next-tasks': OLD_OFF } })
  const ui = await start($)
  expect(offList()).toEqual(['coach', 'next-tasks'])
  expect(files['next-tasks/hooks/hooks.json']).toBe(ON)
  // The list before hooks.json: the reload that write sets off must find the mod listed.
  expect(writes.indexOf(OFF_LIST)).toBeLessThan(writes.indexOf('next-tasks/hooks/hooks.json'))
  expect(await label(ui, 'toggle:next-tasks')).toBe('Turn on')
  expect(await label(ui, 'toggle:coach')).toBe('Turn on')
  expect(await label(ui, 'toggle:pr-desk')).toBe('Turn off')
})

test('6f. a switched-off mod listed ahead of the hub gets a warning: the engine loads it before the hub can refuse it', async ($, on) => {
  const { toasts } = disk(on, { off: ['coach'], order: ['coach', 'mod-hub', 'next-tasks', 'pr-desk'] })
  const ui = await start($)
  expect(toasts.at(-1)).toMatch(/^Can't keep coach off: loaded before mod-hub\. Run install\.ps1 \(or install\.sh\) again/)
  // Switching a mod behind the hub works as usual.
  await ui.press({ key: 'toggle:pr-desk' })
  expect(toasts.at(-1)).toBe('pr-desk switched off.')
})
