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
  public keyBindings = new Map<string, Action>();
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

    // Default bindings
    this.bindKey('KeyW', 'forward');
    this.bindKey('KeyS', 'back');
    this.bindKey('KeyA', 'left');
    this.bindKey('KeyD', 'right');
    this.bindKey('Space', 'jump');
    this.bindKey('ShiftLeft', 'sneak');
    this.bindKey('ControlLeft', 'sprint');
    this.bindKey('F5', 'perspective');

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
    this.keyBindings.set(code, action);
  }

  unbindKey(code: string) {
    this.keyBindings.delete(code);
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
    const action = this.keyBindings.get(e.code);
    if (action) {
      this.setAction(action, true);
    }
  }

  private onKeyUp(e: KeyboardEvent) {
    const action = this.keyBindings.get(e.code);
    if (action) {
      this.setAction(action, false);
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
    if (e.button === 0) this.setAction('attack', true);
    if (e.button === 2) this.setAction('use', true);
    if (e.button === 1) this.setAction('pick', true);
  }

  private onMouseUp(e: MouseEvent) {
    if (!this.pointerLocked) return;
    if (e.button === 0) this.setAction('attack', false);
    if (e.button === 2) this.setAction('use', false);
    if (e.button === 1) this.setAction('pick', false);
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
