import { useEffect, useRef, useState } from "react";
import { accountGeneration } from "../account-session.ts";
import { ApiError, type ManagementReportQuery } from "../api.ts";
import {
  getManagementReportExport,
  type ReportExportFormat,
} from "../report-export.ts";

export function ReportExportActions({ query, staffId }: { query: ManagementReportQuery; staffId: string }) {
  const [downloading, setDownloading] = useState<ReportExportFormat | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const active = useRef<AbortController | null>(null);
  const currentStaffId = useRef(staffId);
  currentStaffId.current = staffId;

  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    active.current?.abort();
    active.current = null;
    setDownloading(null);
    setError("");
    setNotice("");
  }, [staffId]);

  async function download(format: ReportExportFormat) {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const generation = accountGeneration();
    const stillCurrent = () => !controller.signal.aborted
      && accountGeneration() === generation
      && currentStaffId.current === staffId;
    setDownloading(format);
    setError("");
    setNotice("");
    try {
      const file = await getManagementReportExport(format, query, controller.signal);
      if (!stillCurrent()) return;
      triggerDownload(file);
      if (stillCurrent()) setNotice(format === "pdf" ? "بدأ تنزيل تقرير PDF." : "بدأ تنزيل تقرير Excel.");
    } catch (caught: unknown) {
      if (!stillCurrent() || (caught instanceof DOMException && caught.name === "AbortError")) return;
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر تنزيل ملف التقرير. حاول مرة أخرى.");
    } finally {
      if (active.current === controller) active.current = null;
      if (stillCurrent()) setDownloading(null);
    }
  }

  return (
    <section className="card report-export" aria-labelledby="report-export-heading">
      <div>
        <h2 id="report-export-heading">تنزيل التقرير</h2>
        <p className="muted">تستخدم الملفات الفترة والفروع والقناة والموظف المطبقة على التقرير المعروض.</p>
      </div>
      <div className="actions">
        <button type="button" disabled={downloading !== null} onClick={() => void download("pdf")}>
          {downloading === "pdf" ? "جارٍ تجهيز PDF…" : "تنزيل PDF"}
        </button>
        <button type="button" className="secondary" disabled={downloading !== null} onClick={() => void download("xlsx")}>
          {downloading === "xlsx" ? "جارٍ تجهيز Excel…" : "تنزيل Excel"}
        </button>
      </div>
      {error ? <div className="error" role="alert">{error}</div> : null}
      {notice ? <p role="status">{notice}</p> : null}
    </section>
  );
}

function triggerDownload(file: { blob: Blob; fileName: string }) {
  const url = URL.createObjectURL(file.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.fileName;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
