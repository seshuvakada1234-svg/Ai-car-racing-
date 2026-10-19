type Listener = (event: any) => void;

const OPEN = 1;
const CLOSED = 3;

export class FakeWorkerWebSocket {
  peer: FakeWorkerWebSocket | null = null;
  readyState = OPEN;

  private listeners = new Map<string, Set<Listener>>();

  accept() {
    // Worker WebSocket API requires accept(); no-op in test runtime.
  }

  addEventListener(type: string, listener: Listener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: any) {
    if (this.readyState !== OPEN) {
      throw new Error("Socket is not open");
    }
    if (!this.peer || this.peer.readyState !== OPEN) {
      throw new Error("Peer socket is not open");
    }
    this.peer.dispatch("message", { data });
  }

  close(code = 1000, reason = "") {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    this.dispatch("close", { code, reason });

    const peer = this.peer;
    if (peer && peer.readyState !== CLOSED) {
      peer.readyState = CLOSED;
      peer.dispatch("close", { code, reason });
    }
  }

  private dispatch(type: string, event: any) {
    const handlers = this.listeners.get(type);
    if (!handlers || handlers.size === 0) return;
    for (const handler of handlers) {
      try {
        handler(event);
      } catch {
        // Test helper keeps event loop running even if one listener throws.
      }
    }
  }
}

class FakeWebSocketPair {
  0: FakeWorkerWebSocket;
  1: FakeWorkerWebSocket;

  constructor() {
    const client = new FakeWorkerWebSocket();
    const server = new FakeWorkerWebSocket();
    client.peer = server;
    server.peer = client;

    this[0] = client;
    this[1] = server;
  }
}

class FakeWorkerResponse {
  status: number;
  headers: Headers;
  body: any;
  webSocket?: FakeWorkerWebSocket;

  constructor(body: any, init?: { status?: number; headers?: HeadersInit; webSocket?: FakeWorkerWebSocket }) {
    this.body = body;
    this.status = init?.status ?? 200;
    this.headers = new Headers(init?.headers || {});
    this.webSocket = init?.webSocket;
  }

  async text() {
    if (typeof this.body === "string") return this.body;
    if (this.body === null || this.body === undefined) return "";
    return String(this.body);
  }
}

export function installFakeWorkerRuntime() {
  const originalResponse = (globalThis as any).Response;
  const originalWebSocketPair = (globalThis as any).WebSocketPair;

  (globalThis as any).Response = FakeWorkerResponse;
  (globalThis as any).WebSocketPair = FakeWebSocketPair;

  return {
    restore() {
      (globalThis as any).Response = originalResponse;
      if (originalWebSocketPair === undefined) {
        delete (globalThis as any).WebSocketPair;
      } else {
        (globalThis as any).WebSocketPair = originalWebSocketPair;
      }
    },
  };
}
