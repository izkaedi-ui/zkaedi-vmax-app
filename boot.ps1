# ZKAEDI VMAX Monolith Studio — Windows PowerShell Boot Script
# Usage: .\boot.ps1 [-Secure] [-AgentsOnly]

param(
    [switch]$Secure,
    [switch]$AgentsOnly
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "   ZKAEDI VMAX MONOLITH STUDIO v2.5 — SECURE BOOT (PS)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# ---- Phase 1: Infrastructure ----
Write-Host "`n  -> Phase 1: Creating infrastructure..." -ForegroundColor Yellow

$dirs = @("config", "ipc", "ipc\tasks", "ipc\results", "ipc\heartbeats", "logs")
foreach ($d in $dirs) {
    $path = Join-Path $ScriptDir $d
    if (-not (Test-Path $path)) {
        New-Item -ItemType Directory -Path $path -Force | Out-Null
    }
}

# Generate auth key if missing
$authKey = Join-Path $ScriptDir "config\auth.key"
if (-not (Test-Path $authKey)) {
    $key = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
    Set-Content -Path $authKey -Value $key
    Write-Host "  [OK] Generated new auth key" -ForegroundColor Green
} else {
    Write-Host "  [OK] Auth key loaded" -ForegroundColor Green
}

Write-Host "  [OK] IPC bus and logs ready" -ForegroundColor Green

# ---- Track child processes ----
$children = @()

function Stop-AllAgents {
    Write-Host "`n  Shutting down all agents..." -ForegroundColor Yellow
    foreach ($c in $script:children) {
        try {
            if (-not $c.HasExited) {
                Stop-Process -Id $c.Id -Force -ErrorAction SilentlyContinue
                Write-Host "    [x] $($c.ProcessName) (PID $($c.Id)) terminated" -ForegroundColor Red
            }
        } catch {}
    }
}

# Register cleanup
Register-EngineEvent PowerShell.Exiting -Action { Stop-AllAgents } | Out-Null

# ---- Phase 2: Security Watchdog ----
Write-Host "`n  -> Phase 2: Booting Security Watchdog..." -ForegroundColor Yellow
$p = Start-Process -FilePath "python" -ArgumentList "sub_agents\security_watchdog_sub_agent.py" `
    -WorkingDirectory $ScriptDir -WindowStyle Hidden -PassThru
$children += $p
Write-Host "  [OK] Security Watchdog (PID $($p.Id))" -ForegroundColor Green
Start-Sleep -Milliseconds 500

# ---- Phase 3: Telemetry Agent ----
Write-Host "`n  -> Phase 3: Booting Telemetry Agent..." -ForegroundColor Yellow
$p = Start-Process -FilePath "python" -ArgumentList "agents\telemetry_agent.py 0" `
    -WorkingDirectory $ScriptDir -WindowStyle Hidden -PassThru
$children += $p
Write-Host "  [OK] Telemetry Agent (PID $($p.Id))" -ForegroundColor Green
Start-Sleep -Milliseconds 500

# ---- Phase 4: Build Agent ----
Write-Host "`n  -> Phase 4: Booting Build Agent..." -ForegroundColor Yellow
$p = Start-Process -FilePath "python" -ArgumentList "agents\build_agent.py" `
    -WorkingDirectory $ScriptDir -WindowStyle Hidden -PassThru
$children += $p
Write-Host "  [OK] Build Agent (PID $($p.Id))" -ForegroundColor Green
Start-Sleep -Milliseconds 500

# ---- Phase 5: Orchestrator ----
Write-Host "`n  -> Phase 5: Booting Orchestrator Agent..." -ForegroundColor Yellow
$p = Start-Process -FilePath "node" -ArgumentList "--experimental-modules agents\orchestrator_agent.js" `
    -WorkingDirectory $ScriptDir -WindowStyle Hidden -PassThru
$children += $p
Write-Host "  [OK] Orchestrator (PID $($p.Id))" -ForegroundColor Green
Start-Sleep -Seconds 1

# ---- Phase 6: C Server ----
if (-not $AgentsOnly) {
    $serverExe = Join-Path $ScriptDir "zkaedi_vmax_server.exe"
    if (Test-Path $serverExe) {
        Write-Host "`n  -> Phase 6: Booting C Server..." -ForegroundColor Yellow
        $serverArgs = if ($Secure) { "--secure" } else { "" }
        $p = Start-Process -FilePath $serverExe -ArgumentList $serverArgs `
            -WorkingDirectory $ScriptDir -WindowStyle Hidden -PassThru
        $children += $p
        Write-Host "  [OK] C Server (PID $($p.Id))" -ForegroundColor Green
        Start-Sleep -Seconds 1

        # Phase 7: Browser
        $url = "http://localhost:8080"
        Write-Host "`n  -> Phase 7: Opening browser -> $url" -ForegroundColor Yellow
        Start-Process $url
    } else {
        Write-Host "`n  [SKIP] C Server binary not found (run build first)" -ForegroundColor Yellow
    }
}

# ---- Status Summary ----
Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host "  ZKAEDI VMAX STUDIO ONLINE" -ForegroundColor Green
Write-Host "  Active agents: $($children.Count)" -ForegroundColor White
foreach ($c in $children) {
    $status = if ($c.HasExited) { "EXITED" } else { "RUNNING" }
    Write-Host "    * $($c.ProcessName) PID $($c.Id) [$status]" -ForegroundColor White
}
Write-Host "`n  Auth: config\auth.key"
Write-Host "  IPC:  ipc\"
Write-Host "  Logs: logs\"
Write-Host "`n  Press Ctrl+C to shutdown." -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Cyan

# Keep alive
try {
    while ($true) {
        Start-Sleep -Seconds 2
    }
} finally {
    Stop-AllAgents
}
