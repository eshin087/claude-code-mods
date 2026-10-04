# Installs these mods for every Claude Code session on this computer (Windows).
#
# Writes three settings into ~/.claude/settings.json (backed up first as settings.json.bak):
#   CLAUDE_CODE_ENABLE_FUNCTION_HOOKS = 1      function hooks on
#   CLAUDE_CODE_PLUGIN_DIR_WATCH      = 1      sessions reload a mod when its files change
#   CLAUDE_CODE_PLUGIN_DIRS           = every mod folder here, ';'-separated
# Everything else in your settings is kept. Run it again after adding a mod folder.
# Works in Windows PowerShell 5.1 and PowerShell 7.
param([string]$SettingsPath = (Join-Path $HOME '.claude\settings.json'))

$ErrorActionPreference = 'Stop'
$mods = @(Get-ChildItem $PSScriptRoot -Directory |
  Where-Object { Test-Path (Join-Path $_.FullName '.claude-plugin\plugin.json') } |
  ForEach-Object { $_.FullName })
if ($mods.Count -eq 0) { throw "No mods found next to $PSCommandPath" }

New-Item -ItemType Directory -Force (Split-Path $SettingsPath) | Out-Null
if (Test-Path $SettingsPath) {
  Copy-Item $SettingsPath "$SettingsPath.bak" -Force
  $raw = Get-Content $SettingsPath -Raw
  $settings = if ($raw.Trim()) { $raw | ConvertFrom-Json } else { [pscustomobject]@{} }
} else {
  $settings = [pscustomobject]@{}
}
if (-not $settings.PSObject.Properties['env']) {
  $settings | Add-Member -NotePropertyName env -NotePropertyValue ([pscustomobject]@{})
}
$values = [ordered]@{
  CLAUDE_CODE_ENABLE_FUNCTION_HOOKS = '1'
  CLAUDE_CODE_PLUGIN_DIR_WATCH      = '1'
  CLAUDE_CODE_PLUGIN_DIRS           = ($mods -join ';')
}
foreach ($k in $values.Keys) { $settings.env | Add-Member -NotePropertyName $k -NotePropertyValue $values[$k] -Force }
$settings | ConvertTo-Json -Depth 50 | Set-Content $SettingsPath -Encoding UTF8

Write-Host "Installed $($mods.Count) mods into $SettingsPath"
$mods | ForEach-Object { Write-Host "  $(Split-Path $_ -Leaf)" }
Write-Host 'Start a new Claude Code session (or reopen the app) to load them.'
