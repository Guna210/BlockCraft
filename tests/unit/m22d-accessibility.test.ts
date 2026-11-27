import { describe, expect, it, vi } from 'vitest';
import { SOUND_CAPTIONS } from '../../src/audio/captions';
import { directionForSound, SubtitleTracker } from '../../src/audio/subtitles';
import { setAudioParamTarget } from '../../src/audio/service';
import { defaultSettings } from '../../src/engine/settings';
import { loadSettings, saveSettings } from '../../src/engine/settings-persistence';
import { soundLibrary } from '../../src/audio/recipes';
import { HIGH_CONTRAST_UI_TOKENS } from '../../src/ui/ui-kit';
import { createFakeIdb } from './helpers/fake-idb';

function luminance(color: string): number {
  const channels = color
    .slice(1)
    .match(/.{2}/g)!
    .map((value) => parseInt(value, 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrastRatio(foreground: string, background: string): number {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

describe('M22d accessibility and resilience', () => {
  it('has a caption for every non-music, non-UI sound recipe', () => {
    const missing = Object.keys(soundLibrary).filter(
      (id) => !id.startsWith('music.') && !id.startsWith('ui.') && !SOUND_CAPTIONS[id],
    );
    expect(missing).toEqual([]);
  });

  it('uses the four camera-relative subtitle sectors and refreshes repeated captions', () => {
    expect(directionForSound(1, 0, 0, 0, 0)).toBe('ahead');
    expect(directionForSound(0, 1, 0, 0, 0)).toBe('right');
    expect(directionForSound(-1, 0, 0, 0, 0)).toBe('behind');
    expect(directionForSound(0, -1, 0, 0, 0)).toBe('left');

    const tracker = new SubtitleTracker();
    tracker.add('Hollow groans', 'behind', 100);
    tracker.add('Hollow groans', 'right', 250);
    expect(tracker.current(true, 250)).toEqual([
      { text: 'Hollow groans', direction: 'right', ageMs: 0 },
    ]);
    expect(tracker.current(true, 3250)).toEqual([]);
  });

  it('keeps high-contrast text at least 7:1 against panel backgrounds', () => {
    for (const background of [
      HIGH_CONTRAST_UI_TOKENS.outline,
      HIGH_CONTRAST_UI_TOKENS.panel,
      HIGH_CONTRAST_UI_TOKENS.slot,
      HIGH_CONTRAST_UI_TOKENS.shade,
      HIGH_CONTRAST_UI_TOKENS.light,
    ])
      expect(contrastRatio(HIGH_CONTRAST_UI_TOKENS.text, background)).toBeGreaterThanOrEqual(7);
  });

  it('clamps audio gains but preserves negative listener coordinates and vectors', () => {
    const param = { setTargetAtTime: vi.fn() };
    setAudioParamTarget(param, -12, 1, false);
    expect(param.setTargetAtTime).toHaveBeenLastCalledWith(-12, 1, 0.04);
    setAudioParamTarget(param, -0.5, 2, true);
    expect(param.setTargetAtTime).toHaveBeenLastCalledWith(0, 2, 0.04);
    setAudioParamTarget(param, 0.75, 3, true);
    expect(param.setTargetAtTime).toHaveBeenLastCalledWith(0.75, 3, 0.04);
  });

  it('round-trips all three accessibility preferences and defaults them off', async () => {
    const defaults = defaultSettings();
    expect(defaults).toMatchObject({ subtitles: false, reducedMotion: false, highContrast: false });

    const fake = createFakeIdb();
    defaults.subtitles = true;
    defaults.reducedMotion = true;
    defaults.highContrast = true;
    await saveSettings(defaults, fake.env);
    expect(await loadSettings(fake.env)).toMatchObject({
      subtitles: true,
      reducedMotion: true,
      highContrast: true,
    });
  });
});
