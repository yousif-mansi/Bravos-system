import { type ComponentPropsWithoutRef, type KeyboardEvent, type ReactNode, type Ref, useEffect, useId, useRef } from "react";

type TabItem = { id: string; label: string; count?: number; disabled?: boolean };

export function BusinessTabs({ id, label, value, items, onChange }: {
  id: string;
  label: string;
  value: string;
  items: readonly TabItem[];
  onChange: (value: string) => void;
}) {
  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0 || buttons.length === 0) return;
    event.preventDefault();
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    let next = event.key === 'ArrowRight' ? current + (rtl ? -1 : 1) : current + (rtl ? 1 : -1);
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = buttons.length - 1;
    buttons[(next + buttons.length) % buttons.length]?.focus();
  }

  return (
    <div className="business-tabs" role="tablist" aria-label={label} onKeyDown={moveFocus}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          id={`${id}-tab-${item.id}`}
          aria-controls={`${id}-panel-${item.id}`}
          aria-selected={value === item.id}
          tabIndex={value === item.id ? 0 : -1}
          disabled={item.disabled}
          onClick={() => onChange(item.id)}
        >
          <span>{item.label}</span>
          {item.count !== undefined ? <span className="business-tab-count">{item.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function TablePagination({ page, pageSize, total, onPageChange, label = "تصفح السجلات" }: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  label?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(page, 1), pages);
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const to = Math.min(current * pageSize, total);
  if (total <= pageSize) return null;
  return (
    <nav className="business-pagination" aria-label={label}>
      <span aria-live="polite">{from}–{to} من {total}</span>
      <div>
        <button type="button" className="secondary" disabled={current === 1} onClick={() => onPageChange(current - 1)}>السابق</button>
        <span>{current} / {pages}</span>
        <button type="button" className="secondary" disabled={current === pages} onClick={() => onPageChange(current + 1)}>التالي</button>
      </div>
    </nav>
  );
}

export function Modal({ open, title, description, onClose, children, wide = false, closeDisabled = false }: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  closeDisabled?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`business-modal${wide ? " is-wide" : ""}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => { event.preventDefault(); if (!closeDisabled) onClose(); }}
      onClick={(event) => {
        if (event.target !== event.currentTarget || closeDisabled) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
      }}
    >
      <header className="business-modal-header">
        <div><h2 id={titleId}>{title}</h2>{description ? <p id={descriptionId}>{description}</p> : null}</div>
        <button type="button" className="secondary business-close" aria-label={`إغلاق ${title}`} disabled={closeDisabled} onClick={onClose}>×</button>
      </header>
      {open ? <div className="business-modal-body">{children}</div> : null}
    </dialog>
  );
}

export function DetailPanel({ title, onClose, children, actions, className = "", ...rest }: Omit<ComponentPropsWithoutRef<"aside">, "title"> & {
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  ref?: Ref<HTMLElement>;
}) {
  return (
    <aside className={`business-detail-panel ${className}`} aria-label={title} {...rest}>
      <header className="business-detail-header">
        <h2>{title}</h2>
        <button type="button" className="secondary business-close" aria-label={`إغلاق ${title}`} onClick={onClose}>×</button>
      </header>
      <div className="business-detail-body">{children}</div>
      {actions ? <footer className="business-actions">{actions}</footer> : null}
    </aside>
  );
}
