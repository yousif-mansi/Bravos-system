import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  BACKUP_SECTION_NAMES,
  type BackupSectionName,
  type RestoreDeferredSaleDto,
  type RestorePreviewDto,
  type WorkspaceDto,
} from "@bravos/contracts";
import { accountGeneration } from "../account-session.ts";
import { EmptyState } from "../ui/EmptyState.tsx";
import { PageLoading } from "../ui/PageLoading.tsx";
import { ApiError } from "../api.ts";
import {
  acknowledgePreRestoreBackup,
  activateRestorePreview,
  cancelRestorePreview,
  createRestorePreview,
  downloadPreRestoreBackup,
  getRestorePreview,
  getRestoreState,
  listRestoreDeferredSales,
  listRestorePreviews,
  recoverRestoreDeferredSale,
} from "../restore-api.ts";
import {
  assignRestoreActivation,
  adoptActiveRestorePreview,
  attachRestorePreview,
  beginRestoreAttempt,
  clearPendingRestore,
  readPendingRestore,
  restorePendingStorageKey,
  withRestoreLock,
  type PendingRestore,
} from "../restore-pending.ts";
import { invalidateOfflineSession } from "../session.ts";

const SECTION_LABELS: Record<BackupSectionName, string> = {
  identity: "الحسابات والصلاحيات",
  catalog: "المنتجات والتصنيفات",
  inventory: "المخزون والدفعات والتخصيصات",
  receiving: "استلام المخزون",
  sales: "المبيعات النقدية",
  expenses: "المصروفات",
  pricing: "العروض والكوبونات",
  returns: "المرتجعات والاستبدالات",
  corrections: "التصحيحات والمراجعات",
  online_orders: "الطلبات الأونلاين",
  storefront_configuration: "إعدادات المتجر",
  opening_import: "استيراد بيانات البداية",
  analytics: "التحليلات المجمعة",
};

export default function RestorePage({
  workspace,
  onChanged,
}: {
  workspace: WorkspaceDto;
  onChanged: (workspace: WorkspaceDto | null) => Promise<void> | void;
}) {
  const navigate = useNavigate();
  const [previews, setPreviews] = useState<RestorePreviewDto[]>([]);
  const [selected, setSelected] = useState<RestorePreviewDto | null>(null);
  const [deferred, setDeferred] = useState<RestoreDeferredSaleDto[]>([]);
  const [currentGeneration, setCurrentGeneration] = useState(0);
  const [activePreviewId, setActivePreviewId] = useState<string | null>(null);
  const [marker, setMarker] = useState<PendingRestore | null>(null);
  const [archive, setArchive] = useState<File | null>(null);
  const [archivePassword, setArchivePassword] = useState("");
  const [checkpointPassword, setCheckpointPassword] = useState("");
  const [checkpointConfirmation, setCheckpointConfirmation] = useState("");
  const [downloadedSha256, setDownloadedSha256] = useState<string | null>(null);
  const [confirmationFingerprint, setConfirmationFingerprint] = useState("");
  const [confirmedConsequences, setConfirmedConsequences] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const lifecycle = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const selectedIdRef = useRef<string | null>(null);

  useEffect(() => {
    selectedIdRef.current = selected?.id ?? null;
  }, [selected?.id]);

  useEffect(() => {
    const staffId = workspace.staff.id;
    const epoch = accountGeneration();
    const token = ++lifecycle.current;
    let cancelled = false;
    const stillCurrent = () => !cancelled
      && lifecycle.current === token
      && accountGeneration() === epoch
      && workspace.staff.id === staffId;

    async function refresh(selectId?: string | null) {
      const controller = new AbortController();
      controllerRef.current?.abort();
      controllerRef.current = controller;
      try {
        const [state, nextPreviews, nextDeferred] = await Promise.all([
          getRestoreState(controller.signal),
          listRestorePreviews(controller.signal),
          listRestoreDeferredSales(controller.signal),
        ]);
        if (!stillCurrent()) return;
        const stored = readPendingRestore(staffId);
        const recovered = stored
          ? nextPreviews.find((preview) => preview.id === stored.previewId || preview.operationId === stored.operationId) ?? null
          : null;
        const active = (state.pause
          ? nextPreviews.find((preview) => preview.id === state.pause?.previewId) ?? null
          : null) ?? nextPreviews.find((preview) => ["staged", "paused", "ready"].includes(preview.status)) ?? null;
        let nextMarker = stored;
        if (active) {
          nextMarker = adoptActiveRestorePreview(staffId, {
            operationId: active.operationId,
            previewId: active.id,
            previewFingerprint: active.previewFingerprint,
          });
        } else if (recovered) {
          nextMarker = attachRestorePreview(staffId, {
            operationId: recovered.operationId,
            previewId: recovered.id,
            previewFingerprint: recovered.previewFingerprint,
          });
          if (recovered.status === "cancelled" || recovered.status === "activated") {
            clearPendingRestore(staffId, recovered.operationId);
            nextMarker = null;
          }
        }
        const preferredId = selectId ?? active?.id ?? recovered?.id ?? selectedIdRef.current;
        setCurrentGeneration(state.currentGeneration);
        setActivePreviewId(active?.id ?? null);
        setPreviews(nextPreviews);
        setDeferred(nextDeferred);
        setMarker(nextMarker);
        setSelected(nextPreviews.find((preview) => preview.id === preferredId) ?? nextPreviews[0] ?? null);
      } catch (caught) {
        if (stillCurrent() && !(caught instanceof DOMException && caught.name === "AbortError")) {
          if (caught instanceof ApiError && caught.status === 401) {
            await returnToLogin(staffId);
            return;
          }
          setError(message(caught, "تعذر تحميل حالة الاستعادة."));
        }
      } finally {
        if (stillCurrent()) setLoading(false);
      }
    }

    function onStorage(event: StorageEvent) {
      if (event.key === restorePendingStorageKey(staffId)) void refresh();
    }

    setLoading(true);
    setError("");
    setNotice("");
    window.addEventListener("storage", onStorage);
    void refresh();
    const interval = window.setInterval(() => void refresh(selectedIdRef.current), 5_000);
    return () => {
      cancelled = true;
      lifecycle.current += 1;
      controllerRef.current?.abort();
      window.clearInterval(interval);
      window.removeEventListener("storage", onStorage);
    };
  }, [workspace.staff.id]);

  function stillCurrent(staffId: string, epoch: number, token: number) {
    return workspace.staff.id === staffId && accountGeneration() === epoch && lifecycle.current === token;
  }

  async function refresh(previewId?: string | null) {
    const staffId = workspace.staff.id;
    const epoch = accountGeneration();
    const token = lifecycle.current;
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    try {
      const [state, nextPreviews, nextDeferred] = await Promise.all([
        getRestoreState(controller.signal),
        listRestorePreviews(controller.signal),
        listRestoreDeferredSales(controller.signal),
      ]);
      if (!stillCurrent(staffId, epoch, token)) return;
      const currentMarker = readPendingRestore(staffId);
      const recovered = currentMarker
        ? nextPreviews.find((preview) => preview.id === currentMarker.previewId || preview.operationId === currentMarker.operationId)
        : null;
      const active = (state.pause
        ? nextPreviews.find((preview) => preview.id === state.pause?.previewId) ?? null
        : null) ?? nextPreviews.find((preview) => ["staged", "paused", "ready"].includes(preview.status)) ?? null;
      const nextSelected = nextPreviews.find((preview) => preview.id === (
        previewId ?? active?.id ?? recovered?.id ?? selectedIdRef.current
      ))
        ?? nextPreviews[0]
        ?? null;
      if (active) {
        const attached = adoptActiveRestorePreview(staffId, {
          operationId: active.operationId,
          previewId: active.id,
          previewFingerprint: active.previewFingerprint,
        });
        setMarker(attached);
      } else if (recovered) {
        const attached = attachRestorePreview(staffId, {
          operationId: recovered.operationId,
          previewId: recovered.id,
          previewFingerprint: recovered.previewFingerprint,
        });
        setMarker(attached);
      } else {
        setMarker(currentMarker);
      }
      setCurrentGeneration(state.currentGeneration);
      setActivePreviewId(active?.id ?? null);
      setPreviews(nextPreviews);
      setDeferred(nextDeferred);
      setSelected(nextSelected);
    } catch (caught) {
      if (stillCurrent(staffId, epoch, token) && !(caught instanceof DOMException && caught.name === "AbortError")) {
        if (caught instanceof ApiError && caught.status === 401) {
          await returnToLogin(staffId);
          return;
        }
        setError(message(caught, "تعذر تحديث حالة الاستعادة."));
      }
    }
  }

  async function stage(event: FormEvent) {
    event.preventDefault();
    if (busy || !archive) return;
    if (!archive.name.toLowerCase().endsWith(".bravos-backup")) {
      setError("اختر ملف نسخة BRAVOS بامتداد .bravos-backup.");
      return;
    }
    if (![archivePassword, checkpointPassword].every(validPassword)) {
      setError("يجب أن تكون كل كلمة حماية من 12 إلى 128 حرفاً.");
      return;
    }
    if (checkpointPassword !== checkpointConfirmation) {
      setError("تأكيد كلمة حماية نسخة ما قبل الاستعادة غير مطابق.");
      return;
    }
    const staffId = workspace.staff.id;
    const epoch = accountGeneration();
    const token = lifecycle.current;
    setBusy("stage");
    setError("");
    setNotice("");
    try {
      await withRestoreLock(staffId, async () => {
        if (!stillCurrent(staffId, epoch, token)) return;
        const pending = beginRestoreAttempt(staffId);
        setMarker(pending);
        const existing = (await listRestorePreviews()).find((preview) => preview.operationId === pending.operationId);
        if (existing) {
          const attached = attachRestorePreview(staffId, {
            operationId: existing.operationId,
            previewId: existing.id,
            previewFingerprint: existing.previewFingerprint,
          });
          if (stillCurrent(staffId, epoch, token)) {
            setMarker(attached);
            setSelected(existing);
            setNotice("تم العثور على معاينة العملية السابقة دون إنشاء عملية مكررة.");
          }
          return;
        }
        const archiveBase64 = await fileBase64(archive);
        if (!stillCurrent(staffId, epoch, token)) return;
        const created = await createRestorePreview({
          operationId: pending.operationId,
          archiveBase64,
          archivePassword,
          preRestoreBackupPassword: checkpointPassword,
        });
        if (!stillCurrent(staffId, epoch, token)) return;
        const attached = attachRestorePreview(staffId, {
          operationId: created.operationId,
          previewId: created.id,
          previewFingerprint: created.previewFingerprint,
        });
        setMarker(attached);
        setSelected(created);
        setDownloadedSha256(null);
        setNotice("تم فك النسخة والتحقق منها في قاعدة معزولة. راجع الفروق والأجهزة قبل التفعيل.");
        await refresh(created.id);
      });
    } catch (caught) {
      if (stillCurrent(staffId, epoch, token)) {
        if (caught instanceof ApiError && caught.status === 401) {
          await returnToLogin(staffId);
          return;
        }
        const pending = readPendingRestore(staffId);
        let recovered: RestorePreviewDto | null = null;
        if (pending) {
          try {
            recovered = (await listRestorePreviews()).find((preview) => preview.operationId === pending.operationId) ?? null;
          } catch {
            /* keep the operation identity for the next explicit retry */
          }
        }
        if (recovered) {
          setSelected(recovered);
          setMarker(attachRestorePreview(staffId, {
            operationId: recovered.operationId,
            previewId: recovered.id,
            previewFingerprint: recovered.previewFingerprint,
          }));
          setNotice("تمت مطابقة النتيجة مع معاينة موجودة؛ لم تُنشأ عملية أخرى.");
        } else {
          setError(caught instanceof ApiError && caught.status < 500
            ? caught.messageAr
            : "نتيجة إنشاء المعاينة غير مؤكدة. بقي معرّف العملية محفوظاً فقط؛ أعد المحاولة بالملف نفسه وكلمات الحماية نفسها.");
        }
      }
    } finally {
      if (stillCurrent(staffId, epoch, token)) {
        setArchivePassword("");
        setCheckpointPassword("");
        setCheckpointConfirmation("");
        setBusy("");
      }
    }
  }

  async function downloadCheckpoint() {
    if (!selected?.preRestoreArchiveSha256 || busy) return;
    const staffId = workspace.staff.id;
    const epoch = accountGeneration();
    const token = lifecycle.current;
    setBusy("download");
    setError("");
    try {
      const downloaded = await downloadPreRestoreBackup(selected.id, selected.preRestoreArchiveSha256);
      if (!stillCurrent(staffId, epoch, token)) return;
      const url = URL.createObjectURL(downloaded.archive);
      try {
        const link = document.createElement("a");
        link.href = url;
        link.download = downloaded.fileName;
        link.click();
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
      }
      setDownloadedSha256(downloaded.archiveSha256);
      setNotice("تم التحقق من نسخة ما قبل الاستعادة وبدأ تنزيلها. أكد حفظ الملف صراحةً بعد اكتمال التنزيل.");
    } catch (caught) {
      if (stillCurrent(staffId, epoch, token)) {
        if (caught instanceof ApiError && caught.status === 401) {
          await returnToLogin(staffId);
          return;
        }
        setError(message(caught, "تعذر تنزيل نسخة ما قبل الاستعادة."));
      }
    } finally {
      if (stillCurrent(staffId, epoch, token)) setBusy("");
    }
  }

  async function acknowledgeCheckpoint() {
    if (!selected?.preRestoreArchiveSha256 || downloadedSha256 !== selected.preRestoreArchiveSha256 || busy) return;
    await mutatePreview("checkpoint", async () => acknowledgePreRestoreBackup(selected.id, {
      archiveSha256: downloadedSha256,
    }), "تم تسجيل إقرار حفظ نسخة ما قبل الاستعادة.");
  }

  async function cancel() {
    if (!selected || busy) return;
    const operationId = selected.operationId;
    const cancelled = await mutatePreview(
      "cancel",
      () => cancelRestorePreview(selected.id),
      "أُلغيت المعاينة وعاد العمل المعتاد.",
    );
    if (!cancelled) return;
    clearPendingRestore(workspace.staff.id, operationId);
    setMarker(null);
  }

  async function activate() {
    if (!selected?.previewFingerprint || selected.status !== "ready" || busy) return;
    if (!confirmedConsequences || confirmationFingerprint.trim().toLowerCase() !== selected.previewFingerprint) {
      setError("اكتب بصمة المعاينة كاملة ووافق على أثر التفعيل قبل المتابعة.");
      return;
    }
    const staffId = workspace.staff.id;
    const epoch = accountGeneration();
    const token = lifecycle.current;
    setBusy("activate");
    setError("");
    setNotice("");
    try {
      await withRestoreLock(staffId, async () => {
        let current = readPendingRestore(staffId);
        if (!current || current.previewId !== selected.id) {
          current = adoptActiveRestorePreview(staffId, {
            operationId: selected.operationId,
            previewId: selected.id,
            previewFingerprint: selected.previewFingerprint,
          });
        }
        const activation = assignRestoreActivation(staffId, selected.id, selected.previewFingerprint!);
        if (!activation?.activationOperationId) throw new Error("missing-activation-operation");
        setMarker(activation);
        const latest = await getRestorePreview(selected.id);
        if (latest.status === "activated") {
          await returnToLogin(staffId);
          return;
        }
        if (latest.status !== "ready" || latest.previewFingerprint !== selected.previewFingerprint) {
          setSelected(latest);
          throw new ApiError(409, "RESTORE_STALE", "تغيرت المعاينة. راجعها من جديد قبل التفعيل.");
        }
        await activateRestorePreview(selected.id, {
          operationId: activation.activationOperationId,
          previewFingerprint: selected.previewFingerprint!,
        });
        if (!stillCurrent(staffId, epoch, token)) return;
        clearPendingRestore(staffId, selected.operationId);
        await returnToLogin(staffId);
      });
    } catch (caught) {
      if (!stillCurrent(staffId, epoch, token)) return;
      if (caught instanceof ApiError && caught.status === 401) {
        await returnToLogin(staffId);
        return;
      }
      try {
        const latest = await getRestorePreview(selected.id);
        if (latest.status === "activated") {
          clearPendingRestore(staffId, selected.operationId);
          await returnToLogin(staffId);
          return;
        }
        setSelected(latest);
      } catch (reconciliationError) {
        if (reconciliationError instanceof ApiError && reconciliationError.status === 401) {
          await returnToLogin(staffId);
          return;
        }
        /* keep durable activation identity until login/reload can reconcile it */
      }
      setError(caught instanceof ApiError && caught.status < 500
        ? caught.messageAr
        : "نتيجة التفعيل غير مؤكدة. لم نفقد معرّف العملية؛ سجّل الدخول مجدداً وتحقق قبل أي محاولة أخرى.");
    } finally {
      if (stillCurrent(staffId, epoch, token)) setBusy("");
    }
  }

  async function recoverDeferred(sale: RestoreDeferredSaleDto) {
    if (busy || activePreviewId || sale.status !== "pending") return;
    const staffId = workspace.staff.id;
    const epoch = accountGeneration();
    const token = lifecycle.current;
    setBusy(`recover:${sale.operationId}`);
    setError("");
    try {
      const recovered = await recoverRestoreDeferredSale(sale);
      if (!stillCurrent(staffId, epoch, token)) return;
      if (recovered.operationId !== sale.operationId || recovered.id !== sale.saleId) {
        throw new Error("mismatched-sale");
      }
      setNotice("تمت استعادة البيع المتأخر مرة واحدة مع الاحتفاظ بصاحبه وفرعه الأصليين.");
      await refresh(selected?.id);
    } catch (caught) {
      if (stillCurrent(staffId, epoch, token)) {
        if (caught instanceof ApiError && caught.status === 401) {
          await returnToLogin(staffId);
          return;
        }
        setError(message(caught, "تعذر استعادة البيع المتأخر. بقي محفوظاً للمراجعة."));
      }
    } finally {
      if (stillCurrent(staffId, epoch, token)) setBusy("");
    }
  }

  async function mutatePreview(kind: string, action: () => Promise<RestorePreviewDto>, success: string) {
    const staffId = workspace.staff.id;
    const epoch = accountGeneration();
    const token = lifecycle.current;
    setBusy(kind);
    setError("");
    setNotice("");
    try {
      const next = await action();
      if (!stillCurrent(staffId, epoch, token)) return;
      setSelected(next);
      setNotice(success);
      await refresh(next.id);
      return true;
    } catch (caught) {
      if (stillCurrent(staffId, epoch, token)) {
        if (caught instanceof ApiError && caught.status === 401) {
          await returnToLogin(staffId);
          return false;
        }
        setError(message(caught, "تعذر إكمال العملية."));
      }
      return false;
    } finally {
      if (stillCurrent(staffId, epoch, token)) setBusy("");
    }
  }

  async function returnToLogin(staffId: string) {
    await invalidateOfflineSession(staffId);
    await onChanged(null);
    navigate("/login", { replace: true });
  }

  function startNewAttempt() {
    if (busy || activePreviewId) return;
    if (marker) clearPendingRestore(workspace.staff.id, marker.operationId);
    setMarker(null);
    setSelected(null);
    setArchive(null);
    setDownloadedSha256(null);
    setConfirmationFingerprint("");
    setConfirmedConsequences(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setError("");
    setNotice("");
  }

  if (loading && previews.length === 0) {
    return <PageLoading />;
  }

  const pendingDeferred = deferred.filter((sale) => sale.status === "pending");
  return (
    <main className="shell restore-page">
      <header className="page-hero">
        <h1>استعادة نسخة البيانات</h1>
      </header>

      {error ? <div className="error" role="alert">{error}</div> : null}
      {notice ? <div className="notice" role="status">{notice}</div> : null}

      <section className="card restore-warning" aria-labelledby="restore-warning-title">
        <h2 id="restore-warning-title">الاستعادة لا تستبدل النشاط الأحدث بصمت</h2>
        <p>تُفك النسخة وتُراجع في قاعدة معزولة، ثم يتوقف العمل المتصل مؤقتاً حتى تُزامن أجهزة البيع المعروفة وتؤكد توقفها.</p>
        <p>قبل التفعيل يجب تنزيل نسخة مشفرة من البيانات الحالية والتحقق منها والإقرار بحفظها. التفعيل يلغي الجلسات ويطلب تسجيل الدخول من جديد.</p>
      </section>

      {!activePreviewId && (!selected || ["cancelled", "activated"].includes(selected.status)) ? (
        <form className="card restore-upload" aria-label="إنشاء معاينة استعادة" onSubmit={(event) => void stage(event)}>
          <h2>رفع نسخة للمراجعة</h2>
          {marker && !marker.previewId ? (
            <p className="restore-operation-warning" role="status">
              توجد محاولة لم تُحسم بعد. سيُعاد استخدام معرّف العملية نفسه لمنع التكرار.
            </p>
          ) : null}
          <div className="field">
            <label htmlFor="restore-archive">ملف النسخة المشفرة</label>
            <input
              ref={fileInputRef}
              id="restore-archive"
              type="file"
              accept=".bravos-backup,application/vnd.bravos.backup"
              onChange={(event) => setArchive(event.currentTarget.files?.[0] ?? null)}
            />
          </div>
          <div className="field">
            <label htmlFor="restore-archive-password">كلمة حماية النسخة المرفوعة</label>
            <input id="restore-archive-password" type="password" autoComplete="off" value={archivePassword} onChange={(event) => setArchivePassword(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="restore-checkpoint-password">كلمة حماية نسخة البيانات الحالية</label>
            <input id="restore-checkpoint-password" type="password" autoComplete="new-password" value={checkpointPassword} onChange={(event) => setCheckpointPassword(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="restore-checkpoint-confirmation">تأكيد كلمة حماية نسخة البيانات الحالية</label>
            <input id="restore-checkpoint-confirmation" type="password" autoComplete="new-password" value={checkpointConfirmation} onChange={(event) => setCheckpointConfirmation(event.target.value)} />
          </div>
          <button type="submit" disabled={Boolean(busy) || !archive}>فك النسخة وإنشاء المعاينة</button>
        </form>
      ) : null}

      {selected ? (
        <RestorePreview
          preview={selected}
          busy={Boolean(busy)}
          downloadedSha256={downloadedSha256}
          confirmationFingerprint={confirmationFingerprint}
          confirmedConsequences={confirmedConsequences}
          onDownload={() => void downloadCheckpoint()}
          onAcknowledge={() => void acknowledgeCheckpoint()}
          onCancel={() => void cancel()}
          onActivate={() => void activate()}
          onFingerprint={setConfirmationFingerprint}
          onConfirmed={setConfirmedConsequences}
          onRefresh={() => void refresh(selected.id)}
        />
      ) : null}

      {!activePreviewId && selected && ["cancelled", "activated"].includes(selected.status) ? (
        <button className="secondary" type="button" onClick={startNewAttempt}>بدء معاينة استعادة جديدة</button>
      ) : null}

      <section className="card" aria-labelledby="restore-deferred-title">
        <h2 id="restore-deferred-title">مبيعات مكتملة وصلت من جيل سابق</h2>
        <p className="muted">هذه مبيعات دُفعت وسُلّمت فعلياً. تبقى محفوظة حتى يستعيدها المدير مرة واحدة.</p>
        {pendingDeferred.length === 0 ? <EmptyState title="مفيش مبيعات متأخرة" message="لو في بيع اتأخر عن الاستعادة هيظهر هنا." /> : (
          <div className="restore-deferred-list">
            {pendingDeferred.map((sale) => (
              <article className="restore-deferred-sale" key={sale.operationId}>
                <strong>بيع <bdi>{sale.saleId}</bdi></strong>
                <span>الجيل {sale.sourceGeneration} ← {sale.currentGeneration}</span>
                <span>وقت البيع: {formatDate(sale.occurredAt)}</span>
                <button type="button" disabled={Boolean(busy) || Boolean(activePreviewId)} onClick={() => void recoverDeferred(sale)}>
                  {activePreviewId ? "متاح بعد تفعيل الاستعادة" : "استعادة البيع مرة واحدة"}
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      {previews.length > 0 ? (
        <section className="card" aria-labelledby="restore-history-title">
          <h2 id="restore-history-title">سجل المعاينات</h2>
          <div className="restore-history">
            {previews.map((preview) => (
              <button className="restore-history-item" type="button" key={preview.id} onClick={() => setSelected(preview)}>
                <span>{statusLabel(preview.status)}</span>
                <bdi>{preview.backupId}</bdi>
                <span>{formatDate(preview.createdAt)}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}

function RestorePreview(props: {
  preview: RestorePreviewDto;
  busy: boolean;
  downloadedSha256: string | null;
  confirmationFingerprint: string;
  confirmedConsequences: boolean;
  onDownload: () => void;
  onAcknowledge: () => void;
  onCancel: () => void;
  onActivate: () => void;
  onFingerprint: (value: string) => void;
  onConfirmed: (value: boolean) => void;
  onRefresh: () => void;
}) {
  const { preview } = props;
  const active = preview.status === "staged" || preview.status === "paused" || preview.status === "ready";
  return (
    <section className="card restore-preview" aria-label="تفاصيل معاينة الاستعادة">
      <div className="restore-preview-heading">
        <div><h2>معاينة النسخة</h2><p className="muted">الحالة: {statusLabel(preview.status)}</p></div>
        <button className="secondary" type="button" disabled={props.busy} onClick={props.onRefresh}>تحديث الحالة</button>
      </div>
      <dl className="restore-metadata">
        <div><dt>معرّف النسخة</dt><dd><bdi>{preview.backupId}</bdi></dd></div>
        <div><dt>إجمالي السجلات</dt><dd>{preview.totalRecordCount}</dd></div>
        <div><dt>جيل المصدر</dt><dd>{preview.sourceGeneration ?? "غير مسجل"}</dd></div>
        <div><dt>الجيل المتوقع</dt><dd>{preview.expectedGeneration}</dd></div>
      </dl>

      <div className="notice" data-testid="restore-validation-summary">
        <strong>اكتمل تحقق الروابط وأعداد السجلات</strong>
        <p>حمّل الخادم النسخة في قاعدة معزولة وتحقق من روابط السجلات وتطابق مبالغ وحدات البيع مع أسطرها، ثم دمج النشاط الأحدث دون استبدال أي سجل تغيّر.</p>
        <p>
          سجلات النسخة: {preview.totalRecordCount} — السجلات الحالية المقارنة: {
            preview.differences.reduce((total, row) => total + row.liveRecordCount, 0)
          }
        </p>
      </div>

      <h3>الفروق بعد دمج النشاط الأحدث</h3>
      <div className="restore-differences" data-testid="restore-differences">
        {BACKUP_SECTION_NAMES.map((section) => {
          const row = preview.differences.find((difference) => difference.section === section);
          return (
            <div className="restore-difference" key={section}>
              <strong>{SECTION_LABELS[section]}</strong>
              <span>النسخة: {row?.archivedRecordCount ?? 0}</span>
              <span>الحالي: {row?.liveRecordCount ?? 0}</span>
              <span>بعد التفعيل: {row?.restoredRecordCount ?? 0}</span>
              <span>من النسخة فقط: {row?.archiveOnlyRecordCount ?? 0}</span>
              <span>أحدث من النسخة: {row?.liveOnlyRecordCount ?? 0}</span>
              <span className={row?.conflictingRecordCount ? "error" : undefined}>قيم مختلفة لنفس السجل: {row?.conflictingRecordCount ?? 0}</span>
            </div>
          );
        })}
      </div>

      <h3>أجهزة نقاط البيع المعروفة</h3>
      {preview.devices.length === 0 ? <p className="notice">لا توجد أجهزة بيع معروفة تحتاج إلى إقرار.</p> : (
        <div className="restore-devices" data-testid="restore-devices">
          {preview.devices.map((device) => (
            <article className={device.acknowledgedAt ? "restore-device acknowledged" : "restore-device"} key={device.deviceId}>
              <strong><bdi>{device.deviceId}</bdi></strong>
              <span>العمليات غير المثبتة: {device.pendingOperationIds.length}</span>
              <span>عمليات محفوظة لدى الخادم: {device.custodiedOperationIds.length}</span>
              <span>{device.synchronizationComplete ? "اكتملت المزامنة" : "المزامنة غير مكتملة"}</span>
              <span>{device.acknowledgedAt ? `أُقر التوقف: ${formatDate(device.acknowledgedAt)}` : "بانتظار إقرار الجهاز"}</span>
            </article>
          ))}
        </div>
      )}

      {preview.blockingReasons.length > 0 ? (
        <div className="error" data-testid="restore-blockers">
          <strong>موانع التفعيل</strong>
          <ul>{preview.blockingReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        </div>
      ) : null}

      {active && preview.preRestoreArchiveSha256 ? (
        <div className="restore-checkpoint">
          <h3>نسخة ما قبل الاستعادة</h3>
          <p>البصمة المتوقعة: <bdi>{preview.preRestoreArchiveSha256}</bdi></p>
          <div className="actions">
            <button type="button" disabled={props.busy} onClick={props.onDownload}>تحقق ونزّل نسخة البيانات الحالية</button>
            {!preview.preRestoreDownloadAcknowledgedAt ? (
              <button
                className="secondary"
                type="button"
                disabled={props.busy || props.downloadedSha256 !== preview.preRestoreArchiveSha256}
                onClick={props.onAcknowledge}
              >
                أؤكد حفظ الملف المتحقق منه
              </button>
            ) : <span className="notice">تم الإقرار بالحفظ في {formatDate(preview.preRestoreDownloadAcknowledgedAt)}</span>}
          </div>
        </div>
      ) : null}

      {preview.status === "ready" && preview.previewFingerprint ? (
        <div className="restore-activation">
          <h3>التفعيل النهائي</h3>
          <p>انسخ بصمة المعاينة التالية كاملة: <bdi data-testid="restore-fingerprint">{preview.previewFingerprint}</bdi></p>
          <div className="field">
            <label htmlFor="restore-confirm-fingerprint">تأكيد بصمة المعاينة</label>
            <input id="restore-confirm-fingerprint" value={props.confirmationFingerprint} onChange={(event) => props.onFingerprint(event.target.value)} autoComplete="off" />
          </div>
          <label className="checkbox-row" htmlFor="restore-confirm-consequences">
            <input id="restore-confirm-consequences" type="checkbox" checked={props.confirmedConsequences} onChange={(event) => props.onConfirmed(event.target.checked)} />
            أفهم أن التفعيل سيرفع جيل البيانات ويلغي كل الجلسات، وسأعيد تسجيل الدخول.
          </label>
          <button className="danger" type="button" disabled={props.busy} onClick={props.onActivate}>تفعيل هذه البصمة فقط</button>
        </div>
      ) : null}

      {active ? <button className="secondary" type="button" disabled={props.busy} onClick={props.onCancel}>إلغاء المعاينة واستئناف العمل</button> : null}
    </section>
  );
}

function validPassword(value: string) {
  const length = [...value].length;
  return length >= 12 && length <= 128;
}

function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("file-read"));
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      const comma = value.indexOf(",");
      if (comma < 0) reject(new Error("file-read"));
      else resolve(value.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Cairo",
  }).format(new Date(value));
}

function statusLabel(status: RestorePreviewDto["status"]) {
  return ({ staged: "قيد التجهيز", paused: "متوقفة للمراجعة", ready: "جاهزة للتفعيل", activated: "مفعلة", cancelled: "ملغاة" })[status];
}

function message(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.messageAr : fallback;
}
