export interface CubeMaterial {
  name: string;
  top: string;
  side: string;
  bottom: string;
  transparent?: boolean; // glass, water
  cutout?: boolean; // leaves
}

export const SCENE_MATERIALS: CubeMaterial[] = [
  { name: 'grass', top: 'grass_top', side: 'grass_side', bottom: 'dirt' },
  { name: 'dirt', top: 'dirt', side: 'dirt', bottom: 'dirt' },
  { name: 'stone', top: 'stone', side: 'stone', bottom: 'stone' },
  { name: 'cobblestone', top: 'cobblestone', side: 'cobblestone', bottom: 'cobblestone' },
  { name: 'sand', top: 'sand', side: 'sand', bottom: 'sand' },
  { name: 'gravel', top: 'gravel', side: 'gravel', bottom: 'gravel' },
  { name: 'oak_log', top: 'oak_log_top', side: 'oak_log_side', bottom: 'oak_log_top' },
  { name: 'birch_log', top: 'birch_log_top', side: 'birch_log_side', bottom: 'birch_log_top' },
  { name: 'pine_log', top: 'pine_log_top', side: 'pine_log_side', bottom: 'pine_log_top' },
  { name: 'oak_leaves', top: 'oak_leaves', side: 'oak_leaves', bottom: 'oak_leaves', cutout: true },
  {
    name: 'birch_leaves',
    top: 'birch_leaves',
    side: 'birch_leaves',
    bottom: 'birch_leaves',
    cutout: true,
  },
  {
    name: 'pine_leaves',
    top: 'pine_leaves',
    side: 'pine_leaves',
    bottom: 'pine_leaves',
    cutout: true,
  },
  { name: 'oak_planks', top: 'oak_planks', side: 'oak_planks', bottom: 'oak_planks' },
  { name: 'birch_planks', top: 'birch_planks', side: 'birch_planks', bottom: 'birch_planks' },
  { name: 'pine_planks', top: 'pine_planks', side: 'pine_planks', bottom: 'pine_planks' },
  { name: 'glass', top: 'glass', side: 'glass', bottom: 'glass', transparent: true },
  { name: 'water', top: 'water_0', side: 'water_0', bottom: 'water_0', transparent: true },
  { name: 'lava', top: 'lava_0', side: 'lava_0', bottom: 'lava_0' },
  { name: 'coal_ore', top: 'coal_ore', side: 'coal_ore', bottom: 'coal_ore' },
  { name: 'copper_ore', top: 'copper_ore', side: 'copper_ore', bottom: 'copper_ore' },
  { name: 'iron_ore', top: 'iron_ore', side: 'iron_ore', bottom: 'iron_ore' },
  { name: 'gold_ore', top: 'gold_ore', side: 'gold_ore', bottom: 'gold_ore' },
  { name: 'lumite_ore', top: 'lumite_ore', side: 'lumite_ore', bottom: 'lumite_ore' },
  { name: 'skyshard_ore', top: 'skyshard_ore', side: 'skyshard_ore', bottom: 'skyshard_ore' },
  { name: 'oak_wood', top: 'oak_log_side', side: 'oak_log_side', bottom: 'oak_log_side' },
];
