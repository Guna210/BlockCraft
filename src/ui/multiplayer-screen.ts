/** A DOM form for choosing a multiplayer identity and endpoint. */
export class MultiplayerScreen {
  private readonly root = document.createElement('div');
  private readonly name = document.createElement('input');
  private readonly address = document.createElement('input');
  private readonly error = document.createElement('p');
  private readonly connect = document.createElement('button');
  private connection: { close(): void } | null = null;
  private attempt = 0;

  constructor(
    private readonly onBack: () => void,
    private readonly onConnect: (
      connection: import('../game/net/connection').Connection,
    ) => Promise<void>,
  ) {
    this.root.id = 'multiplayer-screen';
    Object.assign(this.root.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '20',
      display: 'none',
      background: 'rgba(10, 14, 22, .88)',
      color: '#f4e9ce',
      font: '16px monospace',
    });
    const form = document.createElement('form');
    Object.assign(form.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      width: 'min(360px, 80vw)',
      margin: '15vh auto',
      padding: '24px',
      background: '#343238',
      border: '4px solid #a99472',
    });
    const heading = document.createElement('h1');
    heading.textContent = 'Multiplayer';
    form.append(heading);
    for (const [labelText, field] of [
      ['Player name', this.name],
      ['Server address', this.address],
    ] as const) {
      const label = document.createElement('label');
      label.textContent = labelText;
      label.append(document.createElement('br'), field);
      field.style.width = '100%';
      form.append(label);
    }
    this.address.value = 'ws://localhost:3001';
    try {
      this.name.value = localStorage.getItem('multiplayer-name') ?? '';
      this.address.value = localStorage.getItem('multiplayer-address') ?? this.address.value;
    } catch {
      /* Storage may be unavailable. */
    }
    this.connect.type = 'submit';
    this.connect.textContent = 'Connect';
    const back = document.createElement('button');
    back.type = 'button';
    back.textContent = 'Back';
    back.onclick = () => {
      this.attempt++;
      this.connection?.close();
      this.connection = null;
      this.connect.disabled = false;
      this.hide();
      this.onBack();
    };
    this.error.setAttribute('role', 'status');
    form.append(this.error, this.connect, back);
    form.onsubmit = (event) => {
      event.preventDefault();
      void this.submit();
    };
    this.root.append(form);
    document.body.append(this.root);
  }

  show(): void {
    this.root.style.display = 'block';
    this.error.textContent = '';
  }
  hide(): void {
    this.root.style.display = 'none';
  }

  private async submit(): Promise<void> {
    let url: URL;
    try {
      url = new URL(this.address.value);
      if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash)
        throw new Error();
    } catch {
      this.error.textContent = 'Invalid server address';
      return;
    }
    if (
      location.protocol === 'https:' &&
      url.protocol === 'ws:' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    ) {
      this.error.textContent = 'This page needs a wss:// address';
      return;
    }
    try {
      localStorage.setItem('multiplayer-name', this.name.value);
      localStorage.setItem('multiplayer-address', this.address.value);
    } catch {
      /* Storage may be unavailable. */
    }
    this.connect.disabled = true;
    this.error.textContent = 'Connecting…';
    const attempt = ++this.attempt;
    try {
      const { Connection } = await import('../game/net/connection');
      const connection = await Connection.connect(url.href, this.name.value);
      if (attempt !== this.attempt) {
        connection.close();
        return;
      }
      this.connection = connection;
      connection.onClose = (reason) => {
        if (this.connection !== connection) return;
        this.connection = null;
        this.error.textContent = reason;
        this.connect.disabled = false;
      };
      await this.onConnect(connection);
      this.hide();
    } catch (error) {
      if (attempt !== this.attempt) return;
      this.error.textContent =
        error instanceof Error ? error.message : 'Connection refused or timed out';
    } finally {
      if (attempt === this.attempt) this.connect.disabled = this.connection !== null;
    }
  }
}
