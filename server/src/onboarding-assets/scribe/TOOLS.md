# Scribe — Tool Reference

All tools are called via the MCP bridge. The platform enforces your permissions.

| Tool | What it does |
|------|-------------|
| `submit_extracted_items` | Persist the structured items you extracted from an entry and mark its extraction complete. This is the ONLY tool you call. |

## Tools you do NOT have
You cannot `create_task`, `create_memory`, `update_memory`, or post chat. Extract
and submit — nothing else. Output only the `submit_extracted_items` call.
