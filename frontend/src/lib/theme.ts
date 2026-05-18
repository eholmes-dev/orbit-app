import { useEffect, useState, useCallback } from "react";

export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "orbit:theme";

function resolveSystem(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function readStored(): ThemeMode {
  if (typeof localStorage === "undefined") return "system";
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return "system";
}

/** Apply the theme to the document root. Called before React paints (in
 *  main.tsx) so we never flash the wrong palette on first render. */
export function applyTheme(mode: ThemeMode): void {
  const resolved = mode === "system" ? resolveSystem() : mode;
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
}

/** Read the persisted preference and apply it. Safe to call before React
 *  mounts — avoids the white-flash on dark-mode page loads. */
export function bootstrapTheme(): void {
  applyTheme(readStored());
}

/** React hook for components that want to read/update the theme preference. */
export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(() => readStored());

  useEffect(() => {
    applyTheme(mode);
    localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  // Follow system changes only when the user picked "system".
  useEffect(() => {
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handle = () => applyTheme("system");
    mq.addEventListener("change", handle);
    return () => mq.removeEventListener("change", handle);
  }, [mode]);

  const setTheme = useCallback((next: ThemeMode) => setMode(next), []);

  // For UI affordances that need to know what's currently shown (e.g. an
  // icon toggle), this resolves "system" to the actual rendered theme.
  const resolved: "light" | "dark" =
    mode === "system" ? resolveSystem() : mode;

  return { mode, setTheme, resolved };
}
