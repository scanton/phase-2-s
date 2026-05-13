import { render, screen, act } from "@testing-library/react";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { ElapsedTimer } from "./RunDetailPage.tsx";

beforeEach(() => {
  vi.useFakeTimers();
  // Default matchMedia: reduced-motion OFF
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

afterEach(() => {
  vi.useRealTimers();
});

describe("ElapsedTimer — label", () => {
  test("shows ELAPSED label when isComplete is false", () => {
    render(<ElapsedTimer startTs={new Date().toISOString()} isComplete={false} />);
    expect(screen.getByTitle("Elapsed time").textContent).toContain("ELAPSED");
  });

  test("shows DURATION label when isComplete is true", () => {
    render(<ElapsedTimer startTs={new Date().toISOString()} isComplete={true} />);
    expect(screen.getByTitle("Elapsed time").textContent).toContain("DURATION");
  });

  test("defaults to ELAPSED when isComplete is undefined", () => {
    render(<ElapsedTimer startTs={new Date().toISOString()} />);
    expect(screen.getByTitle("Elapsed time").textContent).toContain("ELAPSED");
  });
});

describe("ElapsedTimer — ticking behavior", () => {
  test("ticks every second when isComplete=false and reduced-motion is off", () => {
    const startTs = new Date(Date.now() - 1000).toISOString();
    render(<ElapsedTimer startTs={startTs} isComplete={false} />);
    const initialText = screen.getByTitle("Elapsed time").textContent;
    act(() => { vi.advanceTimersByTime(2000); });
    const updatedText = screen.getByTitle("Elapsed time").textContent;
    // After 2 more seconds the elapsed value should differ
    expect(updatedText).not.toBe(initialText);
  });

  test("does NOT tick when isComplete=true", () => {
    const startTs = new Date(Date.now() - 5000).toISOString();
    render(<ElapsedTimer startTs={startTs} isComplete={true} />);
    const initialText = screen.getByTitle("Elapsed time").textContent;
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.getByTitle("Elapsed time").textContent).toBe(initialText);
  });

  test("does NOT tick when prefers-reduced-motion is enabled", () => {
    // Override matchMedia to return reduced-motion=true
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => {},
      }),
    });
    const startTs = new Date(Date.now() - 1000).toISOString();
    render(<ElapsedTimer startTs={startTs} isComplete={false} />);
    const initialText = screen.getByTitle("Elapsed time").textContent;
    act(() => { vi.advanceTimersByTime(5000); });
    // Text must stay frozen — no interval running
    expect(screen.getByTitle("Elapsed time").textContent).toBe(initialText);
  });
});
