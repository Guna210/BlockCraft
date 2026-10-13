import type { BlockDefinition } from '../world/blocks/types';
export interface MiningTool {
  type: string;
  tier: number;
  speed: number;
}
export const BARE_HAND: MiningTool = { type: 'none', tier: -1, speed: 1 };
export function canHarvest(block: BlockDefinition, tool: MiningTool = BARE_HAND): boolean {
  return block.minTier === undefined || (correctTool(block, tool) && tool.tier >= block.minTier);
}
function correctTool(block: BlockDefinition, tool: MiningTool): boolean {
  return (
    block.tool === tool.type ||
    (block.tool === 'shears/hoe' && (tool.type === 'shears' || tool.type === 'hoe'))
  );
}
/** Appendix A.1. Infinity/negative hardness is unbreakable, even in creative. */
export function breakSeconds(
  block: BlockDefinition,
  tool: MiningTool = BARE_HAND,
  water = false,
  airborne = false,
): number {
  if (block.id === 'foundation_stone' || !Number.isFinite(block.hardness) || block.hardness < 0)
    return Infinity;
  if (block.hardness === 0) return 0;
  const correct = correctTool(block, tool);
  const harvest = canHarvest(block, tool);
  return (
    ((block.hardness * (harvest ? 1.5 : 5)) / (correct ? tool.speed : 1)) *
    (water ? 5 : 1) *
    (airborne ? 5 : 1)
  );
}
