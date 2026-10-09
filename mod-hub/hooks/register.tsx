import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { HubMod } from '../types'

// Two jobs. The hub: every mod in the mods folder, its README, and an on/off
// switch. A switched-off mod is named in ~/.claude/mods-data/mod-hub/off.json
// (this computer only) and the hub refuses it at `plugin.register`, so no mod
// file changes and git sees nothing.
// The dock: one slim line above the prompt, only when there is something to
// say: the plan's progress while Claude is idle (the working row carries it
// while Claude works), then a done chip until the next prompt. Panels open with
// their own slash commands; /mods-review opens them all through `signal`, a
// value each mod hooks, so it lands at once.

const PANE = 'mods'
const SELF = 'mod-hub'
const ON = `{ "modules": ["./register.tsx"] }\n`
// What the old switch wrote into a switched-off mod's hooks.json; moved to off.json on sight.
const LEGACY_OFF = './off.tsx'
const REFUSAL = 'switched off in /mods'

const mods = atom({ plugin: 'mod-hub', key: 'mods' } as const, [])
const expanded = atom({ plugin: 'mod-hub', key: 'expanded' } as const, null)
const rootRef = atom({ plugin: 'mod-hub', key: 'root' } as const, '')
const signal = atom({ plugin: 'mod-hub', key: 'signal' } as const, null)
const isOpen = atom({ plugin: 'mod-hub', key: 'isOpen' } as const, false)

// Mission Control's summary, which the dock shows (its owner writes it).
const MISSION = { plugin: 'mission-control', key: 'summary' } as const
// The dock's color: the plan's, as on the working row.
const PLAN = '#22d3ee'
const TRACK = '#3f3f46'

const fmt = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

const parentOf = (dir: string) => dir.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]+$/, '')

const readJson = async ($: EngineInterface, path: string) => {
  try {
    return JSON.parse(await $.fs.read(path)) as Record<string, unknown>
  } catch {
    return null
  }
}

const dataDir = async ($: EngineInterface) => {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  return `${home.replace(/\\/g, '/')}/.claude/mods-data/mod-hub`
}

// The mods switched off on this computer, by name.
const readOff = async ($: EngineInterface) => {
  const saved = await readJson($, `${await dataDir($)}/off.json`)
  return Array.isArray(saved?.off) ? saved.off.filter((n): n is string => typeof n === 'string') : []
}

const writeOff = async ($: EngineInterface, names: string[]) =>
  $.fs.write(`${await dataDir($)}/off.json`, `${JSON.stringify({ off: [...new Set(names)].sort() }, null, 2)}\n`)

// The engine asks only the mods loaded before a mod whether it may load, so the
// hub must come first in CLAUDE_CODE_PLUGIN_DIRS (the installers put it there).
// The folders listed ahead of it, which it cannot keep off.
const normDir = (p: string, isWindows: boolean) => {
  const path = p.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  return isWindows ? path.toLowerCase() : path
}

const foldersAheadOfHub = async ($: EngineInterface) => {
  const isWindows = /^[A-Za-z]:/.test($.plugin.root)
  const dirs = ((await $.env.get('CLAUDE_CODE_PLUGIN_DIRS')) ?? '').split(isWindows ? ';' : ':').map(d => normDir(d, isWindows))
  const at = dirs.indexOf(normDir($.plugin.root, isWindows))
  return at < 0 ? [] : dirs.slice(0, at).map(d => d.slice(d.lastIndexOf('/') + 1))
}

// A mod folder that is gone (deleted here, or by a git pull) comes out of
// CLAUDE_CODE_PLUGIN_DIRS in ~/.claude/settings.json and out of off.json, so
// new sessions stop trying to load it. Only folders beside the hub are touched;
// settings.json is backed up to settings.json.bak first, as the installers do.
const pruneGone = async ($: EngineInterface) => {
  const isWindows = /^[A-Za-z]:/.test($.plugin.root)
  const sep = isWindows ? ';' : ':'
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  const file = `${home.replace(/\\/g, '/')}/.claude/settings.json`
  const text = await $.fs.read(file).catch(() => null)
  if (text === null) return []
  let settings: { env?: Record<string, unknown> }
  try {
    settings = JSON.parse(text)
  } catch {
    return []
  }
  const value = settings.env?.CLAUDE_CODE_PLUGIN_DIRS
  if (typeof value !== 'string') return []
  const base = normDir(parentOf($.plugin.root), isWindows)
  const dirs = value.split(sep).filter(d => d.trim() !== '')
  const gone: string[] = []
  for (const dir of dirs) {
    if (parentOf(normDir(dir, isWindows)) !== base) continue
    if (!(await $.fs.exists(`${dir.trim()}/.claude-plugin/plugin.json`))) gone.push(dir)
  }
  if (gone.length === 0) return []
  await $.fs.write(`${file}.bak`, text)
  settings.env!.CLAUDE_CODE_PLUGIN_DIRS = dirs.filter(d => !gone.includes(d)).join(sep)
  await $.fs.write(file, `${JSON.stringify(settings, null, 2)}\n`)
  const names = gone.map(d => normDir(d, false).split('/').pop()!)
  const off = await readOff($)
  if (off.some(n => names.includes(n))) await writeOff($, off.filter(n => !names.includes(n)))
  return names
}

const aheadWarning = (names: string) =>
  `Can't keep ${names} off: loaded before mod-hub. Run install.ps1 (or install.sh) again to put mod-hub first, then start a new session.`

const scan = async ($: EngineInterface) => {
  const root = parentOf($.plugin.root)
  const entries = await $.fs.list(root)
  const off = await readOff($)
  const ahead = await foldersAheadOfHub($)
  const isWindows = /^[A-Za-z]:/.test(root)
  const found: HubMod[] = []
  const legacy: { name: string; file: string }[] = []
  for (const entry of entries) {
    const dir = `${root}/${entry.name}`
    const manifest = await readJson($, `${dir}/.claude-plugin/plugin.json`)
    if (!manifest) continue
    const name = typeof manifest.name === 'string' ? manifest.name : entry.name
    const hooks = await readJson($, `${dir}/hooks/hooks.json`)
    const modules = Array.isArray(hooks?.modules) ? (hooks.modules as unknown[]) : []
    if (modules.includes(LEGACY_OFF) && name !== SELF) legacy.push({ name, file: `${dir}/hooks/hooks.json` })
    const readme = (await $.fs.exists(`${dir}/README.md`)) ? await $.fs.read(`${dir}/README.md`) : null
    found.push({
      folder: entry.name,
      name,
      description: typeof manifest.description === 'string' ? manifest.description : '',
      version: typeof manifest.version === 'string' ? manifest.version : '',
      isOn: !off.includes(name) && !legacy.some(l => l.name === name),
      isAheadOfHub: ahead.includes(isWindows ? entry.name.toLowerCase() : entry.name),
      readme,
    })
  }
  // A mod the old switch turned off (its hooks.json names the off.tsx stub):
  // the list first, so the reload the hooks.json write sets off refuses it.
  if (legacy.length > 0) {
    await writeOff($, [...off, ...legacy.map(l => l.name)])
    for (const l of legacy) await $.fs.write(l.file, ON)
  }
  found.sort((a, b) => (a.name === SELF ? -1 : b.name === SELF ? 1 : a.name.localeCompare(b.name)))
  await update($, mods, () => found)
  await update($, rootRef, () => root)
  return found
}

// Does what the pressed button said, even when a page left open elsewhere is behind.
const toggle = async ($: EngineInterface, mod: HubMod) => {
  if (mod.name === SELF) return
  const rest = (await readOff($)).filter(n => n !== mod.name)
  await writeOff($, mod.isOn ? [...rest, mod.name] : rest)
  // hooks.json rewritten as it is: its new timestamp makes every watching
  // session reload the mod, and the reload asks plugin.register again.
  const file = `${await read($, rootRef)}/${mod.folder}/hooks/hooks.json`
  const text = await $.fs.read(file).catch(() => null)
  if (text !== null) await $.fs.write(file, text)
  await scan($)
  const isStuck = mod.isOn && mod.isAheadOfHub
  $.ui.toast(isStuck ? aheadWarning(mod.name) : `${mod.name} switched ${mod.isOn ? 'off' : 'on'}.`, { timeoutMs: isStuck ? 12000 : 5000 })
}

const toggleHub = async ($: EngineInterface) => {
  if ((await $.ui.panes()).some(p => p.id === PANE)) {
    await $.ui.close({ id: PANE })
    // A plugin's own close does not reach its own ui.close hook: reset the flag here.
    await update($, isOpen, () => false)
    return 'Mod Hub closed.'
  }
  const list = await scan($)
  const opened = await $.ui.open({ id: PANE, title: 'Mods' })
  if (opened.isPlaced) await update($, isOpen, () => true)
  return opened.isPlaced ? `Mod Hub: ${list.filter(m => m.isOn).length} of ${list.length} mods on.` : `Could not open the pane (${opened.reason}).`
}

// Every mod shows itself: the panels open as tabs, the next-task card opens.
const review = async ($: EngineInterface) => {
  await update($, signal, s => ({ seq: (s?.seq ?? 0) + 1, target: '*', action: 'review' as const }))
  if (!(await $.ui.panes()).some(p => p.id === PANE)) await toggleHub($)
  $.ui.toast('Review: Mods, Plan, Coach and PRs are open as tabs; next tasks are on their way.', { timeoutMs: 8000 })
}

// A review queued from outside (mods-data/mod-hub/review.json with { "pending": true })
// runs once, a few seconds after the mods load, so every mod is listening.
const reviewIfQueued = async ($: EngineInterface) => {
  const file = `${await dataDir($)}/review.json`
  if (!(await $.fs.exists(file))) return
  try {
    const queued = JSON.parse(await $.fs.read(file)) as { pending?: boolean; session?: string }
    if (queued.pending !== true) return
    // A review meant for one session is left for that session.
    if (queued.session && queued.session !== (await $.session.id())) return
  } catch {
    return
  }
  await $.fs.write(file, JSON.stringify({ pending: false }))
  $.clock.after(3000, () => void review($).catch(() => undefined))
}

// A solid rounded bar (track, then fill up to pct) as SVG, for surfaces that draw it.
const svgBar = (pct: number, width: number, color: string) => {
  const fill = Math.max(0, Math.min(width, Math.round(pct * width)))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="8" viewBox="0 0 ${width} 8">` +
    `<rect y="1.5" width="${width}" height="5" rx="2.5" fill="${TRACK}"/>` +
    (fill > 0 ? `<rect y="1.5" width="${Math.max(fill, 5)}" height="5" rx="2.5" fill="${color}"/>` : '') +
    '</svg>'
}

const isModOn = (list: HubMod[], name: string) => list.length === 0 || list.some(m => m.name === name && m.isOn)

export const register: Register = on => {
  // A switched-off mod never loads: the engine asks the hub about every mod
  // loaded after it, at session start and at each reload.
  on('plugin.register', async ($, e, next) => {
    if (e.name !== SELF && (await readOff($)).includes(e.name)) return { refuse: REFUSAL }
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'mods', description: 'Mod Hub: what each mod does, and switch mods on or off (toggles)' })
    await $.command.register({ name: 'mods-review', description: 'Open every mod panel at once (Mods, Plan, Coach, PRs, next tasks)' })
    const list = await scan($).catch(() => [] as HubMod[])
    const stuck = list.filter(m => !m.isOn && m.isAheadOfHub)
    if (stuck.length > 0) $.ui.toast(aheadWarning(stuck.map(m => m.name).join(', ')), { timeoutMs: 12000 })
    const gone = await pruneGone($).catch(() => [] as string[])
    if (gone.length > 0) $.ui.toast(`Removed ${gone.join(', ')} from your mods: its folder is gone.`, { timeoutMs: 8000 })
    await reviewIfQueued($).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'mods' }, async $ => ({ text: await toggleHub($) }))

  on('command.run', { command: 'mods-review' }, async $ => {
    await review($)
    return { text: 'Review mode: every mod panel is open.' }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const done = await next(e)
    await update($, isOpen, () => false)
    return done
  })

  // The dock: the plan's progress while Claude is idle, a done chip once the
  // plan is finished, nothing otherwise. No Box above `below` may carry
  // display, overflow, position, a size (width, height, min...) or an offset
  // (top, left...): the engine refuses a tree that puts its own node under one,
  // and draws none of the band.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const list = await read($, mods)
    const mission = isModOn(list, 'mission-control') ? (await $.state.get(MISSION)).value ?? null : null
    // While a turn runs, Mission Control's working row carries the progress.
    if (!mission || mission.total === 0 || (!mission.isFinished && e.props.isWorking)) return next(e)
    const below = await next(e)
    const elements = $.ui.resolve(e)
    const { Box, Text } = elements
    const SvgEl = 'Svg' in elements && e.surface !== 'terminal' ? elements.Svg : undefined
    // A bar: solid SVG where the surface draws SVG, characters on the terminal.
    const meter = (fraction: number, cells: number) => {
      if (SvgEl) {
        return <SvgEl source={svgBar(fraction, cells * 7, PLAN)} alt={`${Math.round(fraction * 100)}%`} width={cells * 7} height={8} />
      }
      const full = Math.max(0, Math.min(cells, Math.round(fraction * cells)))
      return (
        <Box flexDirection="row">
          <Text color={PLAN}>{'━'.repeat(full)}</Text>
          <Text color={TRACK}>{'━'.repeat(cells - full)}</Text>
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        {below}
        <Box key="dock:row" flexDirection="row" gap={1} flexWrap="nowrap" alignItems="center" overflow="hidden">
          {mission.isFinished ? (
            <Box key="dock:done">
              <Text color="success">{`✓ done ${fmt(mission.elapsedMs)}`}</Text>
            </Box>
          ) : (
            <Box key="dock:progress" flexDirection="row" gap={1} flexShrink={0} alignItems="center">
              <Text color={PLAN}>◎</Text>
              {meter(mission.pct, 10)}
              <Text bold>{`${Math.round(mission.pct * 100)}%`}</Text>
              <Text dimColor>{`· ${mission.stepNo}/${mission.total}${mission.left ? ` · ${mission.left}` : ''}`}</Text>
            </Box>
          )}
          {!mission.isFinished && mission.now !== '' && (
            <Box key="dock:now" flexShrink={1} minWidth={0}>
              <Text dimColor wrap="truncate-end">
                {mission.now}
              </Text>
            </Box>
          )}
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const list = await read($, mods)
    const open = await read($, expanded)
    const root = await read($, rootRef)
    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Text bold>Mods</Text>
            <Text dimColor>
              {list.filter(m => m.isOn).length} on · {list.filter(m => !m.isOn).length} off
            </Text>
            <Button key="refresh" label="Refresh" plain onPress={() => scan($)} />
            <Button key="close" label="Close" role="dismiss" onPress={() => toggleHub($)} />
          </Box>
          <Text dimColor wrap="truncate-middle">
            {root}
          </Text>
        </Box>
        {list.map(m => (
          <Box flexDirection="column">
            <Box flexDirection="row" gap={1}>
              <Text color={m.isOn ? 'success' : 'error'}>{m.isOn ? '● ON ' : '○ OFF'}</Text>
              <Text bold>{m.name}</Text>
              <Text dimColor>{m.version}</Text>
              <Button
                key={`details:${m.folder}`}
                label={open === m.folder ? 'Hide details' : 'Details'}
                plain
                onPress={() => update($, expanded, cur => (cur === m.folder ? null : m.folder))}
              />
              {m.name !== SELF && (
                <Button key={`toggle:${m.folder}`} label={m.isOn ? 'Turn off' : 'Turn on'} onPress={() => toggle($, m)} />
              )}
            </Box>
            <Text dimColor={!m.isOn}>{m.description}</Text>
            {open === m.folder && (
              <Box flexDirection="column" marginTop={1} paddingLeft={2}>
                {m.readme ? <Markdown text={m.readme} /> : <Text dimColor>No README.md in this mod's folder.</Text>}
              </Box>
            )}
          </Box>
        ))}
      </Box>
    )
  })
}
