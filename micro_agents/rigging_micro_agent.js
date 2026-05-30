/**
 * Rigging Micro-Agent — Automatic Bone Placement
 *
 * Places bones inside a mesh using bounding-box axis partitioning.
 * Generates a skeleton hierarchy suitable for real-time animation.
 */

import { MicroAgentBase } from './micro_agent_base.js';

export class RiggingMicroAgent extends MicroAgentBase {
    constructor() {
        super('rigging', 30000);
    }

    validateInput(input) {
        if (!input || !input.vertices) {
            return { valid: false, error: 'Input must have vertices[]' };
        }
        if (input.vertices.length < 9) {
            return { valid: false, error: 'Mesh too small for rigging (need >= 3 vertices)' };
        }
        return { valid: true };
    }

    /**
     * @param {{ vertices: number[], maxBones?: number }} input
     * @returns {{ bones: Array<{name, head, tail, parent}> }}
     */
    execute(input) {
        const { vertices, maxBones = 8 } = input;
        const verts = new Float32Array(vertices);
        const numVerts = verts.length / 3;

        // Compute AABB
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (let i = 0; i < numVerts; i++) {
            const x = verts[i*3], y = verts[i*3+1], z = verts[i*3+2];
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
            if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        }

        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const cz = (minZ + maxZ) / 2;
        const height = maxY - minY;

        // Generate bones along the longest axis (assumed Y for humanoid)
        const bones = [];
        const segmentHeight = height / maxBones;

        // Root bone at base
        bones.push({
            name: 'root',
            head: [cx, minY, cz],
            tail: [cx, minY + segmentHeight, cz],
            parent: null
        });

        // Spine chain
        for (let i = 1; i < maxBones; i++) {
            const y0 = minY + segmentHeight * i;
            const y1 = y0 + segmentHeight;
            bones.push({
                name: `bone_${i}`,
                head: [cx, y0, cz],
                tail: [cx, Math.min(y1, maxY), cz],
                parent: i === 1 ? 'root' : `bone_${i - 1}`
            });
        }

        return {
            bones,
            boundingBox: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
            center: [cx, cy, cz]
        };
    }
}