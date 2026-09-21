import { type ReactNode, useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import type { WorkspaceDto } from "@bravos/contracts";
import { brandAssets } from "../brand.ts";
import { signOutPreservingSales } from "../session.ts";
import { readTheme, toggleTheme, type BravosTheme } from "../theme.ts";
import { navigationFor } from "./nav.ts";

function NavGlyph({ path }: { path: string }) {
  const d = glyphPath(path);
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d={d} />
    </svg>
  );
}

function glyphPath(path: string): string {
  if (path === "/workspace") return "M2 7.5 8 2.5 14 7.5V14H9.5V10H6.5V14H2Z";
  if (path === "/lookup") return "M3 4h10M3 8h10M3 12h6";
  if (path === "/sales") return "M3 13V6l5-3 5 3v7H3Z";
  if (path === "/catalog") return "M3 3h10v10H3Z M6 3v10";
  if (path === "/reports") return "M3 13V8h3v5H3Zm4 0V4h3v9H7Zm4 0V6h3v7h-3Z";
  if (path === "/online-orders") return "M3 5h10v8H3Z M5 3h6";
  if (path === "/receiving") return "M8 2v9M4.5 8 8 11.5 11.5 8M3 14h10";
  if (path === "/staff") return "M8 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM3 14c0-2.5 2.2-4 5-4s5 1.5 5 4";
  return "M3 8h10M8 3v10";
}

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
  const [collapsed, setCollapsed] = useState(() => typeof localStorage !== "undefined" && localStorage.getItem("bravos-sidebar") === "collapsed");
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
    <div className={`app-frame${collapsed ? " is-collapsed" : ""}`}>
      <a className="skip-link" href="#main-content">انتقل إلى المحتوى</a>
      <aside className={`app-sidebar${menuOpen ? " is-open" : ""}`} id="app-sidebar">
        <div className="sidebar-brand">
          <img
            className="brand-mark-img"
            src={markSrc}
            alt=""
            width={40}
            height={43}
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
                  aria-label={item.ariaName ?? item.name}
                  title={item.name}
                  className={({ isActive }) => `nav-link${isActive ? " is-active" : ""}`}
                  onClick={() => setMenuOpen(false)}
                >
                  <NavGlyph path={item.to} />
                  <span>{item.name}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <button
          className="ghost sidebar-collapse"
          type="button"
          onClick={() => {
            const next = !collapsed;
            setCollapsed(next);
            localStorage.setItem("bravos-sidebar", next ? "collapsed" : "expanded");
          }}
        >
          {collapsed ? "›" : "طي القائمة"}
        </button>
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
