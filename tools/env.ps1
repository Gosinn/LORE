# Dot-source this before running npm, node, vite or tests:
#   . "D:\LORE APP\tools\env.ps1"
# The C: drive is nearly full. Everything that would normally land in %TEMP%,
# %APPDATA% or %LOCALAPPDATA% is redirected to D:\LORE-devenv instead.

$devenv = "D:\LORE-devenv"
foreach ($dir in @("$devenv\tmp", "$devenv\appdata", "$devenv\localappdata")) {
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
}

$env:TEMP = "$devenv\tmp"
$env:TMP = "$devenv\tmp"
$env:APPDATA = "$devenv\appdata"
$env:LOCALAPPDATA = "$devenv\localappdata"
$env:npm_config_cache = "D:\npm-cache"
$env:npm_config_prefix = "D:\npm-global"
# Playwright / Capacitor / Gradle caches, for when they come into play.
$env:PLAYWRIGHT_BROWSERS_PATH = "$devenv\ms-playwright"
$env:GRADLE_USER_HOME = "D:\dev\gradle"
