export type BravosTheme = "dark" | "light";

const STORAGE_KEY = "bravos-theme";

export function readTheme(): BravosTheme {
  if (typeof localStorage === "undefined") return "dark";
  return localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
}

export function applyTheme(theme: BravosTheme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(STORAGE_KEY, theme);
}

export function initTheme() {
  applyTheme(readTheme());
}

export function toggleTheme(): BravosTheme {
  const next: BravosTheme = readTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  return next;
}
