/**
 * ZKAEDI VMAX Audio Reactive Sub-Agent — Tier 1 Domain Specialist
 *
 * Maps audio FFT frequency bands to thermodynamic reaction variables
 * for the morphic wave solver (D_H, epsilon, beta, gamma).
 */

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const IPC_HB_DIR  = join(ROOT, 'ipc', 'heartbeats');
const IPC_RES_DIR = join(ROOT, 'ipc', 'results');

function ensureDir(d) { if (!existsSync(d)) mkdirSync(d, { recursive: true }); }

function log(msg) {
    console.log(`[${new Date().toISOString()}] [AUDIO_REACTIVE] ${msg}`);
}

function writeHeartbeat() {
    ensureDir(IPC_HB_DIR);
    writeFileSync(join(IPC_HB_DIR, 'heartbeat_audio_reactive.json'),
        JSON.stringify({
            agent_id: 'audio_reactive',
            status: 'alive',
            timestamp: new Date().toISOString(),
            capabilities: ['fft_analysis', 'reaction_param_mapping']
        }, null, 2));
}

export class AudioReactiveSubAgent {
    constructor(fftSize = 1024) {
        this.fftSize = fftSize;
        this.bands = {
            sub_bass:    { min: 20,    max: 60 },
            bass:        { min: 60,    max: 250 },
            low_mid:     { min: 250,   max: 500 },
            mid:         { min: 500,   max: 2000 },
            upper_mid:   { min: 2000,  max: 4000 },
            presence:    { min: 4000,  max: 6000 },
            brilliance:  { min: 6000,  max: 20000 }
        };
        writeHeartbeat();
        log(`Initialized (FFT size: ${fftSize})`);
    }

    /**
     * Analyze an FFT magnitude buffer and extract energy per band.
     * @param {Float32Array|number[]} fftMagnitudes - FFT magnitude spectrum
     * @param {number} sampleRate - Audio sample rate (default 44100)
     * @returns {Object} Energy per frequency band (0.0 - 1.0 normalized)
     */
    analyzeFFT(fftMagnitudes, sampleRate = 44100) {
        const binCount = fftMagnitudes.length;
        const binFreqWidth = sampleRate / (2 * binCount);
        const bandEnergies = {};

        for (const [name, range] of Object.entries(this.bands)) {
            const startBin = Math.floor(range.min / binFreqWidth);
            const endBin = Math.min(Math.ceil(range.max / binFreqWidth), binCount - 1);

            let energy = 0;
            let count = 0;
            for (let i = startBin; i <= endBin; i++) {
                energy += Math.abs(fftMagnitudes[i] || 0);
                count++;
            }
            bandEnergies[name] = count > 0 ? energy / count : 0;
        }

        // Normalize to 0..1 range
        const maxEnergy = Math.max(...Object.values(bandEnergies), 0.001);
        for (const name of Object.keys(bandEnergies)) {
            bandEnergies[name] /= maxEnergy;
        }

        log(`FFT analyzed: ${binCount} bins, ${Object.keys(bandEnergies).length} bands`);
        return bandEnergies;
    }

    /**
     * Map FFT band energies to morphic wave reaction parameters.
     *
     * Mapping:
     *   D_u (diffusion)  ← bass energy (controls reaction spread rate)
     *   epsilon          ← mid energy (controls activation threshold)
     *   beta             ← presence energy (controls inhibitor strength)
     *   gamma            ← brilliance energy (controls recovery rate)
     *
     * @param {Object} bandEnergies - Output from analyzeFFT()
     * @returns {Object} Reaction parameters { D_u, epsilon, beta, gamma }
     */
    mapToReactionParams(bandEnergies) {
        const params = {
            D_u:     0.01 + (bandEnergies.bass || 0) * 0.09,
            epsilon: 0.02 + (bandEnergies.mid || 0) * 0.18,
            beta:    0.40 + (bandEnergies.presence || 0) * 0.60,
            gamma:   0.80 + (bandEnergies.brilliance || 0) * 1.20
        };

        log(`Reaction params: D_u=${params.D_u.toFixed(4)}, ε=${params.epsilon.toFixed(4)}, ` +
            `β=${params.beta.toFixed(4)}, γ=${params.gamma.toFixed(4)}`);

        // Emit to IPC
        this._emitReactionUpdate(params, bandEnergies);

        writeHeartbeat();
        return params;
    }

    /**
     * Full pipeline: FFT → band analysis → reaction parameter mapping
     */
    processAudioFrame(fftMagnitudes, sampleRate = 44100) {
        const bands = this.analyzeFFT(fftMagnitudes, sampleRate);
        return this.mapToReactionParams(bands);
    }

    _emitReactionUpdate(params, bandEnergies) {
        ensureDir(IPC_RES_DIR);
        const result = {
            task_id: `audio_reaction_${Date.now()}`,
            agent_id: 'audio_reactive',
            type: 'reaction_param_update',
            status: 'success',
            params,
            band_energies: bandEnergies,
            timestamp: new Date().toISOString()
        };
        writeFileSync(
            join(IPC_RES_DIR, `result_audio_${Date.now()}.json`),
            JSON.stringify(result, null, 2)
        );
    }
}