/**
 * Column frustum test. One function decides both which columns are drawn (ChunkRenderer) and which
 * columns rank as "in the camera frustum" when streaming priorities are computed
 * (src/world/streaming-plan.ts), see decisions/M04a-streaming.md.
 */

/** A column spans 16 blocks in x and z and the whole world height in y. */
export const COLUMN_SIZE = 16;
export const COLUMN_MIN_Y = 0;
export const COLUMN_MAX_Y = 320;

/**
 * A column is culled only when it lies completely behind one plane by more than this many blocks.
 * The margin absorbs the float32 rounding of the view-projection matrix, so a visible column is
 * never culled by rounding.
 */
const CULL_MARGIN = 0.01;

/**
 * The six planes (left, right, bottom, top, near, far) of a column-major projection x view matrix as
 * (a, b, c, d) with unit normals pointing into the frustum.
 */
export function extractFrustumPlanes(
  viewProj: ArrayLike<number>,
  out: Float64Array = new Float64Array(24),
): Float64Array {
  const m = viewProj;
  // Row r of the matrix is (m[r], m[r + 4], m[r + 8], m[r + 12]).
  const row = (r: number, c: number) => m[r + 4 * c]!;
  for (let i = 0; i < 6; i++) {
    const axis = i >> 1; // 0: x, 1: y, 2: z
    const sign = i & 1 ? -1 : 1;
    let a = row(3, 0) + sign * row(axis, 0);
    let b = row(3, 1) + sign * row(axis, 1);
    let c = row(3, 2) + sign * row(axis, 2);
    let d = row(3, 3) + sign * row(axis, 3);
    const len = Math.hypot(a, b, c);
    if (len > 0) {
      a /= len;
      b /= len;
      c /= len;
      d /= len;
    }
    out[i * 4] = a;
    out[i * 4 + 1] = b;
    out[i * 4 + 2] = c;
    out[i * 4 + 3] = d;
  }
  return out;
}

/** Conservative box test: false only when the box is fully outside at least one plane. */
export function aabbIntersectsFrustum(
  planes: ArrayLike<number>,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): boolean {
  for (let i = 0; i < 6; i++) {
    const a = planes[i * 4]!;
    const b = planes[i * 4 + 1]!;
    const c = planes[i * 4 + 2]!;
    const d = planes[i * 4 + 3]!;
    // The box corner furthest along the plane normal.
    const px = a >= 0 ? maxX : minX;
    const py = b >= 0 ? maxY : minY;
    const pz = c >= 0 ? maxZ : minZ;
    if (a * px + b * py + c * pz + d < -CULL_MARGIN) return false;
  }
  return true;
}

/** Does the whole-height box of column (cx, cz) touch the frustum? */
export function columnInFrustum(planes: ArrayLike<number>, cx: number, cz: number): boolean {
  const x = cx * COLUMN_SIZE;
  const z = cz * COLUMN_SIZE;
  return aabbIntersectsFrustum(
    planes,
    x,
    COLUMN_MIN_Y,
    z,
    x + COLUMN_SIZE,
    COLUMN_MAX_Y,
    z + COLUMN_SIZE,
  );
}
