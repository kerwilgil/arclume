/**
 * A tiny local HTTP server for AI provider adapter tests — never a real
 * network call, never a dependency the CI environment must provide. Binds
 * loopback-only, ephemeral port.
 */

import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";

export interface FakeServer {
  url: string;
  close(): Promise<void>;
}

export type FakeHandler = (req: IncomingMessage, res: ServerResponse, body: string) => void;

export function startFakeServer(handler: FakeHandler): Promise<FakeServer> {
  return new Promise((resolvePromise, rejectPromise) => {
    const server: Server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        try {
          handler(req, res, Buffer.concat(chunks).toString("utf8"));
        } catch (err) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
      });
    });
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        rejectPromise(new Error("fake server has no port"));
        return;
      }
      resolvePromise({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}
