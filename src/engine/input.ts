export type Action =
  'forward' | 'back' | 'left' | 'right' | 'jump' | 'sneak' | 'sprint' | 'attack' | 'use';

export class InputEngine {
  public keyBindings = new Map<string, Action>();
  public actionStates = new Map<Action, boolean>();
  public mouseMovement = { x: 0, y: 0 };
  public pointerLocked = false;
  private canvas: HTMLCanvasElement;

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
  }

  detach() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.canvas.removeEventListener('click', this.requestPointerLock);
  }

  bindKey(code: string, action: Action) {
    this.keyBindings.set(code, action);
  }

  unbindKey(code: string) {
    this.keyBindings.delete(code);
  }

  setAction(action: Action, state: boolean) {
    this.actionStates.set(action, state);
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
    if (e.repeat) return;
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
    if (this.pointerLocked) {
      this.mouseMovement.x += e.movementX;
      this.mouseMovement.y += e.movementY;
    }
  }

  private onMouseDown(e: MouseEvent) {
    if (!this.pointerLocked) return;
    if (e.button === 0) this.setAction('attack', true);
    if (e.button === 2) this.setAction('use', true);
  }

  private onMouseUp(e: MouseEvent) {
    if (!this.pointerLocked) return;
    if (e.button === 0) this.setAction('attack', false);
    if (e.button === 2) this.setAction('use', false);
  }

  private onPointerLockChange() {
    this.pointerLocked = document.pointerLockElement === this.canvas;
    if (!this.pointerLocked) {
      // Clear actions when losing pointer lock
      this.actionStates.forEach((_, key) => this.actionStates.set(key, false));
    }
  }

  private requestPointerLock() {
    if (!this.pointerLocked) {
      this.canvas.requestPointerLock();
    }
  }
}
