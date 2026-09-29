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
  PAL_STONE,
  PAL_DIRT,
  PAL_GRASS,
  PAL_SAND,
  PAL_GRAVEL,
  PAL_GLASS_FRAME,
  PAL_GLASS_GLINT,
  PAL_GLASS_PANE,
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
  PAL_OAK_BARK,
  PAL_OAK_WOOD,
  PAL_BIRCH_BARK,
  PAL_BIRCH_WOOD,
  PAL_PINE_BARK,
  PAL_PINE_WOOD,
  PAL_LEAVES,
  PAL_LEAVES_TRANS,
} from './wood';
import {
  genCoalOre,
  genCopperOre,
  genIronOre,
  genGoldOre,
  genLumiteOre,
  genSkyshardOre,
  PAL_COAL,
  PAL_COPPER,
  PAL_IRON,
  PAL_GOLD,
  PAL_LUMITE,
  PAL_SKYSHARD,
} from './ores';
import { genWaterFrames, genLavaFrames, PAL_WATER, PAL_LAVA } from './fluids';

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

import { RGBA } from './noise';

export const texturePalettes: Record<string, RGBA[]> = {
  // Terrain
  grass_top: PAL_GRASS,
  grass_side: [...PAL_GRASS, ...PAL_DIRT],
  dirt: PAL_DIRT,
  stone: PAL_STONE,
  cobblestone: PAL_STONE,
  sand: PAL_SAND,
  gravel: PAL_GRAVEL,
  glass: [PAL_GLASS_FRAME, PAL_GLASS_GLINT, PAL_GLASS_PANE],

  // Wood
  oak_log_top: [...PAL_OAK_WOOD, ...PAL_OAK_BARK],
  oak_log_side: PAL_OAK_BARK,
  birch_log_top: [...PAL_BIRCH_WOOD, ...PAL_BIRCH_BARK],
  birch_log_side: PAL_BIRCH_BARK,
  pine_log_top: [...PAL_PINE_WOOD, ...PAL_PINE_BARK],
  pine_log_side: PAL_PINE_BARK,
  oak_planks: PAL_OAK_WOOD,
  birch_planks: PAL_BIRCH_WOOD,
  pine_planks: PAL_PINE_WOOD,
  oak_leaves: [...PAL_LEAVES, PAL_LEAVES_TRANS],
  birch_leaves: [...PAL_LEAVES, PAL_LEAVES_TRANS],
  pine_leaves: [...PAL_LEAVES, PAL_LEAVES_TRANS],

  // Ores
  coal_ore: [...PAL_STONE, ...PAL_COAL],
  copper_ore: [...PAL_STONE, ...PAL_COPPER],
  iron_ore: [...PAL_STONE, ...PAL_IRON],
  gold_ore: [...PAL_STONE, ...PAL_GOLD],
  lumite_ore: [...PAL_STONE, ...PAL_LUMITE],
  skyshard_ore: [...PAL_STONE, ...PAL_SKYSHARD],

  // Fluids
  water: PAL_WATER,
  lava: PAL_LAVA,
};
