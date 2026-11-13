import type { EntityPose } from '../../net/protocol';
const SIZE = 32;
/** Timestamped pose ring. Sampling never mutates the delta baseline or allocates. */
export class PoseBuffer {
  private readonly data = new Float64Array(SIZE * 6);
  private head = 0;
  private count = 0;
  push(time: number, pose: EntityPose): void {
    if (this.count === SIZE) {
      this.head = (this.head + 1) % SIZE;
      this.count--;
    }
    const at = ((this.head + this.count++) % SIZE) * 6;
    this.data[at] = time;
    this.data[at + 1] = pose.x;
    this.data[at + 2] = pose.y;
    this.data[at + 3] = pose.z;
    this.data[at + 4] = pose.yaw;
    this.data[at + 5] = pose.pitch;
  }
  sample(time: number, out: EntityPose): void {
    if (!this.count) return;
    let left = this.head * 6,
      right = left;
    for (let i = 1; i < this.count; i++) {
      right = ((this.head + i) % SIZE) * 6;
      if (this.data[right]! >= time) break;
      left = right;
    }
    const span = this.data[right]! - this.data[left]!;
    const t = span > 0 ? Math.max(0, Math.min(1, (time - this.data[left]!) / span)) : 0;
    out.x = this.lerp(left + 1, right + 1, t);
    out.y = this.lerp(left + 2, right + 2, t);
    out.z = this.lerp(left + 3, right + 3, t);
    const yaw = this.data[left + 4]!;
    const delta = this.data[right + 4]! - yaw;
    out.yaw = yaw + Math.atan2(Math.sin(delta), Math.cos(delta)) * t;
    out.pitch = this.lerp(left + 5, right + 5, t);
  }
  private lerp(a: number, b: number, t: number): number {
    return this.data[a]! + (this.data[b]! - this.data[a]!) * t;
  }
}
