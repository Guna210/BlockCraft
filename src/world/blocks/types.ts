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

export interface BlockDefinition {
  id: string;
  hardness: number;
  blastResistance: number;
  lightEmission: number;
  renderLayer: RenderLayer;
  fullOpaqueCube: boolean;
  states?: Record<string, StateDefinition>;
  textures?: BlockTextures;
}

export interface ResolvedBlockState {
  stateId: number;
  blockId: string;
  properties: Record<string, string | number>;
  definition: BlockDefinition;
}
