export type RenderLayer = 'opaque' | 'cutout' | 'translucent';

export type BlockFaceDirection = 'top' | 'bottom' | 'north' | 'south' | 'east' | 'west';
export type BlockFace = BlockFaceDirection | 'side';

export interface EnumStateDefinition {
  type: 'enum';
  values: string[];
  default: string;
}

export type StateDefinition = EnumStateDefinition;

export interface BlockTextures {
  top?: string;
  side?: string;
  bottom?: string;
  north?: string;
  south?: string;
  east?: string;
  west?: string;
  [face: string]: string | undefined;
}

/** How the mesher draws a block: a cube (default) or two diagonal quads (plants). */
export type BlockModel = 'cube' | 'cross';

export interface BlockDefinition {
  id: string;
  hardness: number;
  blastResistance: number;
  lightEmission: number;
  renderLayer: RenderLayer;
  fullOpaqueCube: boolean;
  /** Mesh model; omitted means a full cube. */
  model?: BlockModel;
  /** Tool that harvests the block, as in SPEC A.3: axe, pickaxe, shovel, shears/hoe or none. */
  tool?: string;
  /** Minimum tool tier (SPEC A.2); omitted means any tier. */
  minTier?: number;
  states?: Record<string, StateDefinition>;
  textures?: BlockTextures;
}

export interface ResolvedBlockState {
  stateId: number;
  blockId: string;
  properties: Record<string, string | number>;
  definition: BlockDefinition;
}
