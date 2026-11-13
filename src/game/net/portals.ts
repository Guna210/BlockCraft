import { portalState, PortalIndex, type PortalRecord } from '../../world/portals';
import type { World } from '../../world/world';
/** Builds rendering records from replicated portal cells; it never activates/collapses/travels locally. */
export class RemotePortals {
  constructor(
    private readonly world: World,
    private readonly index: PortalIndex,
  ) {}
  column(cx: number, cz: number): void {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) this.unload(cx + dx, cz + dz);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) this.scan(cx + dx, cz + dz);
  }
  unload(cx: number, cz: number): void {
    for (const portal of [...(this.index.inColumn(cx, cz) ?? [])]) this.index.remove(portal);
  }
  edit(x: number, y: number, z: number): void {
    for (const portal of [...(this.index.inColumn(Math.floor(x / 16), Math.floor(z / 16)) ?? [])])
      if (!this.complete(portal)) this.index.remove(portal);
    for (let dy = 0; dy < 3; dy++)
      for (let offset = 0; offset < 2; offset++) {
        this.candidate(x - offset, y - dy, z, 'x');
        this.candidate(x, y - dy, z - offset, 'z');
      }
  }
  private complete(portal: PortalRecord): boolean {
    const state = portalState(portal.axis);
    for (let v = 0; v < 3; v++)
      for (let u = 0; u < 2; u++)
        if (
          this.world.getBlockStateId(
            portal.x + (portal.axis === 'x' ? u : 0),
            portal.y + v,
            portal.z + (portal.axis === 'z' ? u : 0),
          ) !== state
        )
          return false;
    return true;
  }
  private candidate(x: number, y: number, z: number, axis: 'x' | 'z'): void {
    const state = portalState(axis);
    if (
      this.world.getBlockStateId(x, y, z) !== state ||
      this.world.getBlockStateId(x, y - 1, z) === state ||
      this.world.getBlockStateId(x - (axis === 'x' ? 1 : 0), y, z - (axis === 'z' ? 1 : 0)) ===
        state
    )
      return;
    const portal = { x, y, z, axis };
    if (this.complete(portal)) this.index.add(portal);
  }
  private scan(cx: number, cz: number): void {
    const column = this.world.getColumn(cx, cz, false);
    if (!column) return;
    const xState = portalState('x'),
      zState = portalState('z');
    for (let sy = 0; sy < 20; sy++) {
      const section = column.getSection(sy);
      if (!section) continue;
      const palette = section.getPalette();
      if (!palette.includes(xState) && !palette.includes(zState)) continue;
      for (let y = 0; y < 16; y++)
        for (let z = 0; z < 16; z++)
          for (let x = 0; x < 16; x++) {
            const state = column.getBlockStateId(x, sy * 16 + y, z);
            if (state === xState || state === zState)
              this.candidate(cx * 16 + x, sy * 16 + y, cz * 16 + z, state === xState ? 'x' : 'z');
          }
    }
  }
}
