import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Target } from "lucide-react";
import { WidgetEmpty, WidgetLoading } from "../../components/home/widgets/WidgetStates";

describe("WidgetEmpty", () => {
  it("renders the icon and message", () => {
    render(<WidgetEmpty icon={Target} message="No objectives yet" />);
    expect(screen.getByText("No objectives yet")).toBeInTheDocument();
  });

  it("renders no CTA button when ctaLabel/onCta are omitted", () => {
    render(<WidgetEmpty icon={Target} message="Couldn't load objectives" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders no CTA button when only ctaLabel is given without onCta", () => {
    render(<WidgetEmpty icon={Target} message="No objectives yet" ctaLabel="+ New goal" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders the CTA button and fires onCta when clicked", async () => {
    const onCta = vi.fn();
    const user = userEvent.setup();
    render(<WidgetEmpty icon={Target} message="No objectives yet" ctaLabel="+ New goal" onCta={onCta} />);

    const button = screen.getByRole("button", { name: "+ New goal" });
    await user.click(button);

    expect(onCta).toHaveBeenCalledTimes(1);
  });
});

describe("WidgetLoading", () => {
  it("renders a loading indicator", () => {
    render(<WidgetLoading />);
    expect(screen.getByText(/Loading/)).toBeInTheDocument();
  });
});
