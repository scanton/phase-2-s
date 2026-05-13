import { render, screen, fireEvent } from "@testing-library/react";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import CompletionBanner from "./CompletionBanner.tsx";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CompletionBanner — rendering", () => {
  test("renders success message when success=true", () => {
    const onDismiss = vi.fn();
    render(<CompletionBanner success={true} onDismiss={onDismiss} />);
    expect(screen.getByText("Run complete — success")).toBeTruthy();
  });

  test("renders failure message when success=false", () => {
    const onDismiss = vi.fn();
    render(<CompletionBanner success={false} onDismiss={onDismiss} />);
    expect(screen.getByText("Run failed")).toBeTruthy();
  });

  test("has role='status' and aria-live='polite' for screen readers", () => {
    const onDismiss = vi.fn();
    render(<CompletionBanner success={true} onDismiss={onDismiss} />);
    const banner = screen.getByRole("status");
    expect(banner).toBeTruthy();
    expect(banner.getAttribute("aria-live")).toBe("polite");
  });
});

describe("CompletionBanner — auto-dismiss timer", () => {
  test("calls onDismiss after 3 seconds", () => {
    const onDismiss = vi.fn();
    render(<CompletionBanner success={true} onDismiss={onDismiss} />);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  test("does NOT call onDismiss before 3 seconds elapse", () => {
    const onDismiss = vi.fn();
    render(<CompletionBanner success={true} onDismiss={onDismiss} />);
    vi.advanceTimersByTime(2999);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  test("clears timer on unmount (no double-call)", () => {
    const onDismiss = vi.fn();
    const { unmount } = render(<CompletionBanner success={true} onDismiss={onDismiss} />);
    unmount();
    vi.advanceTimersByTime(5000);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe("CompletionBanner — click to dismiss", () => {
  test("calls onDismiss immediately on click", () => {
    const onDismiss = vi.fn();
    render(<CompletionBanner success={true} onDismiss={onDismiss} />);
    const banner = screen.getByRole("status");
    fireEvent.click(banner);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  test("click dismiss works for failure banner too", () => {
    const onDismiss = vi.fn();
    render(<CompletionBanner success={false} onDismiss={onDismiss} />);
    const banner = screen.getByRole("status");
    fireEvent.click(banner);
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

describe("CompletionBanner — keyboard dismiss", () => {
  test("Enter key calls onDismiss", () => {
    const onDismiss = vi.fn();
    render(<CompletionBanner success={true} onDismiss={onDismiss} />);
    const banner = screen.getByRole("status");
    fireEvent.keyDown(banner, { key: "Enter" });
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  test("Space key calls onDismiss", () => {
    const onDismiss = vi.fn();
    render(<CompletionBanner success={true} onDismiss={onDismiss} />);
    const banner = screen.getByRole("status");
    fireEvent.keyDown(banner, { key: " " });
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  test("timer does NOT reset when stable onDismiss identity is re-passed", () => {
    // Regression guard for the useCallback fix: a stable function reference
    // must not restart the 3s countdown on re-render
    const onDismiss = vi.fn();
    const { rerender } = render(<CompletionBanner success={true} onDismiss={onDismiss} />);
    vi.advanceTimersByTime(2500);
    // Re-render with same stable reference (simulating useCallback in parent)
    rerender(<CompletionBanner success={true} onDismiss={onDismiss} />);
    vi.advanceTimersByTime(500);
    // Total elapsed: 3000ms — should have fired exactly once
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
