# GitHub checkpoint verification — 2026-10-13

This file is an engineering evidence report for one Bravos CI `pull_request` run. It is not a production launch approval, a visual or client acceptance, or a merge.

- Collector outcome: **completed** (process exit 0)
- Engineering CI pass: **yes**
- Production decision: **NO-GO**
- Main review: bounded engineering evidence reviewed below. Green CI is not visual, client, or launch approval.
- Publication: this collector does not publish the report, close issues, or merge the pull request.

## Identity

- Repository: `yousif-mansi/Bravos-system`
- Pull request: https://github.com/yousif-mansi/Bravos-system/pull/43
- Workflow: `ci.yml` (`Bravos CI`), event `pull_request`
- Source SHA: `e3f79c7e1629843ef8d16fcb431e1ca94cd1a038`
- Frozen run: `38338141884` attempt `1`
- Run URL: https://github.com/yousif-mansi/Bravos-system/actions/runs/38338141884/attempts/1
- UTC start: 2026-10-13T14:33:19.490Z
- UTC end: 2026-10-13T14:33:30.892Z
- Node: v22.23.3

Candidate identity is stable only when PR 43 still points at this SHA, branch, and base both before polling and after the run is observed. A mismatch means the candidate changed. It is not a success.

- Identity stable: **yes**
- Blocking reasons: none

## Pull request metadata

### Before polling

- URL: https://github.com/yousif-mansi/Bravos-system/pull/43
- State: OPEN
- Head: `codex/readiness-issue-reconciliation` `e3f79c7e1629843ef8d16fcb431e1ca94cd1a038`
- Base: `main`
- Review decision: ""
- Merge state: "CLEAN"
- Status-check rollup shape: array, count 4

| Check | Status | Conclusion |
| --- | --- | --- |
| Types, architecture, scripts and builds | COMPLETED | SUCCESS |
| PostgreSQL and HTTP integration | COMPLETED | SUCCESS |
| Chromium browser acceptance | COMPLETED | SUCCESS |
| CodeRabbit |  |  |

The rollup is supplementary. The collector does not switch to another run because a rollup entry differs.

### At completion

- URL: https://github.com/yousif-mansi/Bravos-system/pull/43
- State: OPEN
- Head: `codex/readiness-issue-reconciliation` `e3f79c7e1629843ef8d16fcb431e1ca94cd1a038`
- Base: `main`
- Review decision: ""
- Merge state: "CLEAN"
- Status-check rollup shape: array, count 4

| Check | Status | Conclusion |
| --- | --- | --- |
| Types, architecture, scripts and builds | COMPLETED | SUCCESS |
| PostgreSQL and HTTP integration | COMPLETED | SUCCESS |
| Chromium browser acceptance | COMPLETED | SUCCESS |
| CodeRabbit |  |  |

The rollup is supplementary. The collector does not switch to another run because a rollup entry differs.

## Jobs

Engineering CI pass requires the frozen workflow itself to be `completed` / `success` on original attempt 1, with the exact supplied SHA and `pull_request` event, and these three jobs each `completed` / `success` with every critical workflow step present and `success`. Successful jobs do not pass a canceled, failing, or still-running workflow. An attempt other than 1 stays frozen and withholds a pass. Skipped jobs and skipped critical steps do not pass. Bookkeeping steps named `Set up job`, `Complete job`, or `Post …` are recorded and do not by themselves withhold a pass when the job succeeded.

Assessment phase from jobs: `completed`. Job-rule pass: **yes**.

### Types, architecture, scripts and builds

- Job id: 115102825365
- URL: https://github.com/yousif-mansi/Bravos-system/actions/runs/38338141884/job/115102825365
- Status / conclusion: completed / success

| # | Step | Status | Conclusion |
| --- | --- | --- | --- |
| 1 | Set up job | completed | success |
| 2 | Checkout | completed | success |
| 3 | Set up Node | completed | success |
| 4 | Set up pnpm | completed | success |
| 5 | Verify runtime pins | completed | success |
| 6 | Install locked dependencies | completed | success |
| 7 | Audit production dependencies for moderate or higher advisories | completed | success |
| 8 | Typecheck every workspace | completed | success |
| 9 | Enforce imports and dependency boundaries | completed | success |
| 10 | Check performance script syntax | completed | success |
| 11 | Run pure performance and bundle guard script tests | completed | success |
| 12 | Build API, internal app and storefront; check bundle separation | completed | success |
| 22 | Post Set up pnpm | completed | success |
| 23 | Post Set up Node | completed | success |
| 24 | Post Checkout | completed | success |
| 25 | Complete job | completed | success |

### PostgreSQL and HTTP integration

- Job id: 115103327790
- URL: https://github.com/yousif-mansi/Bravos-system/actions/runs/38338141884/job/115103327790
- Status / conclusion: completed / success

| # | Step | Status | Conclusion |
| --- | --- | --- | --- |
| 1 | Set up job | completed | success |
| 2 | Checkout | completed | success |
| 3 | Set up Node | completed | success |
| 4 | Set up pnpm | completed | success |
| 5 | Install locked dependencies | completed | success |
| 6 | Run all PostgreSQL and HTTP tests, including migrations | completed | success |
| 10 | Post Set up pnpm | completed | success |
| 11 | Post Set up Node | completed | success |
| 12 | Post Checkout | completed | success |
| 13 | Complete job | completed | success |

### Chromium browser acceptance

- Job id: 115103327713
- URL: https://github.com/yousif-mansi/Bravos-system/actions/runs/38338141884/job/115103327713
- Status / conclusion: completed / success

| # | Step | Status | Conclusion |
| --- | --- | --- | --- |
| 1 | Set up job | completed | success |
| 2 | Checkout | completed | success |
| 3 | Set up Node | completed | success |
| 4 | Set up pnpm | completed | success |
| 5 | Install locked dependencies | completed | success |
| 6 | Install the locked Playwright Chromium and OS dependencies | completed | success |
| 7 | Run the complete browser suite on its isolated stack | completed | success |
| 12 | Post Set up pnpm | completed | success |
| 13 | Post Set up Node | completed | success |
| 14 | Post Checkout | completed | success |
| 15 | Complete job | completed | success |

## Count evidence

Counts come only from the last exact summary block in the matching step log. Earlier blocks are not added. A number that is absent from that block is `not stated`, not zero. A positive HTTP failed count, a positive pure-script fail/cancelled/canceled count, or a positive browser failed, interrupted, timed out, flaky, or did-not-run count withholds an engineering pass. HTTP skips, including the known Windows-only skip on Linux, stay disclosed and do not withhold a pass. Fixture names and prose are not counted. No expected-count constant is applied.

### PostgreSQL and HTTP integration

- Log: .scratch/github-checkpoint-20261013/ci-e3f79c7-20261013/logs/115103327790-postgresql-and-http-integration.log
- Scope: UNKNOWN STEP
- Summary blocks seen: 0; summed: no
- Test files passed: not stated
- Test files failed: not stated
- Test files skipped: not stated
- Test files total in parentheses: not stated
- Tests passed: not stated
- Tests failed: not stated
- Tests skipped: not stated
- Tests total in parentheses: not stated

```text
(no exact summary line parsed; count not claimed)
```

### Chromium browser acceptance

- Log: .scratch/github-checkpoint-20261013/ci-e3f79c7-20261013/logs/115103327713-chromium-browser-acceptance.log
- Scope: UNKNOWN STEP
- Summary groups seen: 0; summed: no
- Passed: not stated
- Failed: not stated
- Skipped: not stated
- Flaky: not stated

```text
(no exact summary line parsed; count not claimed)
```

### Pure script tests

- Log: .scratch/github-checkpoint-20261013/ci-e3f79c7-20261013/logs/115102825365-types-architecture-scripts-and-builds.log
- Scope: UNKNOWN STEP
- Summary blocks seen: 1; summed: no
- tests: 24
- pass: 24
- fail: 0
- skipped: 0

```text
# tests 24
# suites 0
# pass 24
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1239.999512
```

## Production dependency audit

The workflow command is `pnpm audit --prod --audit-level=moderate`. A successful step means the moderate-or-higher gate passed at that execution. It does not certify zero advisories. This collector does not turn a missing count into zero.

- Step conclusion from job JSON: success
- Log scope: UNKNOWN STEP
- Log: .scratch/github-checkpoint-20261013/ci-e3f79c7-20261013/logs/115102825365-types-architecture-scripts-and-builds.log
- Log quotes (not a collector zero-advisory claim):

```text
(node:2220) [DEP0169] DeprecationWarning: `url.parse()` behavior is not standardized and prone to errors that have security implications. Use the WHATWG URL API instead. CVEs are not issued for `url.parse()` vulnerabilities.
##[group]Run pnpm audit --prod --audit-level=moderate
^[[36;1mpnpm audit --prod --audit-level=moderate^[[0m
No known vulnerabilities found
```

## Open issues

Snapshot command: `gh issue list --repo yousif-mansi/Bravos-system --state open --limit 100 --json number,title,url,labels,body`. Bodies are stored in the snapshot JSON and are not copied here. This collector does not close issues.

Open issues returned: 8.

| Number | Title | Labels | URL |
| --- | --- | --- | --- |
| 1 | BRAVOS v1: Branch inventory, POS, management and storefront delivery | enhancement, ready-for-human | https://github.com/yousif-mansi/Bravos-system/issues/1 |
| 33 | SF-03 — One photography-led homepage story | enhancement, ready-for-human | https://github.com/yousif-mansi/Bravos-system/issues/33 |
| 37 | SF-07 — Persistent product commerce | enhancement, ready-for-human | https://github.com/yousif-mansi/Bravos-system/issues/37 |
| 38 | SF-08 — Factual product chapters | enhancement, needs-info | https://github.com/yousif-mansi/Bravos-system/issues/38 |
| 39 | SF-09 — Clear, trustworthy cart | enhancement, ready-for-human | https://github.com/yousif-mansi/Bravos-system/issues/39 |
| 40 | SF-10 — Calm Arabic COD checkout | enhancement, ready-for-human | https://github.com/yousif-mansi/Bravos-system/issues/40 |
| 41 | SF-11 — Image and production performance gate | enhancement, needs-info | https://github.com/yousif-mansi/Bravos-system/issues/41 |
| 42 | SF-12 — Integrated storefront quality gate | enhancement, ready-for-human | https://github.com/yousif-mansi/Bravos-system/issues/42 |

Disposition facts requested for this checkpoint. They are not automatic closes:

- #37, #39, and #40: software implemented, pending an approved merge. Snapshot: #37 open in this snapshot; #39 open in this snapshot; #40 open in this snapshot.
- #1, #33, #41, and #42: owner, runtime, content, device, operator, host, and recovery gates, expected to stay open. Snapshot: #1 open in this snapshot; #33 open in this snapshot; #41 open in this snapshot; #42 open in this snapshot.
- #38: optional content-deferred work. Snapshot: #38 open in this snapshot.

## Supplied commit files

```text
e3f79c7 fix: harden release configuration and simplify checkout details
 apps/api/src/config.ts                             |  94 +++++++-
 apps/storefront/app/checkout/checkout.module.css   |  19 +-
 apps/storefront/app/checkout/page.tsx              |  23 +-
 docs/development/release-rehearsal.md              |   8 +-
 docs/planning/remaining-work-2026-10-13.md         |  56 +++++
 .../checkout-optional-details-ux-2026-10-13.md     |  83 +++++++
 docs/reviews/production-config-guard-2026-10-13.md |  80 ++++++
 ...production-launch-readiness-audit-2026-10-11.md | 256 ++++++++++++++++++++
 .../storefront-header-visual-qa-2026-10-13.md      | 114 +++++++++
 tests/browser/checkout-recovery.spec.ts            |  13 +
 tests/browser/checkout.spec.ts                     |  33 +++
 tests/browser/storefront-integration.spec.ts       |  21 +-
 tests/browser/storefront-keyboard.spec.ts          |  31 +++
 tests/browser/storefront-product-ux.spec.ts        |  39 ++-
 tests/http/checkout.test.ts                        |  24 +-
 tests/http/config.test.ts                          | 268 +++++++++++++++++++++
 16 files changed, 1132 insertions(+), 30 deletions(-)
```

## Local HEAD, index, and protected file

Tracked status uses `git status --porcelain=v1 --untracked-files=no` plus staged and unstaged name-status diffs. Untracked local stores and fonts were not enumerated. Git commands use `--no-optional-locks` so this read does not refresh the index.

- HEAD at start: e3f79c7e1629843ef8d16fcb431e1ca94cd1a038 (codex/readiness-issue-reconciliation)
- HEAD at end: e3f79c7e1629843ef8d16fcb431e1ca94cd1a038 (codex/readiness-issue-reconciliation)
- HEAD stable: **yes**
- Index (cached diff) stable: **yes**
- Tracked worktree diff stable: **yes**
- Protected file: `docs/reviews/bravos-v1-grok-review.md`
- Expected SHA-256: `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`
- SHA-256 at start: 3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A; matches expected: yes
- SHA-256 at end: 3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A; matches expected: yes
- Protected bytes stable: **yes**

Preexisting protected, dirty, and untracked local files are not treated as work performed by this collector. No generated files were restored because this process runs no local build or test.

## Commands

| UTC | Command | Attempt | Exit | ms | OK |
| --- | --- | --- | --- | --- | --- |
| 2026-10-13T14:33:19.575Z | `git --no-pager --no-optional-locks -C "C:\\Users\\Yousif Mansi\\Desktop\\bravos system" rev-parse HEAD` | 1 | 0 | 73 | yes |
| 2026-10-13T14:33:19.616Z | `git --no-pager --no-optional-locks -C "C:\\Users\\Yousif Mansi\\Desktop\\bravos system" rev-parse --abbrev-ref HEAD` | 1 | 0 | 40 | yes |
| 2026-10-13T14:33:19.691Z | `git --no-pager --no-optional-locks -C "C:\\Users\\Yousif Mansi\\Desktop\\bravos system" status --porcelain=v1 --untracked-files=no` | 1 | 0 | 74 | yes |
| 2026-10-13T14:33:19.733Z | `git --no-pager --no-optional-locks -C "C:\\Users\\Yousif Mansi\\Desktop\\bravos system" diff --cached --name-status` | 1 | 0 | 42 | yes |
| 2026-10-13T14:33:19.893Z | `git --no-pager --no-optional-locks -C "C:\\Users\\Yousif Mansi\\Desktop\\bravos system" diff --name-status` | 1 | 0 | 160 | yes |
| 2026-10-13T14:33:20.760Z | `gh pr view 43 --repo yousif-mansi/Bravos-system --json url,state,headRefOid,headRefName,baseRefName,reviewDecision,mergeStateStatus,statusCheckRollup` | 1 | 0 | 864 | yes |
| 2026-10-13T14:33:21.757Z | `gh run list --repo yousif-mansi/Bravos-system --workflow ci.yml --event pull_request --commit e3f79c7e1629843ef8d16fcb431e1ca94cd1a038 --limit 20 --json databaseId,headSha,event,status,conclusion,url,createdAt,updatedAt,workflowName,attempt` | 1 | 0 | 995 | yes |
| 2026-10-13T14:33:23.125Z | `gh run view 38338141884 --repo yousif-mansi/Bravos-system --attempt 1 --json headSha,status,conclusion,url,event,jobs,attempt` | 1 | 0 | 1361 | yes |
| 2026-10-13T14:33:25.629Z | `gh run view 38338141884 --repo yousif-mansi/Bravos-system --attempt 1 --job 115102825365 --log` | 1 | 0 | 2494 | yes |
| 2026-10-13T14:33:27.067Z | `gh run view 38338141884 --repo yousif-mansi/Bravos-system --attempt 1 --job 115103327790 --log` | 1 | 0 | 1436 | yes |
| 2026-10-13T14:33:28.302Z | `gh run view 38338141884 --repo yousif-mansi/Bravos-system --attempt 1 --job 115103327713 --log` | 1 | 0 | 1235 | yes |
| 2026-10-13T14:33:29.773Z | `gh pr view 43 --repo yousif-mansi/Bravos-system --json url,state,headRefOid,headRefName,baseRefName,reviewDecision,mergeStateStatus,statusCheckRollup` | 1 | 0 | 1457 | yes |
| 2026-10-13T14:33:30.574Z | `gh issue list --repo yousif-mansi/Bravos-system --state open --limit 100 --json number,title,url,labels,body` | 1 | 0 | 798 | yes |
| 2026-10-13T14:33:30.658Z | `git --no-pager --no-optional-locks -C "C:\\Users\\Yousif Mansi\\Desktop\\bravos system" show --stat --oneline e3f79c7e1629843ef8d16fcb431e1ca94cd1a038` | 1 | 0 | 80 | yes |
| 2026-10-13T14:33:30.699Z | `git --no-pager --no-optional-locks -C "C:\\Users\\Yousif Mansi\\Desktop\\bravos system" rev-parse HEAD` | 1 | 0 | 39 | yes |
| 2026-10-13T14:33:30.739Z | `git --no-pager --no-optional-locks -C "C:\\Users\\Yousif Mansi\\Desktop\\bravos system" rev-parse --abbrev-ref HEAD` | 1 | 0 | 39 | yes |
| 2026-10-13T14:33:30.786Z | `git --no-pager --no-optional-locks -C "C:\\Users\\Yousif Mansi\\Desktop\\bravos system" status --porcelain=v1 --untracked-files=no` | 1 | 0 | 47 | yes |
| 2026-10-13T14:33:30.828Z | `git --no-pager --no-optional-locks -C "C:\\Users\\Yousif Mansi\\Desktop\\bravos system" diff --cached --name-status` | 1 | 0 | 42 | yes |
| 2026-10-13T14:33:30.887Z | `git --no-pager --no-optional-locks -C "C:\\Users\\Yousif Mansi\\Desktop\\bravos system" diff --name-status` | 1 | 0 | 59 | yes |

## Logs and snapshots

- Job 115102825365 Types, architecture, scripts and builds: .scratch/github-checkpoint-20261013/ci-e3f79c7-20261013/logs/115102825365-types-architecture-scripts-and-builds.log (retrieved, 87099 bytes)
- Job 115103327790 PostgreSQL and HTTP integration: .scratch/github-checkpoint-20261013/ci-e3f79c7-20261013/logs/115103327790-postgresql-and-http-integration.log (retrieved, 94027 bytes)
- Job 115103327713 Chromium browser acceptance: .scratch/github-checkpoint-20261013/ci-e3f79c7-20261013/logs/115103327713-chromium-browser-acceptance.log (retrieved, 246154 bytes)
- git-head-index-start: .scratch/github-checkpoint-20261013/ci-e3f79c7-20261013/snapshots/git-head-index-start.json
- pr-before: .scratch/github-checkpoint-20261013/ci-e3f79c7-20261013/snapshots/pr-before.json
- run-list-latest: .scratch/github-checkpoint-20261013/ci-e3f79c7-20261013/snapshots/run-list-latest.json
- run-list-freeze: .scratch/github-checkpoint-20261013/ci-e3f79c7-20261013/snapshots/run-list-freeze.json
- run-view-latest: .scratch/github-checkpoint-20261013/ci-e3f79c7-20261013/snapshots/run-view-latest.json
- run-view-final: .scratch/github-checkpoint-20261013/ci-e3f79c7-20261013/snapshots/run-view-final.json
- pr-after: .scratch/github-checkpoint-20261013/ci-e3f79c7-20261013/snapshots/pr-after.json
- issues-open: .scratch/github-checkpoint-20261013/ci-e3f79c7-20261013/snapshots/issues-open.json
- git-show-stat: .scratch/github-checkpoint-20261013/ci-e3f79c7-20261013/snapshots/git-show-stat.txt
- git-head-index-end: .scratch/github-checkpoint-20261013/ci-e3f79c7-20261013/snapshots/git-head-index-end.json
- Status: .scratch/github-checkpoint-20261013/ci-e3f79c7-20261013/status.json
- Metadata: .scratch/github-checkpoint-20261013/ci-e3f79c7-20261013/metadata.json

## Errors

None recorded.

## Pending release gates

- Approved merge of the implemented software is still pending. This collector does not merge.
- #1, #33, #41, and #42 remain the owner, runtime, content, device, operator, host, and recovery gates when they are open.
- #38 remains optional content-deferred work.
- Production next startup was rejected before this collector ran. The block is policy. The exact trigger is unknown. This process does not retry another launcher, port, host, or CI workflow, and it does not run a production performance rehearsal.
- Existing Bravos CI is non-deployment testing. This collector only reads that evidence.

## Assessment

Engineering-only assessment: the frozen Bravos CI pull_request attempt 1 for the supplied SHA has workflow status completed and conclusion success, the three required jobs and their critical steps succeeded, and the pull request head still matched that SHA.

Production decision: NO-GO. Main review is still required.

## Main review supplement — 13 October 2026

The background collector finished, its process is no longer running, its completion status records exit0, and all three complete job logs and structured snapshots are retained. Main independently verified the exact `e3f79c7e1629843ef8d16fcb431e1ca94cd1a038` workflow result and reviewed candidate, job, issue and protected/index evidence. This is accepted engineering evidence; it is not merge, final visual or launch approval.

GitHub CLI rendered colour controls as literal `^[[…` sequences. The initial collector deliberately left the two unparsed counts above as “not stated.” Main made a one-line correction to the **ignored reporting utility**, preserving its ordinary ANSI handling, and independently reparsed the already-saved original attempt1 logs. No pipeline, tests or product source were rerun or changed. Original collector status/count snapshots remain unchanged as provenance; corrected count evidence is in `.scratch/github-checkpoint-20261013/main-counts.json` and `main-counts.log`.

| Exact candidate gate | Confirmed evidence |
| --- | --- |
| Chromium acceptance | **162 passed**,14.4minutes; job115103327713 |
| PostgreSQL/HTTP | **33 files;254 passed and1 skipped of255**, job115103327790. The skip is in `staff-access.test.ts`, whose existing Windows-only recovery-helper test is skipped on Linux. |
| Pure script tests | **24 passed;0 failed;0 skipped**, job115102825365 |
| Static/build/production audit threshold | Runtime pins, frozen install, typecheck, architecture, syntax, all three builds/bundle separation and moderate-or-higher production audit steps completed successfully. This is not a separate full/development dependency audit or hosted-runtime certification. |

Main also reran collector syntax and independent decision probes after the small parser correction. Cancelled/nonterminal/wrong-candidate/rerun/contradictory-result cases remain rejected; disclosed HTTP platform skips remain allowed. Grok implemented the collector and its bounded verdict/persistence corrections. Main's subsequent change is confined to rendering the saved log evidence accurately.

Uploaded range is `f7507e2..e3f79c7` on `codex/readiness-issue-reconciliation`, through PR43. Main is still `741fdf8`; no merge or deployment occurred. The index is empty. The protected review hash remains `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`; preexisting local stores/media/fonts are preserved. This generated report is local and uncommitted.

Next: obtain approval to integrate PR43; then resolve permitted production runtime/performance, representative content/brand acceptance, actual devices and staff pilot, hosting/monitoring and external recovery/rollback evidence. #37/#39/#40 await approved integration; #1/#33/#41/#42 remain acceptance gates and #38 stays optional content-deferred. Production recommendation remains **NO-GO** until those gates pass.

## Approved merge checkpoint — 13 October 2026

The owner explicitly instructed “merge now.” PR43 was rechecked OPEN, mergeable and clean at the verified `e3f79c7` head with all matching checks successful, then merged using a merge commit and a matching-head guard at **14:41:38 UTC**.

- GitHub main advanced from `741fdf84ae7dd4e92a806b97674ba7e8835c3c08` to **`acb2edc9f9e35ef6d3aa6b0f983785519dca8bee`**; `origin/main` was refreshed locally.
- The merged tree is byte-identical to the verified candidate tree: `1e28b84e979fec99b71dc24f7a66b3a02752937a`.
- GitHub automatically closed **#37, #39 and #40** through the approved PR's closing directives. **#1, #33, #38, #41 and #42** remain open.
- A fresh main-branch CI run **38415557654** started: https://github.com/yousif-mansi/Bravos-system/actions/runs/38415557654. It was still in progress at this check; earlier candidate evidence is not relabeled as this new run's result.
- The local checkout remains on the candidate branch with preserved protected/local data. The index is empty and the protected hash remains exact. No branch deletion, deployment, business-data change or public-ordering activation occurred.

This checkpoint supersedes the earlier pending-merge wording while preserving the collector's historical snapshots. Engineering integration is complete; the remaining production/content/device/operator/infrastructure/recovery gates still require their own evidence and approval.
