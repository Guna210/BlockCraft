import { setSetting } from '../../engine/settings-runtime';
import { api } from './core';
import { WorldManager } from '../../game/world-manager';

api.getLodStats = () => WorldManager.getInstance().getLodStats();
api.setLod = (enabled) => setSetting('lod', enabled);
