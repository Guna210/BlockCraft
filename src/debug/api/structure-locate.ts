import { registerLocator } from './locate';
import { locateStructure } from '../../game/commands/structure-locate';

registerLocator('structure', locateStructure);
