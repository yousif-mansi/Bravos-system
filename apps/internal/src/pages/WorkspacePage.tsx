import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { PosPriceSnapshotDto, WorkspaceDto } from "@bravos/contracts";
import { accountGeneration } from "../account-session.ts";
import {
  acceptOfflineSale,
  acknowledgeCountCoordination,
  ApiError,
  completeSale,
  getStockPause,
  getWorkspace,
  issuePosSnapshot,
  recoverOfflineSale,
} from "../api.ts";
import { posCodeIsCached } from "../offline-ready.ts";
import { acknowledgeRestoreDevice, getRestorePause } from "../restore-api.ts";
import {
  acceptedPayload,
  cacheIssuedSnapshot,
  completedPayload,
  POS_SCHEMA_VERSION,
  pos,
  readPosReadiness,
  recoverPreservedQueues,
  recoveryPayload,
  retryUnsyncedSales,
} from "../pos.ts";
import { signOutPreservingSales } from "../session.ts";

export function WorkspacePage({
  workspace,
  onChanged,
}: {
  workspace: WorkspaceDto;
  onChanged: (workspace: WorkspaceDto | null) => void;
}) {
  const navigate = useNavigate();
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [ready, setReady] = useState(false);
  const [unsynced, setUnsynced] = useState(0);
  const [otherPending, setOtherPending] = useState(0);
  const [syncStatus, setSyncStatus] = useState("");
  const [syncError, setSyncError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [persistent, setPersistent] = useState<boolean | null>(null);
  const [updateDeferred, setUpdateDeferred] = useState(false);
  const [pauseSnapshot, setPauseSnapshot] = useState<PosPriceSnapshotDto | null>(null);
  const [pauseAcknowledged, setPauseAcknowledged] = useState(false);
  const [observedPause, setObservedPause] = useState<PosPriceSnapshotDto["stockPause"]>(null);
  const [restorePauseSnapshot, setRestorePauseSnapshot] = useState<PosPriceSnapshotDto | null>(null);
  const [observedRestorePause, setObservedRestorePause] = useState<PosPriceSnapshotDto["restorePause"]>(null);
  const [restorePauseAcknowledged, setRestorePauseAcknowledged] = useState(false);
  const [restoreCustodyComplete, setRestoreCustodyComplete] = useState(false);
  const [restorePauseSnapshotPendingKey, setRestorePauseSnapshotPendingKey] = useState<string | null>(null);
  const syncingRef = useRef(false);
  const restoreAcknowledgementRef = useRef<{ previewId: string; pendingKey: string } | null>(null);
  const restoreSyncRef = useRef<{ previewId: string; pendingKey: string } | null>(null);
  const restoreGenerationRef = useRef<number | null>(null);

  useEffect(() => {
    function syncOnline() {
      setOnline(navigator.onLine);
    }
    window.addEventListener("online", syncOnline);
    window.addEventListener("offline", syncOnline);
    return () => {
      window.removeEventListener("online", syncOnline);
      window.removeEventListener("offline", syncOnline);
    };
  }, []);

  useEffect(() => {
    function onDeferred() {
      setUpdateDeferred(true);
    }
    window.addEventListener("bravos-update-deferred", onDeferred);
    return () => window.removeEventListener("bravos-update-deferred", onDeferred);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const staffId = workspace.staff.id;
    const epoch = accountGeneration();
    const stillCurrent = () => !cancelled && workspace.staff.id === staffId && accountGeneration() === epoch;
    void (async () => {
      if (online) {
        await runSync(stillCurrent);
      }
      let codeReady = await posCodeIsCached();
      for (let attempt = 0; attempt < 20 && !codeReady && !cancelled; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        codeReady = await posCodeIsCached();
      }
      const data = await readPosReadiness(staffId);
      const schemaVersion = await pos.readSchemaVersion();
      const other = await pos.countOtherPending(staffId);
      if (!stillCurrent()) {
        return;
      }
      setUnsynced(data.unsynced);
      setOtherPending(other);
      setPersistent(data.persistent);
      if (schemaVersion < POS_SCHEMA_VERSION) {
        setUpdateDeferred(true);
      }
      setReady(codeReady && data.dataReady && workspace.capabilities.cashier && schemaVersion >= POS_SCHEMA_VERSION);
    })();
    return () => {
      cancelled = true;
    };
  }, [workspace, online]);

  useEffect(() => {
    let cancelled = false;
    const staffId = workspace.staff.id;
    const epoch = accountGeneration();
    const stillCurrent = () => !cancelled && workspace.staff.id === staffId && accountGeneration() === epoch;
    const refresh = async () => {
      if (!stillCurrent()) return;
      if (observedPause && new Date(observedPause.expiresAt).getTime() <= Date.now()) {
        setObservedPause(null);
        setPauseSnapshot(null);
        setPauseAcknowledged(false);
      }
      if (!navigator.onLine) return;
      try {
        const current = await getStockPause();
        if (!stillCurrent()) return;
        setObservedPause(current);
        if (!current) {
          setPauseSnapshot(null);
          setPauseAcknowledged(false);
        }
      } catch {
        /* keep the last observed finite pause until a later refresh */
      }
    };
    const interval = window.setInterval(() => void refresh(), 5_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    void refresh();
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [workspace.staff.id, observedPause?.coordinationId, observedPause?.expiresAt]);

  useEffect(() => {
    if (!workspace.capabilities.cashier || !online) return;
    let cancelled = false;
    const staffId = workspace.staff.id;
    const epoch = accountGeneration();
    const stillCurrent = () => !cancelled && workspace.staff.id === staffId && accountGeneration() === epoch;
    // Polls the read-only restore pause. A POS snapshot is issued only once per observed pause and
    // queue state, or once after the restore generation changes, never on every poll.
    const observe = async () => {
      if (!stillCurrent() || syncingRef.current) return;
      try {
        const state = await getRestorePause();
        if (!stillCurrent()) return;
        const previousGeneration = restoreGenerationRef.current;
        restoreGenerationRef.current = state.currentGeneration;
        if (state.pause) {
          setObservedRestorePause(state.pause);
          const pendingKey = operationSetKey(await pos.listPendingOperationIds());
          const acknowledged = restoreAcknowledgementRef.current;
          if (acknowledged?.previewId === state.pause.previewId && acknowledged.pendingKey === pendingKey) return;
          const synchronized = restoreSyncRef.current;
          if (synchronized?.previewId === state.pause.previewId && synchronized.pendingKey === pendingKey) return;
          restoreAcknowledgementRef.current = null;
          setRestorePauseAcknowledged(false);
          restoreSyncRef.current = { previewId: state.pause.previewId, pendingKey };
          await runSync(stillCurrent);
          return;
        }
        restoreAcknowledgementRef.current = null;
        restoreSyncRef.current = null;
        setObservedRestorePause(null);
        setRestorePauseSnapshot(null);
        setRestorePauseSnapshotPendingKey(null);
        setRestorePauseAcknowledged(false);
        setRestoreCustodyComplete(false);
        if (previousGeneration !== null && previousGeneration !== state.currentGeneration) await runSync(stillCurrent);
      } catch {
        /* keep the last observed restore pause until a later refresh */
      }
    };
    const interval = window.setInterval(() => void observe(), 5_000);
    window.addEventListener("focus", observe);
    void observe();
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", observe);
    };
  }, [workspace.staff.id, workspace.capabilities.cashier, online]);

  async function runSync(stillCurrent: () => boolean) {
    syncingRef.current = true;
    const staffId = workspace.staff.id;
    setSyncing(true);
    setSyncError("");
    setSyncStatus("جاري مزامنة المبيعات…");
    try {
      try {
        const fresh = await getWorkspace();
        if (!stillCurrent()) {
          return;
        }
        if (fresh.staff.id !== staffId) {
          return;
        }
        if (
          fresh.capabilities.cashier !== workspace.capabilities.cashier ||
          fresh.staff.disabled !== workspace.staff.disabled
        ) {
          await onChanged(fresh);
          return;
        }
        if (!fresh.capabilities.cashier) {
          setSyncError("لا يمكن بدء عمل متصل جديد بهذا الحساب. المبيعات المكتملة محفوظة ويمكن استردادها بمساعدة المدير.");
          setReady(false);
        }
      } catch (caught) {
        if (!stillCurrent()) {
          return;
        }
        if (caught instanceof ApiError && caught.status === 401) {
          setSyncError("انتهت الجلسة أو أُلغي الدخول. سجّل الدخول مجدداً. المبيعات المكتملة محفوظة.");
          setReady(false);
          return;
        }
        if (caught instanceof ApiError && caught.status === 403) {
          setSyncError("لا يمكن بدء عمل متصل جديد بهذا الحساب. المبيعات المكتملة محفوظة ويمكن استردادها بمساعدة المدير.");
          setReady(false);
          return;
        }
      }
      if (workspace.capabilities.cashier) {
        const result = await retryUnsyncedSales(
          staffId,
          {
            accept: async (sale) => {
              if (!stillCurrent() || sale.staffId !== staffId) {
                return Promise.reject(new Error("stale-account"));
              }
              return acceptOfflineSale(await acceptedPayload(sale));
            },
            complete: async (sale) => {
              if (!stillCurrent() || sale.staffId !== staffId) {
                return Promise.reject(new Error("stale-account"));
              }
              return completeSale(await completedPayload(sale));
            },
          },
          stillCurrent,
        );
        if (!stillCurrent()) {
          return;
        }
        setUnsynced(result.remaining);
        if (result.error) {
          setSyncError(result.error);
        }
      }
      const deviceId = await pos.deviceId();
      if (!stillCurrent()) {
        return;
      }
      if (workspace.capabilities.cashier) {
        try {
          const snapshot = await issuePosSnapshot(deviceId, await pos.listPendingOperationIds());
          if (!stillCurrent()) {
            return;
          }
          await cacheIssuedSnapshot(staffId, snapshot);
          setPauseSnapshot(snapshot.stockPause ? snapshot : null);
          setObservedPause(snapshot.stockPause);
          setPauseAcknowledged(false);
          setObservedRestorePause(snapshot.restorePause);
          if (snapshot.restorePause) {
            // Sales still queued after applying this snapshot must be held by the server as retained sales.
            const remainingKey = operationSetKey(await pos.listPendingOperationIds());
            const acknowledged = restoreAcknowledgementRef.current;
            setRestorePauseSnapshot(snapshot);
            setRestorePauseSnapshotPendingKey(remainingKey);
            setRestoreCustodyComplete(pendingCustodiedByServer(snapshot, remainingKey ? remainingKey.split(",") : []));
            setRestorePauseAcknowledged(acknowledged?.previewId === snapshot.restorePause.previewId && acknowledged.pendingKey === remainingKey);
          } else {
            restoreAcknowledgementRef.current = null;
            setRestorePauseSnapshot(null);
            setRestorePauseSnapshotPendingKey(null);
            setRestorePauseAcknowledged(false);
            setRestoreCustodyComplete(false);
          }
        } catch (caught) {
          if (!stillCurrent()) {
            return;
          }
          if (caught instanceof ApiError && (caught.status === 401 || caught.status === 403) && !syncError) {
            setSyncError(
              caught.status === 401
                ? "انتهت الجلسة أو أُلغي الدخول. سجّل الدخول مجدداً. المبيعات المكتملة محفوظة."
                : "لا يمكن بدء عمل متصل جديد بهذا الحساب. المبيعات المكتملة محفوظة ويمكن استردادها بمساعدة المدير.",
            );
          }
        }
      }
      if (stillCurrent()) {
        setSyncStatus("");
      }
    } catch (caught) {
      if (!stillCurrent()) {
        return;
      }
      if (caught instanceof ApiError && caught.status === 401) {
        setSyncError("انتهت الجلسة أو أُلغي الدخول. سجّل الدخول مجدداً. المبيعات المكتملة محفوظة.");
      } else if (caught instanceof ApiError && caught.status === 403) {
        setSyncError("لا يمكن بدء عمل متصل جديد بهذا الحساب. المبيعات المكتملة محفوظة ويمكن استردادها بمساعدة المدير.");
      } else {
        setSyncError("تعذر مزامنة المبيعات. أعد المحاولة عند الاتصال.");
      }
    } finally {
      try {
        if (stillCurrent()) {
          setSyncing(false);
          const data = await readPosReadiness(staffId);
          const other = await pos.countOtherPending(staffId);
          if (stillCurrent()) {
            setUnsynced(data.unsynced);
            setOtherPending(other);
          }
        }
      } finally {
        syncingRef.current = false;
      }
    }
  }

  async function acknowledgeRestorePause() {
    const snapshot = restorePauseSnapshot;
    if (!snapshot?.restorePause || syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    setSyncError("");
    const staffId = workspace.staff.id;
    const epoch = accountGeneration();
    const stillCurrent = () => workspace.staff.id === staffId && accountGeneration() === epoch;
    try {
      const pendingOperationIds = await pos.listPendingOperationIds();
      if (restorePauseSnapshotPendingKey !== operationSetKey(pendingOperationIds)) {
        setRestoreCustodyComplete(false);
        setSyncError("تغير طابور المبيعات بعد اللقطة. أعد المزامنة قبل تأكيد التوقف.");
        return;
      }
      if (!pendingCustodiedByServer(snapshot, pendingOperationIds)) {
        setRestoreCustodyComplete(false);
        setSyncError("لم يثبت الخادم حفظ كل المبيعات المكتملة بعد. أعد المزامنة قبل تأكيد التوقف.");
        return;
      }
      await acknowledgeRestoreDevice(snapshot.restorePause.previewId, {
        deviceId: snapshot.deviceId,
        snapshotId: snapshot.snapshotId,
      });
      if (stillCurrent()) {
        restoreAcknowledgementRef.current = {
          previewId: snapshot.restorePause.previewId,
          pendingKey: operationSetKey(pendingOperationIds),
        };
        setRestorePauseAcknowledged(true);
      }
    } catch (caught) {
      if (stillCurrent()) setSyncError(caught instanceof ApiError ? caught.messageAr : "تعذر تأكيد توقف نقطة البيع للاستعادة.");
    } finally {
      syncingRef.current = false;
      if (stillCurrent()) setSyncing(false);
    }
  }

  async function logout() {
    const accepted = await signOutPreservingSales(workspace.staff.id);
    if (!accepted) {
      return;
    }
    await onChanged(null);
    navigate("/login");
  }

  async function retryNow() {
    const staffId = workspace.staff.id;
    const epoch = accountGeneration();
    const stillCurrent = () => workspace.staff.id === staffId && accountGeneration() === epoch;
    await runSync(stillCurrent);
  }

  async function recoverNow() {
    const staffId = workspace.staff.id;
    const epoch = accountGeneration();
    const stillCurrent = () => workspace.staff.id === staffId && accountGeneration() === epoch;
    setSyncing(true);
    setSyncError("");
    setSyncStatus("جاري استرداد المبيعات المحفوظة…");
    try {
      const result = await recoverPreservedQueues(
        staffId,
        async (sale) => {
          if (!stillCurrent()) {
            return Promise.reject(new Error("stale-account"));
          }
          const recovered = await recoverOfflineSale(await recoveryPayload(sale));
          if (!stillCurrent()) {
            return Promise.reject(new Error("stale-account"));
          }
          return recovered;
        },
        stillCurrent,
      );
      if (!stillCurrent()) {
        return;
      }
      setOtherPending(result.remaining);
      if (result.error) {
        setSyncError(result.error);
      }
      setSyncStatus("");
    } catch {
      if (stillCurrent()) {
        setSyncError("تعذر استرداد المبيعات المحفوظة.");
      }
    } finally {
      if (stillCurrent()) {
        setSyncing(false);
        const data = await readPosReadiness(staffId);
        const other = await pos.countOtherPending(staffId);
        setUnsynced(data.unsynced);
        setOtherPending(other);
      }
    }
  }

  async function acknowledgePause() {
    const snapshot = pauseSnapshot;
    if (!snapshot?.stockPause) return;
    setSyncing(true);
    setSyncError("");
    const staffId = workspace.staff.id;
    const epoch = accountGeneration();
    const stillCurrent = () => workspace.staff.id === staffId && accountGeneration() === epoch;
    try {
      const pendingOperationIds = await pos.listPendingOperationIds();
      if (pendingOperationIds.length > 0) {
        setSyncError("يجب إرسال كل المبيعات المكتملة قبل تأكيد التوقف.");
        return;
      }
      await acknowledgeCountCoordination({
        coordinationId: snapshot.stockPause.coordinationId,
        deviceId: snapshot.deviceId,
        snapshotId: snapshot.snapshotId,
      });
      if (stillCurrent()) setPauseAcknowledged(true);
    } catch (caught) {
      if (stillCurrent()) setSyncError(caught instanceof ApiError ? caught.messageAr : "تعذر تأكيد توقف نقطة البيع.");
    } finally {
      if (stillCurrent()) setSyncing(false);
    }
  }

  return (
    <main className="shell">
      <header className="brand">
        <div>
          <h1>مساحة العمل</h1>
          <p className="muted">{workspace.staff.displayName}</p>
        </div>
        <div className="actions">
          <Link className="button secondary" to="/select-branch">تغيير الفرع</Link>
          {online && workspace.capabilities.manageStaff ? (
            <Link className="button secondary" to="/staff">الموظفون</Link>
          ) : null}
          {online && workspace.capabilities.manageCatalog ? (
            <Link className="button secondary" to="/catalog">المنتجات</Link>
          ) : null}
          {online && workspace.capabilities.manageCatalog ? (
            <Link className="button secondary" to="/storefront-settings">روابط المتجر</Link>
          ) : null}
          {online && workspace.capabilities.manageCatalog ? (
            <Link className="button secondary" to="/delivery-areas">مناطق التوصيل</Link>
          ) : null}
          {online && (workspace.staff.role === "manager" || workspace.capabilities.orderRepresentative) ? (
            <Link className="button secondary" to="/online-orders">الطلبات الأونلاين</Link>
          ) : null}
          {online && workspace.capabilities.manageInventory ? (
            <Link className="button secondary" to="/receiving">استلام المخزون</Link>
          ) : null}
          {online && workspace.capabilities.managePricing ? (
            <Link className="button secondary" to="/offers">العروض</Link>
          ) : null}
          {online && workspace.staff.role === "manager" && workspace.capabilities.manageInventory ? (
            <Link className="button secondary" to="/returns">المرتجعات</Link>
          ) : null}
          {online && workspace.staff.role === "manager" && workspace.capabilities.manageInventory ? (
            <Link className="button secondary" to="/corrections">تصحيح التسجيلات</Link>
          ) : null}
          {online && workspace.staff.role === "manager" && workspace.capabilities.manageInventory ? (
            <Link className="button secondary" to="/stock-corrections">تصحيح كميات المخزون</Link>
          ) : null}
          {online
            && workspace.staff.role === "manager"
            && workspace.capabilities.manageInventory
            && workspace.capabilities.manageCatalog ? (
              <Link className="button secondary" to="/opening-import">استيراد بيانات البداية</Link>
            ) : null}
          {online && workspace.staff.role === "manager" ? (
            <Link className="button secondary" to="/reports">التقارير</Link>
          ) : null}
          {workspace.capabilities.cashier ? (
            <Link className="button secondary" to="/lookup">البحث عن منتج</Link>
          ) : null}
          {workspace.activeBranch ? (
            <Link className="button secondary" to="/sales">المبيعات</Link>
          ) : null}
          {online && workspace.activeBranch ? (
            <Link className="button secondary" to="/expenses">المصروفات</Link>
          ) : null}
          {online && workspace.staff.role === "manager" ? (
            <Link className="button secondary" to="/analytics">تحليلات المتجر</Link>
          ) : null}
          {online && workspace.staff.role === "manager" ? (
            <Link className="button secondary" to="/backup">نسخة احتياطية</Link>
          ) : null}
          {online && workspace.staff.role === "manager" ? (
            <Link className="button secondary" to="/restore">استعادة البيانات</Link>
          ) : null}
          <button className="secondary" type="button" onClick={() => void logout()}>
            تسجيل الخروج
          </button>
        </div>
      </header>
      <div className="branch-banner" data-testid="active-branch">
        الفرع النشط: {workspace.activeBranch?.nameAr}
      </div>
      <p data-testid="unsynced-count">مبيعات غير مزامنة: {unsynced}</p>
      {observedPause ? (
        <div className="error" data-testid="stock-pause" role="alert">
          <p>تغييرات المخزون متوقفة مؤقتاً لإجراء تصحيح كمية.</p>
          <p>لا تبدأ بيعاً جديداً ولا تسلّم بضاعة حتى انتهاء التوقف.</p>
          {pauseAcknowledged ? (
            <p data-testid="stock-pause-acknowledged">تم تأكيد مزامنة هذا الجهاز والتوقف.</p>
          ) : (
            pauseSnapshot?.stockPause?.coordinationId === observedPause.coordinationId ? <button
              type="button"
              data-testid="acknowledge-stock-pause"
              disabled={syncing || unsynced > 0}
              onClick={() => void acknowledgePause()}
            >
              تأكيد مزامنة هذا الجهاز والتوقف
            </button> : <p className="muted">أعد مزامنة المبيعات لإصدار لقطة مرتبطة بهذا التوقف قبل التأكيد.</p>
          )}
        </div>
      ) : null}
      {observedRestorePause ? (
        <div className="error" data-testid="restore-pause" role="alert">
          <p>العمل متوقف مؤقتاً لمراجعة استعادة نسخة البيانات.</p>
          <p>لا تبدأ بيعاً جديداً ولا تسلّم بضاعة حتى انتهاء التوقف.</p>
          {restorePauseAcknowledged ? (
            <p data-testid="restore-pause-acknowledged">تم تأكيد حفظ مبيعات هذا الجهاز والتوقف.</p>
          ) : restorePauseSnapshot?.restorePause?.previewId === observedRestorePause.previewId ? (
            <>
              {unsynced > 0 && restoreCustodyComplete ? <p>المبيعات غير المطبقة محفوظة لدى الخادم وستبقى ظاهرة لاسترداد المدير.</p> : null}
              <button
                type="button"
                data-testid="acknowledge-restore-pause"
                disabled={syncing || !restoreCustodyComplete}
                onClick={() => void acknowledgeRestorePause()}
              >
                تأكيد مزامنة هذا الجهاز والتوقف للاستعادة
              </button>
            </>
          ) : <p className="muted">أعد مزامنة المبيعات لإصدار لقطة مرتبطة بهذه الاستعادة قبل التأكيد.</p>}
        </div>
      ) : null}
      {syncStatus ? (
        <p data-testid="sync-status" role="status">{syncStatus}</p>
      ) : null}
      {syncError ? (
        <div className="error" data-testid="sync-error" role="alert">{syncError}</div>
      ) : null}
      <p className="muted" data-testid="sync-foreground-note">
        إغلاق المتصفح لا يضمن إرسال المبيعات. أعد المحاولة عند الاتصال.
      </p>
      <div className="actions">
        <button
          className="secondary"
          type="button"
          data-testid="retry-sync"
          disabled={!online || syncing}
          onClick={() => void retryNow()}
        >
          إعادة المحاولة
        </button>
      </div>
      {workspace.capabilities.manageStaff && otherPending > 0 ? (
        <div className="notice" data-testid="foreign-queue">
          <p>مبيعات محفوظة لحساب آخر: {otherPending}</p>
          <button
            className="secondary"
            type="button"
            data-testid="recover-queue"
            disabled={!online || syncing}
            onClick={() => void recoverNow()}
          >
            استرداد المبيعات المحفوظة
          </button>
        </div>
      ) : null}
      {ready ? (
        <div className="notice" data-testid="offline-ready" role="status">
          جاهز للعمل دون اتصال
        </div>
      ) : workspace.capabilities.cashier ? (
        <p className="muted" data-testid="offline-not-ready">لم تكتمل جاهزية نقطة البيع دون اتصال بعد.</p>
      ) : null}
      {updateDeferred ? (
        <div className="notice" data-testid="update-deferred" role="status">
          تم تأجيل تحديث التطبيق للحفاظ على المبيعات غير المزامنة. أعد المحاولة بعد المزامنة.
        </div>
      ) : null}
      {persistent === false ? (
        <p className="muted">طلبنا حفظاً ثابتاً للمتصفح إن وُجد. هذا لا يحمي من حذف بيانات المتصفح.</p>
      ) : null}
      <section className="card">
        <h2>ما المتاح الآن</h2>
        <p>
          {online
            ? "يمكنك تسجيل الدخول، اختيار فرع مصرّح به، وصيانة المنتجات واستلام المخزون المركزي، والبحث عن منتج وإتمام بيع نقدي."
            : "البيع النقدي من البيانات المحفوظة متاح للحساب المسجّل. الاستلام والإرجاع والمصروفات وتغيير الأسعار والصلاحيات تتطلب اتصالاً."}
        </p>
      </section>
    </main>
  );
}

function pendingCustodiedByServer(snapshot: PosPriceSnapshotDto, pendingOperationIds: string[]) {
  const deferred = Array.isArray(snapshot.deferredCompletionProofs) ? snapshot.deferredCompletionProofs : [];
  const custodied = new Set(deferred.map((proof) => proof.operationId));
  return pendingOperationIds.every((operationId) => custodied.has(operationId));
}

function operationSetKey(operationIds: string[]) {
  return [...new Set(operationIds)].sort().join(",");
}
