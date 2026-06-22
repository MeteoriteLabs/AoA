import { describe, it, expect } from "vitest";
import {
  SKILL_TOKEN_KIND,
  createSkillToken,
  isRootEmpty,
  isSkillToken,
  serializeRoot,
} from "./commanderInputModel";

const SKILL = {
  name: "brainstorming",
  key: "skill:github-skills/obra/superpowers/brainstorming",
};

function root(): HTMLDivElement {
  return document.createElement("div");
}

describe("createSkillToken", () => {
  it("renders only the name but carries name + key in data attrs", () => {
    const token = createSkillToken(document, SKILL);
    expect(token.textContent).toBe("brainstorming");
    expect(token.dataset.token).toBe(SKILL_TOKEN_KIND);
    expect(token.dataset.name).toBe(SKILL.name);
    expect(token.dataset.key).toBe(SKILL.key);
    expect(token.getAttribute("contenteditable")).toBe("false");
  });

  it("stashes the description in data-desc for the hover card (but not in the directive)", () => {
    const token = createSkillToken(document, { ...SKILL, description: "Explore intent first" });
    expect(token.dataset.desc).toBe("Explore intent first");
    const r = root();
    r.appendChild(token);
    // serializeRoot expands name+key only — description never leaks into the send text.
    expect(serializeRoot(r)).toBe(
      `Use the "brainstorming" skill (skill:github-skills/obra/superpowers/brainstorming).`,
    );
  });

  it("omits data-desc when no description is provided", () => {
    const token = createSkillToken(document, SKILL);
    expect(token.dataset.desc).toBeUndefined();
  });

  it("is recognized by isSkillToken", () => {
    expect(isSkillToken(createSkillToken(document, SKILL))).toBe(true);
    expect(isSkillToken(document.createTextNode("hi"))).toBe(false);
    expect(isSkillToken(document.createElement("span"))).toBe(false);
    expect(isSkillToken(null)).toBe(false);
  });
});

describe("serializeRoot", () => {
  it("returns plain text unchanged", () => {
    const r = root();
    r.appendChild(document.createTextNode("hello there"));
    expect(serializeRoot(r)).toBe("hello there");
  });

  it("expands a skill token to its full use_skill directive", () => {
    const r = root();
    r.appendChild(createSkillToken(document, SKILL));
    expect(serializeRoot(r)).toBe(
      `Use the "brainstorming" skill (skill:github-skills/obra/superpowers/brainstorming).`,
    );
  });

  it("mixes text and tokens in document order, normalizing NBSP padding", () => {
    const r = root();
    r.appendChild(document.createTextNode("please "));
    r.appendChild(createSkillToken(document, SKILL));
    r.appendChild(document.createTextNode(" now"));
    expect(serializeRoot(r)).toBe(
      `please Use the "brainstorming" skill (skill:github-skills/obra/superpowers/brainstorming). now`,
    );
  });

  it("expands multiple tokens", () => {
    const r = root();
    r.appendChild(createSkillToken(document, { name: "a", key: "skill:x/a" }));
    r.appendChild(document.createTextNode(" and "));
    r.appendChild(createSkillToken(document, { name: "b", key: "skill:x/b" }));
    expect(serializeRoot(r)).toBe(
      `Use the "a" skill (skill:x/a). and Use the "b" skill (skill:x/b).`,
    );
  });

  it("treats <br> as a newline", () => {
    const r = root();
    r.appendChild(document.createTextNode("line1"));
    r.appendChild(document.createElement("br"));
    r.appendChild(document.createTextNode("line2"));
    expect(serializeRoot(r)).toBe("line1\nline2");
  });
});

describe("isRootEmpty", () => {
  it("is true for an empty editor", () => {
    expect(isRootEmpty(root())).toBe(true);
  });

  it("is true when only a leftover <br> remains", () => {
    const r = root();
    r.appendChild(document.createElement("br"));
    expect(isRootEmpty(r)).toBe(true);
  });

  it("is true for whitespace-only text", () => {
    const r = root();
    r.appendChild(document.createTextNode("   \n  "));
    expect(isRootEmpty(r)).toBe(true);
  });

  it("is false once there is real text", () => {
    const r = root();
    r.appendChild(document.createTextNode("x"));
    expect(isRootEmpty(r)).toBe(false);
  });

  it("is false when a token is present even with no text", () => {
    const r = root();
    r.appendChild(createSkillToken(document, SKILL));
    expect(isRootEmpty(r)).toBe(false);
  });
});
