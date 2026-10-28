import { api } from './core';
import { WorldManager } from '../../world/world-manager';

api.setSpawning = (enabled: boolean) => WorldManager.getInstance().setSpawning(enabled);
