/**
 * ZKAEDI VMAX Blockchain Audit Sub-Agent — Tier 1 Domain Specialist
 *
 * Provenance verification for 3D assets via:
 *  1. Offline SHA-256 hash verification
 *  2. On-chain eth_call to a StateHealer registry contract
 *  3. Provenance audit logging
 *
 * Hardened: input sanitization, retry with backoff, offline fallback.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, createReadStream }
    from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const IPC_HB_DIR = join(ROOT, 'ipc', 'heartbeats');
const LOGS_DIR   = join(ROOT, 'logs');
const PROVENANCE_LOG = join(LOGS_DIR, 'provenance_audit.log');

function ensureDir(d) { if (!existsSync(d)) mkdirSync(d, { recursive: true }); }

function log(msg) {
    const ts = new Date().toISOString();
    const line = `[${ts}] [BLOCKCHAIN_AUDIT] ${msg}`;
    console.log(line);
    ensureDir(LOGS_DIR);
    try { appendFileSync(PROVENANCE_LOG, line + '\n'); } catch(_) {}
}

function writeHeartbeat() {
    ensureDir(IPC_HB_DIR);
    writeFileSync(join(IPC_HB_DIR, 'heartbeat_blockchain_audit.json'),
        JSON.stringify({
            agent_id: 'blockchain_audit',
            status: 'alive',
            timestamp: new Date().toISOString(),
            capabilities: ['provenance_hash_audit', 'offline_sha256_verify', 'eth_call']
        }, null, 2));
}

/* ---- Input Sanitization ---- */

function isValidContractAddress(addr) {
    return typeof addr === 'string' && /^0x[0-9a-fA-F]{40,64}$/.test(addr);
}

function isValidHash(hash) {
    return typeof hash === 'string' && /^(0x)?[0-9a-fA-F]{64}$/.test(hash);
}

/* ---- SHA-256 File Hashing ---- */

function hashFileSync(filePath) {
    const data = readFileSync(filePath);
    return createHash('sha256').update(data).digest('hex');
}

/* ---- Retry with Exponential Backoff ---- */

async function fetchWithRetry(url, options, maxRetries = 3) {
    let delay = 500;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url, options);
            return response;
        } catch (e) {
            log(`  Attempt ${attempt}/${maxRetries} failed: ${e.message}`);
            if (attempt < maxRetries) {
                await new Promise(r => setTimeout(r, delay));
                delay *= 2;
            } else {
                throw e;
            }
        }
    }
}

export class BlockchainAuditSubAgent {
    constructor(contractAddress) {
        this.contract = contractAddress ||
            '0xbe6b267c42ba83e927cc2a52cdc9f6a18e10cc495ade3c6b9f6d797632cd3ad';

        if (!isValidContractAddress(this.contract)) {
            log(`WARNING: Contract address format invalid: ${this.contract}`);
        }

        writeHeartbeat();
        log(`Initialized — contract: ${this.contract.slice(0, 10)}...`);
    }

    /**
     * Offline hash verification: compute SHA-256 of a local file.
     */
    verifyFileHash(filePath, expectedHash = null) {
        log(`Offline verification: ${filePath}`);

        if (!existsSync(filePath)) {
            log(`  File not found: ${filePath}`);
            return { verified: false, error: 'File not found' };
        }

        const actualHash = hashFileSync(filePath);
        log(`  SHA-256: ${actualHash}`);

        if (expectedHash) {
            const clean = expectedHash.replace(/^0x/, '');
            const match = actualHash === clean;
            log(`  Expected: ${clean}`);
            log(`  Match: ${match ? 'YES ✓' : 'NO ✗'}`);
            return { verified: match, hash: actualHash, expected: clean };
        }

        return { verified: true, hash: actualHash };
    }

    /**
     * On-chain provenance audit via JSON-RPC eth_call.
     * Falls back to offline mode if network is unavailable.
     */
    async auditProvenanceHash(fileHash) {
        log(`Provenance audit: ${fileHash}`);

        if (!isValidHash(fileHash)) {
            log(`  Invalid hash format: ${fileHash}`);
            return { provenanceSecure: false, error: 'Invalid hash format' };
        }

        const cleanHash = fileHash.replace('0x', '');

        try {
            const res = await fetchWithRetry(
                'https://mainnet.infura.io/v3/mock-key',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        method: 'eth_call',
                        params: [{
                            to: this.contract,
                            data: '0x2e01df22' + cleanHash
                        }, 'latest'],
                        id: 1
                    })
                },
                3  /* max retries */
            );

            const data = await res.json();
            const registered = data.result && data.result !== '0x' &&
                              data.result !== '0x0000000000000000000000000000000000000000000000000000000000000000';

            log(`  On-chain result: ${registered ? 'REGISTERED ✓' : 'NOT FOUND'}`);

            writeHeartbeat();
            return {
                provenanceSecure: registered,
                verificationContract: this.contract,
                hash: fileHash,
                timestamp: new Date().toISOString()
            };
        } catch (e) {
            log(`  Network unavailable — falling back to offline mode`);
            writeHeartbeat();
            return {
                provenanceSecure: false,
                error: 'Offline fallback audit active',
                offlineHash: cleanHash,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Full audit: hash file locally → check on-chain registration.
     */
    async fullAudit(filePath) {
        log(`Full audit: ${filePath}`);
        const local = this.verifyFileHash(filePath);
        if (!local.verified && local.error) {
            return local;
        }
        const onchain = await this.auditProvenanceHash('0x' + local.hash);
        return {
            file: filePath,
            localHash: local.hash,
            onChain: onchain,
            timestamp: new Date().toISOString()
        };
    }
}
