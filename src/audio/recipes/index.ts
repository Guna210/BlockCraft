import { footsteps } from './footsteps';
import { blocks } from './blocks';
import { items } from './items';
import { mechanisms } from './mechanisms';
import { entities } from './entities';
import { weather } from './weather';
import { creatures } from './creatures';
import { integration } from './integration';

export const soundLibrary = {
  ...footsteps,
  ...blocks,
  ...items,
  ...mechanisms,
  ...entities,
  ...weather,
  ...creatures,
  ...integration,
};
