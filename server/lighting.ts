import { LightEngine, LightStorage } from '../src/world/lighting';
import type { World, RemovedBlock } from '../src/world/world';
import type { ColumnLight } from '../src/world/batch-light';

/** Simulation queries retain the latest completed light; edits enqueue shared worker relighting. */
export class ServerLighting extends LightEngine {
  constructor(private readonly changed: (cx: number, cz: number) => void) {
    super();
    this.onlyLitColumns = true;
  }
  override onBlockChanged(
    _world: World,
    x: number,
    _y: number,
    z: number,
    _oldState: number,
    _newState: number,
  ): void {
    const cx = Math.floor(x / 16),
      cz = Math.floor(z / 16);
    this.clearColumnCache(cx, cz);
    this.changed(cx, cz);
  }
  override onBlocksRemoved(_world: World, blocks: readonly RemovedBlock[]): Set<number> {
    const touched = new Set<number>();
    for (const block of blocks) {
      const cx = Math.floor(block.x / 16),
        cz = Math.floor(block.z / 16);
      this.clearColumnCache(cx, cz);
      this.changed(cx, cz);
      touched.add(LightStorage.getSectionKey(cx, Math.floor(block.y / 16), cz));
    }
    return touched;
  }
  override *removalSteps(
    world: World,
    blocks: readonly RemovedBlock[],
  ): Generator<void, Set<number>> {
    const touched = this.onBlocksRemoved(world, blocks);
    yield;
    return touched;
  }
  adopt(column: ColumnLight): void {
    for (const section of column.sections) {
      let data = section.lightData;
      if (typeof data === 'number') {
        const raw = this.storage.getRawDataByKey(section.key) ?? new Uint8Array(4096);
        raw.fill(data);
        data = raw;
      }
      this.storage.setRawDataByKey(section.key, data);
      for (let i = 0; i < this.rgbChannels.length; i++) {
        const channel = this.rgbChannels[i]!;
        const rgb = section.rgb?.[i];
        if (rgb) channel.storage.setRawDataByKey(section.key, rgb);
        else channel.storage.getRawDataByKey(section.key)?.fill(0);
      }
    }
    this.skirts.set((column.cx + 32768) * 65536 + column.cz + 32768, {
      height: column.height,
      data: column.skirt,
    });
    this.markLit(column.cx, column.cz);
  }
}
