# Source this in Git Bash before running npm, node, vite, tests or Android builds:
#   source "/d/LORE APP/tools/env.sh"
# Mirrors tools/env.ps1: keeps temp files and caches off the full C: drive.
export LORE_DEVENV="/d/LORE-devenv"
mkdir -p "$LORE_DEVENV/tmp" "$LORE_DEVENV/appdata" "$LORE_DEVENV/localappdata" "$LORE_DEVENV/android-user" /d/toolchains/gradle-home
export TEMP="D:\\LORE-devenv\\tmp"
export TMP="D:\\LORE-devenv\\tmp"
export TMPDIR="D:\\LORE-devenv\\tmp"
export APPDATA="D:\\LORE-devenv\\appdata"
export LOCALAPPDATA="D:\\LORE-devenv\\localappdata"
export npm_config_cache="D:\\npm-cache"
export npm_config_prefix="D:\\npm-global"
export PLAYWRIGHT_BROWSERS_PATH="D:\\LORE-devenv\\ms-playwright"

# Android (Capacitor): portable JDK 21 and Android SDK in D:\toolchains.
export JAVA_HOME="D:\\toolchains\\jdk-21"
export ANDROID_HOME="D:\\toolchains\\android-sdk"
export ANDROID_SDK_ROOT="D:\\toolchains\\android-sdk"
export ANDROID_USER_HOME="D:\\LORE-devenv\\android-user"
export GRADLE_USER_HOME="D:\\toolchains\\gradle-home"
export PATH="/d/toolchains/jdk-21/bin:/d/toolchains/android-sdk/platform-tools:/d/toolchains/android-sdk/cmdline-tools/latest/bin:$PATH"
