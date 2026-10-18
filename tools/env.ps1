# Dot-source this before running npm, node, vite, tests or Android builds:
#   . "D:\LORE APP\tools\env.ps1"
# The C: drive is nearly full. Everything that would normally land in %TEMP%,
# %APPDATA%, %LOCALAPPDATA% or %USERPROFILE%\.android / .gradle goes to D: instead.

$devenv = "D:\LORE-devenv"
foreach ($dir in @("$devenv\tmp", "$devenv\appdata", "$devenv\localappdata", "$devenv\android-user", "D:\toolchains\gradle-home")) {
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
}

$env:TEMP = "$devenv\tmp"
$env:TMP = "$devenv\tmp"
$env:APPDATA = "$devenv\appdata"
$env:LOCALAPPDATA = "$devenv\localappdata"
$env:npm_config_cache = "D:\npm-cache"
$env:npm_config_prefix = "D:\npm-global"
$env:PLAYWRIGHT_BROWSERS_PATH = "$devenv\ms-playwright"

# Android (Capacitor): portable JDK 21 and Android SDK in D:\toolchains.
$env:JAVA_HOME = "D:\toolchains\jdk-21"
$env:ANDROID_HOME = "D:\toolchains\android-sdk"
$env:ANDROID_SDK_ROOT = "D:\toolchains\android-sdk"
$env:ANDROID_USER_HOME = "$devenv\android-user"
$env:GRADLE_USER_HOME = "D:\toolchains\gradle-home"
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\cmdline-tools\latest\bin;$env:Path"
