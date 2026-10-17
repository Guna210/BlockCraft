import { deriveSeed, PRNG } from '../engine/rng';

export interface BlockTick {
  x: number;
  y: number;
  z: number;
  type: string;
}
export interface ScheduledTick extends BlockTick {
  due: number;
  priority: number;
  order: number;
}
interface Entry extends ScheduledTick {
  key: string;
}
export interface TickSection {
  x: number;
  y: number;
  z: number;
}

/** Lower priorities run first. A position/type has at most one pending tick. */
export class BlockTicks {
  public time = 0;
  private order = 0;
  private heap: Entry[] = [];
  private pending = new Map<string, Entry>();

  getPendingTicks(): ScheduledTick[] {
    return this.heap.map((e) => ({
      x: e.x,
      y: e.y,
      z: e.z,
      type: e.type,
      due: e.due,
      priority: e.priority,
      order: e.order,
    }));
  }

  getPendingTicksForColumn(cx: number, cz: number): ScheduledTick[] {
    return this.heap
      .filter((e) => Math.floor(e.x / 16) === cx && Math.floor(e.z / 16) === cz)
      .map((e) => ({
        x: e.x,
        y: e.y,
        z: e.z,
        type: e.type,
        due: e.due,
        priority: e.priority,
        order: e.order,
      }));
  }

  loadTicks(ticks: ScheduledTick[], time?: number, replace = true): void {
    if (time !== undefined) {
      this.time = time;
    }
    if (replace) {
      this.heap = [];
      this.pending.clear();
      this.order = 0;
    }
    let maxOrder = this.order;
    for (const t of ticks) {
      const key = `${t.type}:${t.x},${t.y},${t.z}`;
      if (this.pending.has(key)) continue;
      const entry: Entry = {
        x: t.x,
        y: t.y,
        z: t.z,
        type: t.type,
        due: t.due,
        priority: t.priority,
        order: t.order,
        key,
      };
      if (t.order >= maxOrder) {
        maxOrder = t.order + 1;
      }
      this.pending.set(key, entry);
      this.push(entry);
    }
    this.order = Math.max(this.order, maxOrder);
  }

  addTicks(ticks: ScheduledTick[]): void {
    this.loadTicks(ticks, undefined, false);
  }
  private randomTicks?: {
    sections: () => Iterable<TickSection>;
    samples: number;
    seed: number;
    visit: (x: number, y: number, z: number) => void;
  };

  setRandomTicks(
    sections: () => Iterable<TickSection>,
    samples: number,
    seed: number,
    visit: (x: number, y: number, z: number) => void,
  ): void {
    if (!Number.isSafeInteger(samples) || samples < 0)
      throw new Error('Random tick count must be non-negative');
    this.randomTicks = { sections, samples, seed, visit };
  }

  get count(): number {
    return this.pending.size;
  }
  schedule(block: BlockTick, delay: number, priority = 0): void {
    if (!Number.isSafeInteger(delay) || delay < 1) throw new Error('Tick delay must be positive');
    const key = `${block.type}:${block.x},${block.y},${block.z}`;
    // Coalesce neighbor notifications without postponing an existing update.
    if (this.pending.has(key)) return;
    const entry = { ...block, due: this.time + delay, priority, order: this.order++, key };
    this.pending.set(key, entry);
    this.push(entry);
  }
  private before(a: Entry, b: Entry): boolean {
    return (
      a.due < b.due ||
      (a.due === b.due &&
        (a.priority < b.priority || (a.priority === b.priority && a.order < b.order)))
    );
  }
  private push(entry: Entry): void {
    let i = this.heap.length;
    this.heap.push(entry);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.before(entry, this.heap[parent]!)) break;
      this.heap[i] = this.heap[parent]!;
      i = parent;
    }
    this.heap[i] = entry;
  }
  private pop(): Entry {
    const first = this.heap[0]!;
    const last = this.heap.pop()!;
    if (this.heap.length) {
      let i = 0;
      while (i * 2 + 1 < this.heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < this.heap.length && this.before(this.heap[child + 1]!, this.heap[child]!))
          child++;
        if (!this.before(this.heap[child]!, last)) break;
        this.heap[i] = this.heap[child]!;
        i = child;
      }
      this.heap[i] = last;
    }
    return first;
  }
  advance(dispatch: (block: BlockTick) => void): void {
    this.time++;
    while (this.heap.length && this.heap[0]!.due <= this.time) {
      const next = this.pop();
      this.pending.delete(next.key);
      dispatch(next);
    }
    const random = this.randomTicks;
    if (random && random.samples > 0)
      this.random(random.sections(), random.samples, random.seed, random.visit);
  }
  /** Unloaded terrain must neither retain queued work nor be recreated by a tick. */
  removeColumn(cx: number, cz: number): void {
    const keep = this.heap.filter(
      (e) => Math.floor(e.x / 16) !== cx || Math.floor(e.z / 16) !== cz,
    );
    this.heap = [];
    this.pending.clear();
    for (const entry of keep) {
      this.pending.set(entry.key, entry);
      this.push(entry);
    }
  }
  /** Section coordinates; sample with replacement, independent of section iteration order. */
  random(
    sections: Iterable<TickSection>,
    n: number,
    seed: number,
    visit: (x: number, y: number, z: number) => void,
  ): void {
    if (!Number.isSafeInteger(n) || n < 0)
      throw new Error('Random tick count must be non-negative');
    for (const section of sections) {
      const rng = new PRNG(
        deriveSeed(seed, `random:${this.time}:${section.x},${section.y},${section.z}`),
      );
      for (let i = 0; i < n; i++) {
        const index = Math.floor(rng.next() * 4096);
        visit(
          section.x * 16 + (index & 15),
          section.y * 16 + (index >> 8),
          section.z * 16 + ((index >> 4) & 15),
        );
      }
    }
  }
}
