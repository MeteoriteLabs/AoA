# Router — Tool Reference

All tools are called via the MCP bridge. The platform enforces your role,
capability, and per-agent allowlist automatically.

| Tool | What it does |
|------|-------------|
| `search_discussions` | List/inspect threads to read the scope under discussion. |
| `query_departments` | List the company's departments to pick a routing target. |

## Tools you do NOT have
Do not invent tool names. You cannot `create_task`, `assign_task`, `create_memory`,
or advance phases. If you need any of those, your recommendation must hand off to
the Dispatcher (at L2) or a human.
