import { describe, test, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTheme } from "./useTheme.ts";

const STORAGE_KEY = "phase2s-theme";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  vi.clearAllMocks();
});

describe("useTheme — initial state", () => {
  test("defaults to 'system' when no stored preference", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("system");
  });

  test("reads stored theme from localStorage on init", () => {
    localStorage.setItem(STORAGE_KEY, "dark");
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
  });

  test("reads stored 'light' from localStorage on init", () => {
    localStorage.setItem(STORAGE_KEY, "light");
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");
  });
});

describe("useTheme — setTheme", () => {
  test("setTheme('dark') persists to localStorage and applies data-theme", () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme("dark"));
    expect(result.current.theme).toBe("dark");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  test("setTheme('light') persists to localStorage and applies data-theme", () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme("light"));
    expect(result.current.theme).toBe("light");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  test("setTheme('system') removes localStorage key", () => {
    localStorage.setItem(STORAGE_KEY, "dark");
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme("system"));
    expect(result.current.theme).toBe("system");
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  test("setTheme cycles: light → dark → system", () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme("light"));
    expect(result.current.theme).toBe("light");
    act(() => result.current.setTheme("dark"));
    expect(result.current.theme).toBe("dark");
    act(() => result.current.setTheme("system"));
    expect(result.current.theme).toBe("system");
  });
});

describe("useTheme — system mode applies OS preference", () => {
  test("applies 'dark' data-theme when OS prefers dark and theme is 'system'", () => {
    // Override matchMedia to return dark preference
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: query === "(prefers-color-scheme: dark)",
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => {},
      }),
    });
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("system");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    // Restore
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => {},
      }),
    });
  });

  test("applies 'light' data-theme when OS prefers light and theme is 'system'", () => {
    // matchMedia returns false for dark = light preference (default mock)
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("system");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});
