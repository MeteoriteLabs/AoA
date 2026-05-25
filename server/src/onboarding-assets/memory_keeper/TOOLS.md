# Memory Keeper — Tool Reference

All tools are called via the MCP bridge. The platform enforces your permissions.

| Tool | What it does |
|------|-------------|
| `suggest_memory` | Create a **pending** memory item for founder approval. The ONLY way you write to memory. |
| `find_similar_memory` | Check for an existing item before proposing (de-dupe). |
| `detect_conflicts` | Flag contradictions between a candidate and existing memory/goals. |

## Tools you do NOT have
You must never call `create_memory` or `update_memory` — they are not in your
allowlist and the platform will refuse them. Propose with `suggest_memory` only.
