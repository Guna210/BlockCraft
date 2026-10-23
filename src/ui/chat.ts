import type { InputEngine } from '../engine/input';
import { settings } from '../engine/settings';
import { isActionCode, mouseCode } from '../engine/keybinds';
import { completeCommand, type CompletionCatalog } from '../game/commands/parser';
import type { CommandResult } from '../game/commands';
import { UI } from './ui-kit';

/** Local console. CSS fades visible messages; no timers or frame hook. */
export class Chat {
  private readonly root = document.createElement('section');
  private readonly lines = document.createElement('div');
  private readonly form = document.createElement('form');
  private readonly inputField = document.createElement('input');
  private readonly hint = document.createElement('div');
  private readonly history: string[] = [];
  private historyIndex = 0;
  private draft = '';
  private opened = false;
  private wasLocked = false;
  private completion: { options: string[]; index: number; last: string } | null = null;
  constructor(
    private readonly input: InputEngine,
    private readonly canOpen: () => boolean,
    private readonly execute: (line: string) => Promise<CommandResult>,
    private readonly catalog: () => CompletionCatalog,
  ) {
    this.root.id = 'chat';
    this.root.setAttribute('aria-label', 'Local chat');
    Object.assign(this.root.style, {
      position: 'fixed',
      left: '20px',
      bottom: '100px',
      width: 'min(700px, calc(100vw - 40px))',
      zIndex: '11',
      color: UI.text,
      font: '16px monospace',
      pointerEvents: 'none',
    });
    this.lines.setAttribute('role', 'log');
    this.lines.setAttribute('aria-live', 'polite');
    this.lines.id = 'chat-lines';
    Object.assign(this.form.style, {
      display: 'none',
      background: UI.slot,
      border: `2px solid ${UI.light}`,
      padding: '10px',
      pointerEvents: 'auto',
    });
    this.inputField.id = 'chat-input';
    this.inputField.setAttribute('aria-label', 'Chat message or command');
    this.inputField.maxLength = 512;
    this.inputField.autocomplete = 'off';
    this.inputField.spellcheck = false;
    Object.assign(this.inputField.style, {
      width: '100%',
      boxSizing: 'border-box',
      color: UI.text,
      background: UI.slot,
      border: '0',
      outline: 'none',
      font: 'inherit',
    });
    this.hint.textContent = 'LOCAL CHAT  /  TAB COMPLETE  /  UP & DOWN HISTORY';
    Object.assign(this.hint.style, { color: UI.accent, fontSize: '12px', marginBottom: '8px' });
    this.form.append(this.hint, this.inputField);
    this.root.append(this.lines, this.form);
    document.body.append(this.root);
    const style = document.createElement('style');
    style.textContent =
      '@keyframes blockcraft-chat-fade{0%,75%{opacity:1}100%{opacity:0}}#chat-lines>div{animation:blockcraft-chat-fade 10s linear forwards}#chat[data-open=true] #chat-lines>div{animation:none;opacity:1}';
    document.head.append(style);
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
    });
    this.inputField.addEventListener('input', () => {
      this.completion = null;
      this.hint.textContent = 'LOCAL CHAT  /  TAB COMPLETE  /  UP & DOWN HISTORY';
    });
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener(
      'mousedown',
      (event) => {
        if (
          this.opened ||
          this.input.captured ||
          !this.canOpen() ||
          !(event.target instanceof HTMLCanvasElement)
        )
          return;
        const code = mouseCode(event.button);
        if (
          !isActionCode(code, 'chat', settings.keyBindings) &&
          !isActionCode(code, 'command', settings.keyBindings)
        )
          return;
        event.preventDefault();
        event.stopImmediatePropagation();
        this.open(isActionCode(code, 'command', settings.keyBindings));
      },
      true,
    );
    window.addEventListener(
      'click',
      (event) => {
        if (this.opened && event.target instanceof HTMLCanvasElement) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.inputField.focus();
        }
      },
      true,
    );
  }
  get visible(): boolean {
    return this.opened;
  }
  open(command = false): void {
    if (this.opened || !this.canOpen() || this.input.captured) return;
    this.opened = true;
    this.wasLocked = this.input.pointerLocked;
    this.input.setCapture(true);
    if (this.wasLocked) document.exitPointerLock();
    this.root.dataset.open = 'true';
    this.form.style.display = 'block';
    this.inputField.value = command ? '/' : '';
    this.historyIndex = this.history.length;
    this.draft = '';
    this.completion = null;
    this.inputField.focus();
  }
  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.root.dataset.open = 'false';
    this.form.style.display = 'none';
    this.inputField.blur();
    this.input.setCapture(false);
    if (this.wasLocked) {
      try {
        this.input.relock()?.catch(() => {});
      } catch {
        /* Click the canvas to regain pointer lock. */
      }
    }
  }
  message(text: string, error = false): void {
    const line = document.createElement('div');
    line.textContent = error ? `Error: ${text}` : text;
    line.dataset.error = String(error);
    Object.assign(line.style, {
      background: UI.outline,
      color: error ? UI.accent : UI.text,
      borderLeft: `3px solid ${error ? UI.accent : UI.light}`,
      padding: '6px 9px',
      marginBottom: '4px',
      overflowWrap: 'anywhere',
    });
    this.lines.append(line);
    while (this.lines.children.length > 8) this.lines.firstElementChild!.remove();
    line.addEventListener('animationend', () => line.remove(), { once: true });
  }
  private submit(): void {
    const line = this.inputField.value.trim();
    if (!line) {
      this.close();
      return;
    }
    this.history.push(line);
    if (this.history.length > 100) this.history.shift();
    this.message(line.startsWith('/') ? `> ${line}` : `You: ${line}`);
    this.close();
    if (line.startsWith('/'))
      void this.execute(line)
        .then((result) => this.message(result.text, result.error))
        .catch(() => this.message('Command failed', true));
  }
  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (this.opened) event.stopImmediatePropagation();
  };
  private readonly onKey = (event: KeyboardEvent): void => {
    if (!this.opened) {
      if (
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        !this.canOpen() ||
        this.input.captured
      )
        return;
      if (
        !isActionCode(event.code, 'chat', settings.keyBindings) &&
        !isActionCode(event.code, 'command', settings.keyBindings)
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.open(isActionCode(event.code, 'command', settings.keyBindings));
      return;
    }
    event.stopImmediatePropagation();
    if (isActionCode(event.code, 'menuBack', settings.keyBindings)) {
      event.preventDefault();
      this.close();
    } else if (isActionCode(event.code, 'menuConfirm', settings.keyBindings)) {
      event.preventDefault();
      if (!event.isComposing) this.submit();
    } else if (
      isActionCode(event.code, 'menuUp', settings.keyBindings) ||
      isActionCode(event.code, 'menuDown', settings.keyBindings)
    ) {
      event.preventDefault();
      if (this.historyIndex === this.history.length) this.draft = this.inputField.value;
      this.historyIndex = Math.max(
        0,
        Math.min(
          this.history.length,
          this.historyIndex + (isActionCode(event.code, 'menuUp', settings.keyBindings) ? -1 : 1),
        ),
      );
      this.inputField.value = this.history[this.historyIndex] ?? this.draft;
      this.completion = null;
    } else if (event.key === 'Tab') {
      event.preventDefault();
      if (!this.completion || this.completion.last !== this.inputField.value)
        this.completion = {
          options: completeCommand(this.inputField.value, this.catalog()),
          index: -1,
          last: this.inputField.value,
        };
      const state = this.completion;
      if (!state.options.length) {
        this.hint.textContent = 'NO COMPLETIONS';
        return;
      }
      state.index =
        (state.index + (event.shiftKey ? -1 : 1) + state.options.length) % state.options.length;
      this.inputField.value = state.last = state.options[state.index]!;
      this.inputField.setSelectionRange(state.last.length, state.last.length);
      this.hint.textContent = state.options
        .map((option) => option.split(' ').at(-1))
        .join('  /  ')
        .slice(0, 110);
    }
  };
}
