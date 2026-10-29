import type { StructureRegistration } from './stage';
import { WAYFARER_HAMLET_REGISTRATIONS } from './wayfarer-hamlet';
import { SUNKEN_CRYPT_REGISTRATION } from './sunken-crypt';
import { SPIRE_RUIN_REGISTRATION } from './spire-ruin';
import { MINESHAFT_WARREN_REGISTRATION } from './mineshaft-warren';

/** Every structure the world generates while Create World's Structures option is on. */
export const STRUCTURE_REGISTRATIONS: readonly StructureRegistration[] = [
  ...WAYFARER_HAMLET_REGISTRATIONS,
  SUNKEN_CRYPT_REGISTRATION,
  SPIRE_RUIN_REGISTRATION,
  MINESHAFT_WARREN_REGISTRATION,
];
