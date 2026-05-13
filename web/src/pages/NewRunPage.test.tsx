/**
 * Tests for NewRunPage (Sprint 98)
 *
 * Covers:
 * 1. Form renders with goal textarea, template picker, model toggle, parallel checkbox, buttons
 * 2. Run button is disabled when goal is empty
 * 3. Run button is enabled when goal has text
 * 4. Lint button calls postLint and shows results
 * 5. Lint error is displayed when postLint throws
 * 6. Submit calls postRun and navigates to /runs/:id on success
 * 7. Submit error banner is shown when postRun throws
 * 8. No axe violations in default state
 * 9. Lint button is disabled when goal is empty (F4)
 * 10. Parallel checkbox toggles state (F15)
 * 11. Model tier buttons have correct aria-pressed state (F14)
 * 12. Lint button shows invalid errors (F6)
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { axe } from "vitest-axe";
import { expect, test, vi, beforeEach, describe } from "vitest";
import NewRunPage from "./NewRunPage.tsx";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("../api.ts", () => ({
  postLint: vi.fn(),
  postRun: vi.fn(),
}));

beforeEach(() => {
  mockNavigate.mockReset();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPage() {
  return render(
    <MemoryRouter>
      <NewRunPage />
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NewRunPage", () => {
  test("renders goal textarea, template picker, model toggle, parallel checkbox, lint button, run button", () => {
    renderPage();
    expect(screen.getByLabelText(/goal/i)).toBeTruthy();
    expect(screen.getByLabelText(/template/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /check goal/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^run$/i })).toBeTruthy();
    // Model tier buttons
    expect(screen.getByRole("button", { name: /fast/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /smart/i })).toBeTruthy();
    // Parallel checkbox
    expect(screen.getByRole("checkbox")).toBeTruthy();
  });

  test("Run button is disabled when goal is empty", () => {
    renderPage();
    const runBtn = screen.getByRole("button", { name: /^run$/i }) as HTMLButtonElement;
    expect(runBtn.disabled).toBe(true);
  });

  test("Run button becomes enabled when goal has text", () => {
    renderPage();
    const textarea = screen.getByLabelText(/goal/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Build a login page" } });
    const runBtn = screen.getByRole("button", { name: /^run$/i }) as HTMLButtonElement;
    expect(runBtn.disabled).toBe(false);
  });

  test("Lint button calls postLint and shows valid result", async () => {
    const { postLint } = await import("../api.ts");
    vi.mocked(postLint).mockResolvedValueOnce({ valid: true, errors: [] });

    renderPage();
    const textarea = screen.getByLabelText(/goal/i);
    fireEvent.change(textarea, { target: { value: "Build a login page" } });

    const lintBtn = screen.getByRole("button", { name: /check goal/i });
    fireEvent.click(lintBtn);

    await waitFor(() => {
      expect(screen.getByText(/looks good/i)).toBeTruthy();
    });
    expect(vi.mocked(postLint)).toHaveBeenCalledWith({ goal: "Build a login page", template: undefined });
  });

  test("Lint button shows lint errors when valid is false", async () => {
    const { postLint } = await import("../api.ts");
    vi.mocked(postLint).mockResolvedValueOnce({ valid: false, errors: ["Missing ## Goal section", "Empty constraints"] });

    renderPage();
    const textarea = screen.getByLabelText(/goal/i);
    fireEvent.change(textarea, { target: { value: "bad goal" } });
    fireEvent.click(screen.getByRole("button", { name: /check goal/i }));

    await waitFor(() => {
      expect(screen.getByText(/missing ## goal section/i)).toBeTruthy();
    });
  });

  test("shows lint error message when postLint throws", async () => {
    const { postLint } = await import("../api.ts");
    vi.mocked(postLint).mockRejectedValueOnce(new Error("phase2s not found"));

    renderPage();
    fireEvent.change(screen.getByLabelText(/goal/i), { target: { value: "Build something" } });
    fireEvent.click(screen.getByRole("button", { name: /check goal/i }));

    await waitFor(() => {
      expect(screen.getByText(/phase2s not found/i)).toBeTruthy();
    });
  });

  test("submit calls postRun and navigates to /runs/:id on success", async () => {
    const { postRun } = await import("../api.ts");
    vi.mocked(postRun).mockResolvedValueOnce({ id: "2026-05-12T22-34-57-000" });

    renderPage();
    fireEvent.change(screen.getByLabelText(/goal/i), { target: { value: "Build a login page" } });
    fireEvent.click(screen.getByRole("button", { name: /^run$/i }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/runs/2026-05-12T22-34-57-000");
    });
    expect(vi.mocked(postRun)).toHaveBeenCalledWith({
      goal: "Build a login page",
      template: undefined,
      modelTier: "smart",
      parallel: false,
    });
  });

  test("shows error banner when postRun throws", async () => {
    const { postRun } = await import("../api.ts");
    vi.mocked(postRun).mockRejectedValueOnce(new Error("Lint failed: missing goal section"));

    renderPage();
    fireEvent.change(screen.getByLabelText(/goal/i), { target: { value: "Build something" } });
    fireEvent.click(screen.getByRole("button", { name: /^run$/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
      expect(screen.getByText(/lint failed/i)).toBeTruthy();
    });
  });

  test("no axe violations in default state", async () => {
    const { container } = renderPage();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  test("no axe violations with goal filled in", async () => {
    const { container } = renderPage();
    fireEvent.change(screen.getByLabelText(/goal/i), { target: { value: "Build a REST API" } });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  test("Lint button is disabled when goal is empty", () => {
    renderPage();
    const lintBtn = screen.getByRole("button", { name: /check goal/i }) as HTMLButtonElement;
    expect(lintBtn.disabled).toBe(true);
  });

  test("Lint button becomes enabled when goal has text", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/goal/i), { target: { value: "Build something" } });
    const lintBtn = screen.getByRole("button", { name: /check goal/i }) as HTMLButtonElement;
    expect(lintBtn.disabled).toBe(false);
  });

  test("parallel checkbox starts unchecked and can be toggled", () => {
    renderPage();
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
  });

  test("model tier Smart button is aria-pressed=true by default, Fast is false", () => {
    renderPage();
    const fastBtn = screen.getByRole("button", { name: /fast/i });
    const smartBtn = screen.getByRole("button", { name: /smart/i });
    expect(fastBtn.getAttribute("aria-pressed")).toBe("false");
    expect(smartBtn.getAttribute("aria-pressed")).toBe("true");
  });

  test("clicking Fast button switches aria-pressed to true, Smart to false", () => {
    renderPage();
    const fastBtn = screen.getByRole("button", { name: /fast/i });
    const smartBtn = screen.getByRole("button", { name: /smart/i });
    fireEvent.click(fastBtn);
    expect(fastBtn.getAttribute("aria-pressed")).toBe("true");
    expect(smartBtn.getAttribute("aria-pressed")).toBe("false");
  });

  test("postRun is called with modelTier=fast when Fast is selected", async () => {
    const { postRun } = await import("../api.ts");
    vi.mocked(postRun).mockResolvedValueOnce({ id: "2026-05-12T22-34-57-000" });

    renderPage();
    fireEvent.change(screen.getByLabelText(/goal/i), { target: { value: "Build something" } });
    fireEvent.click(screen.getByRole("button", { name: /fast/i }));
    fireEvent.click(screen.getByRole("button", { name: /^run$/i }));

    await waitFor(() => {
      expect(vi.mocked(postRun)).toHaveBeenCalledWith(
        expect.objectContaining({ modelTier: "fast" }),
      );
    });
  });

  test("postRun is called with parallel=true when checkbox is checked", async () => {
    const { postRun } = await import("../api.ts");
    vi.mocked(postRun).mockResolvedValueOnce({ id: "2026-05-12T22-34-57-000" });

    renderPage();
    fireEvent.change(screen.getByLabelText(/goal/i), { target: { value: "Build something" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /^run$/i }));

    await waitFor(() => {
      expect(vi.mocked(postRun)).toHaveBeenCalledWith(
        expect.objectContaining({ parallel: true }),
      );
    });
  });
});
