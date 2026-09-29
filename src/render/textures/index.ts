// src/render/textures/index.ts
import { TextureData } from './noise';
import {
  genGrassTop,
  genGrassSide,
  genDirt,
  genStone,
  genCobblestone,
  genSand,
  genGravel,
  genGlass,
} from './terrain';
import {
  genOakLogTop,
  genOakLogSide,
  genBirchLogTop,
  genBirchLogSide,
  genPineLogTop,
  genPineLogSide,
  genOakPlanks,
  genBirchPlanks,
  genPinePlanks,
  genOakLeaves,
  genBirchLeaves,
  genPineLeaves,
} from './wood';
import {
  genCoalOre,
  genCopperOre,
  genIronOre,
  genGoldOre,
  genLumiteOre,
  genSkyshardOre,
} from './ores';
import { genWaterFrames, genLavaFrames } from './fluids';

export type TextureGenerator = (seed?: number) => TextureData | TextureData[];

export const textureGenerators: Record<string, TextureGenerator> = {
  // Terrain
  grass_top: genGrassTop,
  grass_side: genGrassSide,
  dirt: genDirt,
  stone: genStone,
  cobblestone: genCobblestone,
  sand: genSand,
  gravel: genGravel,
  glass: genGlass,

  // Wood
  oak_log_top: genOakLogTop,
  oak_log_side: genOakLogSide,
  birch_log_top: genBirchLogTop,
  birch_log_side: genBirchLogSide,
  pine_log_top: genPineLogTop,
  pine_log_side: genPineLogSide,
  oak_planks: genOakPlanks,
  birch_planks: genBirchPlanks,
  pine_planks: genPinePlanks,
  oak_leaves: genOakLeaves,
  birch_leaves: genBirchLeaves,
  pine_leaves: genPineLeaves,

  // Ores
  coal_ore: genCoalOre,
  copper_ore: genCopperOre,
  iron_ore: genIronOre,
  gold_ore: genGoldOre,
  lumite_ore: genLumiteOre,
  skyshard_ore: genSkyshardOre,

  // Fluids
  water: genWaterFrames,
  lava: genLavaFrames,
};

// Required names by M01b Scope:
export const M01_REQUIRED_TEXTURES = [
  'grass_top',
  'grass_side',
  'dirt',
  'stone',
  'cobblestone',
  'sand',
  'gravel',
  'oak_log_top',
  'oak_log_side',
  'birch_log_top',
  'birch_log_side',
  'pine_log_top',
  'pine_log_side',
  'oak_leaves',
  'birch_leaves',
  'pine_leaves',
  'oak_planks',
  'birch_planks',
  'pine_planks',
  'glass',
  'water',
  'lava',
  'coal_ore',
  'copper_ore',
  'iron_ore',
  'gold_ore',
  'lumite_ore',
  'skyshard_ore',
];
