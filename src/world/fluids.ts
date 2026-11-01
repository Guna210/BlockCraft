import type { World } from './world';
import { BlockRegistry } from './blocks/registry';
import type { BlockTick } from './ticks';

export const WATER_TICK_DELAY = 5;
export const LAVA_TICK_DELAY = 30;
// M20 introduces dimensions; use this delay when Hollowdeep worlds become available.
export const HOLLOWDEEP_LAVA_TICK_DELAY = 10;
export const FLUID_SPREAD = 7;
export const DROP_SEARCH_DISTANCE = 4;
const SIDES = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
] as const;
const NEIGHBORS = [...SIDES, [0, 1, 0], [0, -1, 0]] as const;
type Kind = 'water' | 'lava';
interface Fluid {
  kind: Kind;
  level: number;
  falling: boolean;
}

/** Event-driven: generated and streamed sources never enqueue work by themselves. */
export class FluidSimulation {
  private registry = BlockRegistry.getInstance();
  private states = new Map<number, Fluid>();
  /** Ticks between lava flow steps; the world's dimension sets it (faster in the Hollowdeep). */
  public lavaTickDelay = LAVA_TICK_DELAY;
  constructor(private world: World) {
    for (const id of this.registry.getAllStateIds()) {
      const s = this.registry.getResolvedState(id)!;
      if (s.blockId === 'water' || s.blockId === 'lava')
        this.states.set(id, {
          kind: s.blockId,
          level: Number(s.properties.level),
          falling: s.properties.falling === 'true',
        });
    }
  }
  private loaded(x: number, y: number, z: number): boolean {
    return y >= 0 && y < 320 && this.world.hasColumn(Math.floor(x / 16), Math.floor(z / 16));
  }
  private fluid(x: number, y: number, z: number): Fluid | undefined {
    return this.states.get(this.world.getBlockStateId(x, y, z));
  }
  private source(f: Fluid | undefined): boolean {
    return !!f && f.level === 0 && !f.falling;
  }
  private solid(x: number, y: number, z: number): boolean {
    return !!this.registry.getResolvedState(this.world.getBlockStateId(x, y, z))?.definition
      .fullOpaqueCube;
  }
  private open(x: number, y: number, z: number, kind: Kind): boolean {
    if (!this.loaded(x, y, z)) return false;
    const id = this.world.getBlockStateId(x, y, z);
    return id === 0 || this.states.get(id)?.kind === kind;
  }
  private canFall(x: number, y: number, z: number, kind: Kind): boolean {
    return this.open(x, y, z, kind) && !this.source(this.fluid(x, y, z));
  }
  changed(x: number, y: number, z: number): void {
    this.schedule(x, y, z);
    for (const [dx, dy, dz] of NEIGHBORS) this.schedule(x + dx, y + dy, z + dz);
  }
  private schedule(x: number, y: number, z: number): void {
    if (!this.loaded(x, y, z)) return;
    const f = this.fluid(x, y, z);
    if (f)
      this.world.ticks.schedule(
        { x, y, z, type: f.kind },
        f.kind === 'water' ? WATER_TICK_DELAY : this.lavaTickDelay,
      );
  }
  private write(
    x: number,
    y: number,
    z: number,
    kind: Kind,
    level: number,
    falling: boolean,
  ): void {
    this.world.setBlock(x, y, z, kind, { level: String(level), falling: String(falling) });
  }
  /** Shortest reachable drop, with a bounded flood search through passable cells. */
  private dropDistance(
    x: number,
    y: number,
    z: number,
    kind: Kind,
    fromX: number,
    fromZ: number,
  ): number {
    const queue = [{ x, z, distance: 1 }];
    const seen = new Set([`${fromX},${fromZ}`, `${x},${z}`]);
    for (let i = 0; i < queue.length; i++) {
      const p = queue[i]!;
      if (this.canFall(p.x, y - 1, p.z, kind)) return p.distance;
      if (p.distance === DROP_SEARCH_DISTANCE) continue;
      for (const [dx, , dz] of SIDES) {
        const nx = p.x + dx,
          nz = p.z + dz,
          key = `${nx},${nz}`;
        if (seen.has(key) || !this.open(nx, y, nz, kind)) continue;
        seen.add(key);
        queue.push({ x: nx, z: nz, distance: p.distance + 1 });
      }
    }
    return Infinity;
  }
  private flow(x: number, y: number, z: number, kind: Kind, level: number, falling: boolean): void {
    if (!this.loaded(x, y, z)) return;
    const old = this.fluid(x, y, z);
    if (old && old.kind !== kind) {
      if (old.kind === 'lava')
        this.world.setBlock(x, y, z, this.source(old) ? 'blackglass' : 'cobblestone');
      else this.world.setBlock(x, y, z, 'cobblestone');
      return;
    }
    if (!this.open(x, y, z, kind) || this.source(old)) return;
    if (!old || (falling && !old.falling) || (!old.falling && level < old.level)) {
      this.write(x, y, z, kind, level, falling);
    }
  }
  tick({ x, y, z, type }: BlockTick): void {
    if (!this.loaded(x, y, z)) return;
    let f = this.fluid(x, y, z);
    if (!f || f.kind !== type) return;
    // Resolve contact on the lava cell, irrespective of which fluid received the tick.
    for (const [dx, dy, dz] of NEIGHBORS) {
      const other = this.fluid(x + dx, y + dy, z + dz);
      if (!other || other.kind === f.kind) continue;
      if (f.kind === 'lava') {
        this.world.setBlock(x, y, z, this.source(f) ? 'blackglass' : 'cobblestone');
        return;
      }
      this.world.setBlock(
        x + dx,
        y + dy,
        z + dz,
        this.source(other) ? 'blackglass' : 'cobblestone',
      );
    }
    if (!this.source(f)) {
      let sources = 0,
        level = 8;
      for (const [dx, , dz] of SIDES) {
        const n = this.fluid(x + dx, y, z + dz);
        if (!n || n.kind !== f.kind) continue;
        if (this.source(n)) sources++;
        // A descending column feeds sideways only when it reaches support.
        if (!this.canFall(x + dx, y - 1, z + dz, f.kind))
          level = Math.min(level, n.falling ? 1 : n.level + 1);
      }
      const below = this.fluid(x, y - 1, z);
      const above = this.fluid(x, y + 1, z);
      const infinite =
        f.kind === 'water' &&
        sources >= 2 &&
        (this.solid(x, y - 1, z) || (below?.kind === 'water' && this.source(below)));
      const falling = !infinite && above?.kind === f.kind;
      if (infinite || falling) level = 0;
      if (level > FLUID_SPREAD) {
        this.world.setBlock(x, y, z, 'air');
        return;
      }
      if (level !== f.level || falling !== f.falling) {
        this.write(x, y, z, f.kind, level, falling);
        f = this.fluid(x, y, z)!;
      }
    }
    const below = this.fluid(x, y - 1, z);
    if (this.canFall(x, y - 1, z, f.kind) || (below && below.kind !== f.kind)) {
      this.flow(x, y - 1, z, f.kind, 0, true);
      return;
    }
    const nextLevel = f.falling ? 1 : f.level + 1;
    if (nextLevel > FLUID_SPREAD) return;
    const directions = SIDES.map(([dx, , dz]) => ({
      dx,
      dz,
      distance: this.open(x + dx, y, z + dz, f.kind)
        ? this.dropDistance(x + dx, y, z + dz, f.kind, x, z)
        : Infinity,
    }));
    const best = Math.min(...directions.map((d) => d.distance));
    for (const d of directions)
      if (d.distance === best) this.flow(x + d.dx, y, z + d.dz, f.kind, nextLevel, false);
  }
}
