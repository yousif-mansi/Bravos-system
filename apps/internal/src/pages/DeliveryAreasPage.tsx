import { useEffect, useState } from "react";

import type { DeliveryAreaDto, WorkspaceDto } from "@bravos/contracts";
import { createDeliveryArea, listDeliveryAreas, updateDeliveryArea } from "../api.ts";
import { egpInputToPiasters, formatEgpFromPiasters, piastersToEgpInput } from "../money.ts";
import { EmptyState } from "../ui/EmptyState.tsx";

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

  useEffect(() => { void reload(); }, []);

  async function reload() {
    try { setAreas(await listDeliveryAreas()); }
    catch { setError("تعذر تحميل مناطق التوصيل."); }
    finally { setLoading(false); }
  }

  function edit(area: DeliveryAreaDto) {
    setEditingId(area.id);
    setDraft({ nameAr: area.nameAr, feeEgp: piastersToEgpInput(area.feePiasters), active: area.active });
    setMessage(""); setError("");
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
      <section className="card">
        <h2>{editingId ? "تعديل المنطقة" : "إضافة منطقة"}</h2>
        <form aria-label="بيانات منطقة التوصيل" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <div className="field"><label htmlFor="area-name">اسم المنطقة</label><input id="area-name" value={draft.nameAr} onChange={(event) => setDraft({ ...draft, nameAr: event.target.value })} required /></div>
          <div className="field"><label htmlFor="area-fee">رسوم التوصيل بالجنيه</label><input id="area-fee" dir="ltr" inputMode="decimal" value={draft.feeEgp} onChange={(event) => setDraft({ ...draft, feeEgp: event.target.value })} required /></div>
          <label className="checkbox-row"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} /> متاحة في صفحة الطلب</label>
          <div className="form-actions">
            {editingId ? <button className="secondary" type="button" onClick={() => { setEditingId(null); setDraft(EMPTY); }}>إلغاء</button> : null}
            <button type="submit" disabled={saving}>{saving ? "جارٍ الحفظ…" : "حفظ"}</button>
          </div>
        </form>
        {message ? <p role="status" className="notice">{message}</p> : null}
        {error ? <p role="alert" className="error">{error}</p> : null}
      </section>
      <section className="card">
        <h2>المناطق المسجلة</h2>
        {loading ? <p role="status">لحظات…</p> : areas.length === 0 ? <EmptyState title="لسه مفيش مناطق" message="حدد مناطق التوصيل عشان الطلبات تمشي." /> : (
          <div className="list-stack">{areas.map((area) => (
            <article className="summary-card" key={area.id}>
              <div><strong>{area.nameAr}</strong><p className="muted">{formatEgpFromPiasters(area.feePiasters)} · {area.active ? "متاحة" : "موقوفة"}</p></div>
              <button className="secondary" type="button" onClick={() => edit(area)}>تعديل</button>
            </article>
          ))}</div>
        )}
      </section>
    </main>
  );
}
