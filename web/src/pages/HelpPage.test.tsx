import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { axe } from "vitest-axe";
import { expect, test } from "vitest";
import HelpPage from "./HelpPage.tsx";

function renderHelp() {
  return render(
    <MemoryRouter>
      <HelpPage />
    </MemoryRouter>
  );
}

test("HelpPage renders all four sections", () => {
  renderHelp();
  expect(screen.getByText("Getting Started")).toBeInTheDocument();
  expect(screen.getByText("Commands")).toBeInTheDocument();
  expect(screen.getByText("Dashboard")).toBeInTheDocument();
  expect(screen.getByText("Keyboard Shortcuts")).toBeInTheDocument();
});

test("HelpPage commands table contains phase2s serve entry", () => {
  renderHelp();
  // "phase2s serve" appears in both the command column and the example column —
  // use getAllByText and assert at least one match exists.
  const matches = screen.getAllByText(/phase2s serve/);
  expect(matches.length).toBeGreaterThan(0);
});

test("HelpPage commands table contains phase2s conduct", () => {
  renderHelp();
  // The data file has "phase2s conduct <spec>" — check partial match
  const cells = screen.getAllByText(/phase2s conduct/);
  expect(cells.length).toBeGreaterThan(0);
});

test("HelpPage has no axe accessibility violations", async () => {
  const { container } = renderHelp();
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});

test("HelpPage keyboard shortcuts table contains Escape", () => {
  renderHelp();
  expect(screen.getByText("Escape")).toBeInTheDocument();
});
