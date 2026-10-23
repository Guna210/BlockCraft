import { actionsForCode, KEYBIND_ACTIONS, mouseCode } from './keybinds';
import { settings } from './settings';

export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'sneak'
  | 'sprint'
  | 'attack'
  | 'use'
  | 'perspective'
  | 'pick';

export class InputEngine {
  /** Compatibility view for older callers; the source of truth is settings.keyBindings. */
  get keyBindings(): Map<string, Action> {
    const bindings = new Map<string, Action>();
    for (const action of [
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
    ] as const) {
      const code = settings.keyBindings[action];
      if (code) bindings.set(code, action);
    }
    return bindings;
  }
  public actionStates = new Map<Action, boolean>();
  public mouseMovement = { x: 0, y: 0 };
  public pointerLocked = false;
  /** While a UI screen is open, game input is ignored: movement keys, mouse look and buttons. */
  public captured = false;
  public onAction?: (action: Action, down: boolean) => void;
  private canvas: HTMLCanvasElement;
  private readonly onContextMenu = (event: Event) => {
    if (this.pointerLocked) event.preventDefault();
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    // Default state
    const actions: Action[] = [
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
    ];
    for (const action of actions) {
      this.actionStates.set(action, false);
    }

    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    this.onPointerLockChange = this.onPointerLockChange.bind(this);
    this.requestPointerLock = this.requestPointerLock.bind(this);
  }

  attach() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    this.canvas.addEventListener('click', this.requestPointerLock);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  detach() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.canvas.removeEventListener('click', this.requestPointerLock);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
  }

  bindKey(code: string, action: Action) {
    settings.keyBindings[action] = code;
  }

  unbindKey(code: string) {
    for (const action of KEYBIND_ACTIONS)
      if (settings.keyBindings[action] === code) settings.keyBindings[action] = '';
  }

  setCapture(on: boolean) {
    this.captured = on;
    if (!on) return;
    this.actionStates.forEach((_, key) => this.setAction(key, false));
    this.mouseMovement.x = 0;
    this.mouseMovement.y = 0;
  }

  setAction(action: Action, state: boolean) {
    if (this.captured && state) return;
    this.actionStates.set(action, state);
    this.onAction?.(action, state);
  }

  getAction(action: Action): boolean {
    return this.actionStates.get(action) ?? false;
  }

  consumeMouseMovement() {
    const mov = { ...this.mouseMovement };
    this.mouseMovement.x = 0;
    this.mouseMovement.y = 0;
    return mov;
  }

  private onKeyDown(e: KeyboardEvent) {
    if (e.repeat || this.captured) return;
    this.setActionsForCode(e.code, true);
  }

  private onKeyUp(e: KeyboardEvent) {
    this.setActionsForCode(e.code, false);
  }

  private setActionsForCode(code: string, down: boolean): void {
    for (const action of actionsForCode(code, settings.keyBindings)) {
      if (this.actionStates.has(action as Action)) this.setAction(action as Action, down);
    }
  }

  private onMouseMove(e: MouseEvent) {
    if (this.pointerLocked && !this.captured) {
      this.mouseMovement.x += e.movementX;
      this.mouseMovement.y += e.movementY;
    }
  }

  private onMouseDown(e: MouseEvent) {
    if (!this.pointerLocked) return;
    this.setActionsForCode(mouseCode(e.button), true);
  }

  private onMouseUp(e: MouseEvent) {
    if (!this.pointerLocked) return;
    this.setActionsForCode(mouseCode(e.button), false);
  }

  private onPointerLockChange() {
    this.pointerLocked = document.pointerLockElement === this.canvas;
    if (!this.pointerLocked) {
      // Clear actions when losing pointer lock
      this.actionStates.forEach((_, key) => this.setAction(key, false));
    }
  }

  /** Asks for pointer lock again after a screen closes; resolves only where the browser allows it. */
  relock(): Promise<void> | undefined {
    if (this.pointerLocked) return undefined;
    return this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
  }

  private requestPointerLock() {
    if (!this.pointerLocked) {
      this.canvas.requestPointerLock();
    }
  }
}
