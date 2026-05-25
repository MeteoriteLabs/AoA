# Planner — Tool Reference

All tools are called via the MCP bridge. The platform enforces your permissions.

| Tool | What it does |
|------|-------------|
| `search_discussions` | Read the thread + its scope you are planning from. |
| `query_tasks` | See existing tasks the plan may extend or depend on. |
| `query_dependency_chain` | Inspect what blocks / is blocked by a task. |

## Skills
| Skill | When |
|-------|------|
| `writing-plans` | Load before producing a multi-step plan. |

## Tools you do NOT have
You cannot `create_task`, `assign_task`, `add_task_dependency`, or `wakeup_agent` —
those belong to the Dispatcher. You cannot write memory. Return a plan; do not act.
