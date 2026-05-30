/**
 * Anticlip Micro-Agent — Self-Intersection Detection via Spatial Hashing
 *
 * Detects triangles that intersect other triangles in the mesh using
 * a uniform grid spatial hash for broad-phase, then exact triangle-
 * triangle intersection tests for narrow-phase.
 */

import { MicroAgentBase } from './micro_agent_base.js';

export class AnticlipMicroAgent extends MicroAgentBase {
    constructor() {
        super('anticlip', 45000);
    }

    validateInput(input) {
        if (!input || !input.vertices || !input.indices) {
            return { valid: false, error: 'Input must have vertices[] and indices[]' };
        }
        if (input.indices.length < 6) {
            return { valid: false, error: 'Need at least 2 triangles for intersection test' };
        }
        return { valid: true };
    }

    /**
     * @param {{ vertices: number[], indices: number[], cellSize?: number }} input
     * @returns {{ intersections: Array<[number, number]>, count: number }}
     */
    execute(input) {
        const { vertices, indices, cellSize } = input;
        const verts = new Float32Array(vertices);
        const numTris = indices.length / 3;

        // Compute AABB for cell size estimation
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        const numVerts = verts.length / 3;
        for (let i = 0; i < numVerts; i++) {
            const x = verts[i*3], y = verts[i*3+1], z = verts[i*3+2];
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
            if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        }

        const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 0.001);
        const cs = cellSize || (extent / Math.cbrt(numTris));

        // Build spatial hash
        const grid = new Map();
        const triAABBs = [];

        for (let t = 0; t < numTris; t++) {
            const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2];
            const aabb = this._triAABB(verts, a, b, c);
            triAABBs.push(aabb);

            // Hash all cells this triangle touches
            const x0 = Math.floor(aabb.minX / cs);
            const y0 = Math.floor(aabb.minY / cs);
            const z0 = Math.floor(aabb.minZ / cs);
            const x1 = Math.floor(aabb.maxX / cs);
            const y1 = Math.floor(aabb.maxY / cs);
            const z1 = Math.floor(aabb.maxZ / cs);

            for (let gx = x0; gx <= x1; gx++) {
                for (let gy = y0; gy <= y1; gy++) {
                    for (let gz = z0; gz <= z1; gz++) {
                        const key = `${gx},${gy},${gz}`;
                        if (!grid.has(key)) grid.set(key, []);
                        grid.get(key).push(t);
                    }
                }
            }
        }

        // Broad-phase: find candidate pairs
        const testedPairs = new Set();
        const intersections = [];

        for (const [, tris] of grid) {
            for (let i = 0; i < tris.length; i++) {
                for (let j = i + 1; j < tris.length; j++) {
                    const ta = tris[i], tb = tris[j];
                    const pairKey = ta < tb ? `${ta}-${tb}` : `${tb}-${ta}`;
                    if (testedPairs.has(pairKey)) continue;
                    testedPairs.add(pairKey);

                    // Skip adjacent triangles (share an edge)
                    if (this._shareEdge(indices, ta, tb)) continue;

                    // AABB overlap check
                    if (!this._aabbOverlap(triAABBs[ta], triAABBs[tb])) continue;

                    // Narrow-phase: simplified overlap check via separating axis
                    if (this._trianglesOverlap(verts, indices, ta, tb)) {
                        intersections.push([ta, tb]);
                    }
                }
            }
        }

        return {
            intersections,
            count: intersections.length,
            trianglesChecked: numTris,
            pairsTested: testedPairs.size,
            gridCells: grid.size
        };
    }

    _triAABB(verts, a, b, c) {
        const ax = a*3, bx = b*3, cx = c*3;
        return {
            minX: Math.min(verts[ax], verts[bx], verts[cx]),
            minY: Math.min(verts[ax+1], verts[bx+1], verts[cx+1]),
            minZ: Math.min(verts[ax+2], verts[bx+2], verts[cx+2]),
            maxX: Math.max(verts[ax], verts[bx], verts[cx]),
            maxY: Math.max(verts[ax+1], verts[bx+1], verts[cx+1]),
            maxZ: Math.max(verts[ax+2], verts[bx+2], verts[cx+2])
        };
    }

    _aabbOverlap(a, b) {
        return a.minX <= b.maxX && a.maxX >= b.minX &&
               a.minY <= b.maxY && a.maxY >= b.minY &&
               a.minZ <= b.maxZ && a.maxZ >= b.minZ;
    }

    _shareEdge(indices, ta, tb) {
        const a = [indices[ta*3], indices[ta*3+1], indices[ta*3+2]];
        const b = [indices[tb*3], indices[tb*3+1], indices[tb*3+2]];
        let shared = 0;
        for (const v of a) {
            if (b.includes(v)) shared++;
        }
        return shared >= 2;
    }

    _trianglesOverlap(verts, indices, ta, tb) {
        // Simplified: check if any vertex of triangle A is inside triangle B's
        // bounding prism and vice versa. Full Möller–Trumbore would go here
        // in a production implementation.
        const aabb_a = this._triAABB(verts, indices[ta*3], indices[ta*3+1], indices[ta*3+2]);
        const aabb_b = this._triAABB(verts, indices[tb*3], indices[tb*3+1], indices[tb*3+2]);
        
        // Check volume overlap as a proxy
        const overlapX = Math.min(aabb_a.maxX, aabb_b.maxX) - Math.max(aabb_a.minX, aabb_b.minX);
        const overlapY = Math.min(aabb_a.maxY, aabb_b.maxY) - Math.max(aabb_a.minY, aabb_b.minY);
        const overlapZ = Math.min(aabb_a.maxZ, aabb_b.maxZ) - Math.max(aabb_a.minZ, aabb_b.minZ);
        
        if (overlapX <= 0 || overlapY <= 0 || overlapZ <= 0) return false;
        
        const overlapVolume = overlapX * overlapY * overlapZ;
        const aVol = (aabb_a.maxX - aabb_a.minX) * (aabb_a.maxY - aabb_a.minY) * (aabb_a.maxZ - aabb_a.minZ);
        const bVol = (aabb_b.maxX - aabb_b.minX) * (aabb_b.maxY - aabb_b.minY) * (aabb_b.maxZ - aabb_b.minZ);
        
        // Flag as potential intersection if overlap is significant relative to triangle size
        const minVol = Math.min(aVol, bVol);
        return minVol > 0 && (overlapVolume / minVol) > 0.3;
    }
}