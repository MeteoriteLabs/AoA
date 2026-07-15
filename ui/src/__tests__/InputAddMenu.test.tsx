import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InputAddMenu } from "@/components/commander/InputAddMenu";

describe("InputAddMenu", () => {
  it("renders the + trigger button", () => {
    render(<InputAddMenu onUseSkill={vi.fn()} onAttachFile={vi.fn()} />);
    expect(screen.getByRole("button", { name: /add/i })).toBeInTheDocument();
  });

  it("opening the menu shows enabled skill and file actions", async () => {
    const user = userEvent.setup();
    render(<InputAddMenu onUseSkill={vi.fn()} onAttachFile={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /add/i }));

    const useSkillItem = await screen.findByText("Use a skill");
    expect(useSkillItem).toBeInTheDocument();
    // The item itself should not have the disabled attribute
    const useSkillMenuItem = useSkillItem.closest("[role='menuitem']");
    expect(useSkillMenuItem).not.toHaveAttribute("data-disabled");

    const attachFileText = screen.getByText("Attach file");
    expect(attachFileText).toBeInTheDocument();
    // File attachment is a live action, not coming-soon chrome.
    const attachMenuItem = attachFileText.closest("[role='menuitem']");
    expect(attachMenuItem).not.toHaveAttribute("data-disabled");
  });

  it("clicking 'Use a skill' calls onUseSkill", async () => {
    const onUseSkill = vi.fn();
    const user = userEvent.setup();
    render(<InputAddMenu onUseSkill={onUseSkill} onAttachFile={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /add/i }));
    const useSkillItem = await screen.findByText("Use a skill");
    await user.click(useSkillItem);

    expect(onUseSkill).toHaveBeenCalledOnce();
  });

  it("clicking 'Attach file' calls onAttachFile", async () => {
    const onAttachFile = vi.fn();
    const user = userEvent.setup();
    render(<InputAddMenu onUseSkill={vi.fn()} onAttachFile={onAttachFile} />);

    await user.click(screen.getByRole("button", { name: /add/i }));
    await user.click(await screen.findByText("Attach file"));

    expect(onAttachFile).toHaveBeenCalledOnce();
  });

  it("trigger button is disabled when disabled prop is true", () => {
    render(<InputAddMenu onUseSkill={vi.fn()} onAttachFile={vi.fn()} disabled={true} />);
    expect(screen.getByRole("button", { name: /add/i })).toBeDisabled();
  });
});
