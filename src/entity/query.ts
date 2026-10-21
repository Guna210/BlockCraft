export interface EntityBounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface QueriedEntity extends EntityBounds {
  type: string;
  id: number | string;
  /** Mob category ('passive', 'hostile', 'ambient') for creatures. */
  category?: string;
}

export type EntityQueryProvider = () => readonly QueriedEntity[];

/** A shared spatial query for pressure plates, tripwire and later world-interactive systems. */
export class EntityQuery {
  private readonly providers = new Map<string, EntityQueryProvider>();

  addProvider(id: string, provider: EntityQueryProvider): void {
    this.providers.set(id, provider);
  }

  removeProvider(id: string): void {
    this.providers.delete(id);
  }

  query(bounds: EntityBounds): QueriedEntity[] {
    const result: QueriedEntity[] = [];
    for (const id of [...this.providers.keys()].sort()) {
      for (const entity of this.providers.get(id)!()) {
        if (
          entity.minX <= bounds.maxX &&
          entity.maxX >= bounds.minX &&
          entity.minY <= bounds.maxY &&
          entity.maxY >= bounds.minY &&
          entity.minZ <= bounds.maxZ &&
          entity.maxZ >= bounds.minZ
        ) {
          result.push(entity);
        }
      }
    }
    return result;
  }
}
