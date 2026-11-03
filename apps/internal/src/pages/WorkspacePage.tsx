import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { PosPriceSnapshotDto, WorkspaceDto } from "@bravos/contracts";
import { accountGeneration } from "../account-session.ts";
import {
  acceptOfflineSale,
  acknowledgeCountCoordination,
  ApiError,
  completeSale,
  getManagementReport,
  getStockPause,
  getWorkspace,
  listLowStock,
  listOnlineOrders,
  recoverOfflineSale,
} from "../api.ts";
import { formatEgpFromPiasters } from "../money.ts";
import { posCodeIsCached } from "../offline-ready.ts";
import { PrinterConnectionPanel } from "../printing/PrinterConnectionPanel.tsx";
import { acknowledgeRestoreDevice, getRestorePause } from "../restore-api.ts";
import {
  acceptedPayload,
  cacheIssuedSnapshot,
  completedPayload,
  issueStaffPosSnapshot,
  POS_SCHEMA_VERSION,
  pos,
  readPosReadiness,
  recoverPreservedQueues,
  recoveryPayload,
  retryUnsyncedSales,
} from "../pos.ts";


export function WorkspacePage({
  workspace,
  onChanged,
}: {
  workspace: WorkspaceDto;
  onChanged: (workspace: WorkspaceDto | null) => void;
}) {
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
  const restorePauseSnapshotRef = useRef<PosPriceSnapshotDto | null>(null);
  const restorePausePendingKeyRef = useRef<string | null>(null);
  const restoreAcknowledgementRef = useRef<{ previewId: string; pendingKey: string } | null>(null);
  const restoreSyncRef = useRef<{ previewId: string; pendingKey: string } | null>(null);
  const restoreGenerationRef = useRef<number | null>(null);
  const [todaySales, setTodaySales] = useState<string | null>(null);
  const [todayCount, setTodayCount] = useState<number | null>(null);
  const [pendingOrders, setPendingOrders] = useState<number | null>(null);
  const [lowStockCount, setLowStockCount] = useState<number | null>(null);
  const [backupHint, setBackupHint] = useState<string | null>(null);
  const [summaryRetry, setSummaryRetry] = useState(0);
  const [summaryStatus, setSummaryStatus] = useState<Record<string, "loading" | "ready" | "error">>({});

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
        if (!stillCurrent() || syncingRef.current) return;
        const previousGeneration = restoreGenerationRef.current;
        restoreGenerationRef.current = state.currentGeneration;
        if (state.pause) {
          setObservedRestorePause(state.pause);
          const pendingKey = operationSetKey(await pos.listPendingOperationIds());
          if (!stillCurrent() || syncingRef.current) return;
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
        restorePauseSnapshotRef.current = null;
        restorePausePendingKeyRef.current = null;
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

  useEffect(() => {
    setTodaySales(null);
    setTodayCount(null);
    setPendingOrders(null);
    setLowStockCount(null);
    setBackupHint(null);
    setSummaryStatus({});
    if (!online || workspace.staff.role !== "manager") return;
    let cancelled = false;
    const epoch = accountGeneration();
    const staffId = workspace.staff.id;
    const stillCurrent = () => !cancelled && accountGeneration() === epoch && workspace.staff.id === staffId;
    setSummaryStatus({ sales: "loading", orders: "loading", stock: "loading", backup: "loading" });
    function status(key: string, value: "ready" | "error") {
      if (stillCurrent()) setSummaryStatus((current) => ({ ...current, [key]: value }));
    }
    void (async () => {
      if (workspace.staff.role === "manager") {
        try {
          const report = await getManagementReport({ period: "today", detailPage: 1, detailPageSize: 1 });
          if (!stillCurrent()) return;
          setTodaySales(formatEgpFromPiasters(report.summary.netFinalSalesPiasters));
          setTodayCount(report.summary.completedCount);
          status("sales", "ready");
        } catch {
          if (stillCurrent()) {
            setTodaySales(null);
            setTodayCount(null);
            status("sales", "error");
          }
        }
        try {
          const orders = await listOnlineOrders();
          if (!stillCurrent()) return;
          setPendingOrders(orders.filter((order) => order.status === "pending").length);
          status("orders", "ready");
        } catch {
          status("orders", "error");
        }
        try {
          const low = await listLowStock();
          if (!stillCurrent()) return;
          setLowStockCount(low.length);
          status("stock", "ready");
        } catch {
          status("stock", "error");
        }
        try {
          const { getBackupReadiness } = await import("../backup-api.ts");
          if (!stillCurrent()) return;
          const readiness = await getBackupReadiness();
          if (!stillCurrent()) return;
          setBackupHint(
            readiness.knownUnsynchronizedTillCount > 0
              ? `${readiness.knownUnsynchronizedTillCount} جهاز لسه عليه مبيعات`
              : "الجهاز الحالي جاهز",
          );
          status("backup", "ready");
        } catch {
          status("backup", "error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspace.staff.id, workspace.staff.role, online, summaryRetry]);

  function summaryDetail(key: string, readyLabel: string) {
    if (!online) return "غير متاح بدون اتصال";
    if (summaryStatus[key] === "error") return "تعذر تحميل البيانات";
    if (summaryStatus[key] !== "ready") return "لحظات...";
    return readyLabel;
  }

  async function runSync(stillCurrent: () => boolean, options?: { registerReceipt?: boolean }) {
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
      if (!stillCurrent()) {
        return;
      }
      if (workspace.capabilities.cashier) {
        try {
          const snapshot = await issueStaffPosSnapshot(
            await pos.listPendingOperationIds(),
            options?.registerReceipt ? "register" : "passive",
          );
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
            restorePauseSnapshotRef.current = snapshot;
            restorePausePendingKeyRef.current = remainingKey;
            // The queue can shrink while this sync uploads retained sales. Later polls must
            // see that post-sync queue, or a focus event starts another snapshot and drops
            // the confirmation click.
            restoreSyncRef.current = { previewId: snapshot.restorePause.previewId, pendingKey: remainingKey };
            setRestorePauseSnapshot(snapshot);
            setRestorePauseSnapshotPendingKey(remainingKey);
            setRestoreCustodyComplete(pendingCustodiedByServer(snapshot, remainingKey ? remainingKey.split(",") : []));
            setRestorePauseAcknowledged(acknowledged?.previewId === snapshot.restorePause.previewId && acknowledged.pendingKey === remainingKey);
          } else {
            restoreAcknowledgementRef.current = null;
            restorePauseSnapshotRef.current = null;
            restorePausePendingKeyRef.current = null;
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
          const data = await readPosReadiness(staffId);
          const other = await pos.countOtherPending(staffId);
          if (stillCurrent()) {
            setUnsynced(data.unsynced);
            setOtherPending(other);
          }
        }
      } finally {
        // Release the lock before the button enables. Otherwise a click in that
        // window hits the handler and returns without recording acknowledgement.
        syncingRef.current = false;
        if (stillCurrent()) setSyncing(false);
      }
    }
  }

  async function acknowledgeRestorePause() {
    const staffIdForWait = workspace.staff.id;
    const epochForWait = accountGeneration();
    // A focus or poll can start sync in the same turn the button is still enabled.
    // Dropping that click leaves the pause without an acknowledgement.
    while (syncingRef.current) {
      if (workspace.staff.id !== staffIdForWait || accountGeneration() !== epochForWait) return;
      await new Promise((resolve) => window.setTimeout(resolve, 25));
    }
    // The click can land while a poll is still publishing a newer snapshot.
    // The render that created this handler does not see that snapshot.
    const snapshot = restorePauseSnapshotRef.current ?? restorePauseSnapshot;
    const pendingKey = restorePausePendingKeyRef.current ?? restorePauseSnapshotPendingKey;
    if (!snapshot?.restorePause) return;
    syncingRef.current = true;
    setSyncing(true);
    setSyncError("");
    const staffId = workspace.staff.id;
    const epoch = accountGeneration();
    const stillCurrent = () => workspace.staff.id === staffId && accountGeneration() === epoch;
    try {
      const pendingOperationIds = await pos.listPendingOperationIds();
      if (pendingKey !== operationSetKey(pendingOperationIds)) {
        setRestoreCustodyComplete(false);
        setSyncError("تغير طابور المبيعات بعد اللقطة. أعد المزامنة قبل تأكيد التوقف.");
        return;
      }
      if (!pendingCustodiedByServer(snapshot, pendingOperationIds)) {
        setRestoreCustodyComplete(false);
        setSyncError("لم يثبت الخادم حفظ كل المبيعات المكتملة بعد. أعد المزامنة قبل تأكيد التوقف.");
        return;
      }
      // The runtime pause is published while the preview is still being staged. The same
      // snapshot is rejected until that preview is paused or ready, and the server asks
      // for the confirmation to be retried. A different preview or a custody mismatch stops.
      const previewId = snapshot.restorePause.previewId;
      const stalePreview = "تغيرت بيانات العمل أو حالة الأجهزة بعد إعداد معاينة الاستعادة. حدّث المعاينة وأعد المحاولة.";
      const deadline = Date.now() + 12_000;
      let confirmed = false;
      while (!confirmed) {
        try {
          await acknowledgeRestoreDevice(previewId, {
            deviceId: snapshot.deviceId,
            snapshotId: snapshot.snapshotId,
          });
          confirmed = true;
        } catch (caught) {
          const retryable = caught instanceof ApiError && caught.status === 409 && caught.messageAr === stalePreview && Date.now() < deadline;
          if (!retryable || !stillCurrent()) {
            if (stillCurrent()) setSyncError(caught instanceof ApiError ? caught.messageAr : "تعذر تأكيد توقف نقطة البيع للاستعادة.");
            return;
          }
          const pause = await getRestorePause();
          if (!stillCurrent()) return;
          if (pause.pause?.previewId !== previewId) {
            setSyncError(caught instanceof ApiError ? caught.messageAr : stalePreview);
            return;
          }
          await new Promise((resolve) => window.setTimeout(resolve, 400));
        }
      }
      if (stillCurrent()) {
        restoreAcknowledgementRef.current = {
          previewId,
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

  async function retryNow() {
    const staffId = workspace.staff.id;
    const epoch = accountGeneration();
    const stillCurrent = () => workspace.staff.id === staffId && accountGeneration() === epoch;
    await runSync(stillCurrent, { registerReceipt: true });
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

  const needsAttention = Boolean(
    observedPause
    || observedRestorePause
    || syncError
    || updateDeferred
    || (workspace.capabilities.manageStaff && otherPending > 0)
    || unsynced > 0
    || (pendingOrders ?? 0) > 0
    || (lowStockCount ?? 0) > 0,
  );
  const showSyncDock = unsynced > 0 || Boolean(syncError) || Boolean(syncStatus) || !online;

  return (
    <main className="shell dashboard-page">
      <header className="page-hero">
        <div>
          <p className="eyebrow">أهلاً، {workspace.staff.displayName}</p>
          <h1>الرئيسية<span className="sr-only"> مساحة العمل</span></h1>
          <p className="page-subtitle">{workspace.staff.role === "manager" ? "ملخص كل الفروع والمتجر" : "ابدأ البيع"}</p>
        </div>
      </header>

      {workspace.capabilities.cashier ? (
        <Link className="sell-now" to="/lookup" aria-label="نقطة البيع البحث عن منتج">
          <strong>نقطة البيع</strong>
          <span>ابدأ بيع من الكود</span>
        </Link>
      ) : null}
      {workspace.capabilities.cashier && ready ? (
        <p className="quiet-status" data-testid="offline-ready" role="status">جاهز للعمل دون اتصال</p>
      ) : null}
      {workspace.capabilities.cashier && !ready ? (
        <p className="quiet-status" data-testid="offline-not-ready">نقطة البيع بتتجهز</p>
      ) : null}
      <PrinterConnectionPanel />

      {observedPause ? (
        <div className="alert alert-danger" data-testid="stock-pause" role="alert">
          <strong>تصحيح كمية شغال</strong>
          <p>ما تبدأش بيع جديد لحد ما التصحيح يخلص.</p>
          {pauseAcknowledged ? (
            <p data-testid="stock-pause-acknowledged">تم تأكيد مزامنة هذا الجهاز والتوقف.</p>
          ) : (
            pauseSnapshot?.stockPause?.coordinationId === observedPause.coordinationId ? <button
              type="button"
              data-testid="acknowledge-stock-pause"
              disabled={syncing || unsynced > 0}
              onClick={() => void acknowledgePause()}
            >
              أكّد إن الجهاز واقف
            </button> : <p className="muted">إبعت المبيعات الأول عشان تقدر تؤكد.</p>
          )}
        </div>
      ) : null}
      {observedRestorePause ? (
        <div className="alert alert-danger" data-testid="restore-pause" role="alert">
          <strong>استعادة بيانات شغالة</strong>
          <p>ما تبدأش بيع جديد لحد ما الاستعادة تخلص.</p>
          {restorePauseAcknowledged ? (
            <p data-testid="restore-pause-acknowledged">تم تأكيد حفظ مبيعات هذا الجهاز والتوقف.</p>
          ) : restorePauseSnapshot?.restorePause?.previewId === observedRestorePause.previewId ? (
            <>
              {unsynced > 0 && restoreCustodyComplete ? <p>المبيعات دي محفوظة وهتظهر للمدير.</p> : null}
              <button
                type="button"
                data-testid="acknowledge-restore-pause"
                disabled={syncing || !restoreCustodyComplete}
                onClick={() => void acknowledgeRestorePause()}
              >
                أكّد إن الجهاز واقف للاستعادة
              </button>
            </>
          ) : <p className="muted">إبعت المبيعات الأول عشان تقدر تؤكد.</p>}
        </div>
      ) : null}
      {syncError ? (
        <div className="alert alert-danger" data-testid="sync-error" role="alert">{syncError}</div>
      ) : null}
      {updateDeferred ? (
        <div className="alert alert-warn" data-testid="update-deferred" role="status">
          في تحديث مستني المبيعات المتأخرة تتبعت.
        </div>
      ) : null}
      {workspace.capabilities.manageStaff && otherPending > 0 ? (
        <div className="alert alert-warn" data-testid="foreign-queue">
          <p>مبيعات محفوظة لحساب تاني: {otherPending}</p>
          <button
            className="secondary"
            type="button"
            data-testid="recover-queue"
            disabled={!online || syncing}
            onClick={() => void recoverNow()}
          >
            رجّع مبيعات الحساب التاني
          </button>
        </div>
      ) : null}

      {workspace.staff.role === "manager" ? (
        <section className="kpi-grid" aria-label="ملخص كل الفروع والمتجر">
          <article className="kpi-card">
            <strong>{todaySales ?? "—"}</strong>
            <span>صافي مبيعات اليوم — كل الفروع والمتجر</span>
            <small>{summaryDetail("sales", `${todayCount} عملية`)}</small>
          </article>
          <article className="kpi-card">
            <strong>{pendingOrders === null ? "—" : pendingOrders}</strong>
            <span>طلبات المتجر المعلقة</span>
            <small>{summaryDetail("orders", "كل الطلبات من غير تأكيد")}</small>
          </article>
          <article className="kpi-card">
            <strong>{lowStockCount === null ? "—" : lowStockCount}</strong>
            <span>مخزون الفروع يحتاج متابعة</span>
            <small>{summaryDetail("stock", "أصناف قليلة حالياً")}</small>
          </article>
          <article className={`kpi-card${unsynced > 0 ? " is-warn" : ""}`}>
            <strong>{unsynced}</strong>
            <span>مبيعات الجهاز الحالي لسه متبعتش</span>
            <small data-testid="unsynced-count">مبيعات غير مزامنة: {unsynced}</small>
          </article>
        </section>
      ) : (
        <p data-testid="unsynced-count" className={`quiet-metric${unsynced > 0 ? " is-warn" : ""}`}>
          مبيعات غير مزامنة: {unsynced}
        </p>
      )}

      {workspace.staff.role === "manager" && online && Object.values(summaryStatus).includes("error") ? (
        <div className="error" role="alert">
          <p>تعذر تحميل بعض بيانات الملخص{summaryStatus.backup === "error" ? "، ومنها حالة النسخ الاحتياطي" : ""}. أعد المحاولة.</p>
          <button type="button" className="secondary" onClick={() => setSummaryRetry((value) => value + 1)}>
            إعادة تحميل الملخص
          </button>
        </div>
      ) : null}

      {workspace.staff.role === "manager" && backupHint && backupHint !== "الجهاز الحالي جاهز" ? (
        <p className="system-status">{backupHint}</p>
      ) : null}

      {needsAttention && workspace.staff.role === "manager" ? (
        <section className="card attention-card" aria-label="محتاج متابعة">
          <h2>محتاج متابعة</h2>
          <ul>
            {unsynced > 0 ? <li>{unsynced} بيعة لسه متبعتش</li> : null}
            {(pendingOrders ?? 0) > 0 ? <li>{pendingOrders} طلب جديد</li> : null}
            {(lowStockCount ?? 0) > 0 ? <li>{lowStockCount} صنف قليل</li> : null}
            {otherPending > 0 ? <li>{otherPending} بيعة على حساب تاني</li> : null}
          </ul>
        </section>
      ) : null}

      {workspace.staff.role === "manager" || workspace.capabilities.orderRepresentative || workspace.capabilities.manageInventory ? (
        <section className="card quick-actions" aria-label="اختصارات">
          <h2>اختصارات</h2>
          <div className="action-tiles">
            {online && workspace.capabilities.manageInventory ? (
              <Link className="action-tile" to="/receiving">
                <strong>استلام مخزون</strong>
                <span>زود الكمية</span>
              </Link>
            ) : null}
            {online && workspace.capabilities.manageCatalog ? (
              <Link className="action-tile" to="/catalog">
                <strong>إضافة منتج</strong>
                <span>القائمة</span>
              </Link>
            ) : null}
            {online && workspace.staff.role === "manager" ? (
              <Link className="action-tile" to="/reports">
                <strong>التقارير</strong>
                <span>اليوم</span>
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}

      {showSyncDock ? (
        <section className="sync-dock">
          {syncStatus ? <p data-testid="sync-status" role="status">{syncStatus}</p> : null}
          {unsynced > 0 ? (
            <p className="muted" data-testid="sync-foreground-note">في مبيعات لسه متبعتش. النظام بيحاول إرسالها تلقائياً وأنت متصل، وبيعيد المحاولة عند رجوع الاتصال.</p>
          ) : <p className="sr-only" data-testid="sync-foreground-note"> </p>}
          <button
            className="secondary"
            type="button"
            data-testid="retry-sync"
            disabled={!online || syncing}
            onClick={() => void retryNow()}
          >
            إعادة المحاولة
          </button>
        </section>
      ) : (
        <>
          <p className="sr-only" data-testid="sync-foreground-note"> </p>
          <button className="sr-only" type="button" data-testid="retry-sync" disabled={!online || syncing} onClick={() => void retryNow()}>
            إعادة المحاولة
          </button>
        </>
      )}
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
