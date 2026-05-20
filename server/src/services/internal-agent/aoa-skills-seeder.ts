import type { Db } from "@armyofagents/db";
import { companySkills } from "@armyofagents/db";

export interface AoaSkillDefinition {
  key: string;
  name: string;
  description: string;
  triggerPhrases: string[];
  markdown: string;
}

export const AOA_NATIVE_SKILLS: AoaSkillDefinition[] = [
  {
    key: "skill:aoa/brainstorm",
    name: "Brainstorm",
    description: "Interrogate an idea before building it. YC-style probing to surface assumptions, sharpen scope, and decide whether to build.",
    triggerPhrases: ["I want to build", "we should", "I'm thinking about", "can we add", "what if we"],
    markdown: `# AoA Brainstorm

## When to use
Invoke this skill when the user proposes a new feature, project, or initiative before any tasks are created. The goal is to sharpen the idea, not kill it.

## Process

### Step 1: Understand the spark
Ask: "Tell me more about [idea]. What problem does this solve, and for whom?"

### Step 2: Probe with 4-5 questions
Ask these in sequence, pausing after each for the user's answer:
1. "Why now — what changed that makes this the right moment?"
2. "Who specifically benefits, and how do you know they want this?"
3. "What is the smallest possible version that proves the idea works?"
4. "What breaks if you don't do this?"
5. "What assumption here are you MOST confident about? What are you LEAST confident about?"

### Step 3: Synthesize
After the answers, write a one-paragraph crisp framing:
> "[Company] is considering [idea] because [core reason]. The target user is [user]. Success looks like [outcome]. The riskiest assumption is [assumption]. The smallest test is [test]."

Ask: "Does this capture it accurately?"

### Step 4: Hand off (optional)
If the user is ready to plan: invoke \`skill:aoa/sprint-planning\` to break this into tasks.

## Notes
- Do NOT create tasks or call action tools during this skill.
- Do NOT skip the probing phase — even "obvious" ideas have untested assumptions.
- Keep each question short. This is a conversation, not a form.
`,
  },
  {
    key: "skill:aoa/identity-setup",
    name: "Identity Setup",
    description: "Guide a new company through setting their vision, mission, and identity in AoA. Run this on first login or when identity is missing.",
    triggerPhrases: ["set up our company", "configure identity", "define mission", "help us with vision", "who are we"],
    markdown: `# AoA Identity Setup

## When to use
Run when a company has no vision/mission set, or when the founder wants to revisit their identity.

## Process

### Step 1: Check current state
Call \`query_company\` to see what is already set. If vision and mission are both present and the user didn't explicitly ask to change them, ask: "Your identity is already set — do you want to revisit it?"

### Step 2: The founding question
Ask: "In one sentence: what problem does [company name] exist to solve, and for whom?"

Wait for the answer. Do not offer examples — let the founder find their own words.

### Step 3: Dig deeper
Ask these in sequence:
1. "Why hasn't this problem been solved well before?"
2. "What does winning look like in 3-5 years? What's different in the world?"
3. "If [company] disappeared tomorrow, who would notice and why?"

### Step 4: Draft vision and mission
Synthesize:
- **Vision** (the world-change, 1 sentence, starts with "A world where..." or similar)
- **Mission** (how you get there, 1 sentence, starts with "[Company] helps/builds/enables...")

Show both drafts and ask: "Does this feel true? Should we adjust anything?"

### Step 5: Save (with confirmation)
Once the founder approves the text, call \`update_company_identity\` with the approved vision and mission. The tool requires confirmation — show the values before executing.

### Step 6: Stage and team
After identity is saved, ask:
- "What stage is [company] at? (idea / pre-revenue / revenue / growth)"
- "How many people are on the team right now?"

Store these as memory suggestions via \`suggest_memory\` (identity layer).

## Notes
- Never invent or suggest vision/mission text without asking first.
- The \`update_company_identity\` tool requires confirmation — always show the final text to the user before calling it.
`,
  },
  {
    key: "skill:aoa/sprint-planning",
    name: "Sprint Planning",
    description: "Break a goal or idea into structured tasks with dependencies and agent assignments. Creates a full task plan before executing.",
    triggerPhrases: ["plan this sprint", "break this into tasks", "create tasks for", "help me plan", "plan the next"],
    markdown: `# AoA Sprint Planning

## When to use
When the user has a clear goal and wants to turn it into concrete, assigned, prioritized tasks.

## Process

### Step 1: Clarify scope
Ask:
- "What is the goal for this sprint?"
- "What is the deadline or time horizon?"
- "Which agents and team members will be working on this?"
- "Are there any tasks already in flight I should know about?"

Call \`query_tasks\` to check existing work. Call \`query_agents\` to see who's available.

### Step 2: Propose milestones
Based on the scope, propose 2-4 milestones (phases). Example:
> "Phase 1 (Week 1): Foundation — schema, API routes
> Phase 2 (Week 2): UI + integration
> Phase 3: Testing + ship"

Ask: "Does this breakdown make sense?"

### Step 3: Break into tasks
For each milestone, define tasks with:
- Title (verb-noun: "Build user auth endpoint")
- Description (what done looks like)
- Priority (urgent/high/medium/low)
- Assignee (which agent or person)
- Dependencies (which tasks must complete first)

Show the full task list BEFORE creating anything:
> "Here is the full plan — [N] tasks across [M] milestones. Ready to create them?"

### Step 4: Create (with confirmation)
On approval, call \`create_task\` for each task in order. Then call \`add_task_dependency\` for each blocking relationship.

### Step 5: Summary
After creation:
> "Created [N] tasks across [M] milestones. The first unblocked task is '[title]', assigned to [agent]."

## Notes
- Never create tasks without showing the plan first.
- Respect the \`requiresConfirmation\` gate — each \`create_task\` call will ask for approval.
- Use dependency links generously — a well-linked plan is easier to manage.
`,
  },
  {
    key: "skill:aoa/team-design",
    name: "Team Design",
    description: "Design the right agent team for a company or project. Recommends agent roles, adapter types, and concurrency based on what you are building.",
    triggerPhrases: ["what agents do I need", "design the team", "help me hire", "build out the team", "which agents should"],
    markdown: `# AoA Team Design

## When to use
When a founder is starting out or expanding their agent team and wants structured guidance on who to hire.

## Process

### Step 1: Understand the company
Call \`query_company\` to get vision and mission. Call \`query_agents\` to see who is already on the team.

Ask: "What are you primarily trying to build or operate? (e.g. a SaaS product, a content operation, an e-commerce store)"

### Step 2: Identify functions needed
Based on the answer, identify which functions the company needs:
- **Engineering** — write code, review PRs, maintain systems
- **Design** — UI/UX, brand, visual assets
- **QA** — testing, bug verification, regression checks
- **Content/Marketing** — copy, posts, SEO, campaigns
- **Support** — respond to user issues, triage
- **Research** — competitive analysis, user interviews, data analysis
- **Operations** — project management, coordination, documentation

Ask: "Which of these are priorities for the next 90 days?"

### Step 3: Recommend the team
For each needed function, recommend:

| Role | Adapter | Concurrency | First task |
|------|---------|-------------|-----------|
| Nova Coder | claude_local | Start at 1, trust up to 3 | Implement [feature] |
| Nova Reviewer | claude_local | 1 | Review PRs from Nova Coder |
| QA Agent | claude_local | 1 | Test [feature] flows |

Explain the concurrency model: "Start each agent at concurrency 1. As you see reliable output — tasks completed, no major mistakes — increase to 2-3. AoA's default is 1 because it is a teaching default, not a ceiling."

### Step 4: Show the org chart
Render a simple tree:
\`\`\`
Engineering Department
├── Nova Coder (claude_local, concurrency: 1)
└── Nova Reviewer (claude_local, concurrency: 1)
QA Department
└── QA Agent (claude_local, concurrency: 1)
\`\`\`

Ask: "Does this structure make sense? Should I adjust any roles?"

### Step 5: Create agents (with confirmation)
On approval, call \`create_agent\` for each new agent. Each call has \`requiresConfirmation: true\` — the user will approve each one.

## Notes
- Always explain the concurrency teaching default.
- Do not create agents without showing the org chart first.
- The \`create_agent\` tool requires founder role — check this before promising agent creation.
`,
  },
];

/**
 * Seed AoA-native skills into a company's skill catalog.
 * Uses ON CONFLICT DO NOTHING so re-running is safe.
 */
export async function seedAoaNativeSkills(db: Db, companyId: string): Promise<void> {
  for (const skill of AOA_NATIVE_SKILLS) {
    // Derive slug from the key: strip "skill:aoa/" prefix
    const slug = skill.key.replace(/^skill:aoa\//, "aoa-");
    await db
      .insert(companySkills)
      .values({
        companyId,
        key: skill.key,
        slug,
        name: skill.name,
        description: skill.description,
        triggerPhrases: skill.triggerPhrases,
        markdown: skill.markdown,
        sourceType: "builtin",
      })
      .onConflictDoNothing();
  }
}
