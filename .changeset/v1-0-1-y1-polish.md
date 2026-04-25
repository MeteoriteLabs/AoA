---
"aoa": patch
---

CLI banner + log strings polished from "Paperclip" to "AoA". User-facing strings on `aoa doctor`, `aoa db:backup`, `aoa configure`, `aoa env`, and `aoa onboard` log steps now reference AoA consistently. Default Board user email constant updated to `local@aoa.local` for fresh installs (existing installs unchanged).

Wire-compat strings, plugin bridge globals, shipped skill names, JWT issuer/audience, embedded-postgres credentials, and localStorage keys are intentionally retained for backward compatibility.

Closes Y1 from the post-1.0 backlog.
