/** Every keyboard and mouse action read by gameplay or UI has one persisted binding here. */
export const KEYBIND_ACTIONS = [
  'forward',
  'back',
  'left',
  'right',
  'jump',
  'sneak',
  'sprint',
  'attack',
  'use',
  'perspective',
  'pick',
  'inventory',
  'drop',
  'menuBack',
  'menuConfirm',
  'menuUp',
  'menuDown',
  'debug',
  'hotbar1',
  'hotbar2',
  'hotbar3',
  'hotbar4',
  'hotbar5',
  'hotbar6',
  'hotbar7',
  'hotbar8',
  'hotbar9',
  'chat',
  'command',
  'screenshot',
] as const;

export type KeybindAction = (typeof KEYBIND_ACTIONS)[number];
export type KeyBindings = Record<KeybindAction, string>;

export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  sneak: 'ShiftLeft',
  sprint: 'ControlLeft',
  attack: 'Mouse0',
  use: 'Mouse2',
  perspective: 'F5',
  pick: 'Mouse1',
  inventory: 'KeyE',
  drop: 'KeyQ',
  menuBack: 'Escape',
  menuConfirm: 'Enter',
  menuUp: 'ArrowUp',
  menuDown: 'ArrowDown',
  debug: 'F3',
  hotbar1: 'Digit1',
  hotbar2: 'Digit2',
  hotbar3: 'Digit3',
  hotbar4: 'Digit4',
  hotbar5: 'Digit5',
  hotbar6: 'Digit6',
  hotbar7: 'Digit7',
  hotbar8: 'Digit8',
  hotbar9: 'Digit9',
  chat: 'KeyT',
  command: 'Slash',
  screenshot: 'F2',
};

export function cloneKeyBindings(bindings: KeyBindings = DEFAULT_KEY_BINDINGS): KeyBindings {
  return { ...bindings };
}

/** Returns all actions on a key. Multiple matches are intentional and shown as conflicts in UI. */
export function actionsForCode(code: string, bindings: KeyBindings): KeybindAction[] {
  const actions: KeybindAction[] = [];
  for (const action of KEYBIND_ACTIONS) if (bindings[action] === code) actions.push(action);
  return actions;
}

export function conflictsFor(bindings: KeyBindings): Array<[string, KeybindAction[]]> {
  const byCode = new Map<string, KeybindAction[]>();
  for (const action of KEYBIND_ACTIONS) {
    const code = bindings[action];
    if (!code) continue;
    const actions = byCode.get(code);
    if (actions) actions.push(action);
    else byCode.set(code, [action]);
  }
  return [...byCode.entries()].filter(([, actions]) => actions.length > 1);
}

export function isActionCode(code: string, action: KeybindAction, bindings: KeyBindings): boolean {
  return bindings[action] === code;
}

export function readableKey(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  if (code === 'Mouse0') return 'Mouse 1';
  if (code === 'Mouse1') return 'Mouse 3';
  if (code === 'Mouse2') return 'Mouse 2';
  if (code === 'ShiftLeft') return 'Left Shift';
  if (code === 'ShiftRight') return 'Right Shift';
  if (code === 'ControlLeft') return 'Left Ctrl';
  if (code === 'ControlRight') return 'Right Ctrl';
  if (code === 'AltLeft') return 'Left Alt';
  if (code === 'AltRight') return 'Right Alt';
  return code || 'Unbound';
}

export const KEYBIND_LABELS: Record<KeybindAction, string> = {
  forward: 'Move forward',
  back: 'Move backward',
  left: 'Move left',
  right: 'Move right',
  jump: 'Jump',
  sneak: 'Sneak',
  sprint: 'Sprint',
  attack: 'Attack',
  use: 'Use item / block',
  perspective: 'Change perspective',
  pick: 'Pick block',
  inventory: 'Inventory',
  drop: 'Drop item',
  menuBack: 'Back / pause',
  menuConfirm: 'Confirm',
  menuUp: 'Menu up',
  menuDown: 'Menu down',
  debug: 'Debug overlay',
  hotbar1: 'Hotbar slot 1',
  hotbar2: 'Hotbar slot 2',
  hotbar3: 'Hotbar slot 3',
  hotbar4: 'Hotbar slot 4',
  hotbar5: 'Hotbar slot 5',
  hotbar6: 'Hotbar slot 6',
  hotbar7: 'Hotbar slot 7',
  hotbar8: 'Hotbar slot 8',
  hotbar9: 'Hotbar slot 9',
  chat: 'Open chat',
  command: 'Open command',
  screenshot: 'Screenshot',
};

/** Converts a DOM mouse button number to the same code used by key bindings. */
export function mouseCode(button: number): string {
  return `Mouse${button}`;
}
