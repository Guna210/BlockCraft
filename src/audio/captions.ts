import type { soundLibrary } from './recipes';

export interface SoundCaption {
  text: string;
  /** Matches the audio service's maximum audible radius; nearby idle creature calls are shorter. */
  audibleDistance: number;
}

const AUDIBLE_DISTANCE = 36;
const CREATURE_IDLE_DISTANCE = 24;

/** One caption for every synthesized sound recipe; names follow SPEC Appendices A–C. */
export const SOUND_CAPTIONS: Record<string, SoundCaption> = {
  'footstep.grass': { text: 'Grass footsteps', audibleDistance: AUDIBLE_DISTANCE },
  'footstep.stone': { text: 'Stone footsteps', audibleDistance: AUDIBLE_DISTANCE },
  'footstep.sand': { text: 'Sand footsteps', audibleDistance: AUDIBLE_DISTANCE },
  'footstep.wood': { text: 'Wood footsteps', audibleDistance: AUDIBLE_DISTANCE },
  'footstep.gravel': { text: 'Gravel footsteps', audibleDistance: AUDIBLE_DISTANCE },
  'footstep.snow': { text: 'Snow footsteps', audibleDistance: AUDIBLE_DISTANCE },
  'footstep.water': { text: 'Water steps', audibleDistance: AUDIBLE_DISTANCE },
  'break.grass': { text: 'Grass breaks', audibleDistance: AUDIBLE_DISTANCE },
  'break.stone': { text: 'Stone breaks', audibleDistance: AUDIBLE_DISTANCE },
  'break.sand': { text: 'Sand breaks', audibleDistance: AUDIBLE_DISTANCE },
  'break.wood': { text: 'Wood breaks', audibleDistance: AUDIBLE_DISTANCE },
  'break.gravel': { text: 'Gravel breaks', audibleDistance: AUDIBLE_DISTANCE },
  'break.snow': { text: 'Snow breaks', audibleDistance: AUDIBLE_DISTANCE },
  'break.glass': { text: 'Glass breaks', audibleDistance: AUDIBLE_DISTANCE },
  'break.foliage': { text: 'Foliage rustles', audibleDistance: AUDIBLE_DISTANCE },
  'place.grass': { text: 'Grass block placed', audibleDistance: AUDIBLE_DISTANCE },
  'place.stone': { text: 'Stone placed', audibleDistance: AUDIBLE_DISTANCE },
  'place.sand': { text: 'Sand placed', audibleDistance: AUDIBLE_DISTANCE },
  'place.wood': { text: 'Wood placed', audibleDistance: AUDIBLE_DISTANCE },
  'place.gravel': { text: 'Gravel placed', audibleDistance: AUDIBLE_DISTANCE },
  'place.snow': { text: 'Snow placed', audibleDistance: AUDIBLE_DISTANCE },
  'place.glass': { text: 'Glass placed', audibleDistance: AUDIBLE_DISTANCE },
  'place.foliage': { text: 'Foliage placed', audibleDistance: AUDIBLE_DISTANCE },
  'item.pickup': { text: 'Item picked up', audibleDistance: AUDIBLE_DISTANCE },
  'item.eat': { text: 'Eating', audibleDistance: AUDIBLE_DISTANCE },
  'mechanism.kiln_crackle': { text: 'Kiln crackles', audibleDistance: AUDIBLE_DISTANCE },
  'mechanism.piston': { text: 'Piston moves', audibleDistance: AUDIBLE_DISTANCE },
  'mechanism.button': { text: 'Button clicks', audibleDistance: AUDIBLE_DISTANCE },
  'mechanism.lever': { text: 'Lever clicks', audibleDistance: AUDIBLE_DISTANCE },
  'mechanism.note': { text: 'Note Block rings', audibleDistance: AUDIBLE_DISTANCE },
  'weapon.bow_draw': { text: 'Bow draws', audibleDistance: AUDIBLE_DISTANCE },
  'weapon.bow_release': { text: 'Bow releases', audibleDistance: AUDIBLE_DISTANCE },
  'weapon.arrow_hit': { text: 'Arrow hits', audibleDistance: AUDIBLE_DISTANCE },
  'player.hurt': { text: 'Player hurt', audibleDistance: AUDIBLE_DISTANCE },
  'player.death': { text: 'Player dies', audibleDistance: AUDIBLE_DISTANCE },
  'entity.explosion': { text: 'Explosion', audibleDistance: AUDIBLE_DISTANCE },
  'weather.rain': { text: 'Rain falls', audibleDistance: AUDIBLE_DISTANCE },
  'weather.thunder': { text: 'Thunder rumbles', audibleDistance: AUDIBLE_DISTANCE },
  'ambience.fluid': { text: 'Fluid bubbles', audibleDistance: AUDIBLE_DISTANCE },
  'ambience.cave': { text: 'Cave ambience', audibleDistance: AUDIBLE_DISTANCE },
  'creature.tuftbuck.idle': { text: 'Tuftbuck bleats', audibleDistance: CREATURE_IDLE_DISTANCE },
  'creature.tuftbuck.hurt': { text: 'Tuftbuck cries out', audibleDistance: AUDIBLE_DISTANCE },
  'creature.tuftbuck.death': { text: 'Tuftbuck falls silent', audibleDistance: AUDIBLE_DISTANCE },
  'creature.rootboar.idle': { text: 'Rootboar grunts', audibleDistance: CREATURE_IDLE_DISTANCE },
  'creature.rootboar.hurt': { text: 'Rootboar cries out', audibleDistance: AUDIBLE_DISTANCE },
  'creature.rootboar.death': { text: 'Rootboar falls silent', audibleDistance: AUDIBLE_DISTANCE },
  'creature.dapplefowl.idle': {
    text: 'Dapplefowl clucks',
    audibleDistance: CREATURE_IDLE_DISTANCE,
  },
  'creature.dapplefowl.hurt': { text: 'Dapplefowl squawks', audibleDistance: AUDIBLE_DISTANCE },
  'creature.dapplefowl.death': {
    text: 'Dapplefowl falls silent',
    audibleDistance: AUDIBLE_DISTANCE,
  },
  'creature.mossback.idle': { text: 'Mossback groans', audibleDistance: CREATURE_IDLE_DISTANCE },
  'creature.mossback.hurt': { text: 'Mossback cries out', audibleDistance: AUDIBLE_DISTANCE },
  'creature.mossback.death': { text: 'Mossback falls silent', audibleDistance: AUDIBLE_DISTANCE },
  'creature.glimmer_moth.idle': {
    text: 'Glimmer Moth chirps',
    audibleDistance: CREATURE_IDLE_DISTANCE,
  },
  'creature.glimmer_moth.hurt': {
    text: 'Glimmer Moth chirps sharply',
    audibleDistance: AUDIBLE_DISTANCE,
  },
  'creature.glimmer_moth.death': {
    text: 'Glimmer Moth falls silent',
    audibleDistance: AUDIBLE_DISTANCE,
  },
  'creature.hollow.idle': { text: 'Hollow groans', audibleDistance: CREATURE_IDLE_DISTANCE },
  'creature.hollow.hurt': { text: 'Hollow cries out', audibleDistance: AUDIBLE_DISTANCE },
  'creature.hollow.death': { text: 'Hollow falls silent', audibleDistance: AUDIBLE_DISTANCE },
  'creature.thornling.idle': { text: 'Thornling creaks', audibleDistance: CREATURE_IDLE_DISTANCE },
  'creature.thornling.hurt': { text: 'Thornling crackles', audibleDistance: AUDIBLE_DISTANCE },
  'creature.thornling.death': { text: 'Thornling falls silent', audibleDistance: AUDIBLE_DISTANCE },
  'creature.skitterer.idle': {
    text: 'Skitterer chitters',
    audibleDistance: CREATURE_IDLE_DISTANCE,
  },
  'creature.skitterer.hurt': {
    text: 'Skitterer chitters sharply',
    audibleDistance: AUDIBLE_DISTANCE,
  },
  'creature.skitterer.death': { text: 'Skitterer falls silent', audibleDistance: AUDIBLE_DISTANCE },
  'creature.sporeburst.idle': {
    text: 'Sporeburst bubbles',
    audibleDistance: CREATURE_IDLE_DISTANCE,
  },
  'creature.sporeburst.hurt': { text: 'Sporeburst squelches', audibleDistance: AUDIBLE_DISTANCE },
  'creature.sporeburst.death': {
    text: 'Sporeburst falls silent',
    audibleDistance: AUDIBLE_DISTANCE,
  },
  'creature.cinderwraith.idle': {
    text: 'Cinderwraith drones',
    audibleDistance: CREATURE_IDLE_DISTANCE,
  },
  'creature.cinderwraith.hurt': {
    text: 'Cinderwraith crackles',
    audibleDistance: AUDIBLE_DISTANCE,
  },
  'creature.cinderwraith.death': {
    text: 'Cinderwraith falls silent',
    audibleDistance: AUDIBLE_DISTANCE,
  },
  'creature.glowwing.idle': { text: 'Glowwing hums', audibleDistance: CREATURE_IDLE_DISTANCE },
  'creature.glowwing.hurt': { text: 'Glowwing pulses', audibleDistance: AUDIBLE_DISTANCE },
  'creature.glowwing.death': { text: 'Glowwing falls silent', audibleDistance: AUDIBLE_DISTANCE },
  'creature.magmaw.idle': { text: 'Magmaw bubbles', audibleDistance: CREATURE_IDLE_DISTANCE },
  'creature.magmaw.hurt': { text: 'Magmaw growls', audibleDistance: AUDIBLE_DISTANCE },
  'creature.magmaw.death': { text: 'Magmaw falls silent', audibleDistance: AUDIBLE_DISTANCE },
} satisfies Record<string, SoundCaption>;

export type CaptionableSoundId = Exclude<
  keyof typeof soundLibrary,
  `music.${string}` | `ui.${string}`
>;
