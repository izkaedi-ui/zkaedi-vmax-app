#!/usr/bin/env python3
"""
ZKAEDI VMAX Terminal Agent — Tier 0 CLI Interface

Provides a validated command interface for interacting with the
agent environment. Whitelisted commands only.
"""
import os
import sys
import json
import subprocess
import glob

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR   = os.path.join(SCRIPT_DIR, '..')
IPC_DIR    = os.path.join(ROOT_DIR, 'ipc')

ALLOWED_COMMANDS = {'sync', 'rebuild', 'validate', 'transpile', 'status', 'health', 'manifest', 'help'}


def cmd_help():
    print("ZKAEDI VMAX Terminal Agent v2.5")
    print("=" * 50)
    print("Available commands:")
    print("  sync       — Synchronize pipeline asset folders")
    print("  rebuild    — Trigger full recompilation")
    print("  validate   — Run skeletal rig validation on a GLB file")
    print("  transpile  — Transpile a JS file to WASM")
    print("  status     — Query all agent heartbeats")
    print("  health     — Run full health check")
    print("  manifest   — Display registered agents")
    print("  help       — Show this help message")


def cmd_sync():
    print("[TERMINAL] Triggering pipeline sync...")
    subprocess.run([sys.executable,
                    os.path.join(ROOT_DIR, 'utils', 'pipeline_sync.py')],
                   cwd=ROOT_DIR)


def cmd_rebuild():
    print("[TERMINAL] Triggering rebuild...")
    build_sh = os.path.join(ROOT_DIR, 'build.sh')
    if sys.platform == 'win32':
        subprocess.run(['wsl', 'bash', '-c',
                        f'cd "$(wslpath \'{ROOT_DIR}\')" && bash build.sh'],
                       cwd=ROOT_DIR)
    else:
        subprocess.run(['/bin/bash', build_sh], cwd=ROOT_DIR)


def cmd_validate(target):
    print(f"[TERMINAL] Validating: {target}")
    subprocess.run([sys.executable,
                    os.path.join(ROOT_DIR, 'utils', 'rig_validator.py'),
                    target], cwd=ROOT_DIR)


def cmd_transpile(target):
    print(f"[TERMINAL] Transpiling: {target}")
    subprocess.run([sys.executable,
                    os.path.join(ROOT_DIR, 'utils', 'zcc_wasm_compiler.py'),
                    target], cwd=ROOT_DIR)


def cmd_status():
    print("[TERMINAL] Agent Heartbeat Status")
    print("=" * 60)
    hb_dir = os.path.join(IPC_DIR, 'heartbeats')
    if not os.path.isdir(hb_dir):
        print("  No heartbeats directory found. Is the orchestrator running?")
        return
    
    files = sorted(glob.glob(os.path.join(hb_dir, 'heartbeat_*.json')))
    if not files:
        print("  No heartbeats found.")
        return
    
    import time
    now = time.time()
    
    for fpath in files:
        try:
            with open(fpath, 'r') as f:
                hb = json.load(f)
            ts = hb.get('timestamp', '?')
            agent_id = hb.get('agent_id', os.path.basename(fpath))
            status = hb.get('status', '?')
            
            # Calculate age
            try:
                import datetime
                hb_time = datetime.datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ")
                age = int(now - hb_time.timestamp())
                age_str = f"{age}s ago"
                if age > 30:
                    status = "STALE"
            except Exception:
                age_str = "?"
            
            status_icon = "[UP]" if status == "alive" else "[DN]" if status == "STALE" else "[??]"
            print(f"  {status_icon} {agent_id:25s} {status:10s} ({age_str})")
        except Exception as e:
            print(f"  [!!] Error reading {os.path.basename(fpath)}: {e}")


def cmd_health():
    print("[TERMINAL] Full Health Check")
    print("=" * 60)
    
    # Check critical directories
    dirs_to_check = ['src', 'config', 'agents', 'sub_agents', 'micro_agents',
                     'utils', 'ipc', 'logs']
    print("\nDirectory Structure:")
    for d in dirs_to_check:
        dpath = os.path.join(ROOT_DIR, d)
        exists = os.path.isdir(dpath)
        icon = "[OK]" if exists else "[XX]"
        count = len(os.listdir(dpath)) if exists else 0
        print(f"  {icon} {d:20s} {'exists' if exists else 'MISSING':10s} ({count} items)")
    
    # Check manifest
    manifest_path = os.path.join(ROOT_DIR, 'config', 'agent_manifest.json')
    print(f"\nAgent Manifest:")
    if os.path.isfile(manifest_path):
        try:
            with open(manifest_path, 'r') as f:
                manifest = json.load(f)
            agents = manifest.get('agents', [])
            print(f"  [OK] Loaded {len(agents)} agents")
            for a in agents:
                ep = os.path.join(ROOT_DIR, a['entrypoint'])
                ep_exists = os.path.isfile(ep)
                icon = "[OK]" if ep_exists else "[XX]"
                print(f"    {icon} [{a['tier']:12s}] {a['id']:25s} -> {a['entrypoint']}")
        except Exception as e:
            print(f"  [XX] Error: {e}")
    else:
        print("  [XX] Manifest not found")
    
    # Check auth key
    auth_path = os.path.join(ROOT_DIR, 'config', 'auth.key')
    print(f"\nSecurity:")
    print(f"  {'[OK]' if os.path.isfile(auth_path) else '[XX]'} Auth key: "
          f"{'present' if os.path.isfile(auth_path) else 'MISSING'}")
    
    # Agent heartbeats
    print(f"\nAgent Heartbeats:")
    cmd_status()


def cmd_manifest():
    manifest_path = os.path.join(ROOT_DIR, 'config', 'agent_manifest.json')
    if not os.path.isfile(manifest_path):
        print("[TERMINAL] Manifest not found")
        return
    
    with open(manifest_path, 'r') as f:
        manifest = json.load(f)
    
    print("[TERMINAL] Registered Agents")
    print("=" * 70)
    for a in manifest.get('agents', []):
        print(f"\n  ID:           {a['id']}")
        print(f"  Tier:         {a['tier']}")
        print(f"  Entrypoint:   {a['entrypoint']}")
        print(f"  Language:     {a['language']}")
        print(f"  Capabilities: {', '.join(a['capabilities'])}")
        print(f"  Depends on:   {', '.join(a['depends_on']) if a['depends_on'] else 'none'}")
        print(f"  Auth required: {a['security']['requires_auth']}")


def main():
    if len(sys.argv) < 2:
        cmd_help()
        sys.exit(0)

    cmd = sys.argv[1].lower().strip()

    # Input validation — whitelist only
    if cmd not in ALLOWED_COMMANDS:
        print(f"[TERMINAL] ✗ Unknown or disallowed command: '{cmd}'")
        print(f"[TERMINAL] Allowed: {', '.join(sorted(ALLOWED_COMMANDS))}")
        sys.exit(1)

    if cmd == 'help':
        cmd_help()
    elif cmd == 'sync':
        cmd_sync()
    elif cmd == 'rebuild':
        cmd_rebuild()
    elif cmd == 'validate':
        if len(sys.argv) < 3:
            print("[TERMINAL] Usage: terminal_agent.py validate <file.glb>")
            sys.exit(1)
        cmd_validate(sys.argv[2])
    elif cmd == 'transpile':
        if len(sys.argv) < 3:
            print("[TERMINAL] Usage: terminal_agent.py transpile <file.js>")
            sys.exit(1)
        cmd_transpile(sys.argv[2])
    elif cmd == 'status':
        cmd_status()
    elif cmd == 'health':
        cmd_health()
    elif cmd == 'manifest':
        cmd_manifest()


if __name__ == "__main__":
    main()
