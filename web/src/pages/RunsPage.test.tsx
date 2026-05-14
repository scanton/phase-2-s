import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  // Wait for loading to settle (empty state shows "No runs yet", no table rendered)
  await waitFor(() => {
    expect(screen.queryByText(/no runs yet/i)).toBeTruthy();
  }, { timeout: 1000 });
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
  await waitFor(() => {
    expect(screen.queryByText("Test goal for axe check")).toBeTruthy();
  }, { timeout: 1000 });
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});

// ---------------------------------------------------------------------------
// Filter toolbar tests (Sprint 99)
// ---------------------------------------------------------------------------

test("RunsPage renders filter toolbar with search input and status dropdown", async () => {
  render(
    <MemoryRouter>
      <RunsPage />
    </MemoryRouter>
  );
  expect(screen.getByRole("searchbox", { name: /search by goal/i })).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: /filter by status/i })).toBeInTheDocument();
});

test("RunsPage shows 'No runs match your filters' empty state when filters active and no results", async () => {
  const { fetchRuns } = await import("../api.ts");
  vi.mocked(fetchRuns).mockResolvedValue([]);

  render(
    <MemoryRouter initialEntries={["/?search=nomatch"]}>
      <RunsPage />
    </MemoryRouter>
  );
  // The empty state differs based on whether filters are active
  // With search param in URL, component initialises with search="nomatch"
  await waitFor(() => {
    expect(screen.queryByText(/no runs match your filters/i)).toBeInTheDocument();
  }, { timeout: 1000 });
});

test("RunsPage shows 'No runs yet' empty state with no filters and no results", async () => {
  const { fetchRuns } = await import("../api.ts");
  vi.mocked(fetchRuns).mockResolvedValue([]);

  render(
    <MemoryRouter>
      <RunsPage />
    </MemoryRouter>
  );
  await waitFor(() => {
    expect(screen.queryByText(/no runs yet/i)).toBeInTheDocument();
  }, { timeout: 1000 });
});

test("RunsPage 'Clear filters' button appears when a filter is active", async () => {
  const { fetchRuns } = await import("../api.ts");
  vi.mocked(fetchRuns).mockResolvedValue([]);

  render(
    <MemoryRouter>
      <RunsPage />
    </MemoryRouter>
  );

  const searchInput = screen.getByRole("searchbox", { name: /search by goal/i });
  await userEvent.type(searchInput, "fix");

  await waitFor(() => {
    const clearButtons = screen.getAllByText(/clear filters/i);
    expect(clearButtons.length).toBeGreaterThan(0);
  }, { timeout: 1000 });
});
