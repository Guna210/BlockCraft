import { UI } from '../../ui/ui-kit';
import { networkText } from './text';
export class DisconnectScreen {
  private readonly root = document.createElement('section');
  constructor(reason: string, leave: () => Promise<void>) {
    this.root.id = 'disconnect-screen';
    Object.assign(this.root.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '30',
      display: 'grid',
      placeContent: 'center',
      background: UI.outline,
      color: UI.text,
      font: '18px monospace',
    });
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      padding: '28px',
      background: UI.panel,
      borderTop: `4px solid ${UI.light}`,
      borderLeft: `4px solid ${UI.light}`,
      borderRight: `4px solid ${UI.shade}`,
      borderBottom: `4px solid ${UI.shade}`,
    });
    const title = document.createElement('h1');
    title.textContent = 'Disconnected';
    const text = document.createElement('p');
    text.textContent = networkText(reason || 'Connection lost');
    text.id = 'disconnect-reason';
    const back = document.createElement('button');
    back.textContent = 'Back to main menu';
    back.onclick = () => {
      back.disabled = true;
      void leave()
        .then(() => this.root.remove())
        .catch(() => {
          back.disabled = false;
        });
    };
    panel.append(title, text, back);
    this.root.append(panel);
    document.body.append(this.root);
  }
  dispose(): void {
    this.root.remove();
  }
}
