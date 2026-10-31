import { describe, expect, it } from 'vitest';
import { soundLibrary } from '../../src/audio/recipes';
import { blockSoundMaterial } from '../../src/audio/service';
import '../../src/entity/mobs';
import { creatureTypeIds } from '../../src/entity/mobs/creature';

describe('M16b audio recipes', () => {
  it('registers idle, hurt, and death voices for every creature type', () => {
    for (const type of creatureTypeIds()) {
      for (const voice of ['idle', 'hurt', 'death'])
        expect(soundLibrary[`creature.${type}.${voice}`], `${type} ${voice} voice`).toBeDefined();
    }
  });

  it('maps known block ids and registry tool classes without substring guesses', () => {
    expect(blockSoundMaterial('ice')).toBe('snow');
    expect(blockSoundMaterial('oak_door')).toBe('wood');
    expect(blockSoundMaterial('bluebell')).toBe('foliage');
    expect(blockSoundMaterial('red_sand')).toBe('sand');
    expect(blockSoundMaterial('mystery_door')).toBe('stone');
    expect(blockSoundMaterial('crystalized_glass')).toBe('stone');
  });
});
