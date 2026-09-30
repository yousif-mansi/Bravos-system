import { useEffect, useState } from "react";

import type { DeliveryAreaDto, WorkspaceDto } from "@bravos/contracts";
import { createDeliveryArea, listDeliveryAreas, updateDeliveryArea } from "../api.ts";
import { egpInputToPiasters, formatEgpFromPiasters, piastersToEgpInput } from "../money.ts";
import { EmptyState } from "../ui/EmptyState.tsx";
import { useRevealFeedback } from "../ui/useRevealFeedback.ts";

type Draft = { nameAr: string; feeEgp: string; active: boolean };
const EMPTY: Draft = { nameAr: "", feeEgp: "", active: true };

export default function DeliveryAreasPage({ workspace }: { workspace: WorkspaceDto }) {
  const [areas, setAreas] = useState<DeliveryAreaDto[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const editFeedback = useRevealFeedback<HTMLElement>();
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => { void reload(); }, []);

  async function reload() {
    setLoading(true); setLoadFailed(false); setError("");
    try { setAreas(await listDeliveryAreas()); }
    catch { setError("تعذر تحميل مناطق التوصيل."); setLoadFailed(true); }
    finally { setLoading(false); }
  }

  function edit(area: DeliveryAreaDto) {
    setEditingId(area.id);
    setDraft({ nameAr: area.nameAr, feeEgp: piastersToEgpInput(area.feePiasters), active: area.active });
    setMessage(""); setError("");
    editFeedback.reveal();
  }

  async function save() {
    setSaving(true); setMessage(""); setError("");
    try {
      const feePiasters = egpInputToPiasters(draft.feeEgp);
      if (feePiasters === null) throw new Error("رسوم التوصيل غير صالحة.");
      const input = { nameAr: draft.nameAr, feePiasters, active: draft.active };
      if (editingId) await updateDeliveryArea(editingId, input);
      else await createDeliveryArea(input);
      setDraft(EMPTY); setEditingId(null);
      editFeedback.clearHighlight();
      await reload();
      setMessage("تم حفظ منطقة التوصيل.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر حفظ منطقة التوصيل.");
    } finally { setSaving(false); }
  }

  return (
    <main className="shell">
      <header className="page-hero">
        <h1>مناطق التوصيل</h1>
      </header>
      <section ref={editFeedback.regionRef} className={`card reveal-feedback${editFeedback.highlighted ? " is-highlighted" : ""}`}>
        <h2 ref={editFeedback.headingRef} tabIndex={-1}>{editingId ? "تعديل المنطقة" : "إضافة منطقة"}</h2>
        <form aria-label="بيانات منطقة التوصيل" aria-busy={saving} onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <fieldset disabled={saving}>
          <div className="field"><label htmlFor="area-name">اسم المنطقة</label><input id="area-name" value={draft.nameAr} onChange={(event) => setDraft({ ...draft, nameAr: event.target.value })} required /></div>
          <div className="field"><label htmlFor="area-fee">رسوم التوصيل بالجنيه</label><input id="area-fee" dir="ltr" inputMode="decimal" value={draft.feeEgp} onChange={(event) => setDraft({ ...draft, feeEgp: event.target.value })} required /></div>
          <label className="checkbox-row"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} /> متاحة في صفحة الطلب</label>
          <div className="form-actions">
            {editingId ? <button className="secondary" type="button" onClick={() => { setEditingId(null); setDraft(EMPTY); editFeedback.clearHighlight(); }}>إلغاء</button> : null}
            <button type="submit" disabled={saving}>{saving ? "جارٍ الحفظ…" : "حفظ"}</button>
          </div>
          </fieldset>
        </form>
        {message ? <p role="status" className="notice">{message}</p> : null}
        {error ? <p role="alert" className="error">{error}</p> : null}
        {loadFailed ? <button className="secondary" type="button" disabled={loading || saving} onClick={() => void reload()}>إعادة تحميل مناطق التوصيل</button> : null}
      </section>
      <section className="card">
        <h2>المناطق المسجلة</h2>
        {loading ? <p role="status">جارٍ تحميل مناطق التوصيل…</p> : !loadFailed && areas.length === 0 ? <EmptyState title="لسه مفيش مناطق" message="حدد مناطق التوصيل عشان الطلبات تمشي." /> : (
          <div className="list-stack">{areas.map((area) => (
            <article className="summary-card" key={area.id}>
              <div><strong>{area.nameAr}</strong><p className="muted">{formatEgpFromPiasters(area.feePiasters)} · {area.active ? "متاحة" : "موقوفة"}</p></div>
              <button className="secondary" type="button" disabled={saving} aria-pressed={editingId === area.id} onClick={() => edit(area)}>تعديل</button>
            </article>
          ))}</div>
        )}
      </section>
    </main>
  );
}
