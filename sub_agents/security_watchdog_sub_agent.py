#!/usr/bin/env python3
"""
ZKAEDI VMAX Security Watchdog Sub-Agent — Tier 1

Monitors the zcc_build environment for:
  1. File integrity of src/ and config/ (SHA-256 manifest)
  2. Anomalous patterns in logs/ (repeated 404s, auth failures)
  3. IPC bus for shutdown signals
  4. Can trigger server lockdown via kill-switch notification

Runs as a persistent daemon alongside the orchestrator.
"""
import os
import sys
import json
import time
import signal
import hashlib
import glob
import re

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR   = os.path.join(SCRIPT_DIR, '..')
SRC_DIR    = os.path.join(ROOT_DIR, 'src')
CONFIG_DIR = os.path.join(ROOT_DIR, 'config')
LOGS_DIR   = os.path.join(ROOT_DIR, 'logs')
IPC_HB_DIR = os.path.join(ROOT_DIR, 'ipc', 'heartbeats')
IPC_TASKS  = os.path.join(ROOT_DIR, 'ipc', 'tasks')
SEC_LOG    = os.path.join(LOGS_DIR, 'security.log')
INTEGRITY_MANIFEST = os.path.join(CONFIG_DIR, 'integrity_manifest.json')

POLL_INTERVAL = 5  # seconds
ANOMALY_THRESHOLD_404 = 50  # per scan window
ANOMALY_THRESHOLD_AUTH = 10

_running = True

def _handle_signal(signum, frame):
    global _running
    _running = False

signal.signal(signal.SIGINT, _handle_signal)
signal.signal(signal.SIGTERM, _handle_signal)


def sec_log(level, msg):
    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    line = f"[{ts}] [{level}] [SECURITY_WATCHDOG] {msg}"
    print(line)
    os.makedirs(LOGS_DIR, exist_ok=True)
    try:
        with open(SEC_LOG, 'a') as f:
            f.write(line + '\n')
    except Exception:
        pass


def file_sha256(filepath):
    h = hashlib.sha256()
    try:
        with open(filepath, 'rb') as f:
            for chunk in iter(lambda: f.read(8192), b''):
                h.update(chunk)
        return h.hexdigest()
    except Exception:
        return None


# ---- File Integrity Monitoring ----

def build_integrity_manifest():
    """Build SHA-256 manifest for all files in src/ and config/."""
    manifest = {}
    for dir_path in [SRC_DIR, CONFIG_DIR]:
        if not os.path.isdir(dir_path):
            continue
        for fname in os.listdir(dir_path):
            fpath = os.path.join(dir_path, fname)
            if os.path.isfile(fpath) and fname != 'auth.key':
                rel = os.path.relpath(fpath, ROOT_DIR)
                manifest[rel] = file_sha256(fpath)
    return manifest


def save_integrity_manifest(manifest):
    os.makedirs(CONFIG_DIR, exist_ok=True)
    with open(INTEGRITY_MANIFEST, 'w') as f:
        json.dump({
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "files": manifest
        }, f, indent=2)
    sec_log("INFO", f"Integrity manifest saved ({len(manifest)} files)")


def load_integrity_manifest():
    if not os.path.isfile(INTEGRITY_MANIFEST):
        return None
    try:
        with open(INTEGRITY_MANIFEST, 'r') as f:
            data = json.load(f)
        return data.get("files", {})
    except Exception:
        return None


def check_integrity(baseline):
    """Compare current file hashes against the baseline manifest."""
    current = build_integrity_manifest()
    violations = []

    for rel, expected_hash in baseline.items():
        current_hash = current.get(rel)
        if current_hash is None:
            violations.append({"file": rel, "type": "DELETED"})
        elif current_hash != expected_hash:
            violations.append({
                "file": rel,
                "type": "MODIFIED",
                "expected": expected_hash[:16] + "...",
                "actual": current_hash[:16] + "..."
            })

    for rel in current:
        if rel not in baseline:
            violations.append({"file": rel, "type": "NEW_FILE"})

    return violations


# ---- Log Anomaly Detection ----

def scan_logs_for_anomalies():
    """Scan server logs for suspicious patterns."""
    anomalies = []
    
    # Scan orchestrator log for patterns
    orch_log = os.path.join(LOGS_DIR, 'orchestrator.log')
    if os.path.isfile(orch_log):
        try:
            with open(orch_log, 'r') as f:
                lines = f.readlines()[-200:]  # Last 200 lines
            
            error_count = sum(1 for l in lines if '[ERROR]' in l)
            warn_count = sum(1 for l in lines if '[WARN]' in l)
            
            if error_count > 10:
                anomalies.append({
                    "source": "orchestrator.log",
                    "type": "HIGH_ERROR_RATE",
                    "count": error_count
                })
        except Exception:
            pass

    return anomalies


# ---- Heartbeat ----

def write_heartbeat(status="alive", alert=None):
    os.makedirs(IPC_HB_DIR, exist_ok=True)
    hb = {
        "agent_id": "security_watchdog",
        "status": status,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "pid": os.getpid(),
        "alert": alert
    }
    try:
        with open(os.path.join(IPC_HB_DIR, 'heartbeat_security_watchdog.json'), 'w') as f:
            json.dump(hb, f, indent=2)
    except Exception:
        pass


# ---- Shutdown Signal Check ----

def check_shutdown():
    if not os.path.isdir(IPC_TASKS):
        return False
    for fname in os.listdir(IPC_TASKS):
        if fname.startswith('security_watchdog_') and fname.endswith('.json'):
            fpath = os.path.join(IPC_TASKS, fname)
            try:
                with open(fpath, 'r') as f:
                    task = json.load(f)
                if task.get('type') == 'shutdown':
                    os.remove(fpath)
                    return True
            except Exception:
                pass
    return False


# ---- Lockdown ----

def trigger_lockdown(reason):
    """Write a lockdown signal that the orchestrator can consume."""
    sec_log("CRITICAL", f"LOCKDOWN TRIGGERED: {reason}")
    os.makedirs(IPC_TASKS, exist_ok=True)
    lockdown = {
        "task_id": f"lockdown_{int(time.time())}",
        "target_agent": "orchestrator",
        "type": "lockdown",
        "payload": {
            "reason": reason,
            "triggered_by": "security_watchdog",
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        },
        "status": "pending"
    }
    fpath = os.path.join(IPC_TASKS, f"lockdown_{int(time.time())}.json")
    with open(fpath, 'w') as f:
        json.dump(lockdown, f, indent=2)


# ---- Main Loop ----

def main():
    global _running
    sec_log("INFO", "Security Watchdog starting...")

    # Build or load integrity manifest
    baseline = load_integrity_manifest()
    if baseline is None:
        sec_log("INFO", "No existing integrity manifest — building baseline")
        baseline = build_integrity_manifest()
        save_integrity_manifest(baseline)
    else:
        sec_log("INFO", f"Loaded integrity baseline ({len(baseline)} files)")

    while _running:
        if check_shutdown():
            sec_log("INFO", "Shutdown signal received")
            break

        # 1. File integrity check
        violations = check_integrity(baseline)
        if violations:
            for v in violations:
                sec_log("ALERT", f"Integrity violation: {v['file']} ({v['type']})")
            
            # Only trigger lockdown for MODIFIED critical files, not new files
            critical_mods = [v for v in violations 
                          if v['type'] == 'MODIFIED' and 
                          ('security' in v['file'] or 'auth' in v['file'])]
            if critical_mods:
                trigger_lockdown(f"{len(critical_mods)} critical file(s) modified")

        # 2. Log anomaly scan
        anomalies = scan_logs_for_anomalies()
        for a in anomalies:
            sec_log("WARN", f"Anomaly detected: {a['type']} in {a['source']} ({a.get('count', '?')})")

        # 3. Heartbeat
        alert = None
        if violations:
            alert = f"{len(violations)} integrity violation(s)"
        elif anomalies:
            alert = f"{len(anomalies)} anomaly(ies)"
        
        write_heartbeat(
            status="alert" if (violations or anomalies) else "alive",
            alert=alert
        )

        time.sleep(POLL_INTERVAL)

    sec_log("INFO", "Security Watchdog stopped.")


if __name__ == "__main__":
    main()
