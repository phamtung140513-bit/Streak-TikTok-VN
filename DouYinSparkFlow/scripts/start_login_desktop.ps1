$ErrorActionPreference = "Stop"

$appRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $appRoot
Set-Location $appRoot

if (-not $env:LOGIN_DESKTOP_MODE) { $env:LOGIN_DESKTOP_MODE = "native" }
if (-not $env:LOGIN_DESKTOP_API_PORT) { $env:LOGIN_DESKTOP_API_PORT = "18090" }
if (-not $env:LOGIN_PROFILE_DIR) {
    $env:LOGIN_PROFILE_DIR = Join-Path $repoRoot "state\login-profile"
}

$python = Join-Path $repoRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    $python = (Get-Command python -ErrorAction Stop).Source
}

New-Item -ItemType Directory -Force -Path $env:LOGIN_PROFILE_DIR | Out-Null

Write-Host "Starting Windows native login browser..."
Write-Host "Profile: $env:LOGIN_PROFILE_DIR"
Write-Host "API: http://127.0.0.1:$env:LOGIN_DESKTOP_API_PORT"

& $python .\login_desktop_server.py
