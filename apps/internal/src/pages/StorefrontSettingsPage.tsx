import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { StorefrontContactsDto, WorkspaceDto } from "@bravos/contracts";
import { getStorefrontContacts, updateStorefrontContacts } from "../api.ts";

type Draft = Pick<StorefrontContactsDto, "whatsappUrl" | "facebookUrl" | "instagramUrl" | "tiktokUrl">;

const EMPTY: Draft = {
  whatsappUrl: null,
  facebookUrl: null,
  instagramUrl: null,
  tiktokUrl: null,
};

export default function StorefrontSettingsPage({
  workspace,
}: {
  workspace: WorkspaceDto;
  onChanged: (workspace: WorkspaceDto | null) => void;
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void getStorefrontContacts()
      .then((contacts) => {
        if (!cancelled) setDraft(toDraft(contacts));
      })
      .catch(() => {
        if (!cancelled) setError("تعذر تحميل روابط المتجر.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const saved = await updateStorefrontContacts(draft);
      setDraft(toDraft(saved));
      setMessage("تم حفظ روابط المتجر.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر حفظ روابط المتجر.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="shell">
      <header className="brand">
        <div>
          <h1>روابط المتجر</h1>
          <p className="muted">{workspace.staff.displayName}</p>
        </div>
        <Link className="button secondary" to="/workspace">مساحة العمل</Link>
      </header>
      <section className="card">
        <p className="muted">أدخل الروابط الحقيقية فقط. اترك أي رابط فارغاً لإخفائه من المتجر.</p>
        {loading ? <p>جارٍ التحميل…</p> : (
          <form
            aria-label="إعداد روابط التواصل في المتجر"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <ContactField id="whatsapp-url" label="رابط واتساب" value={draft.whatsappUrl} onChange={(value) => setDraft({ ...draft, whatsappUrl: value })} />
            <ContactField id="facebook-url" label="رابط فيسبوك" value={draft.facebookUrl} onChange={(value) => setDraft({ ...draft, facebookUrl: value })} />
            <ContactField id="instagram-url" label="رابط إنستجرام" value={draft.instagramUrl} onChange={(value) => setDraft({ ...draft, instagramUrl: value })} />
            <ContactField id="tiktok-url" label="رابط تيك توك" value={draft.tiktokUrl} onChange={(value) => setDraft({ ...draft, tiktokUrl: value })} />
            <button type="submit" disabled={saving}>{saving ? "جارٍ الحفظ…" : "حفظ الروابط"}</button>
          </form>
        )}
        {message ? <p role="status" className="notice">{message}</p> : null}
        {error ? <p role="alert" className="error">{error}</p> : null}
      </section>
    </main>
  );
}

function toDraft(contacts: StorefrontContactsDto): Draft {
  return {
    whatsappUrl: contacts.whatsappUrl,
    facebookUrl: contacts.facebookUrl,
    instagramUrl: contacts.instagramUrl,
    tiktokUrl: contacts.tiktokUrl,
  };
}

function ContactField({ id, label, value, onChange }: {
  id: string;
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="url"
        dir="ltr"
        inputMode="url"
        placeholder="https://"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
      />
    </div>
  );
}
