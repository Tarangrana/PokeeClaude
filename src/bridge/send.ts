import { request } from "node:http";

import { bridgePort } from "../config.js";

/**
 * POST JSON to the local bridge. Resolves to the HTTP status, or null when the
 * desktop pet isn't running. Never throws: hooks must not break the agent.
 */
export function postToBridge(path: string, body: unknown, timeoutMs = 400, port = bridgePort()): Promise<number | null> {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data) },
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? null));
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
    req.end(data);
  });
}

export function getFromBridge(path: string, timeoutMs = 400, port = bridgePort()): Promise<unknown> {
  return new Promise((resolve) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET", timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch {
          resolve(null);
        }
      });
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
    req.end();
  });
}
