import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { MAX_JOB_JSON_BYTES, PRINT_CONNECTOR_HOST, parseJobId, parsePrintJob } from "./contracts.ts";
import { assertListenTarget } from "./listen.ts";
import type { SanitizedEvent } from "./ports.ts";
import { publicMeta, type ConnectorService } from "./service.ts";

type RunningConnector = {
  port: number;
  host: typeof PRINT_CONNECTOR_HOST;
  close: () => Promise<void>;
  waitUntilIdle: () => Promise<void>;
  holdsDocument: (id: string) => boolean;
};

const JSON_TYPE = /^application\/json(?:; charset=utf-8)?$/;

function headerValue(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function contentLength(value: string | null): number | "absent" | "invalid" {
  if (value === null) return "absent";
  if (!/^\d+$/.test(value)) return "invalid";
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return "invalid";
  return parsed;
}

function bearer(value: string | null): string | null {
  if (!value || value.slice(0, 7).toLowerCase() !== "bearer ") return null;
  const token = value.slice(7);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

function requestTarget(raw: string | undefined): string | null {
  if (!raw || !raw.startsWith("/") || raw.includes("?") || raw.includes("#") || raw.includes("\\") || raw.includes("%") || raw.includes("..")) {
    return null;
  }
  return raw;
}

function emit(input: {
  event: SanitizedEvent["event"];
  httpStatus?: number | null;
  jobId?: string | null;
  kind?: "label" | "receipt" | null;
  phase?: string | null;
  failureCode?: string | null;
  error?: string | null;
}): SanitizedEvent {
  return {
    event: input.event,
    httpStatus: input.httpStatus ?? null,
    jobId: input.jobId ?? null,
    kind: input.kind ?? null,
    phase: input.phase ?? null,
    failureCode: input.failureCode ?? null,
    error: input.error ?? null,
  };
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  cors: Record<string, string>,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'",
    ...cors,
  });
  res.end(payload);
}

function corsFor(origin: string | null, staffOrigin: string, privateNetwork: boolean): Record<string, string> {
  if (origin !== staffOrigin) return {};
  return {
    "Access-Control-Allow-Origin": staffOrigin,
    Vary: "Origin, Access-Control-Request-Private-Network",
    ...(privateNetwork ? { "Access-Control-Allow-Private-Network": "true" } : {}),
  };
}

function readBody(req: IncomingMessage, declared: number | "absent"): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (error: Error | null, body?: Buffer) => {
      if (settled) return;
      settled = true;
      if (error) {
        req.pause();
        reject(error);
        return;
      }
      resolve(body ?? Buffer.alloc(0));
    };
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_JOB_JSON_BYTES) {
        finish(Object.assign(new Error("payload_too_large"), { code: "payload_too_large" }));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (declared !== "absent" && declared !== total) {
        finish(Object.assign(new Error("invalid_request"), { code: "invalid_request" }));
        return;
      }
      finish(null, Buffer.concat(chunks));
    });
    req.on("error", () => {
      finish(Object.assign(new Error("invalid_request"), { code: "invalid_request" }));
    });
  });
}

export async function listenPrintConnector(options: {
  service: ConnectorService;
  staffOrigin: string;
  port: 0 | 17831;
  mode: "production" | "ephemeral-test";
  log: (event: SanitizedEvent) => void;
}): Promise<RunningConnector> {
  assertListenTarget(PRINT_CONNECTOR_HOST, options.port, options.mode);
  const server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (res.headersSent) return;
      sendJson(res, 500, { error: "internal" }, {});
    });
  });
  server.requestTimeout = 5_000;
  server.headersTimeout = 2_000;
  server.maxHeadersCount = 32;

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen({ host: PRINT_CONNECTOR_HOST, port: options.port }, () => {
      server.off("error", onError);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string" || address.address !== PRINT_CONNECTOR_HOST) {
    server.close();
    throw new Error("refusing_listen_host");
  }
  const listenPort = address.port;
  if (!Number.isInteger(listenPort) || listenPort < 0 || listenPort > 65_535) {
    server.close();
    throw new Error("refusing_listen_host");
  }
  const expectedHost = `${PRINT_CONNECTOR_HOST}:${listenPort}`;
  options.log(emit({ event: "listen", httpStatus: listenPort }));

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const host = headerValue(req.headers.host);
    const origin = headerValue(req.headers.origin);
    const privateNetwork = headerValue(req.headers["access-control-request-private-network"]) === "true";
    if (host !== expectedHost) {
      options.log(emit({ event: "rejected", httpStatus: 403, error: "invalid_host" }));
      sendJson(res, 403, { error: "invalid_host" }, {});
      return;
    }
    const path = requestTarget(req.url);
    if (!path) {
      options.log(emit({ event: "rejected", httpStatus: 400, error: "invalid_request" }));
      sendJson(res, 400, { error: "invalid_request" }, corsFor(origin, options.staffOrigin, false));
      return;
    }
    if (origin !== null && origin !== options.staffOrigin) {
      options.log(emit({ event: "rejected", httpStatus: 403, error: "invalid_origin" }));
      sendJson(res, 403, { error: "invalid_origin" }, {});
      return;
    }
    if (req.method === "OPTIONS") {
      preflight(req, path, origin, privateNetwork, res);
      return;
    }
    const cors = corsFor(origin, options.staffOrigin, privateNetwork);
    if (path === "/health" && req.method === "GET") {
      sendJson(res, 200, { ok: true }, cors);
      return;
    }
    if (path === "/health") {
      sendJson(res, 405, { error: "method_not_allowed" }, { ...cors, Allow: "GET" });
      return;
    }
    if (origin !== options.staffOrigin) {
      options.log(emit({ event: "rejected", httpStatus: 403, error: "invalid_origin" }));
      sendJson(res, 403, { error: "invalid_origin" }, {});
      return;
    }
    if (path === "/pair") {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "method_not_allowed" }, { ...cors, Allow: "POST" });
        return;
      }
      await postPair(req, res, cors);
      return;
    }
    if (path === "/unpair") {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "method_not_allowed" }, { ...cors, Allow: "POST" });
        return;
      }
      await postUnpair(req, res, cors);
      return;
    }
    if (path === "/status") {
      if (req.method !== "GET") {
        sendJson(res, 405, { error: "method_not_allowed" }, { ...cors, Allow: "GET" });
        return;
      }
      if (!guarded(req, res, cors)) return;
      sendJson(res, 200, options.service.status(listenPort), cors);
      return;
    }
    if (path === "/jobs") {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "method_not_allowed" }, { ...cors, Allow: "POST" });
        return;
      }
      if (!guarded(req, res, cors)) return;
      await postJob(req, res, cors);
      return;
    }
    const jobPath = /^\/jobs\/([0-9a-f-]{36})$/i.exec(path);
    if (jobPath?.[1]) {
      if (req.method !== "GET") {
        sendJson(res, 405, { error: "method_not_allowed" }, { ...cors, Allow: "GET" });
        return;
      }
      if (!guarded(req, res, cors)) return;
      const id = parseJobId(jobPath[1]);
      const job = id ? options.service.job(id) : null;
      if (!job) {
        sendJson(res, 404, { error: "not_found" }, cors);
        return;
      }
      sendJson(res, 200, { job: publicMeta(job) }, cors);
      return;
    }
    sendJson(res, 404, { error: "not_found" }, cors);
  }

  function guarded(req: IncomingMessage, res: ServerResponse, cors: Record<string, string>): boolean {
    const allowed = options.service.authorize(options.staffOrigin, bearer(headerValue(req.headers.authorization)));
    if (allowed) return true;
    options.log(emit({ event: "rejected", httpStatus: 401, error: "unauthorized" }));
    sendJson(res, 401, { error: "unauthorized" }, cors);
    return false;
  }

  function preflight(req: IncomingMessage, path: string, origin: string | null, privateNetwork: boolean, res: ServerResponse): void {
    const known = path === "/health" || path === "/pair" || path === "/unpair" || path === "/status" || path === "/jobs" || /^\/jobs\/[0-9a-f-]{36}$/i.test(path);
    if (!known || origin !== options.staffOrigin) {
      options.log(emit({ event: "rejected", httpStatus: 403, error: "invalid_origin" }));
      sendJson(res, 403, { error: "invalid_origin" }, {});
      return;
    }
    const requestedMethod = headerValue(req.headers["access-control-request-method"])?.toUpperCase() ?? null;
    if (requestedMethod !== "GET" && requestedMethod !== "POST") {
      sendJson(res, 403, { error: "invalid_request" }, {});
      return;
    }
    const requestedHeaders = headerValue(req.headers["access-control-request-headers"]);
    if (requestedHeaders) {
      const parts = requestedHeaders.split(",").map((part) => part.trim().toLowerCase()).filter((part) => part.length > 0);
      if (parts.some((part) => part !== "authorization" && part !== "content-type")) {
        sendJson(res, 403, { error: "invalid_request" }, {});
        return;
      }
    }
    res.writeHead(204, {
      "Access-Control-Allow-Origin": options.staffOrigin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "600",
      Vary: "Origin, Access-Control-Request-Private-Network",
      "Cache-Control": "no-store",
      "Content-Length": "0",
      ...(privateNetwork ? { "Access-Control-Allow-Private-Network": "true" } : {}),
    });
    res.end();
  }

  return {
    port: listenPort,
    host: PRINT_CONNECTOR_HOST,
    waitUntilIdle: () => options.service.waitUntilIdle(),
    holdsDocument: (id) => options.service.holdsDocument(id),
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };

  async function postPair(req: IncomingMessage, res: ServerResponse, cors: Record<string, string>): Promise<void> {
    const body = await jsonBody(req, res, cors);
    if (body === undefined) return;
    const record = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
    if (!record || Object.keys(record).length !== 1 || typeof record.code !== "string") {
      options.log(emit({ event: "rejected", httpStatus: 400, error: "invalid_request" }));
      sendJson(res, 400, { error: "invalid_request" }, cors);
      return;
    }
    const result = await options.service.pair(options.staffOrigin, record.code);
    if (!result.ok) {
      const status = result.error === "pairing_rate_limited" ? 429 : result.error === "pairing_store_failed" ? 500 : 401;
      options.log(emit({ event: "rejected", httpStatus: status, error: result.error }));
      sendJson(res, status, { error: result.error }, cors);
      return;
    }
    sendJson(res, 200, { token: result.token }, cors);
  }

  async function postUnpair(req: IncomingMessage, res: ServerResponse, cors: Record<string, string>): Promise<void> {
    if (!guarded(req, res, cors)) return;
    const cleared = await options.service.unpair(options.staffOrigin, bearer(headerValue(req.headers.authorization)));
    if (!cleared) {
      sendJson(res, 401, { error: "unauthorized" }, cors);
      return;
    }
    sendJson(res, 200, { ok: true }, cors);
  }

  async function postJob(req: IncomingMessage, res: ServerResponse, cors: Record<string, string>): Promise<void> {
    const body = await jsonBody(req, res, cors);
    if (body === undefined) return;
    const job = parsePrintJob(body);
    if (!job) {
      options.log(emit({ event: "rejected", httpStatus: 400, error: "invalid_job" }));
      sendJson(res, 400, { error: "invalid_job" }, cors);
      return;
    }
    const result = await options.service.submit(job);
    if (result.type === "conflict") {
      options.log(emit({ event: "rejected", httpStatus: 409, error: "job_conflict", jobId: job.id, kind: job.kind }));
      sendJson(res, 409, { error: "job_conflict" }, cors);
      return;
    }
    if (result.type === "storage_failed") {
      options.log(emit({ event: "rejected", httpStatus: 500, error: "journal_unavailable", jobId: job.id, kind: job.kind }));
      sendJson(res, 500, { error: "journal_unavailable" }, cors);
      return;
    }
    if (result.type === "queue_full" || result.type === "retention_full") {
      const error = result.type === "retention_full" ? "job_retention_full" : result.type;
      options.log(emit({ event: "rejected", httpStatus: 429, error, jobId: job.id, kind: job.kind }));
      sendJson(res, 429, { error }, cors);
      return;
    }
    if (result.type !== "accepted" && result.type !== "existing") {
      options.log(emit({ event: "rejected", httpStatus: 500, error: "journal_unavailable", jobId: job.id, kind: job.kind }));
      sendJson(res, 500, { error: "journal_unavailable" }, cors);
      return;
    }
    const meta = publicMeta(result.meta);
    options.log(emit({
      event: "job_accepted",
      httpStatus: 202,
      jobId: meta.id,
      kind: meta.kind,
      phase: meta.phase,
      failureCode: meta.failureCode,
    }));
    sendJson(res, 202, { job: meta }, cors);
  }

  async function jsonBody(req: IncomingMessage, res: ServerResponse, cors: Record<string, string>): Promise<unknown> {
    const type = headerValue(req.headers["content-type"]);
    if (!type || !JSON_TYPE.test(type.toLowerCase())) {
      options.log(emit({ event: "rejected", httpStatus: 415, error: "unsupported_media_type" }));
      sendJson(res, 415, { error: "unsupported_media_type" }, cors);
      return undefined;
    }
    const declared = contentLength(headerValue(req.headers["content-length"]));
    if (declared === "invalid") {
      sendJson(res, 400, { error: "invalid_request" }, cors);
      return undefined;
    }
    if (declared !== "absent" && declared > MAX_JOB_JSON_BYTES) {
      options.log(emit({ event: "rejected", httpStatus: 413, error: "payload_too_large" }));
      sendJson(res, 413, { error: "payload_too_large" }, cors);
      req.resume();
      return undefined;
    }
    try {
      const bytes = await readBody(req, declared);
      if (bytes.length === 0) {
        sendJson(res, 400, { error: "invalid_request" }, cors);
        return undefined;
      }
      return JSON.parse(bytes.toString("utf8")) as unknown;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error && error.code === "payload_too_large"
        ? "payload_too_large"
        : "invalid_request";
      const status = code === "payload_too_large" ? 413 : 400;
      if (!res.headersSent) {
        options.log(emit({ event: "rejected", httpStatus: status, error: code }));
        sendJson(res, status, { error: code }, cors);
      }
      req.resume();
      return undefined;
    }
  }
}
