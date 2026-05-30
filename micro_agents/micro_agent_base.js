/**
 * ZKAEDI VMAX Micro-Agent Base Class — Tier 2 Worker Foundation
 *
 * Provides:
 *  - Input validation and sanitization
 *  - IPC status reporting
 *  - Task timeout enforcement
 *  - Standardized execute() interface
 */

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename_base = fileURLToPath(import.meta.url);
const __dirname_base = dirname(__filename_base);
const ROOT = join(__dirname_base, '..');

const IPC_RES_DIR = join(ROOT, 'ipc', 'results');

function ensureDir(d) { if (!existsSync(d)) mkdirSync(d, { recursive: true }); }

export class MicroAgentBase {
    /**
     * @param {string} agentId - Unique agent identifier
     * @param {number} timeoutMs - Maximum execution time in milliseconds
     */
    constructor(agentId, timeoutMs = 30000) {
        this.agentId = agentId;
        this.timeoutMs = timeoutMs;
        this.startTime = null;
    }

    /**
     * Validate input before processing. Override in subclasses for
     * domain-specific validation.
     * @returns {{ valid: boolean, error?: string }}
     */
    validateInput(input) {
        if (input === null || input === undefined) {
            return { valid: false, error: 'Input is null or undefined' };
        }
        return { valid: true };
    }

    /**
     * Abstract execute method. MUST be overridden by subclasses.
     * @param {*} input - Task-specific input data
     * @returns {*} Task-specific output
     */
    execute(input) {
        throw new Error(`${this.agentId}: execute() not implemented`);
    }

    /**
     * Run the agent with timeout enforcement and IPC reporting.
     */
    run(input, taskId = null) {
        const id = taskId || `${this.agentId}_${Date.now()}`;
        this.startTime = Date.now();

        // Validate
        const validation = this.validateInput(input);
        if (!validation.valid) {
            const result = {
                task_id: id, agent_id: this.agentId,
                status: 'rejected', error: validation.error,
                timestamp: new Date().toISOString()
            };
            this._reportResult(result);
            return result;
        }

        // Execute with timeout
        try {
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('TIMEOUT')), this.timeoutMs);
            });

            // For synchronous execute(), just run it directly
            const output = this.execute(input);
            const elapsed = Date.now() - this.startTime;

            if (elapsed > this.timeoutMs) {
                throw new Error('TIMEOUT');
            }

            const result = {
                task_id: id, agent_id: this.agentId,
                status: 'success', output,
                elapsed_ms: elapsed,
                timestamp: new Date().toISOString()
            };
            this._reportResult(result);
            return result;
        } catch (e) {
            const result = {
                task_id: id, agent_id: this.agentId,
                status: e.message === 'TIMEOUT' ? 'timeout' : 'error',
                error: e.message,
                elapsed_ms: Date.now() - this.startTime,
                timestamp: new Date().toISOString()
            };
            this._reportResult(result);
            return result;
        }
    }

    _reportResult(result) {
        ensureDir(IPC_RES_DIR);
        const fname = `result_${this.agentId}_${Date.now()}.json`;
        try {
            writeFileSync(join(IPC_RES_DIR, fname),
                          JSON.stringify(result, null, 2));
        } catch (_) {}
    }
}
