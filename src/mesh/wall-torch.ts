import type { PackVertexFn } from './models';
/** Reserved normals 6/7 identify two crossed sprites. Tint bits encode the wall facing. */
export const MODEL_WALL_TORCH = 8;
export function emitWallTorch(
  pack: PackVertexFn,
  vertices: Uint32Array,
  offset: number,
  indices: Uint32Array,
  indexOffset: number,
  x: number,
  y: number,
  z: number,
  facing: number,
  tile: number,
  light: number,
): void {
  for (let q = 0; q < 2; q++) {
    const base = offset / 2 + q * 4;
    for (let c = 0; c < 4; c++)
      pack(
        x,
        y,
        z,
        6 + q,
        0,
        light >>> 12,
        (light >>> 8) & 15,
        facing,
        tile,
        c < 2 ? 0 : 1,
        c === 0 || c === 3 ? 1 : 0,
        vertices,
        offset + q * 8 + c * 2,
        (light >>> 4) & 15,
        light & 15,
      );
    const order = [0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2];
    for (let j = 0; j < 12; j++) indices[indexOffset + q * 12 + j] = base + order[j]!;
  }
}
export function wallTorchOffset(
  u: number,
  v: number,
  quad: number,
  facing: number,
): [number, number, number] {
  const h = 1 - v,
    across = u - 0.5;
  const away = 0.02 + h * 0.45 + (quad === 1 ? across * 0.3 : 0);
  const lateral = quad === 0 ? across : 0;
  return [
    facing === 2 ? away : facing === 3 ? 1 - away : 0.5 + lateral,
    0.15 + h * 0.85,
    facing === 0 ? 1 - away : facing === 1 ? away : 0.5 + lateral,
  ];
}
export const WALL_TORCH_GLSL = `
vec3 wallTorchOffset(float u, float v, uint quad, uint facing) {
 float h=1.0-v, across=u-0.5;
 float away=0.02+h*0.45+(quad==1u?across*0.3:0.0);
 float lateral=quad==0u?across:0.0;
 return vec3(facing==2u?away:facing==3u?1.0-away:0.5+lateral,0.15+h*0.85,facing==0u?1.0-away:facing==1u?away:0.5+lateral);
}`;
