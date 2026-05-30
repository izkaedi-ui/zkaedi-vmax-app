/**
 * Retopo Micro-Agent — Quadric Edge-Collapse Retopology
 *
 * Simplifies mesh geometry by iteratively collapsing the lowest-cost
 * edges using a quadric error metric approximation.
 */

import { MicroAgentBase } from './micro_agent_base.js';

export class RetopoloMicroAgent extends MicroAgentBase {
    constructor() {
        super('retopo', 60000);
    }

    validateInput(input) {
        if (!input || !input.vertices || !input.indices) {
            return { valid: false, error: 'Input must have vertices[] and indices[]' };
        }
        if (input.vertices.length < 9 || input.indices.length < 3) {
            return { valid: false, error: 'Mesh too small for retopology' };
        }
        return { valid: true };
    }

    /**
     * @param {{ vertices: number[], indices: number[], targetFaces: number }} input
     * @returns {{ vertices: number[], indices: number[], facesRemoved: number }}
     */
    execute(input) {
        const { vertices, indices, targetFaces = Math.floor(indices.length / 6) } = input;
        const verts = new Float32Array(vertices);
        const tris = [...indices];
        const numVerts = verts.length / 3;
        const initialFaces = tris.length / 3;
        let currentFaces = initialFaces;

        // Build edge list with quadric error costs
        const edges = [];
        for (let i = 0; i < tris.length; i += 3) {
            const a = tris[i], b = tris[i+1], c = tris[i+2];
            edges.push([a, b, this._edgeCost(verts, a, b)]);
            edges.push([b, c, this._edgeCost(verts, b, c)]);
            edges.push([c, a, this._edgeCost(verts, c, a)]);
        }

        // Sort by cost (ascending)
        edges.sort((x, y) => x[2] - y[2]);

        // Collapse edges until target face count
        const collapsed = new Set();
        let collapseCount = 0;
        for (const [a, b, cost] of edges) {
            if (currentFaces <= targetFaces) break;
            if (collapsed.has(a) || collapsed.has(b)) continue;

            // Collapse b into a (midpoint)
            const ax = a * 3, bx = b * 3;
            verts[ax]     = (verts[ax] + verts[bx]) / 2;
            verts[ax + 1] = (verts[ax + 1] + verts[bx + 1]) / 2;
            verts[ax + 2] = (verts[ax + 2] + verts[bx + 2]) / 2;

            // Remap indices
            for (let i = 0; i < tris.length; i++) {
                if (tris[i] === b) tris[i] = a;
            }

            collapsed.add(b);
            currentFaces = Math.max(1, currentFaces - 2);
            collapseCount++;
        }

        // Remove degenerate triangles
        const cleanTris = [];
        for (let i = 0; i < tris.length; i += 3) {
            const a = tris[i], b = tris[i+1], c = tris[i+2];
            if (a !== b && b !== c && c !== a) {
                cleanTris.push(a, b, c);
            }
        }

        return {
            vertices: Array.from(verts),
            indices: cleanTris,
            facesRemoved: initialFaces - (cleanTris.length / 3),
            collapsesPerformed: collapseCount
        };
    }

    _edgeCost(verts, a, b) {
        const ax = a * 3, bx = b * 3;
        const dx = verts[ax] - verts[bx];
        const dy = verts[ax+1] - verts[bx+1];
        const dz = verts[ax+2] - verts[bx+2];
        return dx * dx + dy * dy + dz * dz;
    }
}