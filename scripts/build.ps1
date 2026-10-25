#requires -Version 5.1
<#
  StremioFlix build helper.

  Usage:
    .\scripts\build.ps1 -Platform windows
    .\scripts\build.ps1 -Platform android -Abi aarch64
    .\scripts\build.ps1 -Platform android            # all ABIs, split per ABI
#>

param(
    [ValidateSet('windows', 'android')]
    [string]$Platform = 'windows',
    [string[]]$Abi = @('aarch64'),
    [switch]$Universal,
    [switch]$Aab
)

$ErrorActionPreference = 'Continue'
$Root    = Split-Path -Parent $PSScriptRoot
$SrcTauri = Join-Path $Root 'src-tauri'
$LogDir  = Join-Path $Root 'build-logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# ---------------------------------------------------------------- environment
$AndroidSdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$NDKVersion = '29.0.14206865'
$NDKHome    = Join-Path $AndroidSdk "ndk\$NDKVersion"

$env:ANDROID_HOME        = $AndroidSdk
$env:ANDROID_SDK_ROOT    = $AndroidSdk
$env:ANDROID_NDK_HOME    = $NDKHome
$env:NDK_HOME            = $NDKHome
$env:CARGO_TAURI_ANDROID_PROJECT_PATH = (Join-Path $SrcTauri 'gen\android')

# JDK 17 is what AGP 9.x + Gradle 9.x expect; prefer it when present.
$jdkHome = $env:JAVA_HOME
if (-not $jdkHome -or -not (Test-Path (Join-Path $jdkHome 'bin\javac.exe'))) {
    $candidates = Get-ChildItem 'C:\Program Files\Eclipse Adoptium' -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending
    $jdk17 = $candidates | Where-Object { $_.Name -match 'jdk-17' } | Select-Object -First 1
    if ($jdk17) { $jdkHome = $jdk17.FullName }
}
if ($jdkHome) { $env:JAVA_HOME = $jdkHome }

$env:PATH = "$NDKHome\toolchains\llvm\prebuilt\windows-x86_64\bin;" +
            "$env:USERPROFILE\.cargo\bin;" +
            "$env:PATH"

Write-Host "ANDROID_HOME = $env:ANDROID_HOME"
Write-Host "NDK_HOME     = $env:NDK_HOME"
Write-Host "JAVA_HOME    = $env:JAVA_HOME"

# ------------------------------------------------------------------- build
Push-Location $Root
try {
    if ($Platform -eq 'windows') {
        $log = Join-Path $LogDir 'windows.log'
        Write-Host "==> Building Windows (msi + nsis) ... log: $log"
        & cargo tauri build --target x86_64-pc-windows-msvc 2>&1 |
            Tee-Object -FilePath $log
        if ($LASTEXITCODE -ne 0) { throw "Windows build failed (exit $LASTEXITCODE)" }
    }
    else {
        $log = Join-Path $LogDir 'android.log'
        $args = @('tauri', 'android', 'build', '--ci')
        if ($Aab) { $args += '--aab' } else { $args += '--apk' }
        if ($Universal) {
            $args += @('--target', ($Abi -join ','))
        }
        else {
            foreach ($a in $Abi) { $args += @('--target', $a) }
            $args += '--split-per-abi'
        }

        Write-Host "==> Building Android: cargo $($args -join ' ')"
        Write-Host "    log: $log"
        & cargo @args 2>&1 | Tee-Object -FilePath $log
        if ($LASTEXITCODE -ne 0) { throw "Android build failed (exit $LASTEXITCODE)" }
    }
}
finally {
    Pop-Location
}

Write-Host ''
Write-Host '==> Build artifacts:'
Get-ChildItem (Join-Path $SrcTauri 'target') -Recurse -Include '*.apk', '*.aab', '*.msi', '*-setup.exe' -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch '\\deps\\' } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 20 |
    ForEach-Object { Write-Host ("    {0}  ({1:N1} MB)" -f $_.FullName, ($_.Length / 1MB)) }
