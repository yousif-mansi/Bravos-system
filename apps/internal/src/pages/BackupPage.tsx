import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  BACKUP_SECTION_NAMES,
  type BackupSectionName,
  type WorkspaceDto,
} from "@bravos/contracts";
import { accountGeneration, subscribeAccount } from "../account-session.ts";
import { ApiError } from "../api.ts";
import {
  downloadBusinessBackup,
  getBackupReadiness,
  type BackupDownload,
  type BackupReadinessDto,
} from "../backup-api.ts";

const SECTION_LABELS: Record<BackupSectionName, string> = {
  identity: "الموظفون والفروع والصلاحيات",
  catalog: "الكتالوج ومراجع الصور",
  inventory: "المخزون والدفعات والتخصيصات",
  receiving: "استلام المخزون",
  sales: "المبيعات النقدية",
  expenses: "المصروفات",
  pricing: "الأسعار والعروض والكوبونات",
  returns: "المرتجعات والاستبدالات",
  corrections: "التصحيحات المرتبطة",
  online_orders: "الطلبات الأونلاين",
  storefront_configuration: "إعدادات المتجر والتوصيل",
  opening_import: "سجل استيراد بيانات البداية",
  analytics: "إحصاءات المتجر المجمّعة",
};

export default function BackupPage({ workspace }: { workspace: WorkspaceDto }) {
  const [readiness, setReadiness] = useState<BackupReadinessDto | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(true);
  const [readinessError, setReadinessError] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [invalidPasswordField, setInvalidPasswordField] = useState<"password" | "confirmation" | null>(null);
  const [completed, setCompleted] = useState<BackupDownload["manifest"] | null>(null);
  const lifecycle = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const readinessRequest = useRef<AbortController | null>(null);
  const readinessVersion = useRef(0);

  function isCurrentAccount(staffId: string, epoch: number, token: number): boolean {
    return lifecycle.current === token
      && accountGeneration() === epoch
      && workspace.staff.id === staffId;
  }

  async function refreshReadiness(staffId: string, epoch: number, token: number) {
    const version = ++readinessVersion.current;
    readinessRequest.current?.abort();
    const controller = new AbortController();
    readinessRequest.current = controller;
    if (isCurrentAccount(staffId, epoch, token)) {
      setReadinessLoading(true);
      setReadinessError("");
    }
    try {
      const next = await getBackupReadiness(controller.signal);
      if (isCurrentAccount(staffId, epoch, token) && readinessVersion.current === version) {
        setReadiness(next);
      }
    } catch (caught) {
      if (
        isCurrentAccount(staffId, epoch, token)
        && readinessVersion.current === version
        && !isAbort(caught)
      ) {
        setReadiness(null);
        setReadinessError(caught instanceof ApiError ? caught.messageAr : "تعذر فحص أجهزة نقاط البيع المعروفة.");
      }
    } finally {
      if (isCurrentAccount(staffId, epoch, token) && readinessVersion.current === version) {
        setReadinessLoading(false);
      }
      if (readinessRequest.current === controller) {
        readinessRequest.current = null;
      }
    }
  }

  useEffect(() => {
    const staffId = workspace.staff.id;
    const token = ++lifecycle.current;
    const epoch = accountGeneration();
    const reload = () => void refreshReadiness(staffId, epoch, token);
    reload();
    window.addEventListener("online", reload);
    const unsubscribe = subscribeAccount(() => {
      lifecycle.current += 1;
      readinessRequest.current?.abort();
      activeRequest.current?.abort();
      setPassword("");
      setConfirmation("");
      setCreating(false);
      setCompleted(null);
    });
    return () => {
      lifecycle.current += 1;
      readinessRequest.current?.abort();
      activeRequest.current?.abort();
      window.removeEventListener("online", reload);
      unsubscribe();
    };
  }, [workspace.staff.id]);

  async function createBackup(event: FormEvent) {
    event.preventDefault();
    if (creating) return;
    setError("");
    setInvalidPasswordField(null);
    setCompleted(null);
    const passwordLength = [...password].length;
    if (passwordLength < 12 || passwordLength > 128) {
      setInvalidPasswordField("password");
      setError("كلمة حماية النسخة يجب أن تكون من 12 إلى 128 حرفاً.");
      return;
    }
    if (password !== confirmation) {
      setInvalidPasswordField("confirmation");
      setError("كلمتا الحماية غير متطابقتين.");
      return;
    }

    const submittedPassword = password;
    setPassword("");
    setConfirmation("");
    setCreating(true);
    const staffId = workspace.staff.id;
    const epoch = accountGeneration();
    const token = lifecycle.current;
    const controller = new AbortController();
    activeRequest.current?.abort();
    activeRequest.current = controller;
    const stillCurrent = () => isCurrentAccount(staffId, epoch, token) && !controller.signal.aborted;

    try {
      const result = await downloadBusinessBackup(submittedPassword, controller.signal);
      if (!stillCurrent()) return;
      const actualChecksum = await sha256(result.archive);
      if (!stillCurrent()) return;
      if (actualChecksum !== result.manifest.sha256.toLowerCase()) {
        setError("فشل التحقق من سلامة الملف المنزّل. لم يتم حفظه؛ أعد المحاولة.");
        return;
      }
      saveOutsideBrowser(result.archive, result.fileName);
      if (!stillCurrent()) return;
      setCompleted(result.manifest);
      void refreshReadiness(staffId, epoch, token);
    } catch (caught) {
      if (!stillCurrent() || isAbort(caught)) return;
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر إنشاء النسخة الاحتياطية. أعد المحاولة عند استقرار الاتصال.");
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
      }
      if (stillCurrent()) {
        setCreating(false);
      }
    }
  }

  return (
    <main className="shell backup-page">
      <header className="page-hero">
        <h1>نسخة احتياطية للبيانات</h1>
      </header>

      {error ? <div className="error" role="alert">{error}</div> : null}
      {completed ? <BackupCompleted manifest={completed} /> : null}

      <section className="card backup-scope" aria-labelledby="backup-scope-title">
        <h2 id="backup-scope-title">ما الذي تحفظه النسخة؟</h2>
        <p>
          تشمل سجلات العمل المركزية، والسجلات الأصلية وتصحيحاتها، ودفعات التكلفة وتخصيصاتها،
          وإعدادات التشغيل، وربط الموظفين بالعمليات، وهويات العمليات اللازمة لمنع التكرار.
        </p>
        <p>
          تُحفظ مراجع الصور، لكن ملفات الصور نفسها غير موجودة داخل النسخة. لذلك لا يمكن لهذه النسخة
          وحدها استعادة ملف صورة محذوف من التخزين.
        </p>
        <p className="muted">
          لا تحتوي النسخة على كلمات دخول أو جلسات نشطة أو رموز استعادة أو أسرار الخدمة.
          هذه الشاشة للتنزيل فقط؛ معاينة الاستعادة وتأكيدها تأتي في مسار مستقل.
        </p>
      </section>

      <section className="card backup-central-warning" aria-labelledby="backup-central-title">
        <h2 id="backup-central-title">حدود البيانات المركزية</h2>
        <p>
          تُنشأ النسخة من البيانات التي وصلت إلى الخادم المركزي. أي مبيعات مكتملة ما زالت غير مرسلة
          من جهاز نقطة بيع لن تكون داخل الملف.
        </p>
        <Readiness readiness={readiness} loading={readinessLoading} error={readinessError} />
      </section>

      <form className="card backup-form" aria-label="إنشاء نسخة احتياطية" onSubmit={(event) => void createBackup(event)}>
        <h2>إنشاء الملف المشفّر</h2>
        <p className="muted">
          اختر كلمة حماية من 12 إلى 128 حرفاً واحفظها في مكان آمن. لن تُحفظ الكلمة أو النسخة داخل بيانات المتصفح.
        </p>
        <div className="field">
          <label htmlFor="backup-password">كلمة حماية النسخة</label>
          <input
            id="backup-password"
            name="backup-password"
            type="password"
            autoComplete="new-password"
            required
            disabled={creating}
            value={password}
            aria-invalid={invalidPasswordField === "password" || undefined}
            onChange={(event) => { setPassword(event.currentTarget.value); setInvalidPasswordField(null); }}
          />
        </div>
        <div className="field">
          <label htmlFor="backup-password-confirmation">تأكيد كلمة الحماية</label>
          <input
            id="backup-password-confirmation"
            name="backup-password-confirmation"
            type="password"
            autoComplete="new-password"
            required
            disabled={creating}
            value={confirmation}
            aria-invalid={invalidPasswordField === "confirmation" || undefined}
            onChange={(event) => { setConfirmation(event.currentTarget.value); setInvalidPasswordField(null); }}
          />
        </div>
        <button type="submit" disabled={creating || readinessLoading || !readiness || Boolean(readinessError)}>
          {creating ? "لحظات…" : "إنشاء وتنزيل النسخة"}
        </button>
      </form>
    </main>
  );
}

function Readiness({
  readiness,
  loading,
  error,
}: {
  readiness: BackupReadinessDto | null;
  loading: boolean;
  error: string;
}) {
  if (loading) {
    return <p role="status">لحظات…</p>;
  }
  if (error) {
    return <div className="error" role="alert">{error}</div>;
  }
  if (!readiness || readiness.knownUnsynchronizedTillCount === 0) {
    return <div className="notice" role="status">كل الأجهزة المعروفة متزامنة.</div>;
  }
  return (
    <div className="backup-warning" role="alert" data-testid="backup-unsynchronized-warning">
      <strong>أجهزة معروفة تحتاج إلى مزامنة: {readiness.knownUnsynchronizedTillCount}</strong>
      <p>زامن هذه الأجهزة قبل الاعتماد على الملف كأحدث نسخة كاملة.</p>
      <div className="list-stack">
        {readiness.knownUnsynchronizedTills.map((till) => (
          <article className="backup-till" key={till.deviceId}>
            <span>معرّف الجهاز: <bdi>{till.deviceId}</bdi></span>
            <span>عمليات معلّقة معروفة: {till.pendingOperationCount}</span>
            <span>آخر اتصال: {formatDateTime(till.latestSnapshotAt)}</span>
          </article>
        ))}
      </div>
    </div>
  );
}

function BackupCompleted({ manifest }: { manifest: BackupDownload["manifest"] }) {
  return (
    <section className="notice backup-completed" aria-label="تفاصيل النسخة المنزلة" role="status">
      <h2>تم التحقق من سلامة الملف وبدأ تنزيل النسخة</h2>
      <dl className="backup-metadata">
        <div><dt>معرّف النسخة</dt><dd><bdi>{manifest.backupId}</bdi></dd></div>
        <div><dt>وقت الإنشاء</dt><dd>{formatDateTime(manifest.createdAt)}</dd></div>
        <div><dt>إصدار التنسيق</dt><dd>{manifest.formatVersion}</dd></div>
        <div><dt>إصدار قاعدة البيانات</dt><dd>{manifest.schemaVersion}</dd></div>
        <div><dt>إجمالي السجلات</dt><dd>{manifest.totalRecordCount}</dd></div>
        <div><dt>أجهزة غير مزامنة وقت الالتقاط</dt><dd>{manifest.knownUnsynchronizedTillCount}</dd></div>
      </dl>
      <h3>السجلات حسب القسم</h3>
      <div className="backup-counts" data-testid="backup-section-counts">
        {BACKUP_SECTION_NAMES.map((section) => (
          <div className="backup-count" key={section}>
            <span>{SECTION_LABELS[section]}</span>
            <strong>{manifest.sectionCounts[section]}</strong>
          </div>
        ))}
      </div>
      <p className="backup-checksum">
        بصمة SHA-256 للملف: <bdi>{manifest.sha256}</bdi>
      </p>
    </section>
  );
}

async function sha256(archive: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await archive.arrayBuffer());
  return Array.from(new Uint8Array(digest), (item) => item.toString(16).padStart(2, "0")).join("");
}

function saveOutsideBrowser(archive: Blob, fileName: string) {
  const url = URL.createObjectURL(archive);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Cairo",
  }).format(parsed);
}

function isAbort(caught: unknown): boolean {
  return caught instanceof DOMException && caught.name === "AbortError";
}
