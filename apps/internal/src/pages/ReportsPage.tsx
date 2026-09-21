import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type {
  BranchDto,
  ManagementReportDto,
  ReportCompletedSaleDto,
  ReportRefundDto,
  WorkspaceDto,
} from "@bravos/contracts";
import { ApiError, getManagementReport, listStaff, type ManagementReportQuery } from "../api.ts";
import { accountGeneration } from "../account-session.ts";
import { formatEgpFromPiasters } from "../money.ts";
import { ReportExportActions } from "./ReportExportActions.tsx";

type PeriodKind = "today" | "day" | "month";
type ChannelFilter = "all" | "physical" | "online";

const cairoDateTime = new Intl.DateTimeFormat("ar-EG", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Cairo",
});

const channelName: Record<"physical" | "online", string> = {
  physical: "الفروع",
  online: "الأونلاين",
};

export default function ReportsPage({ workspace }: { workspace: WorkspaceDto }) {
  const [cairoToday] = useState(() => cairoDateParts(new Date()));
  const [period, setPeriod] = useState<PeriodKind>("today");
  const [day, setDay] = useState(cairoToday.day);
  const [month, setMonth] = useState(cairoToday.month);
  const [branchId, setBranchId] = useState("");
  const [channel, setChannel] = useState<ChannelFilter>("all");
  const [employeeId, setEmployeeId] = useState("");
  const [query, setQuery] = useState<ManagementReportQuery>({ period: "today", detailPage: 1, detailPageSize: 25 });
  const [report, setReport] = useState<ManagementReportDto | null>(null);
  const [knownEmployees, setKnownEmployees] = useState<Array<{ staffId: string; displayName: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [requestRevision, setRequestRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const epoch = accountGeneration();
    const staffId = workspace.staff.id;
    void listStaff()
      .then((staff) => {
        if (cancelled || accountGeneration() !== epoch || workspace.staff.id !== staffId) return;
        setKnownEmployees((current) => mergeEmployees(
          current,
          staff.map((account) => ({ staffId: account.id, displayName: account.displayName })),
        ));
      })
      .catch(() => {
        // The report remains usable if the optional filter roster cannot be refreshed.
      });
    return () => {
      cancelled = true;
    };
  }, [workspace.staff.id]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const epoch = accountGeneration();
    const staffId = workspace.staff.id;
    const stillCurrent = () => !cancelled
      && accountGeneration() === epoch
      && workspace.staff.id === staffId;

    setLoading(true);
    setError("");
    setReport(null);
    void getManagementReport(query, controller.signal)
      .then((next) => {
        if (!stillCurrent()) return;
        setReport(next);
        setKnownEmployees((current) => mergeEmployees(current, next.byEmployee));
      })
      .catch((caught: unknown) => {
        if (!stillCurrent() || (caught instanceof DOMException && caught.name === "AbortError")) return;
        setError(caught instanceof ApiError ? caught.messageAr : "تعذر تحميل التقرير. حاول مرة أخرى.");
      })
      .finally(() => {
        if (stillCurrent()) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [query, requestRevision, workspace.staff.id]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const optionalFilters = {
      ...(branchId ? { branchId } : {}),
      ...(channel !== "all" ? { channel } : {}),
      ...(employeeId ? { employeeId } : {}),
    };
    if (period === "day") {
      if (!day) {
        setError("اختر اليوم المطلوب.");
        return;
      }
      setQuery({ period, date: day, ...optionalFilters, detailPage: 1, detailPageSize: 25 });
      return;
    }
    if (period === "month") {
      if (!month) {
        setError("اختر الشهر المطلوب.");
        return;
      }
      setQuery({ period, month, ...optionalFilters, detailPage: 1, detailPageSize: 25 });
      return;
    }
    setQuery({ period, ...optionalFilters, detailPage: 1, detailPageSize: 25 });
  }

  return (
    <main className="shell reports-page">
      <header className="page-hero">
        <h1>تقارير الإدارة</h1>
      </header>

      <form className="card report-filters" aria-label="فلاتر التقارير" onSubmit={applyFilters}>
        <div className="field">
          <label htmlFor="report-period">الفترة</label>
          <select id="report-period" value={period} onChange={(event) => setPeriod(event.target.value as PeriodKind)}>
            <option value="today">اليوم</option>
            <option value="day">يوم محدد</option>
            <option value="month">شهر ميلادي</option>
          </select>
        </div>
        {period === "day" ? (
          <div className="field">
            <label htmlFor="report-day">اليوم</label>
            <input id="report-day" type="date" value={day} onChange={(event) => setDay(event.target.value)} required />
          </div>
        ) : null}
        {period === "month" ? (
          <div className="field">
            <label htmlFor="report-month">الشهر</label>
            <input id="report-month" type="month" value={month} onChange={(event) => setMonth(event.target.value)} required />
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="report-branch">الفرع</label>
          <select id="report-branch" value={branchId} onChange={(event) => setBranchId(event.target.value)}>
            <option value="">كل الفروع</option>
            {workspace.authorizedBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.nameAr}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="report-channel">القناة</label>
          <select id="report-channel" value={channel} onChange={(event) => setChannel(event.target.value as ChannelFilter)}>
            <option value="all">كل القنوات</option>
            <option value="physical">الفروع</option>
            <option value="online">الأونلاين</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="report-employee">الموظف</label>
          <select id="report-employee" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
            <option value="">كل الموظفين</option>
            {knownEmployees.map((employee) => (
              <option key={employee.staffId} value={employee.staffId}>{employee.displayName}</option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={loading}>عرض التقرير</button>
      </form>

      {error ? (
        <div className="error" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => setRequestRevision((current) => current + 1)}>إعادة محاولة تحميل التقرير</button>
        </div>
      ) : null}
      {loading && !report ? <p role="status">جارٍ تحميل التقرير…</p> : null}
      {report ? (
        <>
          <ReportExportActions query={query} staffId={workspace.staff.id} />
          <ReportContents
            report={report}
            loading={loading}
            workspace={workspace}
            onPageChange={(detailPage) => setQuery((current) => ({ ...current, detailPage }))}
          />
        </>
      ) : null}
    </main>
  );
}

function ReportContents({
  report,
  loading,
  workspace,
  onPageChange,
}: {
  report: ManagementReportDto;
  loading: boolean;
  workspace: WorkspaceDto;
  onPageChange: (page: number) => void;
}) {
  const summary = report.summary;
  return (
    <div className="report-results" aria-busy={loading}>
      <section className="card report-period" aria-labelledby="report-period-heading">
        <div>
          <h2 id="report-period-heading">الفترة المعروضة</h2>
          <p data-testid="report-period-label">{report.period.labelAr}</p>
        </div>
        <p className="muted" dir="ltr">{report.period.fromCairoDate} — {report.period.toCairoDateInclusive}</p>
      </section>

      <section className="card" aria-labelledby="report-summary-heading">
        <h2 id="report-summary-heading">ملخص النشاط</h2>
        <div className="report-metrics" data-testid="report-summary">
          <Metric label="العمليات المكتملة" value={String(summary.completedCount)} />
          <Metric label="إجمالي القيم النهائية" value={money(summary.grossFinalSalesPiasters)} />
          <Metric label="إجمالي قيمة البضاعة" value={money(summary.grossMerchandiseSalesPiasters)} />
          <Metric
            label="رسوم التوصيل المحصلة"
            value={money(summary.deliveryChargesPiasters)}
            note="رسوم يدفعها العميل وليست هامش شركة الشحن أو رصيداً مستحقاً."
          />
          <Metric label="استرداد البضاعة" value={money(summary.merchandiseRefundPiasters)} />
          <Metric label="استرداد رسوم الطلب" value={money(summary.checkoutChargeRefundPiasters)} />
          <Metric label="صافي القيم النهائية" value={money(summary.netFinalSalesPiasters)} />
          <Metric label="صافي مبيعات البضاعة" value={money(summary.netMerchandiseSalesPiasters)} />
          <Metric label="صافي تكلفة البضاعة المعروفة" value={money(summary.knownNetMerchandiseCostPiasters)} />
          <Metric label="مجمل ربح البضاعة" value={profit(summary.merchandiseGrossProfitPiasters)} />
          <Metric label="المصروفات الفعلية" value={money(summary.effectiveExpensesPiasters)} />
          <Metric
            label="ربح التشغيل بعد المصروفات"
            value={profit(summary.operatingProfitPiasters)}
            note={report.filters.channel === "online" ? "المصروفات مسجلة على الفروع ولا تُخصم عند عرض قناة الأونلاين وحدها." : undefined}
          />
          <Metric label="تكلفة المشتريات في الفترة" value={money(summary.purchaseCostPiasters)} />
        </div>
        {summary.costsIncomplete ? (
          <div className="report-warning" role="status">
            الربح غير مكتمل لأن تكلفة {summary.unresolvedCostQuantity} قطعة غير معروفة. لم تُحسب كأنها صفر.
          </div>
        ) : null}
      </section>

      <ReportBreakdowns report={report} />
      <OnlineOrderOperations report={report} />
      <DetailPaging report={report} loading={loading} onPageChange={onPageChange} />
      <CompletedSales sales={report.completedSales} />
      <Refunds refunds={report.refunds} branches={workspace.authorizedBranches} />
      <BestSellers report={report} />
      <Inventory report={report} />
      <PurchasesAndExpenses report={report} />
      <LowStock report={report} />
      <DetailPaging report={report} loading={loading} onPageChange={onPageChange} />
    </div>
  );
}

function ReportBreakdowns({ report }: { report: ManagementReportDto }) {
  return (
    <section className="grid two" aria-label="تفاصيل النشاط حسب القناة والفرع والموظف">
      <div className="card">
        <h2>حسب القناة</h2>
        <div className="report-table-wrap">
          <table className="report-table">
            <thead><tr><th>القناة</th><th>النهائي</th><th>صافي البضاعة</th><th>مجمل الربح</th></tr></thead>
            <tbody>
              {report.byChannel.map((row) => (
                <tr key={row.channel}>
                  <td>{channelName[row.channel]} ({row.completedCount})</td>
                  <td>{money(row.grossFinalSalesPiasters)}</td>
                  <td>{money(row.netMerchandiseSalesPiasters)}</td>
                  <td>{profit(row.grossProfitPiasters)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <h2>حسب الفرع</h2>
        {report.byBranch.length ? (
          <div className="report-table-wrap">
            <table className="report-table">
              <thead><tr><th>الفرع</th><th>صافي البضاعة</th><th>المصروفات</th><th>ربح التشغيل</th></tr></thead>
              <tbody>
                {report.byBranch.map((row) => (
                  <tr key={row.branch.id}>
                    <td>{row.branch.nameAr} ({row.completedCount})</td>
                    <td>{money(row.netMerchandiseSalesPiasters)}</td>
                    <td>{money(row.effectiveExpensesPiasters)}</td>
                    <td>{profit(row.operatingProfitPiasters)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="empty">لا توجد مبيعات فرع في هذه الفترة.</p>}
      </div>
      <div className="card report-wide">
        <h2>حسب الموظف</h2>
        {report.byEmployee.length ? (
          <div className="report-table-wrap">
            <table className="report-table">
              <thead><tr><th>الموظف</th><th>العمليات</th><th>القيمة النهائية</th><th>خصم الموظف</th><th>المرتجعات</th><th>المصروفات</th></tr></thead>
              <tbody>
                {report.byEmployee.map((row) => (
                  <tr key={row.staffId}>
                    <td>{row.displayName}</td>
                    <td>{row.completedCount}</td>
                    <td>{money(row.grossFinalSalesPiasters)}</td>
                    <td>{money(row.employeeDiscountPiasters)}</td>
                    <td>{money(row.merchandiseRefundPiasters)}</td>
                    <td>{money(row.effectiveExpensesPiasters)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="empty">لا توجد مبيعات منسوبة لموظف في هذه الفترة.</p>}
      </div>
    </section>
  );
}

function OnlineOrderOperations({ report }: { report: ManagementReportDto }) {
  const operations = report.onlineOrderOperations;
  return (
    <section className="card" data-testid="online-order-operations" aria-labelledby="online-order-operations-heading">
      <h2 id="online-order-operations-heading">طلبات الأونلاين قيد التشغيل</h2>
      <p className="muted">هذه لقطة تشغيلية حالية لا تتغير باختيار يوم أو شهر، ولا تدخل في إيراد المبيعات المكتملة.</p>
      <div className="report-metrics">
        <Metric label="معلق" value={String(operations.pendingCount)} />
        <Metric label="مؤكد ومحمي" value={String(operations.confirmedCount)} />
        <Metric label="تم الشحن" value={String(operations.shippedCount)} />
        <Metric label="فشل التوصيل" value={String(operations.deliveryFailedCount)} />
      </div>
    </section>
  );
}

function DetailPaging({
  report,
  loading,
  onPageChange,
}: {
  report: ManagementReportDto;
  loading: boolean;
  onPageChange: (page: number) => void;
}) {
  const page = report.pageInfo;
  return (
    <nav className="card report-pagination" aria-label="صفحات تفاصيل التقرير">
      <p>
        صفحة التفاصيل {page.page} · إجمالي السجلات: {page.totalCompletedSales} مبيعات، {page.totalRefunds} مرتجعات، {page.totalPurchases} مشتريات، {page.totalExpenses} مصروفات.
      </p>
      <div className="actions">
        <button className="secondary" type="button" disabled={loading || page.page <= 1} onClick={() => onPageChange(page.page - 1)}>
          الصفحة السابقة
        </button>
        <button className="secondary" type="button" disabled={loading || !page.hasMore} onClick={() => onPageChange(page.page + 1)}>
          الصفحة التالية
        </button>
      </div>
    </nav>
  );
}

function CompletedSales({ sales }: { sales: ReportCompletedSaleDto[] }) {
  return (
    <section className="card" aria-labelledby="completed-sales-heading">
      <h2 id="completed-sales-heading">المبيعات المكتملة</h2>
      <p className="muted">تظهر هنا مبيعات الفروع المكتملة والطلبات التي وصلت للعميل فقط. الطلبات المعلقة والمؤكدة تبقى في شاشة تشغيل الطلبات.</p>
      {sales.length ? <div className="report-card-list">
        {sales.map((sale) => (
          <article className="report-detail-card" data-testid="report-sale" key={`${sale.source.kind}:${sale.source.id}`}>
            <div className="report-detail-heading">
              <div>
                <h3>{sale.source.reference}</h3>
                <p className="muted">{channelName[sale.channel]} · {formatCairoDateTime(sale.occurredAt)}</p>
              </div>
              <SourceLink sale={sale} />
            </div>
            <p>
              الحالة الفعلية: {sale.effectiveStatus === "active" ? "ساري" : "ملغى"} · مراجعة التصحيح {sale.correctionRevision}
            </p>
            {sale.effectiveStatus === "cancelled" ? (
              <p className="report-warning">هذا البيع ملغى ولا يُعرض كبيع مكتمل عادي في الإجماليات.</p>
            ) : null}
            <p>{sale.branch ? `الفرع: ${sale.branch.nameAr}` : "قناة الأونلاين المركزية"}</p>
            <p>{sale.employee ? `الموظف: ${sale.employee.displayName}` : "لا يوجد موظف بيع لطلب الأونلاين"}</p>
            <div className="report-amount-line">
              <span>الأصلي: {money(sale.accepted.originalPiasters)}</span>
              <span>خصم العرض: {money(sale.accepted.automaticOfferDiscountPiasters)}</span>
              <span>خصم الكوبون: {money(sale.accepted.couponDiscountPiasters)}</span>
              <span>خصم الموظف: {money(sale.accepted.employeeDiscountPiasters)}</span>
            </div>
            {sale.accepted.employeeDiscountReason ? <p>سبب الخصم: {sale.accepted.employeeDiscountReason}</p> : null}
            <div className="report-amount-line report-final-line">
              <span>البضاعة: {money(sale.effectiveMerchandisePiasters)}</span>
              <span>التوصيل: {money(sale.deliveryChargePiasters)}</span>
              <strong>النهائي: {money(sale.effectiveFinalPiasters)}</strong>
            </div>
            <ul className="report-lines" aria-label={`أصناف ${sale.source.reference}`}>
              {sale.lines.map((line) => (
                <li key={line.sourceLineId}>
                  <span>{line.productNameAr} ({line.productCode}) × {line.quantity}</span>
                  <strong>{money(line.paidPiasters)}</strong>
                </li>
              ))}
            </ul>
            {sale.costsIncomplete ? (
              <p className="report-warning">التكلفة غير مكتملة: {sale.unresolvedCostQuantity} قطعة دون تكلفة معروفة.</p>
            ) : <p className="muted">التكلفة المعروفة: {money(sale.knownCostPiasters)}</p>}
            <CorrectionHistory items={sale.corrections} />
          </article>
        ))}
      </div> : <p className="empty">لا توجد مبيعات مكتملة في الفترة.</p>}
    </section>
  );
}

function SourceLink({ sale }: { sale: ReportCompletedSaleDto }) {
  const destination = sourceDestination(sale.source);
  return <Link to={destination.to}>{destination.shortLabel}</Link>;
}

function Refunds({ refunds, branches }: { refunds: ReportRefundDto[]; branches: BranchDto[] }) {
  const branchNames = new Map(branches.map((branch) => [branch.id, branch.nameAr]));
  return (
    <section className="card" aria-labelledby="refunds-heading">
      <h2 id="refunds-heading">المرتجعات في فترة المعالجة</h2>
      {refunds.length ? <div className="report-card-list">
        {refunds.map((refund) => (
          <article className="report-detail-card" data-testid="report-refund" key={refund.returnId}>
            <div className="report-detail-heading">
              <div>
                <h3>مرتجع {refund.returnId}</h3>
                <p className="muted">{formatCairoDateTime(refund.postedAt)}</p>
              </div>
              <RefundLinks refund={refund} />
            </div>
            <div className="report-amount-line">
              <span>القناة الأصلية: {channelName[refund.channel]}</span>
              <span>الفرع الأصلي: {refund.originalBranchId ? branchNames.get(refund.originalBranchId) ?? refund.originalBranchId : "لا يوجد — طلب أونلاين"}</span>
              <span>فرع المعالجة: {branchNames.get(refund.handlingBranchId) ?? refund.handlingBranchId}</span>
              <span>مراجعة التصحيح: {refund.correctionRevision}</span>
            </div>
            <div className="report-amount-line">
              <span>استرداد البضاعة: {money(refund.authorizedRefund.merchandisePiasters)}</span>
              <span>استرداد رسوم الطلب: {money(refund.authorizedRefund.checkoutChargePiasters)}</span>
              <strong>المعتمد: {money(refund.authorizedRefund.totalPiasters)}</strong>
              <span>حالة الاسترداد النقدي: {cashRefundStatusName(refund.cashRefundStatus)}</span>
              <span>المستحق نقداً: {money(refund.cashRefundOwedPiasters)}</span>
              <span>المدفوع فعلياً: {money(refund.actualRefundPaidPiasters)}</span>
            </div>
            <p>تكلفة البضاعة القابلة للبيع المستعادة: {money(refund.sellableRestoredCostPiasters)}</p>
            {refund.refundCashEvents.length ? (
              <ul className="report-plain-list" aria-label={`حركة نقد المرتجع ${refund.returnId}`}>
                {refund.refundCashEvents.map((event, index) => (
                  <li key={`${event.recordedAt}:${index}`}>
                    <strong>{event.direction === "paid_out" ? "دفع استرداد" : "استرداد دفع سابق"} · {money(event.amountPiasters)}</strong>
                    <span>{formatCairoDateTime(event.recordedAt)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {refund.effectiveStatus === "cancelled" ? <p className="muted">ملغى ولا يؤثر في الإجماليات الحالية.</p> : null}
            <CorrectionHistory items={refund.corrections} />
            {refund.exchange ? (
              <p>
                استبدال: بضاعة {money(refund.exchange.replacementMerchandisePiasters)}، رصيد مطبق {money(refund.exchange.creditAppliedPiasters)}،
                نقد محصل {money(refund.exchange.cashCollectedPiasters)}، استرداد نقدي مستحق {money(refund.exchange.cashRefundOwedPiasters)}،
                استرداد نقدي مدفوع فعلياً {money(refund.exchange.cashRefundPaidPiasters)}.
              </p>
            ) : null}
          </article>
        ))}
      </div> : <p className="empty">لا توجد مرتجعات معالجة في الفترة.</p>}
    </section>
  );
}

function RefundLinks({ refund }: { refund: ReportRefundDto }) {
  const destination = sourceDestination(refund.source);
  return (
    <div className="actions">
      <Link to={`/returns?returnId=${encodeURIComponent(refund.returnId)}`}>فتح المرتجع</Link>
      <Link to={destination.to}>{destination.originalLabel}</Link>
    </div>
  );
}

function BestSellers({ report }: { report: ManagementReportDto }) {
  return (
    <section className="card" data-testid="best-sellers" aria-labelledby="best-sellers-heading">
      <h2 id="best-sellers-heading">الأكثر مبيعاً</h2>
      <p className="muted">الترتيب حسب إجمالي الوحدات المباعة الفعلية. تظهر المرتجعات منفصلة ولا نخمّن صافي الوحدات.</p>
      {report.bestSellers.length ? <ol className="report-ranked-list">
        {report.bestSellers.map((product) => (
          <li key={product.productId}>
            <strong>{product.productNameAr} ({product.productCode})</strong>
            <span>مباع فعلياً قبل المرتجعات: {product.grossEffectiveSoldQuantity}</span>
            <span>مرتجع: {product.returnedQuantity}</span>
          </li>
        ))}
      </ol> : <p className="empty">لا توجد أصناف مباعة في الفترة.</p>}
    </section>
  );
}

function Inventory({ report }: { report: ManagementReportDto }) {
  const inventory = report.inventory;
  return (
    <section className="card" data-testid="inventory-valuation" aria-labelledby="inventory-heading">
      <h2 id="inventory-heading">قيمة المخزون المركزي</h2>
      <p className="muted">هذه لقطة المخزون الحالية الآن، ولا تتغير باختيار يوم أو شهر تاريخي في التقرير.</p>
      <div className="report-metrics">
        <Metric label="المتاح" value={`${inventory.availableQuantity} قطعة · ${money(inventory.availableValuePiasters)}`} />
        <Metric
          label="المحمي للطلبات المؤكدة أو الجاري توصيلها"
          value={`${inventory.protectedQuantity} قطعة · ${money(inventory.protectedValuePiasters)}`}
        />
      </div>
      {inventory.costsIncomplete ? (
        <div className="report-warning" role="status">
          قيمة المخزون غير مكتملة. كمية بتكلفة غير معروفة: {inventory.unresolvedCostQuantity}. لم تُسجل بقيمة صفر.
        </div>
      ) : null}
      <p className="muted">المخزون المتاح منفصل عن البضاعة المحمية للطلبات، ولا تمثل الرسوم أو الشحن قيمة مخزون.</p>
    </section>
  );
}

function PurchasesAndExpenses({ report }: { report: ManagementReportDto }) {
  return (
    <section className="grid two" aria-label="المشتريات والمصروفات">
      <div className="card">
        <h2>المشتريات</h2>
        <p className="muted">المشتريات مركزية ولا تتغير بفلتر الفرع أو الموظف أو قناة البيع.</p>
        <p className="expense-total">{money(report.purchases.totalPiasters)}</p>
        {report.purchases.receipts.length ? <ul className="report-plain-list">
          {report.purchases.receipts.map((receipt) => (
            <li key={receipt.receiptId}>
              <strong>{receipt.receiptDate}</strong>
              <span>{receipt.effectiveQuantity} قطعة · {money(receipt.effectiveCostPiasters)}</span>
              <ul className="report-lines" aria-label={`تفاصيل الاستلام ${receipt.receiptId}`}>
                {receipt.lines.map((line) => (
                  <li key={line.lineId}>
                    <span>{line.variant.product.nameAr} · {line.variant.size.nameAr} · {line.variant.color.nameAr} · {line.effectiveQuantity} قطعة</span>
                    <strong>{money(line.effectiveUnitCostPiasters)} للوحدة · {money(line.effectiveCostPiasters)}</strong>
                  </li>
                ))}
              </ul>
              {receipt.corrections.map((correction) => (
                <span key={correction.id}>
                  تصحيح {correction.revision}: {correction.reason} · المسؤول {correction.changedByDisplayName} · {formatCairoDateTime(correction.changedAt)}
                </span>
              ))}
            </li>
          ))}
        </ul> : <p className="empty">لا توجد مشتريات في الفترة.</p>}
      </div>
      <div className="card">
        <h2>المصروفات</h2>
        <p className="expense-total">{money(report.expenses.totalPiasters)}</p>
        {report.expenses.items.length ? <ul className="report-plain-list">
          {report.expenses.items.map((expense) => (
            <li key={expense.expenseId}>
              <strong>{expense.categoryNameAr} · {money(expense.amountPiasters)}</strong>
              <span>{expense.branch.nameAr} · {expense.createdByDisplayName} · {expense.expenseDate}</span>
              <span>الحالة الفعلية: {expense.effectiveStatus === "active" ? "ساري" : "ملغى ولا يؤثر في الإجماليات"}</span>
              <span>مراجعة التصحيح: {expense.correctionRevision}</span>
              <span>{expense.description}</span>
              <CorrectionHistory items={expense.corrections} compact />
            </li>
          ))}
        </ul> : <p className="empty">لا توجد مصروفات في الفترة.</p>}
      </div>
    </section>
  );
}

function LowStock({ report }: { report: ManagementReportDto }) {
  return (
    <section className="card" aria-labelledby="low-stock-heading">
      <h2 id="low-stock-heading">المخزون المنخفض الآن</h2>
      <p className="muted">قائمة مركزية حالية لا تتغير باختيار فرع أو موظف في التقرير.</p>
      {report.lowStock.length ? <ul className="report-plain-list">
        {report.lowStock.map((row) => (
          <li key={row.variantId}>
            <strong>{row.variant.product.nameAr} ({row.variant.product.code})</strong>
            <span>{row.variant.size.nameAr} · {row.variant.color.nameAr}</span>
            <span>المتاح {row.availableQuantity} · حد التنبيه {row.threshold}</span>
          </li>
        ))}
      </ul> : <p className="empty">لا توجد أصناف عند حد المخزون المنخفض.</p>}
    </section>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note?: ReactNode }) {
  return (
    <div className="report-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {note ? <small>{note}</small> : null}
    </div>
  );
}

function CorrectionHistory({
  items,
  compact = false,
}: {
  items: Array<{
    id: string;
    type: "correction" | "cancellation";
    revision: number;
    reason: string;
    changedByDisplayName: string;
    changedAt: string;
  }>;
  compact?: boolean;
}) {
  if (!items.length) return null;
  return (
    <div className={compact ? "report-corrections compact" : "report-corrections"}>
      <h4>سجل التصحيحات المرتبط</h4>
      <ul className="report-plain-list">
        {items.map((correction) => (
          <li key={correction.id}>
            <strong>{correction.type === "cancellation" ? "إلغاء" : "تصحيح"} · مراجعة {correction.revision}</strong>
            <span>{correction.reason}</span>
            <span>{correction.changedByDisplayName} · {formatCairoDateTime(correction.changedAt)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function money(value: number) {
  return formatEgpFromPiasters(value);
}

function profit(value: number | null) {
  return value === null ? "غير مكتمل — توجد تكلفة غير معروفة" : money(value);
}

function cashRefundStatusName(status: ReportRefundDto["cashRefundStatus"]) {
  if (status === "owed") return "مستحق";
  if (status === "paid") return "مدفوع";
  if (status === "overpaid") return "مدفوع أكثر من المعتمد حالياً";
  if (status === "cancelled") return "ملغى";
  return "لا يوجد";
}

function formatCairoDateTime(value: string) {
  return cairoDateTime.format(new Date(value));
}

function sourceDestination(
  source: { kind: "physical_sale" | "delivered_online_order"; id: string },
) {
  return source.kind === "delivered_online_order"
    ? { to: `/online-orders/${source.id}`, shortLabel: "فتح الطلب", originalLabel: "فتح الطلب الأصلي" }
    : {
        to: `/sales?saleId=${encodeURIComponent(source.id)}`,
        shortLabel: "فتح سجل المبيعات",
        originalLabel: "فتح البيع الأصلي",
      };
}

function cairoDateParts(now: Date): { day: string; month: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (part: "year" | "month" | "day") => parts.find((entry) => entry.type === part)?.value ?? "";
  const day = `${get("year")}-${get("month")}-${get("day")}`;
  return { day, month: day.slice(0, 7) };
}

function mergeEmployees(
  current: Array<{ staffId: string; displayName: string }>,
  incoming: Array<{ staffId: string; displayName: string }>,
) {
  const employees = new Map(current.map((employee) => [employee.staffId, employee]));
  for (const employee of incoming) employees.set(employee.staffId, {
    staffId: employee.staffId,
    displayName: employee.displayName,
  });
  return [...employees.values()].sort((left, right) => left.displayName.localeCompare(right.displayName, "ar"));
}
