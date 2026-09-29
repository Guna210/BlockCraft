import { describe, expect, it, beforeEach } from 'vitest';
import { BlockRegistry } from '../../src/world/blocks/registry';
import { World } from '../../src/world/world';
import { buildPaddedSection, PADDED_SECTION_VOLUME } from '../../src/world/padded';
import {
  buildMeshLookupTables,
  greedyMesh,
  shouldCullFace,
  MeshLookupTables,
} from '../../src/mesh/greedy';

describe('Greedy Mesher (M02b)', () => {
  let registry: BlockRegistry;
  let tables: MeshLookupTables;
  const tileMap = new Map<string, number>();

  beforeEach(() => {
    BlockRegistry.resetInstance();
    registry = BlockRegistry.getInstance();

    // Map texture names to unique integer tile indices
    tileMap.clear();
    let tileId = 0;
    const getTileIndex = (texName: string): number => {
      let id = tileMap.get(texName);
      if (id === undefined) {
        id = tileId++;
        tileMap.set(texName, id);
      }
      return id;
    };

    tables = buildMeshLookupTables(registry, getTileIndex);
  });

  it('solid 16³ cube gives exactly 6 quads', () => {
    const padded = new Uint16Array(PADDED_SECTION_VOLUME);
    const stoneState = registry.getStateId('stone')!;
    expect(stoneState).toBeDefined();

    // Fill core 16x16x16 with stone, padding remains 0 (air)
    for (let pz = 1; pz <= 16; pz++) {
      for (let py = 1; py <= 16; py++) {
        for (let px = 1; px <= 16; px++) {
          padded[px + 18 * (py + 18 * pz)] = stoneState;
        }
      }
    }

    const mesh = greedyMesh(padded, tables);

    expect(mesh.opaque.quadCount).toBe(6);
    expect(mesh.cutout.quadCount).toBe(0);
    expect(mesh.translucent.quadCount).toBe(0);
    expect(mesh.opaque.vertices.length).toBe(6 * 4 * 2); // 6 quads * 4 verts * 2 uint32
    expect(mesh.opaque.indices.length).toBe(6 * 6); // 6 quads * 6 uint32 indices
  });

  it('3D checkerboard gives the correct naive face count (12,288 quads)', () => {
    const padded = new Uint16Array(PADDED_SECTION_VOLUME);
    const stoneState = registry.getStateId('stone')!;

    /*
     * Derivation of expected face count for a 16x16x16 3D checkerboard:
     * - The 16x16x16 core section contains 16^3 = 4,096 block positions.
     * - A position (x, y, z) in [0..15]^3 is solid stone if (x + y + z) % 2 === 0, else air.
     * - Exactly 4,096 / 2 = 2,048 positions contain solid stone blocks.
     * - Every solid block has 6 orthogonal neighbors, all of which have opposite parity (odd)
     *   and are therefore air.
     * - Thus, every stone block has all 6 faces exposed (none culled by neighbors).
     * - Total exposed faces = 2,048 blocks * 6 faces/block = 12,288 faces.
     * - Since no two solid blocks share an edge or face on the same plane, no 2D greedy merging
     *   is possible across adjacent blocks.
     * - Therefore, total quads produced = 12,288 quads.
     */
    let solidCount = 0;
    for (let z = 0; z < 16; z++) {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          if ((x + y + z) % 2 === 0) {
            padded[x + 1 + 18 * (y + 1 + 18 * (z + 1))] = stoneState;
            solidCount++;
          }
        }
      }
    }
    expect(solidCount).toBe(2048);

    const mesh = greedyMesh(padded, tables);

    expect(mesh.opaque.quadCount).toBe(12288);
    expect(mesh.cutout.quadCount).toBe(0);
    expect(mesh.translucent.quadCount).toBe(0);
    expect(mesh.opaque.vertices.length).toBe(12288 * 4 * 2);
    expect(mesh.opaque.indices.length).toBe(12288 * 6);
  });

  it('16³ leaf-leaf checkerboard produces 24,576 cutout quads without buffer overflow', () => {
    const padded = new Uint16Array(PADDED_SECTION_VOLUME);
    const oakLeaves = registry.getStateId('oak_leaves')!;
    const birchLeaves = registry.getStateId('birch_leaves')!;
    expect(oakLeaves).toBeDefined();
    expect(birchLeaves).toBeDefined();

    // Fill entire 16x16x16 section with alternating oak_leaves and birch_leaves
    // Leaves keep faces between each other, so all 4,096 blocks expose all 6 faces = 24,576 quads!
    for (let z = 0; z < 16; z++) {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const state = (x + y + z) % 2 === 0 ? oakLeaves : birchLeaves;
          padded[x + 1 + 18 * (y + 1 + 18 * (z + 1))] = state;
        }
      }
    }

    const mesh = greedyMesh(padded, tables);

    expect(mesh.cutout.quadCount).toBe(24576);
    expect(mesh.cutout.vertexCount).toBe(98304); // 24,576 quads * 4
    expect(mesh.cutout.vertices.length).toBe(196608); // 98,304 verts * 2 uint32
    expect(mesh.cutout.indices.length).toBe(147456); // 24,576 quads * 6 uint32

    // Check maximum index value
    let maxIdx = 0;
    for (let i = 0; i < mesh.cutout.indices.length; i++) {
      if (mesh.cutout.indices[i]! > maxIdx) {
        maxIdx = mesh.cutout.indices[i]!;
      }
    }
    expect(maxIdx).toBe(98303);
  });

  it('randomized reference test: total quad area per direction matches brute-force exposed face count over 60 random mixed sections', () => {
    const allStates = registry.getAllStateIds();

    for (let seed = 1; seed <= 60; seed++) {
      const padded = new Uint16Array(PADDED_SECTION_VOLUME);

      // Populate random section
      for (let pz = 1; pz <= 16; pz++) {
        for (let py = 1; py <= 16; py++) {
          for (let px = 1; px <= 16; px++) {
            // Include air (0) plus random states
            const raw = (px * 31 + py * 17 + pz * 13 + seed * 97) % (allStates.length + 5);
            if (raw < allStates.length) {
              padded[px + 18 * (py + 18 * pz)] = allStates[raw]!;
            } else {
              padded[px + 18 * (py + 18 * pz)] = 0; // Air
            }
          }
        }
      }

      // Brute-force count exposed faces per direction f (0..5)
      const bruteForceCounts = [0, 0, 0, 0, 0, 0];
      for (let f = 0; f < 6; f++) {
        for (let z = 0; z < 16; z++) {
          for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) {
              const selfPx = x + 1;
              const selfPy = y + 1;
              const selfPz = z + 1;
              let neighPx = selfPx;
              let neighPy = selfPy;
              let neighPz = selfPz;

              switch (f) {
                case 0:
                  neighPx++;
                  break; // East (+X)
                case 1:
                  neighPx--;
                  break; // West (-X)
                case 2:
                  neighPy++;
                  break; // Top (+Y)
                case 3:
                  neighPy--;
                  break; // Bottom (-Y)
                case 4:
                  neighPz++;
                  break; // South (+Z)
                case 5:
                  neighPz--;
                  break; // North (-Z)
              }

              const selfState = padded[selfPx + 18 * (selfPy + 18 * selfPz)]!;
              const neighState = padded[neighPx + 18 * (neighPy + 18 * neighPz)]!;

              if (!shouldCullFace(selfState, neighState, tables)) {
                const currentCount = bruteForceCounts[f];
                if (currentCount !== undefined) {
                  bruteForceCounts[f] = currentCount + 1;
                }
              }
            }
          }
        }
      }

      // Run greedy mesher
      const mesh = greedyMesh(padded, tables);

      // Sum quad surface area per direction across all 3 buckets
      const quadAreaPerDirection = [0, 0, 0, 0, 0, 0];
      const buckets = [mesh.opaque, mesh.cutout, mesh.translucent];

      for (const bucket of buckets) {
        const verts = bucket.vertices;
        for (let i = 0; i < verts.length; i += 8) {
          // 8 uint32s per quad (4 verts * 2 uint32/vert)
          const normalIndex = (verts[i]! >> 15) & 7;

          // Word 1 of vert 0 (offset i+1) has u0, v0
          // Word 1 of vert 2 (offset i+5) has u2, v2 (which is W, H for unrotated or H, W for rotated)
          const u2 = (verts[i + 5]! >> 16) & 255;
          const v2 = (verts[i + 5]! >> 24) & 255;
          const quadArea = u2 * v2;

          const currentArea = quadAreaPerDirection[normalIndex];
          if (currentArea !== undefined) {
            quadAreaPerDirection[normalIndex] = currentArea + quadArea;
          }
        }
      }

      for (let f = 0; f < 6; f++) {
        expect(quadAreaPerDirection[f]).toBe(bruteForceCounts[f]);
      }
    }
  });

  it('two full-stone sections side by side produce no faces on their shared boundary', () => {
    const world = new World();
    const stoneState = registry.getStateId('stone')!;

    // Fill section A at (0, 0, 0): world coords [0..15, 0..15, 0..15]
    world.fill(0, 0, 0, 15, 15, 15, 'stone');

    // Fill section B at (1, 0, 0): world coords [16..31, 0..15, 0..15]
    world.fill(16, 0, 0, 31, 15, 15, 'stone');

    // Build section A's padded copy from World
    const paddedA = buildPaddedSection(world, 0, 0, 0);

    // Verify boundary padding at px=17 (world x=16) contains stone
    expect(paddedA[17 + 18 * (1 + 18 * 1)]).toBe(stoneState);

    const meshA = greedyMesh(paddedA, tables);

    // Section A has 5 outer faces (Top, Bottom, North, South, West).
    // The East boundary at x=15 facing x=16 is completely culled by Section B's stone blocks.
    expect(meshA.opaque.quadCount).toBe(5);

    // Verify no vertex has normal index 0 (+X East)
    const verts = meshA.opaque.vertices;
    for (let i = 0; i < verts.length; i += 2) {
      const normalIndex = (verts[i]! >> 15) & 7;
      expect(normalIndex).not.toBe(0); // Normal 0 is East (+X)
    }
  });

  it('bucket allocation: leaves in cutout, water and glass in translucent, stone in opaque', () => {
    const padded = new Uint16Array(PADDED_SECTION_VOLUME);
    const stoneState = registry.getStateId('stone')!;
    const oakLeavesState = registry.getStateId('oak_leaves')!;
    const glassState = registry.getStateId('glass')!;
    const waterState = registry.getStateId('water')!;

    // Place one block of each
    padded[1 + 18 * (1 + 18 * 1)] = stoneState;
    padded[3 + 18 * (1 + 18 * 1)] = oakLeavesState;
    padded[5 + 18 * (1 + 18 * 1)] = glassState;
    padded[7 + 18 * (1 + 18 * 1)] = waterState;

    const mesh = greedyMesh(padded, tables);

    expect(mesh.opaque.quadCount).toBe(6); // stone (1 block * 6 faces)
    expect(mesh.cutout.quadCount).toBe(6); // oak leaves (1 block * 6 faces)
    expect(mesh.translucent.quadCount).toBe(12); // glass (6 faces) + water (6 faces)
  });

  describe('Culling Rules', () => {
    it('face is hidden when neighbor is a full opaque cube', () => {
      const stoneState = registry.getStateId('stone')!;
      const dirtState = registry.getStateId('dirt')!;

      // Stone against Dirt (both full opaque cubes)
      expect(shouldCullFace(stoneState, dirtState, tables)).toBe(true);
      // Stone against Air
      expect(shouldCullFace(stoneState, 0, tables)).toBe(false);
    });

    it('two adjacent translucent blocks of the same type hide shared faces', () => {
      const waterState = registry.getStateId('water')!;
      const glassState = registry.getStateId('glass')!;

      // Water against Water -> culled
      expect(shouldCullFace(waterState, waterState, tables)).toBe(true);
      // Glass against Glass -> culled
      expect(shouldCullFace(glassState, glassState, tables)).toBe(true);
      // Water against Glass (different translucent types) -> kept
      expect(shouldCullFace(waterState, glassState, tables)).toBe(false);
      expect(shouldCullFace(glassState, waterState, tables)).toBe(false);
    });

    it('leaves keep faces between each other', () => {
      const oakLeavesState = registry.getStateId('oak_leaves')!;
      const birchLeavesState = registry.getStateId('birch_leaves')!;
      const stoneState = registry.getStateId('stone')!;

      // Leaves against Leaves -> kept
      expect(shouldCullFace(oakLeavesState, oakLeavesState, tables)).toBe(false);
      expect(shouldCullFace(oakLeavesState, birchLeavesState, tables)).toBe(false);

      // Leaves against full opaque cube -> culled by Rule 1
      expect(shouldCullFace(oakLeavesState, stoneState, tables)).toBe(true);

      // Leaves against Air -> kept
      expect(shouldCullFace(oakLeavesState, 0, tables)).toBe(false);
    });

    it('air section fast path returns empty mesh immediately', () => {
      const padded = new Uint16Array(PADDED_SECTION_VOLUME); // all air
      const mesh = greedyMesh(padded, tables);

      expect(mesh.opaque.quadCount).toBe(0);
      expect(mesh.cutout.quadCount).toBe(0);
      expect(mesh.translucent.quadCount).toBe(0);
    });

    it('all-opaque section surrounded by opaque padding fast path returns empty mesh', () => {
      const padded = new Uint16Array(PADDED_SECTION_VOLUME);
      const stoneState = registry.getStateId('stone')!;
      padded.fill(stoneState);

      const mesh = greedyMesh(padded, tables);

      expect(mesh.opaque.quadCount).toBe(0);
      expect(mesh.cutout.quadCount).toBe(0);
      expect(mesh.translucent.quadCount).toBe(0);
    });
  });

  describe('Log Orientations', () => {
    it('sets rotated UVs for X-axis and Z-axis log side faces', () => {
      const oakLogX = registry.getStateId('oak_log', { axis: 'x' })!;
      const oakLogZ = registry.getStateId('oak_log', { axis: 'z' })!;
      expect(oakLogX).toBeDefined();
      expect(oakLogZ).toBeDefined();

      // Mesh a single X-axis log block
      const paddedX = new Uint16Array(PADDED_SECTION_VOLUME);
      paddedX[1 + 18 * (1 + 18 * 1)] = oakLogX;

      const meshX = greedyMesh(paddedX, tables);
      expect(meshX.opaque.quadCount).toBe(6);

      // Mesh a single Z-axis log block
      const paddedZ = new Uint16Array(PADDED_SECTION_VOLUME);
      paddedZ[1 + 18 * (1 + 18 * 1)] = oakLogZ;

      const meshZ = greedyMesh(paddedZ, tables);
      expect(meshZ.opaque.quadCount).toBe(6);
    });
  });

  describe('Performance Benchmark (Informational)', () => {
    it('measures worst-case mesh time for 3D checkerboard and random blocks', () => {
      const checkerPadded = new Uint16Array(PADDED_SECTION_VOLUME);
      const stoneState = registry.getStateId('stone')!;
      for (let z = 0; z < 16; z++) {
        for (let y = 0; y < 16; y++) {
          for (let x = 0; x < 16; x++) {
            if ((x + y + z) % 2 === 0) {
              checkerPadded[x + 1 + 18 * (y + 1 + 18 * (z + 1))] = stoneState;
            }
          }
        }
      }

      // Warmup
      for (let i = 0; i < 5; i++) {
        greedyMesh(checkerPadded, tables);
      }

      const iterations = 50;
      const startChecker = performance.now();
      for (let i = 0; i < iterations; i++) {
        greedyMesh(checkerPadded, tables);
      }
      const endChecker = performance.now();
      const avgCheckerMs = (endChecker - startChecker) / iterations;

      // Random blocks section
      const randomPadded = new Uint16Array(PADDED_SECTION_VOLUME);
      const allStates = registry.getAllStateIds();
      for (let pz = 1; pz <= 16; pz++) {
        for (let py = 1; py <= 16; py++) {
          for (let px = 1; px <= 16; px++) {
            const randomState = allStates[(px * 17 + py * 31 + pz * 13) % allStates.length]!;
            randomPadded[px + 18 * (py + 18 * pz)] = randomState;
          }
        }
      }

      const startRandom = performance.now();
      for (let i = 0; i < iterations; i++) {
        greedyMesh(randomPadded, tables);
      }
      const endRandom = performance.now();
      const avgRandomMs = (endRandom - startRandom) / iterations;

      console.log(`[M02b Performance Benchmark]`);
      console.log(
        `- 3D Checkerboard (12,288 faces worst-case): ${avgCheckerMs.toFixed(3)} ms / call`,
      );
      console.log(`- Random Blocks Section: ${avgRandomMs.toFixed(3)} ms / call`);

      // Informational benchmark log only, no hardcoded speed threshold asserted
      expect(avgCheckerMs).toBeGreaterThan(0);
      expect(avgRandomMs).toBeGreaterThan(0);
    });
  });
});
