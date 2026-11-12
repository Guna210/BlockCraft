import { UI } from '../../ui/ui-kit';
/** Only installed during a remote session; holding Tab shows the current server roster. */
export class PlayerList {
  private readonly root = document.createElement('div');
  constructor(private readonly captured: () => boolean) {
    this.root.id = 'player-list';
    this.root.setAttribute('aria-label', 'Players');
    Object.assign(this.root.style, {
      position: 'fixed',
      top: '24px',
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'none',
      zIndex: '12',
      minWidth: '260px',
      padding: '12px',
      color: UI.text,
      background: UI.panel,
      borderTop: `3px solid ${UI.light}`,
      borderLeft: `3px solid ${UI.light}`,
      borderRight: `3px solid ${UI.shade}`,
      borderBottom: `3px solid ${UI.shade}`,
      font: '16px monospace',
    });
    document.body.append(this.root);
    window.addEventListener('keydown', this.key, true);
    window.addEventListener('keyup', this.key, true);
    window.addEventListener('blur', this.hide);
  }
  update(players: readonly { name: string; pingMs: number }[]): void {
    this.root.replaceChildren();
    for (const player of players) {
      const row = document.createElement('div');
      row.textContent = `${player.name}  ${player.pingMs} ms`;
      this.root.append(row);
    }
  }
  private readonly hide = () => {
    this.root.style.display = 'none';
  };
  private readonly key = (event: KeyboardEvent) => {
    if (event.code !== 'Tab') return;
    if (event.type === 'keyup') {
      this.hide();
      return;
    }
    if (this.captured()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.root.style.display = 'block';
  };
  dispose(): void {
    window.removeEventListener('keydown', this.key, true);
    window.removeEventListener('keyup', this.key, true);
    window.removeEventListener('blur', this.hide);
    this.root.remove();
  }
}
