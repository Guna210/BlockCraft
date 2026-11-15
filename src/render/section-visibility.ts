import { aabbIntersectsFrustum } from '../world/frustum';
import { columnKey } from '../world/streaming-plan';
import { CaveCuller } from './cave-culling';

const RADIUS = 34;
const WIDTH = RADIUS * 2 + 1;
const HEIGHT = 20;
const SIZE = WIDTH * WIDTH * HEIGHT;

interface ColumnMasks {
  x: number;
  z: number;
  values: Int32Array;
}

/** Renderer-owned masks and reusable cave traversal scratch. */
export class SectionVisibility {
  private readonly columns = new Map<number, ColumnMasks>();
  private readonly list: ColumnMasks[] = [];
  private readonly masks = new Int32Array(SIZE);
  private readonly frustum = new Uint8Array(SIZE);
  private readonly culler = new CaveCuller(WIDTH, HEIGHT, WIDTH);
  private readonly bucket = new Int32Array(12).fill(0x7fffffff);
  private version = 0;
  private computedVersion = -1;
  private cx = 0;
  private cy = 0;
  private cz = 0;
  private distance = -1;
  private useFrustum = true;
  private minY = 0;
  private maxY = HEIGHT - 1;
  private radius = 0;
  private valid = false;

  meshChanged(): void {
    this.version++;
  }

  set(x: number, y: number, z: number, mask: number | undefined): void {
    if (y < 0 || y >= HEIGHT) return;
    const key = columnKey(x, z);
    let column = this.columns.get(key);
    if (!column) {
      if (mask === undefined) return;
      column = { x, z, values: new Int32Array(HEIGHT).fill(-1) };
      this.columns.set(key, column);
      this.list.push(column);
    }
    const value = mask ?? -1;
    column.values[y] = value;
    this.version++;
  }

  removeColumn(x: number, z: number): void {
    const key = columnKey(x, z);
    const column = this.columns.get(key);
    if (!column) return;
    this.columns.delete(key);
    const index = this.list.indexOf(column);
    this.list[index] = this.list[this.list.length - 1]!;
    this.list.pop();
    this.version++;
  }

  invalidateColumn(x: number, z: number): void {
    const column = this.columns.get(columnKey(x, z));
    if (!column) return;
    column.values.fill(-1);
    this.version++;
  }

  retain(x: number, z: number, keep: ReadonlySet<string>): void {
    const column = this.columns.get(columnKey(x, z));
    if (!column) return;
    for (let y = 0; y < HEIGHT; y++) {
      if (column.values[y] !== -1 && !keep.has(`${x},${y},${z}`)) {
        column.values[y] = -1;
        this.version++;
      }
    }
  }

  clear(): void {
    this.columns.clear();
    this.list.length = 0;
    this.version++;
    this.valid = false;
  }

  prepare(
    camera: ArrayLike<number>,
    matrix: ArrayLike<number>,
    planes: ArrayLike<number>,
    distance: number,
    useFrustum: boolean,
    minMeshY = 0,
    maxMeshY = HEIGHT - 1,
  ): void {
    const cx = Math.floor(camera[0]! / 16);
    const cy = Math.floor(camera[1]! / 16);
    const cz = Math.floor(camera[2]! / 16);
    const minY = Math.max(0, Math.min(cy, minMeshY));
    const maxY = Math.min(HEIGHT - 1, Math.max(cy, maxMeshY));
    let viewChanged =
      !this.valid ||
      this.cx !== cx ||
      this.cy !== cy ||
      this.cz !== cz ||
      this.distance !== distance ||
      this.useFrustum !== useFrustum ||
      this.minY !== minY ||
      this.maxY !== maxY;
    for (let i = 0; i < 12; i++) {
      const value = Math.round(matrix[i]! * 100);
      if (this.bucket[i] !== value) {
        this.bucket[i] = value;
        viewChanged = true;
      }
    }
    if (!viewChanged && this.computedVersion === this.version) return;
    this.cx = cx;
    this.cy = cy;
    this.cz = cz;
    this.distance = distance;
    this.useFrustum = useFrustum;
    this.minY = minY;
    this.maxY = maxY;
    this.computedVersion = this.version;
    this.valid = cy >= 0 && cy < HEIGHT;
    if (!this.valid) return;
    this.masks.fill(-1);
    const radius = Math.min(RADIUS, Math.max(0, distance + 2));
    this.radius = radius;
    if (viewChanged) {
      this.frustum.fill(0);
      for (let z = -radius; z <= radius; z++)
        for (let y = minY; y <= maxY; y++)
          for (let x = -radius; x <= radius; x++) {
            const index = (z + RADIUS) * WIDTH * HEIGHT + y * WIDTH + x + RADIUS;
            const wx = (cx + x) * 16,
              wy = y * 16,
              wz = (cz + z) * 16;
            // The expansion covers movement inside the camera section and small turns within a bucket.
            if (
              !useFrustum ||
              aabbIntersectsFrustum(planes, wx - 64, wy - 64, wz - 64, wx + 80, wy + 80, wz + 80)
            )
              this.frustum[index] = 1;
          }
    }
    for (let i = 0; i < this.list.length; i++) {
      const column = this.list[i]!;
      const x = column.x - cx + RADIUS,
        z = column.z - cz + RADIUS;
      if (x < 0 || x >= WIDTH || z < 0 || z >= WIDTH) continue;
      for (let y = 0; y < HEIGHT; y++)
        this.masks[z * WIDTH * HEIGHT + y * WIDTH + x] = column.values[y]!;
    }
    this.culler.traverse(this.masks, this.frustum, RADIUS * WIDTH * HEIGHT + cy * WIDTH + RADIUS);
  }

  visible(x: number, y: number, z: number): boolean {
    if (!this.valid || y < 0 || y >= HEIGHT) return true;
    if (Math.abs(x - this.cx) > this.radius || Math.abs(z - this.cz) > this.radius) return true;
    x = x - this.cx + RADIUS;
    z = z - this.cz + RADIUS;
    if (x < 0 || x >= WIDTH || z < 0 || z >= WIDTH) return true;
    return this.culler.visible[z * WIDTH * HEIGHT + y * WIDTH + x] !== 0;
  }
}
