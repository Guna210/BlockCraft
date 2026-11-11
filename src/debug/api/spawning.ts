import { api } from './core';
import { WorldManager } from '../../game/world-manager';

api.setSpawning = (enabled: boolean) => WorldManager.getInstance().setSpawning(enabled);
