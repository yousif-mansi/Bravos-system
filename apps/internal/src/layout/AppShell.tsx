import { type ReactNode, useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import type { WorkspaceDto } from "@bravos/contracts";
import { brandAssets } from "../brand.ts";
import { signOutPreservingSales } from "../session.ts";
import { readTheme, toggleTheme, type BravosTheme } from "../theme.ts";
import { navigationFor } from "./nav.ts";

export function AppShell({
  workspace,
  onChanged,
  children,
}: {
  workspace: WorkspaceDto;
  onChanged: (workspace: WorkspaceDto | null) => void;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState<BravosTheme>(() => (typeof document === "undefined" ? "dark" : readTheme()));

  useEffect(() => {
    setTheme(readTheme());
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
    setMenuOpen(false);
  }, [workspace.activeBranch?.id]);

  async function logout() {
    const accepted = await signOutPreservingSales(workspace.staff.id);
    if (!accepted) return;
    await onChanged(null);
    navigate("/login");
  }

  const groups = navigationFor(workspace, online);
  const markSrc = theme === "light" ? brandAssets.markBlack : brandAssets.markIvory;

  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">انتقل إلى المحتوى</a>
      <aside className={`app-sidebar${menuOpen ? " is-open" : ""}`} id="app-sidebar">
        <div className="sidebar-brand">
          <img
            className="brand-mark-img"
            src={markSrc}
            alt=""
            width={48}
            height={52}
          />
        </div>
        <nav className="sidebar-nav" aria-label="التنقل الداخلي">
          {groups.map((group) => (
            <div className="nav-group" key={group.label}>
              <p className="nav-group-label">{group.label}</p>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/workspace"}
                  aria-label={item.ariaName}
                  className={({ isActive }) => `nav-link${isActive ? " is-active" : ""}`}
                  onClick={() => setMenuOpen(false)}
                >
                  {item.name}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      {menuOpen ? <button className="sidebar-backdrop" type="button" aria-label="إغلاق القائمة" onClick={() => setMenuOpen(false)} /> : null}
      <div className="app-body">
        <header className="app-topbar">
          <button
            className="menu-toggle ghost"
            type="button"
            aria-expanded={menuOpen}
            aria-controls="app-sidebar"
            onClick={() => setMenuOpen((open) => !open)}
          >
            القائمة
          </button>
          <div className="topbar-context">
            <p className="topbar-user">{workspace.staff.displayName}</p>
            {workspace.activeBranch ? (
              <Link
                className="branch-banner"
                to="/select-branch"
                data-testid="active-branch"
                aria-label={`تغيير الفرع ${workspace.activeBranch.nameAr}`}
              >
                {workspace.activeBranch.nameAr}
              </Link>
            ) : (
              <p className="branch-banner" data-testid="active-branch">بدون فرع</p>
            )}
          </div>
          <div className="topbar-status">
            {online ? null : <span className="status-chip is-warn">بدون إنترنت</span>}
            <button
              className="ghost"
              type="button"
              onClick={() => setTheme(toggleTheme())}
            >
              {theme === "dark" ? "فاتح" : "داكن"}
            </button>
            <button className="secondary" type="button" onClick={() => void logout()}>
              تسجيل الخروج
            </button>
          </div>
        </header>
        <div className="app-content" id="main-content">
          {children}
        </div>
      </div>
    </div>
  );
}
