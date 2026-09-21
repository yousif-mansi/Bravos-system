import type { ReactNode } from "react";

export function EmptyState({
  title,
  message,
  children,
}: {
  title: string;
  message: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{message}</p>
      {children ? <div className="empty-state-actions">{children}</div> : null}
    </div>
  );
}
