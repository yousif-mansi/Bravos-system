import { useEffect, useId, useRef, useState } from "react";
import { LABEL_PRINTER_NAME, RECEIPT_PRINTER_NAME } from "@bravos/print-contracts";
import { accountGeneration, subscribeAccount } from "../account-session.ts";
import {
  ConnectorClientError,
  pairDevice,
  readConnectorConnection,
  unpairDevice,
  type ConnectorConnection,
} from "./connector-client.ts";
import "./printer-connection.css";

function messageFor(connection: ConnectorConnection): string {
  if (connection.state === "offline") {
    return connection.pairedLocally
      ? "الربط محفوظ في هذا المتصفح، وبرنامج الطباعة غير متاح الآن."
      : "برنامج الطباعة غير متاح على هذا الجهاز.";
  }
  if (connection.state === "unpaired") {
    return "برنامج الطباعة يعمل، وهذا المتصفح غير مربوط. أدخل رمز الربط مرة واحدة.";
  }
  if (connection.state === "origin-mismatch") {
    return "برنامج الطباعة لا يخدم هذه الصفحة. افتح شاشة الموظفين من الصفحة التي ضُبط عليها البرنامج.";
  }
  if (connection.state === "invalid-status") {
    return "برنامج الطباعة ردّ بحالة لا يمكن استخدامها. هذا لا يعني أن الطابعة طبعت.";
  }
  if (!connection.rendererReady) {
    return "المتصفح مربوط وبرنامج الطباعة يعمل، لكن تجهيز الرسم غير جاهز بعد. هذا ليس نجاح طباعة.";
  }
  return "المتصفح مربوط وبرنامج الطباعة جاهز لاستلام الأوامر. هذا لا يعني خروج الورق.";
}

function pairedLocally(connection: ConnectorConnection | null): boolean {
  if (!connection) return false;
  if (connection.state === "paired") return true;
  return "pairedLocally" in connection && connection.pairedLocally;
}

export function PrinterConnectionPanel() {
  const codeId = useId();
  const [connection, setConnection] = useState<ConnectorConnection | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [generation, setGeneration] = useState(accountGeneration);
  const actionRef = useRef<AbortController | null>(null);

  useEffect(() => subscribeAccount(() => {
    actionRef.current?.abort();
    setGeneration(accountGeneration());
  }), []);

  useEffect(() => {
    const epoch = generation;
    const controller = new AbortController();
    let mounted = true;
    setError("");
    void readConnectorConnection({ signal: controller.signal })
      .then((next) => {
        if (!mounted || controller.signal.aborted || accountGeneration() !== epoch) return;
        setConnection(next);
      })
      .catch((caught: unknown) => {
        if (!mounted || controller.signal.aborted || accountGeneration() !== epoch) return;
        if (caught instanceof ConnectorClientError && caught.code === "aborted") return;
        setConnection({ state: "offline", pairedLocally: false });
        setError(caught instanceof ConnectorClientError ? caught.message : "تعذر التحقق من برنامج الطباعة.");
      });
    return () => {
      mounted = false;
      controller.abort();
    };
  }, [generation]);

  async function refresh(epoch: number, signal: AbortSignal): Promise<void> {
    const next = await readConnectorConnection({ signal });
    if (signal.aborted || accountGeneration() !== epoch) return;
    setConnection(next);
  }

  async function connect(): Promise<void> {
    if (busy) return;
    const epoch = accountGeneration();
    const controller = new AbortController();
    actionRef.current = controller;
    setBusy(true);
    setError("");
    try {
      await pairDevice(code, { signal: controller.signal });
      if (accountGeneration() !== epoch || controller.signal.aborted) return;
      const { selectKnownLabelProfile } = await import("../labels/label-print.ts");
      if (accountGeneration() !== epoch || controller.signal.aborted) return;
      selectKnownLabelProfile();
      setCode("");
      await refresh(epoch, controller.signal);
    } catch (caught) {
      if (accountGeneration() !== epoch || controller.signal.aborted) return;
      setError(caught instanceof ConnectorClientError ? caught.message : "تعذر الربط.");
    } finally {
      setBusy(false);
    }
  }

  async function forget(): Promise<void> {
    if (busy) return;
    const epoch = accountGeneration();
    const controller = new AbortController();
    actionRef.current = controller;
    setBusy(true);
    setError("");
    try {
      await unpairDevice({ signal: controller.signal });
      if (accountGeneration() !== epoch || controller.signal.aborted) return;
      await refresh(epoch, controller.signal);
    } catch (caught) {
      if (accountGeneration() !== epoch || controller.signal.aborted) return;
      setError(caught instanceof ConnectorClientError ? caught.message : "تعذر إلغاء الربط.");
    } finally {
      setBusy(false);
    }
  }

  async function recheck(): Promise<void> {
    if (busy) return;
    const epoch = accountGeneration();
    const controller = new AbortController();
    actionRef.current = controller;
    setBusy(true);
    setError("");
    try {
      await refresh(epoch, controller.signal);
    } catch (caught) {
      if (accountGeneration() !== epoch || controller.signal.aborted) return;
      setError(caught instanceof ConnectorClientError ? caught.message : "تعذر التحقق من برنامج الطباعة.");
    } finally {
      setBusy(false);
    }
  }

  const remembered = pairedLocally(connection);
  const status = connection ? messageFor(connection) : "جارٍ التحقق من برنامج الطباعة…";

  return (
    <section className="printer-connection" data-testid="printer-connection" aria-label="برنامج الطباعة على هذا الجهاز">
      <p className="quiet-status" role="status" data-testid="printer-connection-status">{status}</p>
      {remembered ? (
        <>
          <p data-testid="printer-label-destination">ملصقات: {LABEL_PRINTER_NAME}</p>
          <p data-testid="printer-receipt-destination">إيصالات: {RECEIPT_PRINTER_NAME}</p>
          <div className="actions">
            <button type="button" className="secondary" data-testid="printer-refresh" disabled={busy} onClick={() => void recheck()}>
              إعادة التحقق
            </button>
            <button type="button" className="secondary" data-testid="printer-unpair" disabled={busy} onClick={() => void forget()}>
              إلغاء الربط
            </button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void connect();
          }}
        >
          <div className="field">
            <label htmlFor={codeId}>رمز الربط</label>
            <input
              id={codeId}
              data-testid="printer-pair-code"
              value={code}
              autoComplete="off"
              spellCheck={false}
              dir="ltr"
              disabled={busy || connection === null}
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
          <button type="submit" data-testid="printer-pair" disabled={busy || connection === null}>
            ربط هذا الجهاز
          </button>
        </form>
      )}
      {error ? <p className="error" role="alert" data-testid="printer-connection-error">{error}</p> : null}
    </section>
  );
}
