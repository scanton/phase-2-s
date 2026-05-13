import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { axe } from "vitest-axe";
import { expect, test, vi, beforeEach } from "vitest";
import RunsPage from "./RunsPage.tsx";

// Mock the API
vi.mock("../api.ts", () => ({
  fetchRuns: vi.fn(() => Promise.resolve([])),
  fetchActiveRuns: vi.fn(() => Promise.resolve([])),
}));

beforeEach(() => {
  // Reset the document theme
  document.documentElement.removeAttribute("data-theme");
});

test("RunsPage has no axe violations in empty state", async () => {
  const { container } = render(
    <MemoryRouter>
      <RunsPage />
    </MemoryRouter>
  );
  // Wait for loading to settle
  await waitFor(() => {
    expect(container.querySelector('[aria-busy="false"]')).toBeTruthy();
  }, { timeout: 1000 }).catch(() => {
    // If no aria-busy table visible, just wait a tick
  });
  await new Promise(r => setTimeout(r, 100));
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});

test("RunsPage has no axe violations with mock data", async () => {
  const { fetchRuns } = await import("../api.ts");
  vi.mocked(fetchRuns).mockResolvedValueOnce([
    {
      specHash: "abc12345",
      ts: new Date().toISOString(),
      goal: "Test goal for axe check",
      success: true,
      durationMs: 5000,
      subtaskCount: 3,
      specPath: "/tmp/spec.md",
      roles: ["worker"],
      runLogPath: "/tmp/run.jsonl",
      rounds: 1,
    },
  ]);
  const { container } = render(
    <MemoryRouter>
      <RunsPage />
    </MemoryRouter>
  );
  await new Promise(r => setTimeout(r, 100));
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
