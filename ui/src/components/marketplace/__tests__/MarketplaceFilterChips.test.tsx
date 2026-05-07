import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MarketplaceFilterChips } from "../MarketplaceFilterChips";

const counts = { skill: 250, plugin: 45, agent: 38, team: 12 };

describe("MarketplaceFilterChips", () => {
  it("renders 5 chips", () => {
    render(<MarketplaceFilterChips value={null} onChange={vi.fn()} counts={counts} />);
    expect(screen.getByRole("button", { name: /^all$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /skills/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /plugins/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /agents/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /teams/i })).toBeInTheDocument();
  });

  it("highlights All when value=null", () => {
    render(<MarketplaceFilterChips value={null} onChange={vi.fn()} counts={counts} />);
    expect(screen.getByRole("button", { name: /^all$/i }).getAttribute("data-active")).toBe("true");
    expect(screen.getByRole("button", { name: /skills/i }).getAttribute("data-active")).toBeNull();
  });

  it("highlights the matching type chip when value is set", () => {
    render(<MarketplaceFilterChips value="skill" onChange={vi.fn()} counts={counts} />);
    expect(screen.getByRole("button", { name: /skills/i }).getAttribute("data-active")).toBe("true");
    expect(screen.getByRole("button", { name: /^all$/i }).getAttribute("data-active")).toBeNull();
  });

  it("renders the count next to each non-All chip", () => {
    render(<MarketplaceFilterChips value={null} onChange={vi.fn()} counts={counts} />);
    expect(screen.getByRole("button", { name: /skills/i }).textContent).toMatch(/250/);
    expect(screen.getByRole("button", { name: /plugins/i }).textContent).toMatch(/45/);
    expect(screen.getByRole("button", { name: /agents/i }).textContent).toMatch(/38/);
    expect(screen.getByRole("button", { name: /teams/i }).textContent).toMatch(/12/);
  });

  it("calls onChange with the type when a chip is clicked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<MarketplaceFilterChips value={null} onChange={onChange} counts={counts} />);
    await user.click(screen.getByRole("button", { name: /skills/i }));
    expect(onChange).toHaveBeenCalledWith("skill");
  });

  it("calls onChange(null) when All is clicked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<MarketplaceFilterChips value="skill" onChange={onChange} counts={counts} />);
    await user.click(screen.getByRole("button", { name: /^all$/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
