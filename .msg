fix(cli-011): S-P3 counts a leg only on an OBSERVED non-zero exit

Codex review on PR #551 (56045e5d): verdictNonZeroExit accepted any returned or thrown leg
without checking the exit code, so "output survives a non-zero exit" could be recorded
without one. A leg now counts only if it returned with a numeric exit code other than 0;
threw (no verifiable exit code), exit 0, and a null code are inconclusive and name why.
RED 1/37 on the old core; GREEN 37/37.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
