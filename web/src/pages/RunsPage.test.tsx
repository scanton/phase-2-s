import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { axe } from "vitest-axe";
import { expect, test, vi, beforeEach } from "vitest";
import RunsPage from "./RunsPage.tsx";
import type { ConductLogEntry } from "../types.ts";

// Mock the API. RunsPage fetches via the paginated endpoint (Sprint 101).
vi.mock("../api.ts", () => ({
  fetchRunsPage: vi.fn(() => Promise.resolve({ runs: [], total: 0, hasMore: false })),
  fetchActiveRuns: vi.fn(() => Promise.resolve([])),
}));

function page(runs: ConductLogEntry[], total = runs.length, hasMore = false) {
  return { runs, total, hasMore };
}

function entry(overrides: Partial<ConductLogEntry> = {}): ConductLogEntry {
  return {
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
    ...overrides,
  };
}

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
  const { fetchRunsPage } = await import("../api.ts");
  vi.mocked(fetchRunsPage).mockResolvedValueOnce(page([entry()]));
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
  const { fetchRunsPage } = await import("../api.ts");
  vi.mocked(fetchRunsPage).mockResolvedValue(page([]));

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
  const { fetchRunsPage } = await import("../api.ts");
  vi.mocked(fetchRunsPage).mockResolvedValue(page([]));

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
  const { fetchRunsPage } = await import("../api.ts");
  vi.mocked(fetchRunsPage).mockResolvedValue(page([]));

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

// ---------------------------------------------------------------------------
// Pagination tests (Sprint 101)
// ---------------------------------------------------------------------------

test("RunsPage shows Load More button when hasMore is true", async () => {
  const { fetchRunsPage } = await import("../api.ts");
  vi.mocked(fetchRunsPage).mockResolvedValueOnce(page([entry()], 120, true));

  render(
    <MemoryRouter>
      <RunsPage />
    </MemoryRouter>
  );
  await waitFor(() => {
    expect(screen.getByRole("button", { name: /load more \(1 of 120\)/i })).toBeInTheDocument();
  }, { timeout: 1000 });
});

test("RunsPage hides Load More button when hasMore is false", async () => {
  const { fetchRunsPage } = await import("../api.ts");
  vi.mocked(fetchRunsPage).mockResolvedValueOnce(page([entry()]));

  render(
    <MemoryRouter>
      <RunsPage />
    </MemoryRouter>
  );
  await waitFor(() => {
    expect(screen.queryByText("Test goal for axe check")).toBeTruthy();
  }, { timeout: 1000 });
  expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
});

test("RunsPage Load More appends the next page", async () => {
  const { fetchRunsPage } = await import("../api.ts");
  vi.mocked(fetchRunsPage)
    .mockResolvedValueOnce(page([entry({ specHash: "aaaa1111", goal: "First page goal" })], 2, true))
    .mockResolvedValueOnce(page([entry({ specHash: "bbbb2222", goal: "Second page goal" })], 2, false));

  render(
    <MemoryRouter>
      <RunsPage />
    </MemoryRouter>
  );
  await waitFor(() => {
    expect(screen.queryByText("First page goal")).toBeTruthy();
  }, { timeout: 1000 });

  await userEvent.click(screen.getByRole("button", { name: /load more/i }));

  await waitFor(() => {
    expect(screen.queryByText("Second page goal")).toBeTruthy();
  }, { timeout: 1000 });
  // Both pages visible; button gone (hasMore false)
  expect(screen.queryByText("First page goal")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
});
