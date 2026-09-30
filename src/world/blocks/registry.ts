import { BlockDefinition, BlockFaceDirection, ResolvedBlockState, StateDefinition } from './types';

export class BlockRegistry {
  private static instance: BlockRegistry | null = null;

  private blocks: Map<string, BlockDefinition> = new Map();
  private stateToIdMap: Map<string, number> = new Map();
  private idToStateMap: Map<number, ResolvedBlockState> = new Map();
  private defaultStateIdMap: Map<string, number> = new Map();
  private stateHashBytesMap: Map<number, Uint8Array> = new Map();

  public static getInstance(): BlockRegistry {
    if (!BlockRegistry.instance) {
      BlockRegistry.instance = new BlockRegistry();
      BlockRegistry.instance.loadData();
    }
    return BlockRegistry.instance;
  }

  public static resetInstance(): void {
    BlockRegistry.instance = null;
  }

  private constructor() {}

  public loadData(): void {
    const jsonModules = import.meta.glob<
      | { default?: Record<string, Omit<BlockDefinition, 'id'>> }
      | Record<string, Omit<BlockDefinition, 'id'>>
    >('../../../data/blocks/*.json', {
      eager: true,
    });

    const rawBlocks: BlockDefinition[] = [];

    for (const filePath of Object.keys(jsonModules)) {
      const moduleExport = jsonModules[filePath];
      if (!moduleExport) continue;
      const categoryData = ((moduleExport as { default?: unknown }).default ||
        moduleExport) as Record<string, Omit<BlockDefinition, 'id'>>;

      for (const [id, def] of Object.entries(categoryData)) {
        rawBlocks.push({
          ...def,
          id,
        });
      }
    }

    // Stable State IDs sorting rule:
    // 1. Sort block definitions alphabetically by block ID.
    // 2. Ensure 'air' is first if present (blockId === 'air').
    rawBlocks.sort((a, b) => {
      if (a.id === 'air') return -1;
      if (b.id === 'air') return 1;
      return a.id.localeCompare(b.id);
    });

    let currentStateId = 0;

    for (const def of rawBlocks) {
      this.blocks.set(def.id, def);

      const statePermutations = this.generateStatePermutations(def.states);

      let defaultStateIdForBlock: number | null = null;

      for (const props of statePermutations) {
        const stateId = currentStateId++;
        const key = this.getLookupKey(def.id, props);

        const resolvedState: ResolvedBlockState = {
          stateId,
          blockId: def.id,
          properties: props,
          definition: def,
        };

        this.stateToIdMap.set(key, stateId);
        this.idToStateMap.set(stateId, resolvedState);

        // Precompute worldHash bytes for this stateId
        const hashStrParts: string[] = [def.id];
        if (props) {
          const sortedKeys = Object.keys(props).sort();
          for (const k of sortedKeys) {
            hashStrParts.push(':', k, '=', String(props[k]));
          }
        }
        hashStrParts.push(',');
        const str = hashStrParts.join('');
        const bytes = new Uint8Array(str.length);
        for (let i = 0; i < str.length; i++) {
          bytes[i] = str.charCodeAt(i);
        }
        this.stateHashBytesMap.set(stateId, bytes);

        // Check if this is default state
        const isDefault = this.isDefaultProps(def.states, props);
        if (isDefault || defaultStateIdForBlock === null) {
          defaultStateIdForBlock = stateId;
        }
      }

      if (defaultStateIdForBlock !== null) {
        this.defaultStateIdMap.set(def.id, defaultStateIdForBlock);
      }
    }
  }

  public getStateHashBytes(stateId: number): Uint8Array {
    return this.stateHashBytesMap.get(stateId) ?? this.stateHashBytesMap.get(0)!;
  }

  private generateStatePermutations(
    states?: Record<string, StateDefinition>,
  ): Array<Record<string, string | number>> {
    if (!states || Object.keys(states).length === 0) {
      return [{}];
    }

    const stateKeys = Object.keys(states).sort(); // Sort state keys deterministically
    let permutations: Array<Record<string, string | number>> = [{}];

    for (const key of stateKeys) {
      const def = states[key]!;
      const nextPermutations: Array<Record<string, string | number>> = [];

      for (const currentProps of permutations) {
        for (const val of def.values) {
          nextPermutations.push({
            ...currentProps,
            [key]: val,
          });
        }
      }
      permutations = nextPermutations;
    }

    return permutations;
  }

  private isDefaultProps(
    states: Record<string, StateDefinition> | undefined,
    props: Record<string, string | number>,
  ): boolean {
    if (!states) return true;
    for (const [key, def] of Object.entries(states)) {
      if (props[key] !== def.default) return false;
    }
    return true;
  }

  private getLookupKey(blockId: string, props: Record<string, string | number>): string {
    const keys = Object.keys(props).sort();
    if (keys.length === 0) return blockId;
    const parts = keys.map((k) => `${k}=${props[k]}`);
    return `${blockId}[${parts.join(',')}]`;
  }

  public getBlockDefinition(blockId: string): BlockDefinition | undefined {
    return this.blocks.get(blockId);
  }

  public getStateId(blockId: string, props?: Record<string, string | number>): number | undefined {
    const def = this.blocks.get(blockId);
    if (!def) return undefined;

    const mergedProps: Record<string, string | number> = {};
    if (def.states) {
      for (const [k, v] of Object.entries(def.states)) {
        mergedProps[k] = v.default;
      }
    }
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        mergedProps[k] = v;
      }
    }

    const key = this.getLookupKey(blockId, mergedProps);
    return this.stateToIdMap.get(key);
  }

  public getResolvedState(stateId: number): ResolvedBlockState | undefined {
    return this.idToStateMap.get(stateId);
  }

  public getDefaultStateId(blockId: string): number | undefined {
    return this.defaultStateIdMap.get(blockId);
  }

  public getAllBlockIds(): string[] {
    return Array.from(this.blocks.keys());
  }

  public getAllStateIds(): number[] {
    return Array.from(this.idToStateMap.keys());
  }

  public getMaxStateId(): number {
    let max = 0;
    for (const key of this.idToStateMap.keys()) {
      if (key > max) max = key;
    }
    return max;
  }

  public getFaceTexture(stateId: number, face: BlockFaceDirection): string | undefined {
    const state = this.idToStateMap.get(stateId);
    if (!state || !state.definition.textures) return undefined;

    const tex = state.definition.textures;

    // Log axis rotation handling:
    // If block has an 'axis' state property ('x', 'y', 'z')
    const axis = state.properties['axis'] as string | undefined;

    if (axis) {
      if (axis === 'y') {
        // Normal top/bottom log-top, sides log-side
        if (face === 'top' || face === 'bottom') {
          return tex.top || tex.side;
        } else {
          return tex.side || tex.top;
        }
      } else if (axis === 'x') {
        // Log aligned along X-axis: east and west are log tops!
        if (face === 'east' || face === 'west') {
          return tex.top || tex.side;
        } else {
          return tex.side || tex.top;
        }
      } else if (axis === 'z') {
        // Log aligned along Z-axis: north and south are log tops!
        if (face === 'north' || face === 'south') {
          return tex.top || tex.side;
        } else {
          return tex.side || tex.top;
        }
      }
    }

    // Default face fallback order:
    // 1. Explicit face (e.g. north)
    // 2. top/bottom/side generic faces
    if (face === 'top') return tex.top || tex.side;
    if (face === 'bottom') return tex.bottom || tex.top || tex.side;
    return tex[face] || tex.side || tex.top;
  }
}
