# Issue tracker: GitHub

Issues and specs for BRAVOS live in GitHub Issues at https://github.com/yousif-mansi/Bravos-system/issues. Use the `gh` CLI.

Repository: `yousif-mansi/Bravos-system`.

## Conventions

- Create: `gh issue create --repo yousif-mansi/Bravos-system --title "..." --body-file <file>`.
- Read, including comments and labels: `gh issue view <number> --repo yousif-mansi/Bravos-system --json number,title,body,labels,comments,assignees,state`.
- List: `gh issue list --repo yousif-mansi/Bravos-system --state open --json number,title,body,labels,comments,assignees`. Add appropriate `--label` and `--state` filters.
- Comment: `gh issue comment <number> --repo yousif-mansi/Bravos-system --body-file <file>`.
- Apply or remove labels: `gh issue edit <number> --repo yousif-mansi/Bravos-system --add-label "..."` or `--remove-label "..."`.
- Close: `gh issue close <number> --repo yousif-mansi/Bravos-system`. Add any required explanation as a comment first.
- For multiline bodies and comments, write the exact text to a temporary UTF-8 file and use `--body-file`.
- Use `docs/agents/triage-labels.md` for triage state names. Follow the invoked skill's rules for content and transitions.
- Local planning notes may support an issue, but the ticket and its current state live on GitHub.

The explicit repository argument avoids targeting another checkout by accident. The matching `origin` remote also allows `gh` to infer this repository.

## Pull requests as a triage surface

**PRs as a request surface: no.**

If this flag is changed to `yes`, use `gh pr view`, `gh pr diff`, `gh pr comment`, `gh pr edit`, and `gh pr close` with the same repository argument. Use `gh api --paginate repos/yousif-mansi/Bravos-system/pulls` to discover external requests, keeping author associations `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE`.

GitHub shares one number space across issues and PRs. If a reference is ambiguous, try `gh pr view <number>` and fall back to `gh issue view <number>`, with the repository specified.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Read the GitHub issue body, comments, labels, and state using the command above.

## Wayfinding operations

Used by `/wayfinder`. The map is a single issue with child issues as tickets.

- Map: an issue labelled `wayfinder:map`, containing Notes / Decisions-so-far / Fog.
- Child ticket: link the issue to the map using GitHub sub-issues. Where unavailable, use a task list in the map and put `Part of #<map>` at the top of the child body.
- Ticket types: `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task`. Create these labels only when wayfinding is used.
- Blocking: use GitHub native issue dependencies. Add a dependency using `gh api --method POST repos/yousif-mansi/Bravos-system/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-database-id>`. Obtain the numeric database ID with `gh api repos/yousif-mansi/Bravos-system/issues/<blocker> --jq .id`.
- If dependencies are unavailable, add `Blocked by: #<number>, #<number>` near the top of the child body. A child is unblocked when every blocker is closed.
- Frontier: take the first open, unassigned, unblocked child in map order. Check native open-blocker counts or all issues referenced in the fallback line.
- Claim: `gh issue edit <number> --repo yousif-mansi/Bravos-system --add-assignee @me` before doing the work.
- Resolve: comment with the answer, close the child, and append a short answer plus its link to the map's Decisions-so-far.
