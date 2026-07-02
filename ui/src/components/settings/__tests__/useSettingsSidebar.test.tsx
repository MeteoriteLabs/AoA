import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, Outlet } from "react-router-dom";
import type { ReactNode } from "react";
import { useSettingsSidebar } from "../useSettingsSidebar";

const mockNavigate = vi.fn();
vi.mock("@/lib/router", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

function Harness({ activeKey }: { activeKey: any }) {
  const { pillItems } = useSettingsSidebar(activeKey);
  return (
    <div>
      {pillItems.map((p) => (
        <button key={p.id} data-testid={`pill-${p.id}`} data-active={p.active ? "1" : "0"} onClick={p.onClick}>
          {p.label}
        </button>
      ))}
    </div>
  );
}

function renderHook(activeKey: any) {
  let captured: ReactNode = null;
  render(
    <MemoryRouter initialEntries={["/instance/settings"]}>
      <Routes>
        <Route element={<Outlet context={{ setSecondarySidebar: (n: ReactNode) => { captured = n; } }} />}>
          <Route path="/instance/settings" element={<Harness activeKey={activeKey} />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  return { getCaptured: () => captured };
}

describe("useSettingsSidebar", () => {
  it("renders all 8 settings sections with the active one flagged", () => {
    renderHook("backups");
    for (const key of ["general", "health", "privacy", "backups", "heartbeats", "experimental", "plugins", "access"]) {
      expect(screen.getByTestId(`pill-${key}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("pill-backups").getAttribute("data-active")).toBe("1");
    expect(screen.getByTestId("pill-general").getAttribute("data-active")).toBe("0");
  });

  it("navigates non-access sections to ?tab=<key>", async () => {
    const user = userEvent.setup();
    mockNavigate.mockClear();
    renderHook("general");
    await user.click(screen.getByTestId("pill-health"));
    expect(mockNavigate).toHaveBeenCalledWith("/instance/settings?tab=health");
  });

  it("navigates the Access section to /instance/access", async () => {
    const user = userEvent.setup();
    mockNavigate.mockClear();
    renderHook("general");
    await user.click(screen.getByTestId("pill-access"));
    expect(mockNavigate).toHaveBeenCalledWith("/instance/access");
  });

  it("pushes a SecondarySidebar node to the outlet context", () => {
    const { getCaptured } = renderHook("access");
    expect(getCaptured()).not.toBeNull();
  });
});
