import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

export type FetchHandler = (request: Request) => Response | Promise<Response>;

type NodeRequest = IncomingMessage & { originalUrl?: string; body?: unknown; protocol?: string };
type Next = (err?: unknown) => void;

/** Builds a web Request from a Node request. Handles bodies that a framework already parsed. */
export function toWebRequest(req: NodeRequest): Request {
  const encrypted = (req.socket as { encrypted?: boolean }).encrypted;
  const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0] ?? req.protocol ?? (encrypted ? "https" : "http");
  const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost";
  const url = new URL(req.originalUrl ?? req.url ?? "/", `${proto}://${host}`);

  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined || k.startsWith(":")) continue;
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else headers.set(k, v);
  }

  const method = (req.method ?? "GET").toUpperCase();
  const init: RequestInit & { duplex?: "half" } = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    if (req.body !== undefined && req.readableEnded) {
      // express.json(), fastify or koa-bodyparser consumed the stream; rebuild the body.
      const body = req.body;
      if (typeof body === "string" || body instanceof Uint8Array) init.body = body as BodyInit;
      else {
        init.body = JSON.stringify(body);
        headers.set("content-type", "application/json");
      }
      headers.delete("content-length");
    } else {
      init.body = Readable.toWeb(req) as unknown as ReadableStream;
      init.duplex = "half";
    }
  }
  return new Request(url, init);
}

/** Writes a web Response to a Node response, streaming the body with backpressure. */
export async function sendWebResponse(res: ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((value, key) => {
    if (key === "set-cookie") return;
    headers[key] = value;
  });
  const cookies = response.headers.getSetCookie?.() ?? [];
  if (cookies.length) headers["set-cookie"] = cookies;
  res.writeHead(response.status, response.statusText, headers);

  if (!response.body) {
    res.end();
    return;
  }
  const body = Readable.fromWeb(response.body as never);
  await new Promise<void>((resolve) => {
    res.on("close", () => {
      body.destroy();
      resolve();
    });
    body.on("error", () => res.destroy());
    body.pipe(res);
  });
}

/**
 * Plain Node.js `http` handler. Also usable as Express / Connect middleware:
 *
 * ```ts
 * app.all("/api/files", toNodeHandler(finder.handler));
 * ```
 */
export function toNodeHandler(handler: FetchHandler) {
  return async (req: IncomingMessage, res: ServerResponse, next?: Next): Promise<void> => {
    try {
      await sendWebResponse(res, await handler(toWebRequest(req)));
    } catch (e) {
      if (next) next(e);
      else {
        if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
        res.end("Internal Server Error");
      }
    }
  };
}

/** Express / Connect alias of {@link toNodeHandler}. */
export const toExpress = toNodeHandler;

/** Koa middleware: `router.all("/api/files", toKoa(finder.handler))`. */
export function toKoa(handler: FetchHandler) {
  const node = toNodeHandler(handler);
  return async (ctx: { req: IncomingMessage; res: ServerResponse; request?: { body?: unknown }; respond?: boolean }) => {
    ctx.respond = false;
    if (ctx.request?.body !== undefined) (ctx.req as NodeRequest).body = ctx.request.body;
    await node(ctx.req, ctx.res);
  };
}

interface FastifyLike {
  removeAllContentTypeParsers(): void;
  addContentTypeParser(type: string, fn: (req: unknown, payload: unknown, done: (err: Error | null, body?: unknown) => void) => void): void;
  all(path: string, handler: (request: { raw: IncomingMessage }, reply: { raw: ServerResponse; hijack(): void }) => Promise<void>): void;
}

/**
 * Fastify plugin. Fastify parses (and rejects unknown) bodies before handlers run, so the plugin
 * disables body parsing inside its own scope and hands the raw stream to ciFinder.
 *
 * ```ts
 * fastify.register(toFastify(finder.handler), { prefix: "/api/files" });
 * ```
 */
export function toFastify(handler: FetchHandler, options: { path?: string } = {}) {
  const node = toNodeHandler(handler);
  return async (fastify: FastifyLike) => {
    fastify.removeAllContentTypeParsers();
    fastify.addContentTypeParser("*", (_req, _payload, done) => done(null));
    fastify.all(options.path ?? "/", async (request, reply) => {
      reply.hijack();
      await node(request.raw, reply.raw);
    });
  };
}
