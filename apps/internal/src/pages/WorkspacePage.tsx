import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { WorkspaceDto } from "@bravos/contracts";
import { accountGeneration } from "../account-session.ts";
import { acceptOfflineSale, completeSale, issuePosSnapshot } from "../api.ts";
import { posCodeIsCached } from "../offline-ready.ts";
import { cacheIssuedSnapshot, POS_SCHEMA_VERSION, pos, readPosReadiness, retryUnsyncedSales } from "../pos.ts";
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
  const [persistent, setPersistent] = useState<boolean | null>(null);
  const [updateDeferred, setUpdateDeferred] = useState(false);

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
      if (workspace.capabilities.cashier && online) {
        try {
          const deviceId = await pos.deviceId();
          if (!stillCurrent()) {
            return;
          }
          const snapshot = await issuePosSnapshot(deviceId);
          if (!stillCurrent()) {
            return;
          }
          await cacheIssuedSnapshot(staffId, snapshot);
          if (!stillCurrent()) {
            return;
          }
          await retryUnsyncedSales(
            staffId,
            {
              accept: (sale) => {
                if (!stillCurrent() || sale.staffId !== staffId) {
                  return Promise.reject(new Error("stale-account"));
                }
                return acceptOfflineSale({
                  saleId: sale.id,
                  operationId: sale.operationId,
                  deviceId: sale.deviceId,
                  snapshotId: sale.snapshotId ?? "",
                  occurredAt: sale.occurredAt,
                  customerName: sale.customerName,
                  customerPhone: sale.customerPhone,
                  employeeDiscountPiasters: sale.employeeDiscountPiasters,
                  discountReason: sale.discountReason,
                  lines: sale.lines.map((line) => ({
                    variantId: line.variantId,
                    quantity: line.quantity,
                    listedUnitPricePiasters: line.listedUnitPricePiasters,
                  })),
                });
              },
              complete: (sale) => {
                if (!stillCurrent() || sale.staffId !== staffId) {
                  return Promise.reject(new Error("stale-account"));
                }
                return completeSale({
                  saleId: sale.id,
                  operationId: sale.operationId,
                  occurredAt: sale.occurredAt,
                  customerName: sale.customerName,
                  customerPhone: sale.customerPhone,
                  employeeDiscountPiasters: sale.employeeDiscountPiasters,
                  discountReason: sale.discountReason,
                  lines: sale.lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity })),
                });
              },
            },
            stillCurrent,
          );
        } catch {
          /* keep last issued snapshot and unacknowledged work */
        }
      }
      let codeReady = await posCodeIsCached();
      for (let attempt = 0; attempt < 20 && !codeReady && !cancelled; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        codeReady = await posCodeIsCached();
      }
      const data = await readPosReadiness(staffId);
      const schemaVersion = await pos.readSchemaVersion();
      if (!stillCurrent()) {
        return;
      }
      setUnsynced(data.unsynced);
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

  async function logout() {
    const accepted = await signOutPreservingSales(workspace.staff.id);
    if (!accepted) {
      return;
    }
    await onChanged(null);
    navigate("/login");
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
          {online && workspace.capabilities.manageInventory ? (
            <Link className="button secondary" to="/receiving">استلام المخزون</Link>
          ) : null}
          {workspace.capabilities.cashier ? (
            <Link className="button secondary" to="/lookup">البحث عن منتج</Link>
          ) : null}
          {workspace.activeBranch ? (
            <Link className="button secondary" to="/sales">المبيعات</Link>
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
