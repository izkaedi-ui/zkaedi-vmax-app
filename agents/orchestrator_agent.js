/**
 * ZKAEDI VMAX Orchestrator Agent — Tier 0 Command Authority
 * 
 * Responsibilities:
 *  - Loads agent_manifest.json and tracks all registered agents
 *  - Manages IPC bus (filesystem-based task queue)
 *  - Dispatches tasks to sub-agents based on capability matching
 *  - Monitors agent heartbeats and flags stale agents
 *  - Provides a kill-switch for graceful shutdown of all children
 *  - Logs all operations to logs/orchestrator.log
 */

import { readFileSync, writeFileSync, renameSync, existsSync, readdirSync, unlinkSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

/* ---- Configuration ---- */

const IPC_DIR        = join(ROOT, 'ipc');
const TASKS_DIR      = join(IPC_DIR, 'tasks');
const RESULTS_DIR    = join(IPC_DIR, 'results');
const HEARTBEATS_DIR = join(IPC_DIR, 'heartbeats');
const LOGS_DIR       = join(ROOT, 'logs');
const LOG_FILE       = join(LOGS_DIR, 'orchestrator.log');
const MANIFEST_PATH  = join(ROOT, 'config', 'agent_manifest.json');

const HEARTBEAT_STALE_SEC = 30;
const POLL_INTERVAL_MS    = 2000;

/* ---- Logging ---- */

function log(level, message) {
    const ts = new Date().toISOString();
    const line = `[${ts}] [${level}] ${message}`;
    console.log(line);
    try {
        const { appendFileSync } = await import('fs');
        appendFileSync(LOG_FILE, line + '\n');
    } catch (_) { /* best effort */ }
}

/* ---- IPC Helpers ---- */

function ensureDir(dir) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function dispatchTask(agentId, taskType, payload) {
    const taskId = `${agentId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const task = {
        task_id: taskId,
        target_agent: agentId,
        type: taskType,
        payload: payload,
        status: 'pending',
        dispatched_at: new Date().toISOString()
    };
    const taskPath = join(TASKS_DIR, `${taskId}.json`);
    const taskTmp  = taskPath + '.tmp';
    writeFileSync(taskTmp, JSON.stringify(task, null, 2));
    renameSync(taskTmp, taskPath);
    log('INFO', `Dispatched task ${taskId} -> ${agentId} (${taskType})`);
    return taskId;
}

function collectResults() {
    if (!existsSync(RESULTS_DIR)) return [];
    const files = readdirSync(RESULTS_DIR).filter(f => f.endsWith('.json'));
    const results = [];
    for (const f of files) {
        try {
            const data = JSON.parse(readFileSync(join(RESULTS_DIR, f), 'utf-8'));
            results.push(data);
            unlinkSync(join(RESULTS_DIR, f)); /* consume */
        } catch (_) { /* skip corrupt */ }
    }
    return results;
}

/* ---- Agent Registry ---- */

class OrchestratorAgent {
    constructor() {
        this.agents = [];
        this.running = false;
        this._init();
    }

    _init() {
        ensureDir(TASKS_DIR);
        ensureDir(RESULTS_DIR);
        ensureDir(HEARTBEATS_DIR);
        ensureDir(LOGS_DIR);

        log('INFO', '========================================');
        log('INFO', 'ZKAEDI VMAX Orchestrator Agent v2.5');
        log('INFO', '========================================');

        this._loadManifest();
        this._writeHeartbeat();
    }

    _loadManifest() {
        if (!existsSync(MANIFEST_PATH)) {
            log('WARN', `Manifest not found at ${MANIFEST_PATH}`);
            return;
        }
        try {
            const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
            this.agents = manifest.agents || [];
            log('INFO', `Loaded ${this.agents.length} agents from manifest`);
            for (const agent of this.agents) {
                log('INFO', `  [${agent.tier}] ${agent.id} -> ${agent.entrypoint} ` +
                    `(${agent.capabilities.join(', ')})`);
            }
        } catch (e) {
            log('ERROR', `Failed to parse manifest: ${e.message}`);
        }
    }

    _writeHeartbeat() {
        const hb = {
            agent_id: 'orchestrator',
            status: 'alive',
            timestamp: new Date().toISOString(),
            uptime_sec: process.uptime ? Math.floor(process.uptime()) : 0,
            registered_agents: this.agents.length
        };
        try {
            writeFileSync(join(HEARTBEATS_DIR, 'heartbeat_orchestrator.json'),
                          JSON.stringify(hb, null, 2));
        } catch (_) {}
    }

    /* Find agents matching a required capability */
    findAgentByCapability(capability) {
        return this.agents.filter(a => a.capabilities.includes(capability));
    }

    /* Dispatch a task to the first agent that has the required capability */
    dispatch(capability, payload) {
        const candidates = this.findAgentByCapability(capability);
        if (candidates.length === 0) {
            log('WARN', `No agent found with capability: ${capability}`);
            return null;
        }
        const target = candidates[0];
        return dispatchTask(target.id, capability, payload);
    }

    /* Check all agent heartbeats for staleness */
    checkHealth() {
        const now = Date.now();
        const report = [];
        for (const agent of this.agents) {
            if (!agent.health_check) {
                report.push({ id: agent.id, status: 'no_healthcheck' });
                continue;
            }
            const hbPath = join(ROOT, agent.health_check);
            if (!existsSync(hbPath)) {
                report.push({ id: agent.id, status: 'missing' });
                continue;
            }
            try {
                const hb = JSON.parse(readFileSync(hbPath, 'utf-8'));
                const age = (now - new Date(hb.timestamp).getTime()) / 1000;
                report.push({
                    id: agent.id,
                    status: age > HEARTBEAT_STALE_SEC ? 'stale' : 'alive',
                    age_sec: Math.round(age)
                });
            } catch (_) {
                report.push({ id: agent.id, status: 'corrupt' });
            }
        }
        return report;
    }

    /* Kill-switch: write a shutdown signal to all agents */
    killAll() {
        log('WARN', 'KILL SWITCH ACTIVATED — sending shutdown signal to all agents');
        const signal = {
            type: 'shutdown',
            timestamp: new Date().toISOString(),
            reason: 'orchestrator_kill_switch'
        };
        for (const agent of this.agents) {
            dispatchTask(agent.id, 'shutdown', signal);
        }
    }

    /* Main event loop */
    start() {
        this.running = true;
        log('INFO', 'Orchestrator event loop started');

        const tick = () => {
            if (!this.running) return;

            /* Update own heartbeat */
            this._writeHeartbeat();

            /* Collect completed results */
            const results = collectResults();
            for (const r of results) {
                log('INFO', `Result received: ${r.task_id} => ${r.status}`);
            }

            /* Health monitoring */
            const health = this.checkHealth();
            const stale = health.filter(h => h.status === 'stale' || h.status === 'missing');
            if (stale.length > 0) {
                log('WARN', `${stale.length} agents unhealthy: ${stale.map(s => s.id).join(', ')}`);
            }

            setTimeout(tick, POLL_INTERVAL_MS);
        };

        tick();
    }

    stop() {
        this.running = false;
        log('INFO', 'Orchestrator stopped');
    }
}

/* ---- Entrypoint ---- */

const orchestrator = new OrchestratorAgent();

/* Handle graceful shutdown */
process.on('SIGINT', () => {
    log('INFO', 'Received SIGINT — shutting down');
    orchestrator.stop();
    process.exit(0);
});
process.on('SIGTERM', () => {
    log('INFO', 'Received SIGTERM — shutting down');
    orchestrator.stop();
    process.exit(0);
});

orchestrator.start();

export { OrchestratorAgent };