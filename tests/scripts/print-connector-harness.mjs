import http from "node:http";
import { DEFAULT_STAFF_ORIGIN } from "../../packages/print-contracts/src/index.ts";
import { createPrintConnectorForTests } from "../../apps/print-connector/src/test-connector.ts";

export function jobId(n) {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

export function labelJob(id, copies = 1, name = "قميص قطن") {
  return {
    kind: "label",
    id,
    copies,
    product: { code: "SHIRT-1", name },
    paper: { widthMm: 38, heightMm: 25 },
    dpi: 203,
    profile: "compact",
  };
}

export function receiptJob(id, name = "أحمد") {
  return {
    kind: "receipt",
    id,
    copies: 1,
    receiptView: {
      brand: "BRAVOS",
      branchName: "الفيوم",
      contactPhone: "01017412287",
      printedReference: "BRV-001-000042",
      occurredAtLabel: "31/10/2026 14:05",
      cashierDisplayName: "منى",
      customerName: name,
      customerPhone: "01000000000",
      lines: [{
        productName: "قميص قطن",
        productCode: "SHIRT-1",
        sizeName: "L",
        colorName: "أسود",
        quantityAndUnitPrice: "1 × 850",
        lineOriginal: "850",
        linePaid: "800",
      }],
      adjustments: [
        { label: "الإجمالي قبل الخصم", amount: "850" },
        { label: "خصم الموظف", amount: "50" },
      ],
      finalTotal: "800",
      exchangeCredit: null,
      cashCollected: null,
      paymentMethodLabel: "نقدي",
      paymentAllocations: [{ label: "المبلغ النقدي", amount: "800" }],
      contentWidthMm: 72,
    },
  };
}

export function injectedPort(submit) {
  return {
    describe: () => ({ implementation: "injected" }),
    submit,
  };
}

export async function startConnector(options) {
  return createPrintConnectorForTests(options);
}

export function request(connector, options) {
  const raw = options.raw;
  const payload = raw == null
    ? (options.body === undefined ? null : Buffer.from(JSON.stringify(options.body)))
    : Buffer.from(raw);
  const headers = {
    Host: options.host ?? `127.0.0.1:${connector.port}`,
    ...(options.origin === null ? {} : { Origin: options.origin ?? connector.staffOrigin }),
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    ...(options.headers ?? {}),
  };
  if (payload) {
    headers["Content-Type"] = options.contentType ?? "application/json";
    headers["Content-Length"] = String(options.contentLength ?? payload.length);
  }
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port: connector.port,
      method: options.method,
      path: options.path,
      agent: false,
      headers,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        if (text.length > 0) {
          try {
            json = JSON.parse(text);
          } catch {
            json = null;
          }
        }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.setTimeout(2_000, () => {
      req.destroy(new Error("test_request_timeout"));
    });
    req.on("error", reject);
    req.end(payload ?? undefined);
  });
}

export async function pairConnector(connector, code = connector.notices.at(-1)?.code) {
  return request(connector, { method: "POST", path: "/pair", body: { code } });
}

export const STAFF_ORIGIN = DEFAULT_STAFF_ORIGIN;

export function clock(start) {
  let now = start;
  return {
    now: () => now,
    advance(ms) {
      now += ms;
    },
  };
}
