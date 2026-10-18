# Source this in Git Bash before running npm, node, vite or tests:
#   source "/d/LORE APP/tools/env.sh"
# Mirrors tools/env.ps1: keeps temp files and caches off the full C: drive.
export LORE_DEVENV="/d/LORE-devenv"
mkdir -p "$LORE_DEVENV/tmp" "$LORE_DEVENV/appdata" "$LORE_DEVENV/localappdata"
export TEMP="D:\\LORE-devenv\\tmp"
export TMP="D:\\LORE-devenv\\tmp"
export TMPDIR="D:\\LORE-devenv\\tmp"
export APPDATA="D:\\LORE-devenv\\appdata"
export LOCALAPPDATA="D:\\LORE-devenv\\localappdata"
export npm_config_cache="D:\\npm-cache"
export npm_config_prefix="D:\\npm-global"
export PLAYWRIGHT_BROWSERS_PATH="D:\\LORE-devenv\\ms-playwright"
export GRADLE_USER_HOME="D:\\dev\\gradle"
