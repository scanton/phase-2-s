/**
 * React component tests for ConfigPage (Sprint 97)
 *
 * Covers:
 *   1.  Renders all 5 sections on 200
 *   2.  Shows "currently set" placeholder for masked (***SET***) fields
 *   3.  Save button disabled when unchanged; enabled after edit
 *   4.  POST called with correct body on save
 *   5.  Success toast after save
 *   6.  Inline error on 400
 *   7.  Empty state banner on 404
 *   8.  axe accessibility smoke test
 *   9.  allowDestructive confirm dialog fires on false→true
 *   10. Show/hide password toggle changes input type
 *   11. Save without touching API key fields preserves existing keys (sentinel)
 */

import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { axe } from "vitest-axe";
import { MemoryRouter } from "react-router-dom";
import ConfigPage from "./ConfigPage.tsx";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MASKED = "***SET***";

const SAMPLE_CONFIG = {
  provider: "anthropic",
  model: "claude-3-5-sonnet-20241022",
  apiKey: MASKED,
  anthropicApiKey: MASKED,
  openrouterApiKey: MASKED,
  geminiApiKey: MASKED,
  minimaxApiKey: MASKED,
  allowDestructive: false,
  requireSpecification: false,
  verifyCommand: "npm test",
  browser: false,
  notify: {
    mac: false,
    slack: MASKED,
    discord: MASKED,
    teams: MASKED,
  },
};

function makeGetOk(config = SAMPLE_CONFIG) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ config }),
  });
}

function makePostOk() {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ok: true }),
  });
}

/** Render ConfigPage inside a router (needed for NavLink in Sidebar if any) */
function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/config"]}>
      <ConfigPage />
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConfigPage — rendering", () => {
  beforeEach(() => {
    global.fetch = makeGetOk();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("1. renders all 5 sections on 200", async () => {
    renderPage();
    await waitFor(() => {
      // Check section headings by role (avoids multi-element text match issues)
      const headings = screen.getAllByRole("heading");
      const headingTexts = headings.map((h) => h.textContent ?? "");
      expect(headingTexts.some((t) => /Provider.*Model/i.test(t))).toBe(true);
      expect(headingTexts.some((t) => /API Keys/i.test(t))).toBe(true);
      expect(headingTexts.some((t) => /Ollama/i.test(t))).toBe(true);
      expect(headingTexts.some((t) => /Notifications/i.test(t))).toBe(true);
      expect(headingTexts.some((t) => /Behavior/i.test(t))).toBe(true);
    });
  });

  test("2. shows '(currently set)' placeholder for masked API key fields", async () => {
    renderPage();
    await waitFor(() => {
      // The API key input should show the "(currently set)" placeholder
      const apiKeyInput = screen.getByLabelText(/OpenAI API key/i) as HTMLInputElement;
      expect(apiKeyInput.placeholder).toBe("(currently set)");
    });
  });
});

describe("ConfigPage — save button", () => {
  beforeEach(() => {
    global.fetch = makeGetOk();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("3a. Save button is disabled when unchanged", async () => {
    renderPage();
    await waitFor(() => {
      const saveBtn = screen.getByRole("button", { name: /save changes/i });
      expect(saveBtn).toBeTruthy();
      expect((saveBtn as HTMLButtonElement).disabled).toBe(true);
    });
  });

  test("3b. Save button is enabled after editing a field", async () => {
    renderPage();
    await waitFor(() => screen.getByLabelText(/^Model$/i));

    const modelInput = screen.getByLabelText(/^Model$/i) as HTMLInputElement;
    fireEvent.change(modelInput, { target: { value: "gpt-4o" } });

    const saveBtn = screen.getByRole("button", { name: /save changes/i }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
  });
});

describe("ConfigPage — save flow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("4. POST called with correct body on save", async () => {
    const postFn = makePostOk();
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (opts?.method === "POST") {
        callCount++;
        return postFn(url, opts);
      }
      // GET: first call returns config; second (reload) returns same
      return makeGetOk()();
    });

    renderPage();
    await waitFor(() => screen.getByLabelText(/^Model$/i));

    // Change model
    const modelInput = screen.getByLabelText(/^Model$/i) as HTMLInputElement;
    fireEvent.change(modelInput, { target: { value: "gpt-4o-mini" } });

    const saveBtn = screen.getByRole("button", { name: /save changes/i });
    fireEvent.click(saveBtn);

    await waitFor(() => expect(callCount).toBe(1));

    const [, postOpts] = (postFn as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    const body = JSON.parse((postOpts as RequestInit).body as string);
    expect(body.model).toBe("gpt-4o-mini");
  });

  test("5. success toast appears after save", async () => {
    global.fetch = vi.fn().mockImplementation((_url, opts) => {
      if ((opts as RequestInit | undefined)?.method === "POST") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ ok: true }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ config: SAMPLE_CONFIG }),
      });
    });

    renderPage();
    await waitFor(() => screen.getByLabelText(/^Model$/i));

    fireEvent.change(screen.getByLabelText(/^Model$/i), { target: { value: "claude-opus-4" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(screen.getByText("Config saved")).toBeTruthy();
    });
  });

  test("6. inline error appears on 400 response", async () => {
    global.fetch = vi.fn().mockImplementation((_url, opts) => {
      if ((opts as RequestInit | undefined)?.method === "POST") {
        return Promise.resolve({
          ok: false,
          status: 400,
          json: async () => ({ error: "Invalid config value" }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ config: SAMPLE_CONFIG }),
      });
    });

    renderPage();
    await waitFor(() => screen.getByLabelText(/^Model$/i));

    fireEvent.change(screen.getByLabelText(/^Model$/i), { target: { value: "bad-model" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(screen.getByText("Invalid config value")).toBeTruthy();
    });
  });
});

describe("ConfigPage — empty state", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("7. renders empty state banner on 404", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "No .phase2s.yaml found" }),
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/No .phase2s.yaml found/i)).toBeTruthy();
    });
  });
});

describe("ConfigPage — accessibility", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("8. axe accessibility smoke test", async () => {
    global.fetch = makeGetOk();
    const { container } = renderPage();

    await waitFor(() => screen.getByText(/Provider & Model/i));

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe("ConfigPage — allowDestructive confirm dialog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("9. confirm dialog fires on false→true for allowDestructive", async () => {
    global.fetch = makeGetOk({ ...SAMPLE_CONFIG, allowDestructive: false });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    renderPage();
    await waitFor(() => screen.getByLabelText(/Allow destructive/i));

    const checkbox = screen.getByLabelText(/Allow destructive/i) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    fireEvent.click(checkbox);

    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(checkbox.checked).toBe(true);
  });

  test("9b. cancelling the confirm dialog leaves allowDestructive false", async () => {
    global.fetch = makeGetOk({ ...SAMPLE_CONFIG, allowDestructive: false });
    vi.spyOn(window, "confirm").mockReturnValue(false);

    renderPage();
    await waitFor(() => screen.getByLabelText(/Allow destructive/i));

    const checkbox = screen.getByLabelText(/Allow destructive/i) as HTMLInputElement;
    fireEvent.click(checkbox);

    expect(checkbox.checked).toBe(false);
  });
});

describe("ConfigPage — password show/hide toggle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("10. show/hide toggle changes input type", async () => {
    global.fetch = makeGetOk();
    renderPage();
    await waitFor(() => screen.getByLabelText(/OpenAI API key/i));

    const input = screen.getByLabelText(/OpenAI API key/i) as HTMLInputElement;
    expect(input.type).toBe("password");

    // Click the show button (aria-label "Show")
    const showBtn = input.parentElement?.querySelector('[aria-label="Show"]');
    expect(showBtn).toBeTruthy();
    fireEvent.click(showBtn!);

    expect(input.type).toBe("text");
  });
});

describe("ConfigPage — sentinel preservation on save", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("11. saving without touching API key fields sends ***SET*** in POST body", async () => {
    let capturedBody: Record<string, unknown> | null = null;

    global.fetch = vi.fn().mockImplementation((_url, opts) => {
      if ((opts as RequestInit | undefined)?.method === "POST") {
        capturedBody = JSON.parse((opts as RequestInit).body as string);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ ok: true }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ config: SAMPLE_CONFIG }),
      });
    });

    renderPage();
    await waitFor(() => screen.getByLabelText(/^Model$/i));

    // Change only model — don't touch API key fields
    fireEvent.change(screen.getByLabelText(/^Model$/i), { target: { value: "gpt-4o" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(capturedBody).not.toBeNull());

    // API keys should be sent as ***SET*** to preserve them
    expect(capturedBody!.apiKey).toBe(MASKED);
    expect(capturedBody!.anthropicApiKey).toBe(MASKED);
  });
});
