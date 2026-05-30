#!/usr/bin/env python3
"""
ZKAEDI VMAX Telemetry Agent — Tier 0 Hardware Monitor

Collects real hardware telemetry (CPU, RAM, GPU) when psutil/pynvml
are available, otherwise falls back to simulated data.
Writes state to assets/telemetry_state.json and heartbeat to IPC bus.
"""
import os
import sys
import json
import time
import signal
import hashlib
import platform

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR   = os.path.join(SCRIPT_DIR, '..')
ASSETS_DIR = os.path.join(ROOT_DIR, 'assets')
IPC_HB_DIR = os.path.join(ROOT_DIR, 'ipc', 'heartbeats')
TELEM_FILE = os.path.join(ASSETS_DIR, 'telemetry_state.json')
HB_FILE    = os.path.join(IPC_HB_DIR, 'heartbeat_telemetry.json')

# Try to import real monitoring libraries
_HAS_PSUTIL = False
_HAS_PYNVML = False

try:
    import psutil
    _HAS_PSUTIL = True
except ImportError:
    pass

try:
    import pynvml
    pynvml.nvmlInit()
    _HAS_PYNVML = True
except Exception:
    pass

import random

_running = True

def _handle_signal(signum, frame):
    global _running
    print(f"\n[TELEMETRY] Received signal {signum}, shutting down gracefully...")
    _running = False

signal.signal(signal.SIGINT, _handle_signal)
signal.signal(signal.SIGTERM, _handle_signal)


def get_real_telemetry():
    """Collect real hardware stats via psutil + pynvml."""
    cpu_pct = psutil.cpu_percent(interval=0.5)
    mem = psutil.virtual_memory()
    ram_used_gb = mem.used / (1024 ** 3)
    ram_total_gb = mem.total / (1024 ** 3)

    vram_used_mb = 0
    vram_total_mb = 0
    gpu_name = "N/A"

    if _HAS_PYNVML:
        try:
            handle = pynvml.nvmlDeviceGetHandleByIndex(0)
            gpu_name = pynvml.nvmlDeviceGetName(handle)
            if isinstance(gpu_name, bytes):
                gpu_name = gpu_name.decode('utf-8')
            mem_info = pynvml.nvmlDeviceGetMemoryInfo(handle)
            vram_used_mb = mem_info.used / (1024 ** 2)
            vram_total_mb = mem_info.total / (1024 ** 2)
        except Exception:
            pass

    return {
        "node_id": platform.node() or "ZKAEDI_NODE",
        "source": "real",
        "throughput_dps": 0,
        "hardware": {
            "processor": platform.processor() or "Unknown CPU",
            "gpu": gpu_name,
            "system_ram": f"{ram_used_gb:.1f}GB / {ram_total_gb:.0f}GB",
            "vram_allocation": f"{vram_used_mb:.0f}MB / {vram_total_mb:.0f}MB"
        },
        "load": {
            "cpu_utilization": f"{cpu_pct:.1f}%",
            "ram_utilization": f"{mem.percent:.1f}%",
            "vram_load_pct": f"{(vram_used_mb / max(vram_total_mb, 1)) * 100:.1f}%"
        }
    }


def get_simulated_telemetry():
    """Fallback simulated telemetry when psutil is unavailable."""
    cpu_pct = random.uniform(12.5, 24.8)
    ram_used_gb = random.uniform(14.2, 18.9)
    vram_used_mb = random.uniform(2100.0, 3450.0)
    vram_total_mb = 12288

    return {
        "node_id": "MODESTO_GRID_NODE_A",
        "source": "simulated",
        "throughput_dps": random.randint(695, 715),
        "hardware": {
            "processor": "AMD Ryzen AI 7",
            "gpu": "NVIDIA GeForce RTX 5070",
            "system_ram": f"{ram_used_gb:.1f}GB / 64GB DDR5",
            "vram_allocation": f"{vram_used_mb:.0f}MB / {vram_total_mb}"
        },
        "load": {
            "cpu_utilization": f"{cpu_pct:.1f}%",
            "vram_load_pct": f"{(vram_used_mb / vram_total_mb) * 100:.1f}%"
        }
    }


def write_heartbeat():
    """Write IPC heartbeat file."""
    os.makedirs(IPC_HB_DIR, exist_ok=True)
    hb = {
        "agent_id": "telemetry",
        "status": "alive",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": "real" if _HAS_PSUTIL else "simulated",
        "pid": os.getpid()
    }
    try:
        with open(HB_FILE, 'w') as f:
            json.dump(hb, f, indent=2)
    except Exception as e:
        print(f"[TELEMETRY] Heartbeat write error: {e}")


def check_shutdown_signal():
    """Check if orchestrator sent a shutdown task."""
    tasks_dir = os.path.join(ROOT_DIR, 'ipc', 'tasks')
    if not os.path.isdir(tasks_dir):
        return False
    for fname in os.listdir(tasks_dir):
        if fname.startswith('telemetry_') and fname.endswith('.json'):
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


def monitor_loop(ticks=3):
    global _running
    get_telemetry = get_real_telemetry if _HAS_PSUTIL else get_simulated_telemetry
    mode = "REAL (psutil)" if _HAS_PSUTIL else "SIMULATED"
    print(f"[TELEMETRY] Mode: {mode}")
    print(f"[TELEMETRY] GPU monitoring: {'ACTIVE' if _HAS_PYNVML else 'UNAVAILABLE'}")

    os.makedirs(ASSETS_DIR, exist_ok=True)
    tick = 0

    while _running and (ticks <= 0 or tick < ticks):
        stats = get_telemetry()

        # Check for shutdown signal
        if check_shutdown_signal():
            print("[TELEMETRY] Shutdown signal received from orchestrator")
            break

        try:
            with open(TELEM_FILE, 'w') as f:
                json.dump({
                    "node_id": stats["node_id"],
                    "source": stats["source"],
                    "throughput_dps": stats.get("throughput_dps", 0),
                    "vram_allocation": stats["hardware"]["vram_allocation"].split("/")[0].strip(),
                    "cpu_utilization": stats["load"]["cpu_utilization"],
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                }, f, indent=2)

            vram_str = stats["hardware"]["vram_allocation"].split("/")[0].strip()
            print(f" -> Telemetry sync [{stats['source']}]: "
                  f"CPU: {stats['load']['cpu_utilization']}, VRAM: {vram_str}")
        except Exception as e:
            print(f"[TELEMETRY] Error: {e}")

        write_heartbeat()
        tick += 1
        time.sleep(1)

    print("[TELEMETRY] Agent stopped.")


if __name__ == "__main__":
    ticks_count = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    # Use 0 or negative for infinite loop
    monitor_loop(ticks_count)
