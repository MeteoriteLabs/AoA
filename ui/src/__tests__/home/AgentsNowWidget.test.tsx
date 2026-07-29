import { screen } from "@testing-library/react";
import { renderWithProviders, mockCompanyContext } from "../test-utils";
import { AgentsNowWidget } from "../../components/home/widgets/AgentsNowWidget";

const { useLiveAgentCountMock } = vi.hoisted(() => ({ useLiveAgentCountMock: vi.fn() }));
vi.mock("../../context/CompanyContext", () => ({ useCompany: () => mockCompanyContext }));
vi.mock("../../hooks/useLiveAgentCount", () => ({ useLiveAgentCount: useLiveAgentCountMock }));

describe("AgentsNowWidget", () => {
  it("shows the live agent count", () => {
    useLiveAgentCountMock.mockReturnValue(3);
    renderWithProviders(<AgentsNowWidget companyId="co-1" role="founder" size={{ w: 1, h: 1 }} />);
    expect(screen.getByText("Agents working now")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("renders 0 (not hidden) when no agents are working", () => {
    useLiveAgentCountMock.mockReturnValue(0);
    renderWithProviders(<AgentsNowWidget companyId="co-1" role="founder" size={{ w: 1, h: 1 }} />);
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("Agents working now")).toBeInTheDocument();
  });
});
