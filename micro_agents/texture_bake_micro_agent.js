/**
 * Texture Bake Micro-Agent — UV Atlas Baking
 *
 * Transfers detail from high-poly source data onto a low-poly mesh's
 * UV space, producing per-texel color/normal maps via barycentric
 * interpolation.
 */

import { MicroAgentBase } from './micro_agent_base.js';

export class TextureBakeMicroAgent extends MicroAgentBase {
    constructor() {
        super('texture_bake', 60000);
    }

    validateInput(input) {
        if (!input || !input.uvs || !input.indices) {
            return { valid: false, error: 'Input must have uvs[] and indices[]' };
        }
        if (!input.resolution || input.resolution < 1 || input.resolution > 8192) {
            return { valid: false, error: 'Resolution must be 1-8192' };
        }
        return { valid: true };
    }

    /**
     * Bake vertex colors or normals into a texture atlas.
     *
     * @param {{
     *   uvs: number[],         // UV coords (2 per vertex)
     *   indices: number[],     // Triangle indices
     *   vertexColors: number[],// RGB per vertex (3 per vertex)
     *   resolution: number     // Texture resolution (width = height)
     * }} input
     *
     * @returns {{
     *   pixels: number[],      // RGBA flat array (resolution * resolution * 4)
     *   resolution: number,
     *   coverage: number       // Percentage of texels filled
     * }}
     */
    execute(input) {
        const { uvs, indices, vertexColors, resolution } = input;
        const width = resolution;
        const height = resolution;
        const pixels = new Uint8Array(width * height * 4);
        let filledTexels = 0;

        // For each triangle
        for (let t = 0; t < indices.length; t += 3) {
            const i0 = indices[t], i1 = indices[t+1], i2 = indices[t+2];

            // UV coordinates
            const u0 = uvs[i0*2], v0 = uvs[i0*2+1];
            const u1 = uvs[i1*2], v1 = uvs[i1*2+1];
            const u2 = uvs[i2*2], v2 = uvs[i2*2+1];

            // Vertex colors
            const c0 = vertexColors ? [vertexColors[i0*3], vertexColors[i0*3+1], vertexColors[i0*3+2]] : [255, 255, 255];
            const c1 = vertexColors ? [vertexColors[i1*3], vertexColors[i1*3+1], vertexColors[i1*3+2]] : [255, 255, 255];
            const c2 = vertexColors ? [vertexColors[i2*3], vertexColors[i2*3+1], vertexColors[i2*3+2]] : [255, 255, 255];

            // Rasterize triangle in UV space
            const pixMinX = Math.max(0, Math.floor(Math.min(u0, u1, u2) * width));
            const pixMaxX = Math.min(width - 1, Math.ceil(Math.max(u0, u1, u2) * width));
            const pixMinY = Math.max(0, Math.floor(Math.min(v0, v1, v2) * height));
            const pixMaxY = Math.min(height - 1, Math.ceil(Math.max(v0, v1, v2) * height));

            for (let py = pixMinY; py <= pixMaxY; py++) {
                for (let px = pixMinX; px <= pixMaxX; px++) {
                    const su = (px + 0.5) / width;
                    const sv = (py + 0.5) / height;

                    // Barycentric coordinates
                    const bary = this._barycentric(su, sv, u0, v0, u1, v1, u2, v2);
                    if (bary.w0 < 0 || bary.w1 < 0 || bary.w2 < 0) continue;

                    // Interpolate color
                    const r = Math.round(bary.w0 * c0[0] + bary.w1 * c1[0] + bary.w2 * c2[0]);
                    const g = Math.round(bary.w0 * c0[1] + bary.w1 * c1[1] + bary.w2 * c2[1]);
                    const b = Math.round(bary.w0 * c0[2] + bary.w1 * c1[2] + bary.w2 * c2[2]);

                    const idx = (py * width + px) * 4;
                    if (pixels[idx + 3] === 0) filledTexels++; // Only count first write
                    pixels[idx]     = Math.min(255, Math.max(0, r));
                    pixels[idx + 1] = Math.min(255, Math.max(0, g));
                    pixels[idx + 2] = Math.min(255, Math.max(0, b));
                    pixels[idx + 3] = 255;
                }
            }
        }

        const totalTexels = width * height;
        return {
            pixels: Array.from(pixels),
            resolution,
            coverage: ((filledTexels / totalTexels) * 100).toFixed(2) + '%',
            filledTexels,
            totalTexels
        };
    }

    _barycentric(px, py, x0, y0, x1, y1, x2, y2) {
        const d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
        if (Math.abs(d) < 1e-12) return { w0: -1, w1: -1, w2: -1 };
        const w0 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / d;
        const w1 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / d;
        const w2 = 1 - w0 - w1;
        return { w0, w1, w2 };
    }
}