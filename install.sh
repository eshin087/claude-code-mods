#!/usr/bin/env bash
# Installs these mods for every Claude Code session on this computer (macOS / Linux).
#
# Writes three settings into ~/.claude/settings.json (backed up first as settings.json.bak):
#   CLAUDE_CODE_ENABLE_FUNCTION_HOOKS = 1      function hooks on
#   CLAUDE_CODE_PLUGIN_DIR_WATCH      = 1      sessions reload a mod when its files change
#   CLAUDE_CODE_PLUGIN_DIRS           = every mod folder here, ':'-separated, mod-hub first
#                                        (a mod can only be switched off if it loads after the hub)
# Everything else in your settings is kept. Run it again after adding a mod folder.
set -euo pipefail
root="$(cd "$(dirname "$0")" && pwd)"
settings="${1:-$HOME/.claude/settings.json}"

python3 - "$root" "$settings" <<'PY'
import json, os, pathlib, shutil, sys

root = pathlib.Path(sys.argv[1])
path = pathlib.Path(sys.argv[2])
found = [p for p in root.iterdir() if (p / '.claude-plugin' / 'plugin.json').is_file()]
mods = [str(p) for p in sorted(found, key=lambda p: (p.name != 'mod-hub', p.name))]
if not mods:
    sys.exit(f'No mods found in {root}')

path.parent.mkdir(parents=True, exist_ok=True)
settings = {}
if path.exists():
    shutil.copy(path, str(path) + '.bak')
    text = path.read_text(encoding='utf-8').strip()
    settings = json.loads(text) if text else {}

env = settings.setdefault('env', {})
env['CLAUDE_CODE_ENABLE_FUNCTION_HOOKS'] = '1'
env['CLAUDE_CODE_PLUGIN_DIR_WATCH'] = '1'
env['CLAUDE_CODE_PLUGIN_DIRS'] = os.pathsep.join(mods)
path.write_text(json.dumps(settings, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')

print(f'Installed {len(mods)} mods into {path}')
for m in mods:
    print('  ' + os.path.basename(m))
print('Start a new Claude Code session (or reopen the app) to load them.')
PY
