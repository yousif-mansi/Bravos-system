import { useEffect, useRef, useState } from "react";

import type {
  OpeningImportFilesDto,
  OpeningImportLineErrorDto,
  OpeningImportPreviewDto,
  WorkspaceDto,
} from "@bravos/contracts";
import { accountGeneration } from "../account-session.ts";
import {
  acceptOpeningImportPreview,
  ApiError,
  createOpeningImportPreview,
  getOpeningImportPreview,
} from "../api.ts";
import { formatEgpFromPiasters } from "../money.ts";
import {
  assignPendingOpeningImport,
  clearPendingOpeningImport,
  loadPendingOpeningImport,
  pendingOpeningImportStorageKey,
  type PendingOpeningImport,
  withOpeningImportLock,
} from "../opening-import-pending.ts";

type SelectedFiles = {
  catalog: File | null;
  stock: File | null;
  configuration: File | null;
};

type PreviewAttempt = {
  operationId: string;
  files: OpeningImportFilesDto;
};

const EMPTY_FILES: SelectedFiles = { catalog: null, stock: null, configuration: null };

export default function OpeningImportPage({ workspace }: { workspace: WorkspaceDto }) {
  const [files, setFiles] = useState<SelectedFiles>(EMPTY_FILES);
  const [formVersion, setFormVersion] = useState(0);
  const [previewAttempt, setPreviewAttempt] = useState<PreviewAttempt | null>(null);
  const [preview, setPreview] = useState<OpeningImportPreviewDto | null>(null);
  const [pendingMarker, setPendingMarker] = useState<PendingOpeningImport | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const previewRef = useRef<OpeningImportPreviewDto | null>(null);
  const previewAttemptRef = useRef<PreviewAttempt | null>(null);
  const busyRef = useRef(false);
  const lifecycle = useRef(0);

  function applyPreview(next: OpeningImportPreviewDto | null) {
    previewRef.current = next;
    setPreview(next);
  }

  useEffect(() => {
    const staffId = workspace.staff.id;
    const epoch = accountGeneration();
    const token = ++lifecycle.current;
    let cancelled = false;
    let refreshVersion = 0;
    const stillCurrent = (version?: number) => !cancelled
      && lifecycle.current === token
      && accountGeneration() === epoch
      && workspace.staff.id === staffId
      && (version === undefined || refreshVersion === version);

    async function refreshFromMarker(initial: boolean) {
      const version = ++refreshVersion;
      const stored = loadPendingOpeningImport(staffId);
      if (stillCurrent(version)) setPendingMarker(stored);
      const previewId = stored?.previewId ?? (!initial ? previewRef.current?.id : null);
      if (!previewId) {
        if (stillCurrent(version)) {
          if (initial) applyPreview(null);
          setLoading(false);
        }
        return;
      }
      try {
        const recovered = await getOpeningImportPreview(previewId);
        if (!stillCurrent(version)) return;
        if (!stored && !initial && recovered.status !== "accepted") {
          applyPreview(null);
          return;
        }
        applyPreview(recovered);
        if (recovered.status === "accepted" && stored) {
          clearPendingOpeningImport(staffId, stored);
          setPendingMarker(null);
          setNotice("تم قبول بيانات البداية وحفظها مرة واحدة.");
        }
      } catch (caught) {
        if (stillCurrent(version)) {
          setError(message(caught, "تعذر استعادة معاينة الاستيراد المحفوظة."));
        }
      } finally {
        if (stillCurrent(version)) setLoading(false);
      }
    }

    function onStorage(event: StorageEvent) {
      if (event.key === pendingOpeningImportStorageKey(staffId)) {
        void refreshFromMarker(false);
      }
    }

    setLoading(true);
    setError("");
    setNotice("");
    applyPreview(null);
    setPendingMarker(null);
    setPreviewAttempt(null);
    previewAttemptRef.current = null;
    busyRef.current = false;
    setBusy(false);
    setFiles(EMPTY_FILES);
    setFormVersion((current) => current + 1);
    window.addEventListener("storage", onStorage);
    void refreshFromMarker(true);
    return () => {
      cancelled = true;
      lifecycle.current += 1;
      window.removeEventListener("storage", onStorage);
    };
  }, [workspace.staff.id]);

  function selectFile(kind: keyof SelectedFiles, file: File | null) {
    setFiles((current) => ({ ...current, [kind]: file }));
    setPreviewAttempt(null);
    previewAttemptRef.current = null;
    setError("");
    setNotice("");
  }

  async function createPreview() {
    if (busyRef.current) return;
    if (!files.catalog || !files.stock || !files.configuration) {
      setError("اختر ملفات الكتالوج والمخزون الافتتاحي والإعدادات الثلاثة.");
      return;
    }
    busyRef.current = true;
    const staffId = workspace.staff.id;
    const epoch = accountGeneration();
    const token = lifecycle.current;
    const stillCurrent = () => workspace.staff.id === staffId
      && accountGeneration() === epoch
      && lifecycle.current === token;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      let attempt = previewAttemptRef.current ?? previewAttempt;
      if (!attempt) {
        const [catalog, stock, configuration] = await Promise.all([
          files.catalog.text(),
          files.stock.text(),
          files.configuration.text(),
        ]);
        if (!stillCurrent()) return;
        attempt = {
          operationId: crypto.randomUUID(),
          files: { catalog, stock, configuration },
        };
        previewAttemptRef.current = attempt;
        setPreviewAttempt(attempt);
      }
      const requestAttempt = attempt;
      await withOpeningImportLock(staffId, async () => {
        if (!stillCurrent()) return;
        const stored = loadPendingOpeningImport(staffId);
        if (stored) {
          setPendingMarker(stored);
          try {
            const existing = await getOpeningImportPreview(stored.previewId);
            if (!stillCurrent()) return;
            applyPreview(existing);
          } catch {
            /* retain the durable marker for a later recovery attempt */
          }
          setError("توجد معاينة سابقة لهذا الحساب. راجعها أو اختر ملفات جديدة صراحةً قبل إنشاء معاينة أخرى.");
          return;
        }
        const created = await createOpeningImportPreview(requestAttempt);
        if (!stillCurrent()) return;
        let assignment: ReturnType<typeof assignPendingOpeningImport>;
        try {
          assignment = assignPendingOpeningImport(staffId, created);
        } catch {
          applyPreview(created);
          setPendingMarker(null);
          setError("تعذر حفظ هوية المعاينة على هذا الجهاز، لذلك لن يمكن قبولها بأمان. حرر مساحة التخزين ثم ابدأ من جديد.");
          return;
        }
        if (assignment.kind === "blocked") {
          setPendingMarker(assignment.pending);
          setError("توجد معاينة سابقة لهذا الحساب. راجعها أو اختر ملفات جديدة صراحةً قبل إنشاء معاينة أخرى.");
          return;
        }
        setPendingMarker(assignment.pending);
        applyPreview(created);
        setNotice(created.status === "invalid"
          ? "حُفظت المعاينة بأخطائها للمراجعة. صحح الملفات ثم اختر ملفات جديدة."
          : "اكتملت المعاينة. راجع كل الدفعات والإعدادات قبل القبول.");
      });
    } catch (caught) {
      if (stillCurrent()) {
        setError(caught instanceof ApiError && caught.status < 500
          ? caught.messageAr
          : "تعذر إنشاء المعاينة. احتفظ بالملفات في هذه الصفحة وأعد المحاولة بنفس العملية.");
      }
    } finally {
      busyRef.current = false;
      if (stillCurrent()) setBusy(false);
    }
  }

  async function startNewUpload() {
    if (busyRef.current) return;
    busyRef.current = true;
    const staffId = workspace.staff.id;
    const epoch = accountGeneration();
    const token = lifecycle.current;
    const stillCurrent = () => workspace.staff.id === staffId
      && accountGeneration() === epoch
      && lifecycle.current === token;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await withOpeningImportLock(staffId, () => {
        const stored = loadPendingOpeningImport(staffId);
        if (stored) clearPendingOpeningImport(staffId, stored);
      });
      if (!stillCurrent()) return;
      setPendingMarker(null);
      applyPreview(null);
      setPreviewAttempt(null);
      previewAttemptRef.current = null;
      setFiles(EMPTY_FILES);
      setFormVersion((current) => current + 1);
    } catch {
      if (stillCurrent()) setError("تعذر بدء رفع جديد على هذا الجهاز. أعد المحاولة.");
    } finally {
      busyRef.current = false;
      if (stillCurrent()) setBusy(false);
    }
  }

  async function acceptPreview() {
    if (busyRef.current) return;
    busyRef.current = true;
    const staffId = workspace.staff.id;
    const epoch = accountGeneration();
    const token = lifecycle.current;
    const stillCurrent = () => workspace.staff.id === staffId
      && accountGeneration() === epoch
      && lifecycle.current === token;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await withOpeningImportLock(staffId, async () => {
        if (!stillCurrent()) return;
        const marker = loadPendingOpeningImport(staffId);
        if (!marker) {
          setPendingMarker(null);
          setError("هوية القبول المحفوظة غير متاحة. ابدأ معاينة جديدة قبل القبول.");
          return;
        }
        setPendingMarker(marker);
        const current = await getOpeningImportPreview(marker.previewId);
        if (!stillCurrent()) return;
        applyPreview(current);
        if (current.status === "accepted") {
          clearPendingOpeningImport(staffId, marker);
          setPendingMarker(null);
          setNotice("تم قبول بيانات البداية وحفظها مرة واحدة.");
          return;
        }
        if (
          current.status !== "ready"
          || current.operationId !== marker.operationId
          || current.previewFingerprint !== marker.previewFingerprint
        ) {
          setError("المعاينة لم تعد جاهزة للقبول. راجع الأخطاء أو ابدأ معاينة جديدة.");
          return;
        }
        const accepted = await acceptOpeningImportPreview(marker.previewId, {
          operationId: marker.operationId,
          previewFingerprint: marker.previewFingerprint,
        });
        if (!stillCurrent()) return;
        applyPreview(accepted);
        clearPendingOpeningImport(staffId, marker);
        setPendingMarker(null);
        setNotice("تم قبول بيانات البداية وحفظها مرة واحدة.");
      });
    } catch (caught) {
      if (!stillCurrent()) return;
      if (caught instanceof ApiError && caught.status < 500) {
        setError(caught.messageAr);
      } else {
        setError("نتيجة قبول الاستيراد غير مؤكدة. لم نفقد هوية العملية؛ أعد تحميل الصفحة للتحقق قبل أي محاولة أخرى.");
      }
    } finally {
      busyRef.current = false;
      if (stillCurrent()) setBusy(false);
    }
  }

  if (loading && !preview) {
    return <main className="shell"><p>جارٍ تحميل استيراد بيانات البداية…</p></main>;
  }

  return (
    <main className="shell opening-import-page">
      <header className="page-hero">
        <h1>استيراد بيانات البداية</h1>
      </header>

      {error ? <div className="error" role="alert">{error}</div> : null}
      {notice ? <div className="notice" role="status">{notice}</div> : null}

      <section className="card opening-import-templates">
        <h2>القوالب المعتمدة</h2>
        <p className="muted">نزّل القوالب كما هي. يمكن ترك ملف بقائمة العناوين فقط إذا لم تكن له بيانات.</p>
        <div className="actions">
          <a className="button secondary" href="/api/internal/opening-import/templates/catalog.csv" download>
            تنزيل قالب الكتالوج
          </a>
          <a className="button secondary" href="/api/internal/opening-import/templates/opening-stock.csv" download>
            تنزيل قالب المخزون الافتتاحي
          </a>
          <a className="button secondary" href="/api/internal/opening-import/templates/configuration.csv" download>
            تنزيل قالب الإعدادات
          </a>
        </div>
      </section>

      {!preview ? (
        <form
          key={formVersion}
          className="card opening-import-form"
          aria-label="رفع ملفات بيانات البداية"
          onSubmit={(event) => {
            event.preventDefault();
            void createPreview();
          }}
        >
          <h2>رفع الملفات للمراجعة</h2>
          <p className="muted">
            الحد الأقصى 1 ميجابايت لكل ملف و5000 صف بيانات إجمالاً. لا تُحفظ محتويات الملفات في المتصفح.
          </p>
          <div className="field">
            <label htmlFor="opening-catalog">ملف الكتالوج CSV</label>
            <input
              id="opening-catalog"
              type="file"
              accept=".csv,text/csv"
              required
              disabled={busy}
              onChange={(event) => selectFile("catalog", event.currentTarget.files?.[0] ?? null)}
            />
          </div>
          <div className="field">
            <label htmlFor="opening-stock">ملف المخزون الافتتاحي CSV</label>
            <input
              id="opening-stock"
              type="file"
              accept=".csv,text/csv"
              required
              disabled={busy}
              onChange={(event) => selectFile("stock", event.currentTarget.files?.[0] ?? null)}
            />
          </div>
          <div className="field">
            <label htmlFor="opening-configuration">ملف الإعدادات CSV</label>
            <input
              id="opening-configuration"
              type="file"
              accept=".csv,text/csv"
              required
              disabled={busy}
              onChange={(event) => selectFile("configuration", event.currentTarget.files?.[0] ?? null)}
            />
          </div>
          <button type="submit" disabled={busy}>{busy ? "جارٍ إنشاء المعاينة…" : "مراجعة الملفات"}</button>
        </form>
      ) : (
        <OpeningImportPreview
          preview={preview}
          canAccept={Boolean(
            preview.status === "ready"
            && pendingMarker?.previewId === preview.id
            && pendingMarker.operationId === preview.operationId
            && pendingMarker.previewFingerprint === preview.previewFingerprint
          )}
          busy={busy}
          onAccept={() => void acceptPreview()}
          onNewUpload={() => void startNewUpload()}
        />
      )}
    </main>
  );
}

function OpeningImportPreview({
  preview,
  canAccept,
  busy,
  onAccept,
  onNewUpload,
}: {
  preview: OpeningImportPreviewDto;
  canAccept: boolean;
  busy: boolean;
  onAccept: () => void;
  onNewUpload: () => void;
}) {
  return (
    <section className="card opening-import-preview" aria-label="معاينة الاستيراد">
      <div className="brand">
        <div>
          <h2>{previewStatus(preview.status)}</h2>
          <p className="muted">رقم المعاينة: {preview.id}</p>
        </div>
        {preview.status !== "accepted" ? (
          <button className="secondary" type="button" disabled={busy} onClick={onNewUpload}>
            اختيار ملفات جديدة
          </button>
        ) : null}
      </div>

      <div className="opening-import-counts" data-testid="opening-import-counts">
        <Count label="التصنيفات" value={preview.counts.categories} />
        <Count label="المقاسات" value={preview.counts.sizes} />
        <Count label="الألوان" value={preview.counts.colors} />
        <Count label="المنتجات" value={preview.counts.products} />
        <Count label="المتغيرات" value={preview.counts.variants} />
        <Count label="دفعات التكلفة" value={preview.counts.batches} />
        <Count label="إجمالي الكمية الافتتاحية" value={preview.counts.openingQuantity} />
        <Count label="فئات المصروفات" value={preview.counts.expenseCategories} />
        <Count label="مناطق التوصيل" value={preview.counts.deliveryAreas} />
        <Count label="العروض التلقائية" value={preview.counts.automaticOffers} />
        <Count label="الكوبونات" value={preview.counts.coupons} />
      </div>

      <CatalogPreview catalog={preview.catalog} />

      {preview.errors.length > 0 ? (
        <section className="opening-import-section" data-testid="opening-import-errors">
          <h3>أخطاء يجب تصحيحها</h3>
          <div className="list-stack">
            {preview.errors.map((item, index) => (
              <div className="error opening-import-error" key={`${item.file}:${item.line}:${item.column ?? ""}:${item.code}:${index}`}>
                <strong>{fileLabel(item)} — السطر {item.line}</strong>
                {item.column ? <span> — الخانة {item.column}</span> : null}
                <p>{item.messageAr}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="opening-import-section" data-testid="opening-import-batches">
        <h3>كل دفعات التكلفة الافتتاحية</h3>
        {preview.batches.length === 0 ? <p className="empty">لا توجد دفعات في هذه المعاينة.</p> : (
          <div className="list-stack">
            {preview.batches.map((batch) => (
              <article className="summary-card opening-import-row" data-testid="opening-import-batch" key={batch.key}>
                <div>
                  <strong>{batch.key}</strong>
                  <p className="muted">المتغير: {batch.variantKey}</p>
                </div>
                <div>
                  <p>الكمية: {batch.quantity}</p>
                  <p>تكلفة الوحدة: {formatEgpFromPiasters(batch.unitCostPiasters)}</p>
                  <p>تاريخ الاستلام: {batch.receiptDate}</p>
                  <p>الترتيب: {batch.batchOrder}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="opening-import-section" data-testid="opening-import-configuration">
        <h3>كل تغييرات الإعدادات</h3>
        {preview.configuration.length === 0 ? <p className="empty">لا توجد تغييرات إعدادات في هذه المعاينة.</p> : (
          <div className="list-stack">
            {preview.configuration.map((item, index) => (
              <article
                className="summary-card opening-import-row"
                data-testid="opening-import-config-row"
                key={`${item.recordType}:${item.key}:${index}`}
              >
                <div>
                  <strong>{item.labelAr}</strong>
                  <p className="muted">{item.recordType} / {item.key}</p>
                </div>
                <div>
                  <p>القيمة الحالية: {item.currentValue ?? "لا توجد"}</p>
                  <p>القيمة المقترحة: {item.proposedValue}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <ConfigurationDetails details={preview.configurationDetails} />

      {preview.status === "ready" && canAccept ? (
        <div className="opening-import-accept">
          <p>
            القبول يضيف البيانات دفعة واحدة. لن يستورد مبيعات ورقية قديمة، ولن يدمج تكاليف الدفعات المختلفة.
          </p>
          <button type="button" disabled={busy} onClick={onAccept}>
            {busy ? "جارٍ التحقق والقبول…" : "قبول الاستيراد"}
          </button>
        </div>
      ) : null}
      {preview.status === "ready" && !canAccept ? (
        <p className="error">هوية القبول الآمنة غير متاحة لهذه المعاينة. اختر ملفات جديدة قبل القبول.</p>
      ) : null}
      {preview.status === "accepted" ? (
        <div className="notice">تم قبول بيانات البداية{preview.acceptedAt ? ` في ${preview.acceptedAt}` : ""}.</div>
      ) : null}
    </section>
  );
}

function CatalogPreview({ catalog }: { catalog: OpeningImportPreviewDto["catalog"] }) {
  return (
    <section className="opening-import-section" data-testid="opening-import-catalog">
      <h3>كل بيانات الكتالوج المقترحة</h3>
      <div className="grid two">
        <PreviewKeyList
          title="التصنيفات"
          empty="لا توجد تصنيفات في هذه المعاينة."
          rows={catalog.categories.map((item) => `${item.key} — ${item.nameAr}${item.parentKey ? ` — الأب: ${item.parentKey}` : ""}`)}
        />
        <PreviewKeyList
          title="المقاسات"
          empty="لا توجد مقاسات في هذه المعاينة."
          rows={catalog.sizes.map((item) => `${item.key} — ${item.nameAr}`)}
        />
        <PreviewKeyList
          title="الألوان"
          empty="لا توجد ألوان في هذه المعاينة."
          rows={catalog.colors.map((item) => `${item.key} — ${item.nameAr}`)}
        />
      </div>

      <h4>المنتجات</h4>
      {catalog.products.length === 0 ? <p className="empty">لا توجد منتجات في هذه المعاينة.</p> : (
        <div className="list-stack">
          {catalog.products.map((product) => (
            <article className="summary-card opening-import-row" data-testid="opening-import-product" key={product.key}>
              <div>
                <strong>{product.key} — {product.nameAr}</strong>
                <p>رمز المنتج: {product.code}</p>
                <p>{product.descriptionAr || "لا يوجد وصف."}</p>
              </div>
              <div>
                <p>التصنيف: {product.categoryKey}</p>
                <p>سعر البيع الافتراضي: {formatEgpFromPiasters(product.defaultSellingPricePiasters)}</p>
                <p>النشر: {publicationLabel(product.publication)}</p>
                <p>مراجع الصور: {product.imageRefs.length > 0 ? product.imageRefs.join("، ") : "لا توجد"}</p>
                <p>دليل المقاسات: {product.sizeGuideAr ?? "لا يوجد"}</p>
              </div>
            </article>
          ))}
        </div>
      )}

      <h4>متغيرات المنتجات</h4>
      {catalog.variants.length === 0 ? <p className="empty">لا توجد متغيرات في هذه المعاينة.</p> : (
        <div className="list-stack">
          {catalog.variants.map((variant) => (
            <article className="summary-card opening-import-row" data-testid="opening-import-variant" key={variant.key}>
              <div>
                <strong>{variant.key}</strong>
                <p>المنتج: {variant.productKey}</p>
              </div>
              <div>
                <p>المقاس: {variant.sizeKey}</p>
                <p>اللون: {variant.colorKey}</p>
                <p>
                  سعر البيع الخاص: {variant.sellingPricePiastersOverride === null
                    ? "يستخدم سعر المنتج الافتراضي"
                    : formatEgpFromPiasters(variant.sellingPricePiastersOverride)}
                </p>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function PreviewKeyList({ title, empty, rows }: { title: string; empty: string; rows: string[] }) {
  return (
    <div>
      <h4>{title}</h4>
      {rows.length === 0 ? <p className="empty">{empty}</p> : (
        <ul>{rows.map((row, index) => <li key={`${index}:${row}`}>{row}</li>)}</ul>
      )}
    </div>
  );
}

function ConfigurationDetails({ details }: { details: OpeningImportPreviewDto["configurationDetails"] }) {
  return (
    <section className="opening-import-section" data-testid="opening-import-configuration-details">
      <h3>التفاصيل الفعلية للإعدادات والعروض</h3>

      {details.inventoryDefaultThreshold !== null ? (
        <p>حد المخزون المنخفض الافتراضي: {details.inventoryDefaultThreshold}</p>
      ) : null}
      {details.variantThresholds.length > 0 ? (
        <div>
          <h4>حدود المخزون للمتغيرات</h4>
          <ul>
            {details.variantThresholds.map((item) => (
              <li key={item.key}>{item.key} — المتغير {item.variantKey}: {item.threshold}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid two">
        <PreviewKeyList
          title="فئات المصروفات"
          empty="لا توجد فئات مصروفات في هذه المعاينة."
          rows={details.expenseCategories.map((item) => `${item.key} — ${item.nameAr} — ${activeLabel(item.active)}`)}
        />
        <div>
          <h4>مناطق التوصيل</h4>
          {details.deliveryAreas.length === 0 ? <p className="empty">لا توجد مناطق توصيل في هذه المعاينة.</p> : (
            <ul>
              {details.deliveryAreas.map((item) => (
                <li key={item.key}>
                  {item.key} — {item.nameAr} — {formatEgpFromPiasters(item.feePiasters)} — {activeLabel(item.active)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {details.contacts ? (
        <div>
          <h4>روابط التواصل</h4>
          <ul>
            <li>واتساب: {details.contacts.whatsappUrl ?? "فارغ"}</li>
            <li>فيسبوك: {details.contacts.facebookUrl ?? "فارغ"}</li>
            <li>إنستجرام: {details.contacts.instagramUrl ?? "فارغ"}</li>
            <li>تيك توك: {details.contacts.tiktokUrl ?? "فارغ"}</li>
          </ul>
        </div>
      ) : null}

      {details.onlineOrderSettings ? (
        <div>
          <h4>سياسة الطلبات غير المجابة</h4>
          <p>مهلة الانتظار: {details.onlineOrderSettings.unreachableWaitHours} ساعة.</p>
          <p>الحد الأدنى لمحاولات التواصل: {details.onlineOrderSettings.minimumContactAttempts}.</p>
        </div>
      ) : null}

      <h4>العروض التلقائية</h4>
      {details.offers.length === 0 ? <p className="empty">لا توجد عروض تلقائية في هذه المعاينة.</p> : (
        <div className="list-stack">
          {details.offers.map((offer) => (
            <article className="summary-card opening-import-row" data-testid="opening-import-offer" key={offer.key}>
              <div>
                <strong>{offer.key} — {offer.nameAr}</strong>
                <p>{offerTypeLabel(offer.discountType)}</p>
                {offer.percentageBasisPoints !== null ? <p>خصم نسبي: {formatBasisPoints(offer.percentageBasisPoints)}</p> : null}
                {offer.fixedDiscountPiasters !== null ? <p>خصم ثابت: {formatEgpFromPiasters(offer.fixedDiscountPiasters)}</p> : null}
                {offer.bundlePricePiasters !== null ? <p>سعر الحزمة: {formatEgpFromPiasters(offer.bundlePricePiasters)}</p> : null}
                {offer.buyQuantity !== null && offer.rewardQuantity !== null ? (
                  <p>اشتر {offer.buyQuantity} واحصل على {offer.rewardQuantity}</p>
                ) : null}
                {offer.rewardPercentageBasisPoints !== null ? (
                  <p>خصم المكافأة: {formatBasisPoints(offer.rewardPercentageBasisPoints)}</p>
                ) : null}
              </div>
              <div>
                <p>الفترة: {offer.startsOn} إلى {offer.endsOn}</p>
                <p>{activeLabel(offer.active)}</p>
                <p>{offer.allowCoupon ? "يسمح بإضافة كوبون" : "لا يسمح بإضافة كوبون"}</p>
                {offer.discountType === "percentage" || offer.discountType === "fixed" ? (
                  <>
                    <Scope label="المنتجات" values={offer.productKeys} />
                    <Scope label="التصنيفات" values={offer.categoryKeys} />
                  </>
                ) : null}
                {offer.discountType === "buy_x_get_y" ? (
                  <>
                    <Scope label="منتجات الشراء" values={offer.buyProductKeys} />
                    <Scope label="تصنيفات الشراء" values={offer.buyCategoryKeys} />
                    <Scope label="منتجات المكافأة" values={offer.rewardProductKeys} />
                    <Scope label="تصنيفات المكافأة" values={offer.rewardCategoryKeys} />
                  </>
                ) : null}
                {offer.bundleItems.length > 0 ? (
                  <div>
                    <p>محتويات الحزمة:</p>
                    <ul>
                      {offer.bundleItems.map((item, index) => (
                        <li key={`${item.variantKey}:${index}`}>{item.variantKey} × {item.requiredQuantity}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}

      <h4>الكوبونات</h4>
      {details.coupons.length === 0 ? <p className="empty">لا توجد كوبونات في هذه المعاينة.</p> : (
        <div className="list-stack">
          {details.coupons.map((coupon) => (
            <article className="summary-card opening-import-row" data-testid="opening-import-coupon" key={coupon.key}>
              <div>
                <strong>{coupon.key} — {coupon.code}</strong>
                {coupon.percentageBasisPoints !== null ? <p>خصم نسبي: {formatBasisPoints(coupon.percentageBasisPoints)}</p> : null}
                {coupon.fixedDiscountPiasters !== null ? <p>خصم ثابت: {formatEgpFromPiasters(coupon.fixedDiscountPiasters)}</p> : null}
                <p>حد الاستخدام: {coupon.usageLimit}</p>
              </div>
              <div>
                <p>الفترة: {coupon.startsOn} إلى {coupon.endsOn}</p>
                <p>{activeLabel(coupon.active)}</p>
                <p>{coupon.allowAutomaticOffer ? "يسمح بالجمع مع عرض تلقائي" : "لا يسمح بالجمع مع عرض تلقائي"}</p>
                <Scope label="المنتجات" values={coupon.productKeys} />
                <Scope label="التصنيفات" values={coupon.categoryKeys} />
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function Scope({ label, values }: { label: string; values: string[] }) {
  return <p>{label}: {values.length > 0 ? values.join("، ") : "الكل"}</p>;
}

function Count({ label, value }: { label: string; value: number }) {
  return <div className="opening-import-count"><span>{label}:</span> <strong>{value}</strong></div>;
}

function previewStatus(status: OpeningImportPreviewDto["status"]) {
  if (status === "accepted") return "تم قبول بيانات البداية";
  if (status === "ready") return "المعاينة جاهزة للقبول";
  return "تحتاج الملفات إلى تصحيح";
}

function publicationLabel(publication: OpeningImportPreviewDto["catalog"]["products"][number]["publication"]) {
  if (publication === "available") return "متاح";
  if (publication === "coming_soon") return "قريباً";
  return "مخفي";
}

function offerTypeLabel(type: OpeningImportPreviewDto["configurationDetails"]["offers"][number]["discountType"]) {
  if (type === "percentage") return "خصم نسبي";
  if (type === "fixed") return "خصم ثابت";
  if (type === "fixed_bundle") return "حزمة بسعر ثابت";
  return "اشتر واحصل على مكافأة";
}

function activeLabel(active: boolean) {
  return active ? "مفعّل" : "غير مفعّل";
}

function formatBasisPoints(basisPoints: number) {
  const percentage = basisPoints / 100;
  return `${Number.isInteger(percentage) ? String(percentage) : percentage.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

function fileLabel(error: OpeningImportLineErrorDto) {
  if (error.file === "catalog.csv") return "ملف الكتالوج (catalog.csv)";
  if (error.file === "opening-stock.csv") return "ملف المخزون الافتتاحي (opening-stock.csv)";
  return "ملف الإعدادات (configuration.csv)";
}

function message(caught: unknown, fallback: string) {
  if (caught instanceof ApiError) return caught.messageAr;
  return fallback;
}
