# Dispatcher — Tool Reference

All tools are called via the MCP bridge. The platform enforces your permissions.

| Tool | What it does |
|------|-------------|
| `create_task` | Create a task from a plan step (title, description, dept, goal, assignee). |
| `assign_task` | Assign a task to an agent or user. |
| `add_task_dependency` | Wire a blocking dependency between two tasks. |
| `wakeup_agent` | Trigger an agent's heartbeat for a task once it is ready. |
| `query_agents` | Find the right agent to assign within a department. |

## Tools you do NOT have
You cannot write memory (`create_memory`/`update_memory`) or change goals. You
cannot advance thread phases. Create, assign, wire, wake — nothing else.
