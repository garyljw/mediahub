## Summary
<!-- What changed and why. -->

## Risk
<!-- High: auth, roles, src/server/**, route handlers, env/secrets, headers, CI workflows, Dockerfile. High-risk changes need a walkthrough for Gary after merge.
     Low: everything else, e.g. UI, docs, copy, tests. These can merge once CI and reviews are clean.
     CLAUDE.md workflow step 3 sets the /code-review level. If step 3 skips the change, write level: n/a and rounds: 0. /security-review runs when CLAUDE.md workflow step 3 calls for it (a security boundary is created, edited or loosened); otherwise mark it n/a. -->
- Tier: High / Low
- Reviews: /code-review (level: low / medium / n/a, rounds: _) · /security-review (yes / n/a)

## Testing
<!-- Commands run and their results, plus anything you checked by hand. Say what was NOT verified. -->

## How to revert
<!-- e.g. "revert this commit". List anything a plain revert won't undo: DB migrations, created users, changed files on the NAS. -->
