import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { AnalyticsMetricDto, AnalyticsSummaryDto, WorkspaceDto } from "@bravos/contracts";
import { accountGeneration } from "../account-session.ts";
import { ApiError, getAnalytics, type AnalyticsQuery } from "../api.ts";

const metricRows: Array<{
  key: keyof AnalyticsSummaryDto["metrics"];
  label: string;
}> = [
  { key: "visits", label: "زيارات المتجر" },
  { key: "productViews", label: "مشاهدات المنتجات" },
  { key: "successfulCartAdditions", label: "عمليات الإضافة الناجحة للسلة" },
  { key: "acceptedOrderSubmissions", label: "طلبات التوصيل المستلمة" },
  { key: "completedOnlineSales", label: "طلبات الأونلاين التي وصلت للعميل" },
];

const arabicInteger = new Intl.NumberFormat("ar-EG");

export default function AnalyticsPage({ workspace }: { workspace: WorkspaceDto }) {
  const [today] = useState(cairoToday);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [query, setQuery] = useState<AnalyticsQuery>({ from: today, to: today });
  const [summary, setSummary] = useState<AnalyticsSummaryDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const generation = accountGeneration();
    const staffId = workspace.staff.id;
    const stillCurrent = () => !cancelled
      && accountGeneration() === generation
      && workspace.staff.id === staffId;

    setLoading(true);
    setError("");
    setSummary(null);
    void getAnalytics(query, controller.signal)
      .then((next) => {
        if (stillCurrent()) setSummary(next);
      })
      .catch((caught: unknown) => {
        if (!stillCurrent() || (caught instanceof DOMException && caught.name === "AbortError")) return;
        setError(caught instanceof ApiError ? caught.messageAr : "تعذر تحميل تحليلات المتجر. حاول مرة أخرى.");
      })
      .finally(() => {
        if (stillCurrent()) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [query, workspace.staff.id]);

  function applyDates(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!from || !to) {
      setError("اختر تاريخ البداية وتاريخ النهاية.");
      return;
    }
    if (from > to) {
      setError("تاريخ البداية يجب ألا يكون بعد تاريخ النهاية.");
      return;
    }
    setQuery({ from, to });
  }

  return (
    <main className="shell analytics-page">
      <header className="brand">
        <div>
          <h1>تحليلات المتجر</h1>
          <p className="muted">أعداد مجمعة لفهم نشاط المتجر من دون ملفات شخصية للزوار.</p>
        </div>
        <Link className="button secondary" to="/workspace">مساحة العمل</Link>
      </header>

      <form className="card analytics-filters" aria-label="فترة تحليلات المتجر" onSubmit={applyDates}>
        <div className="field">
          <label htmlFor="analytics-from">من يوم</label>
          <input id="analytics-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="analytics-to">إلى يوم</label>
          <input id="analytics-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} required />
        </div>
        <button type="submit" disabled={loading}>عرض التحليلات</button>
      </form>

      {error ? <div className="error" role="alert">{error}</div> : null}
      {loading ? <p role="status">جارٍ تحميل التحليلات…</p> : null}
      {summary ? (
        <section className="card" aria-labelledby="analytics-summary-heading">
          <div className="analytics-period">
            <div>
              <h2 id="analytics-summary-heading">النشاط المجمع</h2>
              <p className="muted">هذه أعداد مرات حدوث، وليست أعداد أشخاص فريدين أو نسب تحويل بين زوار محددين.</p>
            </div>
            <p dir="ltr" data-testid="analytics-period">
              {summary.period.fromCairoDate} — {summary.period.toCairoDateInclusive}
            </p>
          </div>
          <div className="analytics-metrics">
            {metricRows.map((row) => (
              <AnalyticsMetric
                key={row.key}
                metricKey={row.key}
                label={row.label}
                metric={summary.metrics[row.key]}
              />
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}

function AnalyticsMetric({
  metricKey,
  label,
  metric,
}: {
  metricKey: keyof AnalyticsSummaryDto["metrics"];
  label: string;
  metric: AnalyticsMetricDto;
}) {
  return (
    <article className="analytics-metric" data-testid={`analytics-${metricKey}`}>
      <span>{label}</span>
      <strong>{arabicInteger.format(metric.count)}</strong>
      <p>{metric.definitionAr}</p>
    </article>
  );
}

function cairoToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
