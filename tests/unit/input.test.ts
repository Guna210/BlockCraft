import { describe, it, expect, beforeEach } from 'vitest';
import { InputEngine } from '../../src/engine/input';

describe('InputEngine', () => {
  let canvas: HTMLCanvasElement;
  let input: InputEngine;

  beforeEach(() => {
    canvas = document.createElement('canvas');
    input = new InputEngine(canvas);
  });

  it('rebinding an action changes which key triggers it', () => {
    // Rebind forward from KeyW to ArrowUp
    input.bindKey('ArrowUp', 'forward');
    input.unbindKey('KeyW');

    // Trigger KeyW - should do nothing
    const wEvent = new KeyboardEvent('keydown', { code: 'KeyW' });
    // Simulate event (since we are unit testing methods directly)
    (input as unknown as { onKeyDown: (e: KeyboardEvent) => void }).onKeyDown(wEvent);
    expect(input.getAction('forward')).toBe(false);

    // Trigger ArrowUp - should set forward
    const upEvent = new KeyboardEvent('keydown', { code: 'ArrowUp' });
    (input as unknown as { onKeyDown: (e: KeyboardEvent) => void }).onKeyDown(upEvent);
    expect(input.getAction('forward')).toBe(true);

    const upEventUp = new KeyboardEvent('keyup', { code: 'ArrowUp' });
    (input as unknown as { onKeyUp: (e: KeyboardEvent) => void }).onKeyUp(upEventUp);
    expect(input.getAction('forward')).toBe(false);
  });

  it('an unbound key triggers nothing', () => {
    const event = new KeyboardEvent('keydown', { code: 'KeyX' });
    (input as unknown as { onKeyDown: (e: KeyboardEvent) => void }).onKeyDown(event);

    // Check all actions are still false
    const actions = Array.from(input.actionStates.values());
    expect(actions.every((v) => v === false)).toBe(true);
  });

  it('actions can be set programmatically', () => {
    input.setAction('jump', true);
    expect(input.getAction('jump')).toBe(true);

    input.setAction('jump', false);
    expect(input.getAction('jump')).toBe(false);
  });
});
