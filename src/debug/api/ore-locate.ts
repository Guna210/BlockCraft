import { registerLocator } from './locate';
import { locateOre } from '../../game/commands/ore-locate';
export { locateOre, ORE_LOCATE_RADIUS_CHUNKS } from '../../game/commands/ore-locate';

registerLocator('ore', locateOre);
