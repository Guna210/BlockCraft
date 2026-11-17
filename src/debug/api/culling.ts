import { api } from './core';
import { cullingSettings } from '../../render/culling-settings';

api.setCulling = (options) => {
  if (options.cave !== undefined) cullingSettings.cave = options.cave;
  if (options.frustum !== undefined) cullingSettings.frustum = options.frustum;
};
