import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { HubMod } from '../types'

// /mods: every mod in the mods folder, what it does (its README), and an on/off
// switch for each. A switched-off mod is named in ~/.claude/mods-data/hub/off.json
// (this computer only) and the hub refuses it when the engine loads it
// (`plugin.register`), so no mod file changes and git sees nothing. A switch
// also saves the mod's hooks.json again unchanged: its new timestamp makes every
// session that watches the folder reload the mod, and the reload asks the hub.

const PANE = 'mods'
const SELF = 'hub'
const REFUSAL = 'switched off in /mods'
// The page's two colors: what's on, and everything quieter.
const ON = '#22d3ee'
const GREY = '#9ca3af'

const mods = atom({ plugin: 'hub', key: 'mods' } as const, [])
const expanded = atom({ plugin: 'hub', key: 'expanded' } as const, null)
const rootRef = atom({ plugin: 'hub', key: 'root' } as const, '')
const isOpen = atom({ plugin: 'hub', key: 'isOpen' } as const, false)

const parentOf = (dir: string) => dir.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]+$/, '')

const readJson = async ($: EngineInterface, path: string) => {
  try {
    return JSON.parse(await $.fs.read(path)) as Record<string, unknown>
  } catch {
    return null
  }
}

const dataDir = async ($: EngineInterface) => {
  // CLAUDE_CONFIG_DIR (set when Claude's folder lives on another drive) wins over ~/.claude
  const dir = ((await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${(await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'}/.claude`).replace(/\\/g, '/')
  return `${dir}/mods-data/hub`
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
// The folders listed ahead of it, which it can't keep off.
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

const aheadWarning = (names: string) =>
  `Can't keep ${names} off: loaded before the hub. Run install.ps1 (or install.sh) again to put the hub first, then start a new session.`

const scan = async ($: EngineInterface) => {
  const root = parentOf($.plugin.root)
  const entries = await $.fs.list(root)
  const off = await readOff($)
  const ahead = await foldersAheadOfHub($)
  const isWindows = /^[A-Za-z]:/.test(root)
  const found: HubMod[] = []
  for (const entry of entries) {
    const dir = `${root}/${entry.name}`
    const manifest = await readJson($, `${dir}/.claude-plugin/plugin.json`)
    if (!manifest) continue
    const name = typeof manifest.name === 'string' ? manifest.name : entry.name
    found.push({
      folder: entry.name,
      name,
      description: typeof manifest.description === 'string' ? manifest.description : '',
      version: typeof manifest.version === 'string' ? manifest.version : '',
      isOn: !off.includes(name),
      isAheadOfHub: ahead.includes(isWindows ? entry.name.toLowerCase() : entry.name),
      readme: (await $.fs.exists(`${dir}/README.md`)) ? await $.fs.read(`${dir}/README.md`) : null,
    })
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
  // hooks.json saved again as it is: its new timestamp makes every watching
  // session reload the mod, and the reload asks plugin.register again.
  const file = `${await read($, rootRef)}/${mod.folder}/hooks/hooks.json`
  const text = await $.fs.read(file).catch(() => null)
  if (text !== null) await $.fs.write(file, text)
  await scan($)
  const isStuck = mod.isOn && mod.isAheadOfHub
  $.ui.toast(isStuck ? aheadWarning(mod.name) : `${mod.name} switched ${mod.isOn ? 'off' : 'on'}.`, { timeoutMs: isStuck ? 12000 : 5000 })
}

const togglePane = async ($: EngineInterface) => {
  if ((await $.ui.panes()).some(p => p.id === PANE)) {
    await $.ui.close({ id: PANE })
    // A plugin's own close does not reach its own ui.close hook: reset the flag here.
    await update($, isOpen, () => false)
    return 'Mods closed.'
  }
  const list = await scan($)
  const opened = await $.ui.open({ id: PANE, title: 'Mods' })
  if (opened.isPlaced) await update($, isOpen, () => true)
  return opened.isPlaced ? `Mods: ${list.filter(m => m.isOn).length} of ${list.length} on.` : `Could not open the pane (${opened.reason}).`
}

export const register: Register = on => {
  // A switched-off mod never loads: the engine asks the hub about every mod
  // loaded after it, at session start and at each reload.
  on('plugin.register', async ($, e, next) => {
    if (e.name !== SELF && (await readOff($)).includes(e.name)) return { refuse: REFUSAL }
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'mods', description: 'Every mod, what it does, and an on/off switch for each' })
    const list = await scan($).catch(() => [] as HubMod[])
    const stuck = list.filter(m => !m.isOn && m.isAheadOfHub)
    if (stuck.length > 0) $.ui.toast(aheadWarning(stuck.map(m => m.name).join(', ')), { timeoutMs: 12000 })
    return next(e)
  })

  on('command.run', { command: 'mods' }, async $ => ({ text: await togglePane($) }))

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const done = await next(e)
    await update($, isOpen, () => false)
    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const list = await read($, mods)
    const open = await read($, expanded)
    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1}>
          <Text bold>Mods</Text>
          <Text color={GREY}>
            {list.filter(m => m.isOn).length} on · {list.filter(m => !m.isOn).length} off
          </Text>
          <Box flexGrow={1} />
          <Button key="refresh" label="Refresh" plain onPress={() => scan($)} />
          <Button key="close" label="Close" role="dismiss" onPress={() => togglePane($)} />
        </Box>
        {list.map(m => (
          <Box key={`mod:${m.folder}`} flexDirection="column">
            <Box flexDirection="row" gap={1}>
              <Text color={m.isOn ? ON : GREY}>{m.isOn ? '● on ' : '○ off'}</Text>
              <Text bold>{m.name}</Text>
              <Text color={GREY}>{m.version}</Text>
              <Box flexGrow={1} />
              <Button
                key={`details:${m.folder}`}
                label={open === m.folder ? 'Hide details' : 'Details'}
                plain
                onPress={() => update($, expanded, cur => (cur === m.folder ? null : m.folder))}
              />
              {m.name !== SELF && <Button key={`toggle:${m.folder}`} label={m.isOn ? 'Turn off' : 'Turn on'} onPress={() => toggle($, m)} />}
            </Box>
            <Text color={GREY}>{m.description}</Text>
            {open === m.folder && (
              <Box flexDirection="column" marginTop={1} paddingLeft={2}>
                {m.readme ? <Markdown text={m.readme} /> : <Text color={GREY}>No README.md in this mod's folder.</Text>}
              </Box>
            )}
          </Box>
        ))}
      </Box>
    )
  })
}
