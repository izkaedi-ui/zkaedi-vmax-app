# 🔱 ZKAEDI VMAX Standalone App Builder v2.5

A hardened, multi-tier agent environment built around a ZCC-compiled C HTTP server.

## Architecture

```
Tier 0 — Orchestrator Layer
├── orchestrator_agent.js    Command authority, IPC bus, health monitor
├── telemetry_agent.py       Real/simulated hardware stats (CPU, RAM, VRAM)
├── build_agent.py           File watcher, auto-recompile, binary checksum
└── terminal_agent.py        CLI interface (whitelisted commands)

Tier 1 — Sub-Agent Layer (Domain Specialists)
├── mesh_processing_sub_agent.js     Decimate → smooth → retopo pipeline
├── audio_reactive_sub_agent.js      FFT → reaction parameter mapping
├── blockchain_audit_sub_agent.js    SHA-256 + on-chain provenance audit
└── security_watchdog_sub_agent.py   File integrity, anomaly detection, lockdown

Tier 2 — Micro-Agent Layer (Single-Task Workers)
├── micro_agent_base.js      Base class (validation, timeout, IPC)
├── retopo_micro_agent.js    Quadric edge-collapse retopology
├── rigging_micro_agent.js   Auto bone placement via AABB partition
├── repair_micro_agent.js    Hole-fill, degenerate triangle removal
├── anticlip_micro_agent.js  Spatial hash self-intersection detection
└── texture_bake_micro_agent.js  UV-space barycentric atlas baking
```

## Security

- **Path traversal guard** — rejects `..`, null bytes, absolute paths
- **Shell injection eliminated** — `system()` replaced with `fork()/execvp()` (POSIX) / `CreateProcessA()` (Win32)
- **HMAC auth gate** — API routes protected by `X-ZCC-Auth` bearer token
- **Rate limiting** — per-IP sliding window (16 req/sec)
- **File integrity monitoring** — SHA-256 manifest, auto-lockdown on tampering
- **Localhost-only mode** — `--secure` flag binds to `127.0.0.1`

## Quick Start

### Windows (PowerShell)
```powershell
.\boot.ps1 -Secure
```

### Linux / WSL
```bash
chmod +x build.sh && ./build.sh
python3 launcher.py --secure
```

### Agents Only (no C server)
```bash
python3 launcher.py --agents-only
```

### CLI Commands
```bash
python3 agents/terminal_agent.py help       # Show commands
python3 agents/terminal_agent.py status     # Agent heartbeats
python3 agents/terminal_agent.py health     # Full health check
python3 agents/terminal_agent.py manifest   # List all agents
python3 agents/terminal_agent.py rebuild    # Trigger recompile
python3 agents/terminal_agent.py sync       # Sync pipeline assets
```

## IPC Protocol

Agents communicate via filesystem-based JSON message queues:

| Directory | Purpose |
|---|---|
| `ipc/tasks/` | Pending tasks (orchestrator → agents) |
| `ipc/results/` | Completed results (agents → orchestrator) |
| `ipc/heartbeats/` | Per-agent health pings |

## Build

The C server compiles on both POSIX and Win32:

```bash
# POSIX (Linux/WSL)
gcc src/zcc_server.c src/zcc_utils.c src/zcc_network.c \
    src/zcc_router.c src/zcc_security.c -I src/ -lpthread -o zkaedi_vmax_server

# Win32 (MSVC)
cl src/zcc_server.c src/zcc_utils.c src/zcc_network.c \
   src/zcc_router.c src/zcc_security.c /I src/ /Fe:zkaedi_vmax_server.exe ws2_32.lib
```

# ZCC (self-hosting)
ZCC_EMIT_IR=1 zcc src/zcc_server.c src/zcc_utils.c src/zcc_network.c \
    src/zcc_router.c src/zcc_security.c -I src/ -lpthread -o zkaedi_vmax_server
