import "@testing-library/jest-dom";
import "vitest-axe/extend-expect";
import { configureAxe } from "vitest-axe";
import * as matchers from "vitest-axe/matchers";
import { expect } from "vitest";

expect.extend(matchers);

configureAxe({
  rules: {
    // Disable color-contrast in tests (we test against mocked DOM, not real colors)
    "color-contrast": { enabled: false },
  },
});

// Mock localStorage for tests
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(window, "localStorage", {
  writable: true,
  value: localStorageMock,
});

// Mock sessionStorage for tests
const sessionStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(window, "sessionStorage", {
  writable: true,
  value: sessionStorageMock,
});

// Mock window.matchMedia for tests
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

// Mock Notification API
Object.defineProperty(window, "Notification", {
  writable: true,
  value: {
    permission: "default" as NotificationPermission,
    requestPermission: async () => "default" as NotificationPermission,
  },
});
