import { describe, expect, it } from 'vitest';
import { creativeItems } from '../../src/ui/creative-inventory';
import { items } from '../../src/gameplay/items';
import { DEFAULT_KEY_BINDINGS, KEYBIND_ACTIONS, actionsForCode } from '../../src/engine/keybinds';
import { normalizeSettings } from '../../src/engine/settings-persistence';

describe('M18c creative catalog and bindings', () => {
  it('searches all categories by id and display name and excludes every nonmatch', () => {
    const matches = creativeItems('food', 'glass');
    expect(matches.length).toBeGreaterThan(1);
    expect(matches.every((item) => item.id.includes('glass'))).toBe(true);
    expect(matches.map((item) => item.id)).toEqual(
      creativeItems('all', 'GLASS').map((item) => item.id),
    );
    expect(creativeItems('all', 'iron ingot').map((item) => item.id)).toContain('iron_ingot');
    expect(creativeItems('all', 'no_such_item')).toEqual([]);
    expect(creativeItems('block', '').every((item) => item.kind === 'block')).toBe(true);
    expect(
      creativeItems('gear', '').every((item) => item.kind === 'tool' || item.kind === 'armor'),
    ).toBe(true);
    expect(creativeItems('all', '').length).toBe(
      [...items.items.keys()].filter((id) => id !== 'air').length,
    );
  });
  it('adds remappable actions and fills them in when loading older settings', () => {
    expect(KEYBIND_ACTIONS).toEqual(expect.arrayContaining(['chat', 'command', 'screenshot']));
    const bindings = normalizeSettings({ keyBindings: { jump: 'KeyK' } }).keyBindings;
    expect(bindings).toMatchObject({
      jump: 'KeyK',
      chat: 'KeyT',
      command: 'Slash',
      screenshot: 'F2',
    });
    bindings.chat = 'KeyY';
    bindings.command = 'Backslash';
    bindings.screenshot = 'F6';
    expect(actionsForCode('KeyT', bindings)).toEqual([]);
    expect(actionsForCode('KeyY', bindings)).toEqual(['chat']);
    expect(DEFAULT_KEY_BINDINGS.screenshot).toBe('F2');
  });
});
