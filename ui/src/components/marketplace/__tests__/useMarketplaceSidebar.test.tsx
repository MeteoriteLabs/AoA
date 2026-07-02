import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route, Outlet } from "react-router-dom";
import type { ReactNode } from "react";
import { useMarketplaceSidebar } from "../useMarketplaceSidebar";

const CATALOG = {
  items: [
    { id: "1", type: "skill", name: "a", description: "", source: { url: "https://github.com/garrytan/x" } },
    { id: "2", type: "skill", name: "b", description: "", source: { url: "https://github.com/aoa-curated/y" } },
    { id: "3", type: "agent", name: "c", description: "", source: { url: "https://github.com/openai/z" } },
  ],
};
vi.mock("@/hooks/useCatalog", () => ({ useCatalog: () => ({ data: CATALOG }) }));
// @/lib/router useNavigate calls useCompany — stub CompanyContext.
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompany: null }) }));

function Harness({ activeKey }: { activeKey: any }) {
  const { pillItems } = useMarketplaceSidebar(activeKey);
  return (
    <div data-testid="pills">
      {pillItems.map((p) => `${p.id}:${p.count}:${p.active ? 1 : 0}`).join(",")}
    </div>
  );
}

function renderHook(activeKey: any) {
  let captured: ReactNode = null;
  render(
    <MemoryRouter initialEntries={["/marketplace"]}>
      <Routes>
        <Route
          element={
            <Outlet context={{ setSecondarySidebar: (n: ReactNode) => { captured = n; } }} />
          }
        >
          <Route path="/marketplace" element={<Harness activeKey={activeKey} />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  return { getCaptured: () => captured };
}

describe("useMarketplaceSidebar", () => {
  it("type counts exclude AoA; home is the non-AoA total; aoa counts AoA items", () => {
    renderHook("home");
    const t = screen.getByTestId("pills").textContent!;
    expect(t).toContain("home:2"); // garrytan skill + openai agent (aoa-curated excluded)
    expect(t).toContain("skill:1");
    expect(t).toContain("agent:1");
    expect(t).toContain("aoa:1");
  });

  it("marks the active key", () => {
    renderHook("skill");
    expect(screen.getByTestId("pills").textContent).toContain("skill:1:1");
  });

  it("pushes a SecondarySidebar node to the outlet context", () => {
    const { getCaptured } = renderHook("aoa");
    expect(getCaptured()).not.toBeNull();
  });
});
