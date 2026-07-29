import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, mockCompanyContext, mockDialogContext } from "../test-utils";
import { SuggestionsWidget } from "../../components/home/widgets/SuggestionsWidget";

const { suggestionsApiMock } = vi.hoisted(() => ({
  suggestionsApiMock: { pending: vi.fn(), detect: vi.fn(), accept: vi.fn(), dismiss: vi.fn() },
}));
vi.mock("../../context/CompanyContext", () => ({ useCompany: () => mockCompanyContext }));
vi.mock("../../context/DialogContext", () => ({ useDialog: () => mockDialogContext }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ pushToast: vi.fn() }) }));
vi.mock("../../api/suggestions", () => ({ suggestionsApi: suggestionsApiMock }));

const s = (over: Record<string, unknown>) => ({ id: "s1", companyId: "co-1", category: "memory_gap", actionType: "flag_risk", actionPayload: {}, title: "T", evidence: "E", status: "pending", expiresAt: null, relatedMemoryItemId: null, createdAt: "x", updatedAt: "x", ...over });

describe("SuggestionsWidget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCompanyContext.selectedCompanyId = "co-1";
    suggestionsApiMock.pending.mockResolvedValue([s({ id: "s-risk", actionType: "flag_risk", title: "Flag launch risk" })]);
    suggestionsApiMock.accept.mockResolvedValue({});
    suggestionsApiMock.dismiss.mockResolvedValue({});
  });

  it("renders pending suggestions with founder actions and dismiss calls the API", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SuggestionsWidget companyId="co-1" role="founder" size={{ w: 2, h: 1 }} />);
    expect(await screen.findByText("Flag launch risk")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    await vi.waitFor(() => expect(suggestionsApiMock.dismiss).toHaveBeenCalledWith("co-1", "s-risk"));
  });

  it("hides accept/dismiss for non-founders", async () => {
    renderWithProviders(<SuggestionsWidget companyId="co-1" role="team_member" size={{ w: 2, h: 1 }} />);
    expect(await screen.findByText("Flag launch risk")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
  });

  it("shows the loading placeholder while the pending-suggestions query is in flight", () => {
    suggestionsApiMock.pending.mockReset().mockReturnValue(new Promise(() => {})); // never resolves
    renderWithProviders(<SuggestionsWidget companyId="co-1" role="team_member" size={{ w: 2, h: 1 }} />);
    expect(screen.getByText(/Refreshing suggestions/i)).toBeInTheDocument();
  });

  it("shows the 'All caught up' empty state when there are zero pending suggestions", async () => {
    suggestionsApiMock.pending.mockReset().mockResolvedValue([]);
    renderWithProviders(<SuggestionsWidget companyId="co-1" role="team_member" size={{ w: 2, h: 1 }} />);
    expect(await screen.findByText("All caught up")).toBeInTheDocument();
  });

  it("falls back to the empty state (no throw) when the pending-suggestions query errors", async () => {
    suggestionsApiMock.pending.mockReset().mockRejectedValue(new Error("network error"));
    renderWithProviders(<SuggestionsWidget companyId="co-1" role="team_member" size={{ w: 2, h: 1 }} />);
    // useQuery's `data` defaults to [] on error (`const { data: suggestions =
    // [] } = useQuery(...)`), so the widget settles into its normal empty
    // shell rather than throwing or hanging on the loading placeholder.
    expect(await screen.findByText("All caught up")).toBeInTheDocument();
  });
});
