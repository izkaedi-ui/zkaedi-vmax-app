#!/usr/bin/env python3
"""
ZKAEDI VMAX Monolith Studio Launcher v2.5

Boots the full agent environment in dependency order:
  1. Creates IPC directories and auth key
  2. Spawns security_watchdog (Tier 1)
  3. Spawns telemetry_agent (Tier 0)
  4. Spawns build_agent (Tier 0)
  5. Spawns orchestrator_agent (Tier 0)
  6. Boots the native C server (optional)
  7. Opens browser

Flags:
  --secure    Bind C server to localhost only (127.0.0.1)
  --no-server Skip booting the C server
  --agents-only Only boot agents, skip server and browser
"""
import os
import sys
import subprocess
import signal
import time
import json
import secrets
import webbrowser
import atexit

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(SCRIPT_DIR)

# ---- Configuration ----

CONFIG_DIR     = os.path.join(SCRIPT_DIR, 'config')
AUTH_KEY_PATH  = os.path.join(CONFIG_DIR, 'auth.key')
IPC_DIR        = os.path.join(SCRIPT_DIR, 'ipc')
LOGS_DIR       = os.path.join(SCRIPT_DIR, 'logs')

IPC_SUBDIRS = ['tasks', 'results', 'heartbeats']
LOG_FILES   = ['orchestrator.log', 'security.log', 'build.log', 'provenance_audit.log']

CHILD_PROCESSES = []

# ---- Helpers ----

def banner(msg):
    print(f"\n  \x1b[36m->\x1b[0m {msg}")

def error(msg):
    print(f"\n  \x1b[31m[X]\x1b[0m {msg}")

def success(msg):
    print(f"\n  \x1b[32m[+]\x1b[0m {msg}")

def ensure_dirs():
    """Create all required directories."""
    dirs = [CONFIG_DIR, IPC_DIR, LOGS_DIR]
    for sub in IPC_SUBDIRS:
        dirs.append(os.path.join(IPC_DIR, sub))
    for d in dirs:
        os.makedirs(d, exist_ok=True)
    # Ensure log files exist
    for lf in LOG_FILES:
        lfp = os.path.join(LOGS_DIR, lf)
        if not os.path.isfile(lfp):
            with open(lfp, 'w') as f:
                f.write(f"# {lf} — created {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}\n")

def generate_auth_key():
    """Generate a 32-byte random hex auth key if missing."""
    if os.path.isfile(AUTH_KEY_PATH):
        with open(AUTH_KEY_PATH, 'r') as f:
            key = f.read().strip()
        if len(key) >= 32:
            banner(f"Auth key loaded ({len(key)} chars)")
            return
    
    key = secrets.token_hex(32)
    os.makedirs(CONFIG_DIR, exist_ok=True)
    with open(AUTH_KEY_PATH, 'w') as f:
        f.write(key + '\n')
    success(f"Generated new auth key -> config/auth.key")

def spawn_agent(name, cmd, cwd=None):
    """Spawn a child process and track it."""
    banner(f"Spawning {name}...")
    try:
        proc = subprocess.Popen(
            cmd,
            cwd=cwd or SCRIPT_DIR,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
        CHILD_PROCESSES.append((name, proc))
        success(f"{name} online (PID {proc.pid})")
        return proc
    except FileNotFoundError as e:
        error(f"Failed to spawn {name}: {e}")
        return None

def shutdown_all():
    """Gracefully terminate all child processes."""
    if not CHILD_PROCESSES:
        return
    print("\n\x1b[33m  Shutting down all agents...\x1b[0m")
    for name, proc in reversed(CHILD_PROCESSES):
        if proc.poll() is None:
            try:
                proc.terminate()
                proc.wait(timeout=5)
                print(f"    \x1b[31m■\x1b[0m {name} terminated")
            except subprocess.TimeoutExpired:
                proc.kill()
                print(f"    \x1b[31m■\x1b[0m {name} killed (timeout)")
            except Exception:
                pass
    CHILD_PROCESSES.clear()

def signal_handler(signum, frame):
    shutdown_all()
    sys.exit(0)

# Register cleanup
atexit.register(shutdown_all)
signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

# ---- Main Boot Sequence ----

def main():
    flags = set(sys.argv[1:])
    secure = '--secure' in flags
    no_server = '--no-server' in flags
    agents_only = '--agents-only' in flags

    print("=" * 60)
    print("   \x1b[36mZKAEDI VMAX MONOLITH STUDIO v2.5 -- SECURE BOOT\x1b[0m")
    print("=" * 60)
    print(f"  Mode: {'SECURE (localhost)' if secure else 'STANDARD'}")
    print(f"  Server: {'DISABLED' if (no_server or agents_only) else 'ENABLED'}")

    # Phase 1: Infrastructure
    banner("Phase 1: Creating infrastructure directories...")
    ensure_dirs()
    generate_auth_key()
    success("IPC bus and logs directories ready")

    # Phase 2: Security Watchdog (first — monitors everything else)
    banner("Phase 2: Booting Security Watchdog...")
    spawn_agent("security_watchdog",
                [sys.executable, "sub_agents/security_watchdog_sub_agent.py"])
    time.sleep(0.5)

    # Phase 3: Telemetry Agent
    banner("Phase 3: Booting Telemetry Agent...")
    spawn_agent("telemetry",
                [sys.executable, "agents/telemetry_agent.py", "0"])  # 0 = infinite
    time.sleep(0.5)

    # Phase 4: Build Agent
    banner("Phase 4: Booting Build Agent...")
    spawn_agent("build_agent",
                [sys.executable, "agents/build_agent.py"])
    time.sleep(0.5)

    # Phase 5: Orchestrator
    banner("Phase 5: Booting Orchestrator Agent...")
    node_cmd = 'node'
    spawn_agent("orchestrator",
                [node_cmd, "--experimental-modules", "agents/orchestrator_agent.js"])
    time.sleep(1.0)

    # Phase 6: C Server
    if not no_server and not agents_only:
        banner("Phase 6: Booting native C server...")
        server_cmd = "./zkaedi_vmax_server"
        if sys.platform == 'win32':
            server_cmd = "zkaedi_vmax_server.exe"
        
        server_args = [server_cmd]
        if secure:
            server_args.append("--secure")
        
        server_proc = spawn_agent("c_server", server_args)
        time.sleep(1.5)

        # Phase 7: Browser
        url = "http://localhost:8080"
        banner(f"Phase 7: Opening browser -> {url}")
        try:
            webbrowser.open(url)
        except Exception:
            pass
    else:
        banner("Phase 6-7: Skipped (--no-server or --agents-only)")

    # Status summary
    print("\n" + "=" * 60)
    print("  \x1b[32m[ONLINE] ZKAEDI VMAX STUDIO\x1b[0m")
    print(f"  Active agents: {len(CHILD_PROCESSES)}")
    for name, proc in CHILD_PROCESSES:
        status = "RUNNING" if proc.poll() is None else f"EXITED({proc.returncode})"
        print(f"    • {name:25s} PID {proc.pid:6d}  [{status}]")
    print(f"\n  Auth key: config/auth.key")
    print(f"  IPC bus:  ipc/")
    print(f"  Logs:     logs/")
    print(f"\n  Press Ctrl+C to shutdown all agents.")
    print("=" * 60)

    # Keep alive
    try:
        while True:
            # Check for dead children
            for name, proc in CHILD_PROCESSES:
                if proc.poll() is not None:
                    pass  # Don't spam — agents may exit normally
            time.sleep(2)
    except KeyboardInterrupt:
        pass

if __name__ == "__main__":
    main()
