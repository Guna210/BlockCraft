import { api } from './core';
import { WorldManager } from '../../game/world-manager';

api.getPostFx = () => WorldManager.getInstance().getPostFxStats();
