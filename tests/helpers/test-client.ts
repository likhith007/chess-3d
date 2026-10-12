import WebSocket from 'ws';
import type { ClientMessage, ServerMessage } from '../../src/shared/protocol.ts';

/** Minimal WS client that buffers server messages so tests can await them in order. */
export class TestClient {
  private readonly ws: WebSocket;
  private readonly inbox: ServerMessage[] = [];
  private waiter: (() => void) | null = null;
  /** Resolves with the close code once the server or client closes the socket. */
  readonly closed: Promise<number>;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    this.closed = new Promise((resolve) => ws.once('close', (code) => resolve(code)));
    ws.on('message', (data) => {
      this.inbox.push(JSON.parse(data.toString()) as ServerMessage);
      this.waiter?.();
    });
  }

  /** `autoPong: false` simulates a client whose network silently died (never answers pings). */
  static connect(url: string, opts: { autoPong?: boolean } = {}): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { autoPong: opts.autoPong ?? true });
      const client = new TestClient(ws);
      ws.once('open', () => resolve(client));
      ws.once('error', reject);
    });
  }

  send(msg: ClientMessage | Record<string, unknown>): void {
    this.ws.send(JSON.stringify(msg));
  }

  sendRaw(raw: string): void {
    this.ws.send(raw);
  }

  /** Resolves with the next message of the given type, discarding others before it. */
  async next<T extends ServerMessage['type']>(type: T): Promise<Extract<ServerMessage, { type: T }>> {
    for (;;) {
      const idx = this.inbox.findIndex((m) => m.type === type);
      if (idx !== -1) {
        const [msg] = this.inbox.splice(0, idx + 1).slice(-1);
        return msg as Extract<ServerMessage, { type: T }>;
      }
      await new Promise<void>((resolve) => (this.waiter = resolve));
    }
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.ws.readyState === WebSocket.CLOSED) return resolve();
      this.ws.once('close', () => resolve());
      this.ws.close();
    });
  }
}
