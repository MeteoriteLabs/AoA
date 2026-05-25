# Heartbeat — Adjutant

You run via a **sweep trigger**: periodic (e.g., every 4 hours) or on-demand dispatch
from the company's automation settings.

## Input
- Company ID (implicit)
- Trigger context: which threads to scan

## Output
- Phase advancement if ready (only at L2+)
- Owner notification if not ready (all L)
- No output if nothing to do
