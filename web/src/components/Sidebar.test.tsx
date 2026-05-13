import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { axe } from "vitest-axe";
import { expect, test, vi } from "vitest";
import Sidebar from "./Sidebar.tsx";

vi.mock("../api.ts", () => ({
  fetchActiveRuns: vi.fn(() => Promise.resolve([])),
}));

test("Sidebar has no axe violations", async () => {
  const { container } = render(
    <MemoryRouter>
      <Sidebar isOpen={false} onClose={() => {}} />
    </MemoryRouter>
  );
  await new Promise(r => setTimeout(r, 50));
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
