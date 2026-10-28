/** First ECS id: item entities count up from 1, so ECS ids never meet them. */
export const ECS_FIRST_ID = 1 << 20;

/** A typed component key; components of one type live in one Map<id, T>. */
export interface ComponentType<T> {
  readonly name: string;
  /** Phantom field that carries T for type inference only. */
  readonly __type?: T;
}

export function defineComponent<T>(name: string): ComponentType<T> {
  return { name };
}

export type EcsSystem = (ecs: EntityWorld) => void;
/** Generated columns awaiting passive population are kept in a bounded FIFO set. */
export const MAX_UNPOPULATED_COLUMNS = 128;

/**
 * Lightweight entity-component system. Pure data: no browser APIs, no rendering. Queries return ids
 * in ascending order so every system visits entities in the same deterministic order.
 */
export class EntityWorld {
  private readonly stores = new Map<ComponentType<unknown>, Map<number, unknown>>();
  private readonly alive = new Set<number>();
  private readonly systems: Array<{ order: number; run: EcsSystem }> = [];
  private nextId = ECS_FIRST_ID;
  /** Ticks simulated so far; keyframe clips are timed against it. */
  time = 0;

  create(): number {
    const id = this.nextId++;
    this.alive.add(id);
    return id;
  }

  exists(id: number): boolean {
    return this.alive.has(id);
  }

  /** Removes the entity and all of its components. */
  destroy(id: number): void {
    if (!this.alive.delete(id)) return;
    for (const store of this.stores.values()) store.delete(id);
  }

  get count(): number {
    return this.alive.size;
  }

  add<T>(id: number, type: ComponentType<T>, value: T): T {
    if (!this.alive.has(id)) throw new Error(`No entity with id ${id} exists`);
    let store = this.stores.get(type as ComponentType<unknown>);
    if (!store) {
      store = new Map();
      this.stores.set(type as ComponentType<unknown>, store);
    }
    store.set(id, value);
    return value;
  }

  get<T>(id: number, type: ComponentType<T>): T | undefined {
    return this.stores.get(type as ComponentType<unknown>)?.get(id) as T | undefined;
  }

  has(id: number, type: ComponentType<unknown>): boolean {
    return this.stores.get(type)?.has(id) ?? false;
  }

  remove(id: number, type: ComponentType<unknown>): void {
    this.stores.get(type)?.delete(id);
  }

  /** Ids that have every listed component, ascending. With no components, every live entity. */
  query(...types: ComponentType<unknown>[]): number[] {
    let ids: Iterable<number>;
    if (types.length === 0) ids = this.alive;
    else {
      let smallest: Map<number, unknown> | undefined;
      for (const type of types) {
        const store = this.stores.get(type);
        if (!store || store.size === 0) return [];
        if (!smallest || store.size < smallest.size) smallest = store;
      }
      ids = smallest!.keys();
    }
    const result: number[] = [];
    outer: for (const id of ids) {
      for (const type of types) if (!this.stores.get(type)!.has(id)) continue outer;
      result.push(id);
    }
    return result.sort((a, b) => a - b);
  }

  /** Adds a system run by tick(); lower order runs first, equal orders run in insertion order. */
  addSystem(run: EcsSystem, order = 0): void {
    let at = this.systems.length;
    while (at > 0 && this.systems[at - 1]!.order > order) at--;
    this.systems.splice(at, 0, { order, run });
  }

  /** Removes one installed system, used when natural spawning is disabled for this world. */
  removeSystem(run: EcsSystem): void {
    const index = this.systems.findIndex((system) => system.run === run);
    if (index >= 0) this.systems.splice(index, 1);
  }

  tick(): void {
    this.time++;
    for (const system of this.systems) system.run(this);
  }
}
