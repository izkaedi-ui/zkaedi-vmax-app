#!/usr/bin/env python3
"""
ZKAEDI VMAX Build Agent — Tier 0 Compiler Watchdog

Watches src/ for file changes, triggers recompilation automatically,
validates binary integrity via SHA-256 checksum, and reports results
to the orchestrator via IPC.
"""
import os
import sys
import json
import time
import signal
import hashlib
import subprocess

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR   = os.path.join(SCRIPT_DIR, '..')
SRC_DIR    = os.path.join(ROOT_DIR, 'src')
IPC_HB_DIR = os.path.join(ROOT_DIR, 'ipc', 'heartbeats')
IPC_RES_DIR= os.path.join(ROOT_DIR, 'ipc', 'results')
LOGS_DIR   = os.path.join(ROOT_DIR, 'logs')
HB_FILE    = os.path.join(IPC_HB_DIR, 'heartbeat_build_agent.json')
LOG_FILE   = os.path.join(LOGS_DIR, 'build.log')

POLL_INTERVAL = 3  # seconds
BINARY_NAME   = 'zkaedi_vmax_server'

_running = True

def _handle_signal(signum, frame):
    global _running
    _running = False
    print(f"\n[BUILD_AGENT] Received signal {signum}, shutting down...")

signal.signal(signal.SIGINT, _handle_signal)
signal.signal(signal.SIGTERM, _handle_signal)


def log(msg):
    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    line = f"[{ts}] {msg}"
    print(line)
    os.makedirs(LOGS_DIR, exist_ok=True)
    try:
        with open(LOG_FILE, 'a') as f:
            f.write(line + '\n')
    except Exception:
        pass


def file_sha256(filepath):
    """Compute SHA-256 of a file."""
    h = hashlib.sha256()
    try:
        with open(filepath, 'rb') as f:
            for chunk in iter(lambda: f.read(8192), b''):
                h.update(chunk)
        return h.hexdigest()
    except FileNotFoundError:
        return None


def snapshot_src():
    """Return dict of {filename: (mtime, size)} for all files in src/."""
    snap = {}
    if not os.path.isdir(SRC_DIR):
        return snap
    for fname in os.listdir(SRC_DIR):
        fpath = os.path.join(SRC_DIR, fname)
        if os.path.isfile(fpath):
            st = os.stat(fpath)
            snap[fname] = (st.st_mtime, st.st_size)
    return snap


def trigger_build():
    """Execute the build script and return (success, output)."""
    build_script = os.path.join(ROOT_DIR, 'build.sh')
    
    if sys.platform == 'win32':
        # On Windows, try WSL or direct gcc
        cmd = ['wsl', 'bash', '-c', f'cd "$(wslpath \'{ROOT_DIR}\')" && bash build.sh']
        # Fallback: try direct gcc
        src_files = [
            os.path.join(SRC_DIR, 'zcc_server.c'),
            os.path.join(SRC_DIR, 'zcc_utils.c'),
            os.path.join(SRC_DIR, 'zcc_network.c'),
            os.path.join(SRC_DIR, 'zcc_router.c'),
            os.path.join(SRC_DIR, 'zcc_security.c'),
        ]
        cmd = ['gcc'] + src_files + [
            '-I', SRC_DIR,
            '-lpthread',
            '-o', os.path.join(ROOT_DIR, BINARY_NAME)
        ]
    else:
        cmd = ['bash', build_script]

    log(f"[BUILD] Executing: {' '.join(cmd)}")
    try:
        result = subprocess.run(cmd, capture_output=True, text=True,
                                timeout=120, cwd=ROOT_DIR)
        success = result.returncode == 0
        output = result.stdout + result.stderr
        if success:
            log("[BUILD] ✓ Compilation successful")
        else:
            log(f"[BUILD] ✗ Compilation failed (exit {result.returncode})")
            log(f"[BUILD] Output: {output[:500]}")
        return success, output
    except subprocess.TimeoutExpired:
        log("[BUILD] ✗ Build timed out (120s)")
        return False, "Timeout"
    except FileNotFoundError as e:
        log(f"[BUILD] ✗ Build tool not found: {e}")
        return False, str(e)


def verify_binary():
    """Check binary exists and compute its SHA-256."""
    binary_path = os.path.join(ROOT_DIR, BINARY_NAME)
    if sys.platform == 'win32':
        binary_path += '.exe'
    
    sha = file_sha256(binary_path)
    if sha:
        log(f"[BUILD] Binary checksum: {sha[:16]}...")
        return True, sha
    else:
        log("[BUILD] Binary not found after build")
        return False, None


def write_heartbeat(last_build_status=None):
    os.makedirs(IPC_HB_DIR, exist_ok=True)
    hb = {
        "agent_id": "build_agent",
        "status": "alive",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "pid": os.getpid(),
        "last_build": last_build_status
    }
    try:
        with open(HB_FILE, 'w') as f:
            json.dump(hb, f, indent=2)
    except Exception:
        pass


def write_result(task_type, success, details):
    os.makedirs(IPC_RES_DIR, exist_ok=True)
    result = {
        "task_id": f"build_agent_{int(time.time())}",
        "agent_id": "build_agent",
        "type": task_type,
        "status": "success" if success else "failure",
        "details": details,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }
    fname = os.path.join(IPC_RES_DIR, f"result_build_{int(time.time())}.json")
    try:
        with open(fname, 'w') as f:
            json.dump(result, f, indent=2)
    except Exception:
        pass


def check_shutdown_signal():
    tasks_dir = os.path.join(ROOT_DIR, 'ipc', 'tasks')
    if not os.path.isdir(tasks_dir):
        return False
    for fname in os.listdir(tasks_dir):
        if fname.startswith('build_agent_') and fname.endswith('.json'):
            fpath = os.path.join(tasks_dir, fname)
            try:
                with open(fpath, 'r') as f:
                    task = json.load(f)
                if task.get('type') == 'shutdown':
                    os.remove(fpath)
                    return True
            except Exception:
                pass
    return False


def main():
    global _running
    log("[BUILD_AGENT] Starting file watcher on src/")
    
    prev_snapshot = snapshot_src()
    last_build_status = "idle"
    
    while _running:
        if check_shutdown_signal():
            log("[BUILD_AGENT] Shutdown signal received")
            break
        
        current_snapshot = snapshot_src()
        
        # Detect changes
        changed_files = []
        for fname, stats in current_snapshot.items():
            if fname not in prev_snapshot:
                changed_files.append(f"{fname} (new)")
            elif prev_snapshot[fname] != stats:
                changed_files.append(f"{fname} (modified)")
        
        if changed_files:
            log(f"[BUILD_AGENT] Detected changes: {', '.join(changed_files)}")
            success, output = trigger_build()
            
            if success:
                valid, sha = verify_binary()
                last_build_status = f"success:{sha[:16]}" if valid else "success:no_binary"
            else:
                last_build_status = "failed"
            
            write_result("auto_build", success, {
                "changed_files": changed_files,
                "build_output": output[:1000] if output else ""
            })
        
        prev_snapshot = current_snapshot
        write_heartbeat(last_build_status)
        time.sleep(POLL_INTERVAL)
    
    log("[BUILD_AGENT] Stopped.")


if __name__ == "__main__":
    main()
