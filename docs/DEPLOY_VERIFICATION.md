# Deployment Verification Guard

`scripts/verify_deploy.js` confirms the code you think you shipped is actually
live on **both** independent deploy targets: GitHub (`git push`) and Apps Script
(`clasp push`). It exists because both targets have failed silently in real
deploys:

- **4.16.1** — a source file was reverted while the version + CHANGELOG moved
  forward, so GitHub's content disagreed with what was supposedly shipped. A
  version-stamp check passed; only a content diff caught it.
- **4.22.0** — `git push` succeeded but `clasp push` died with an OAuth reauth
  error (`invalid_rapt`) that scrolled past in the terminal. Apps Script silently
  stayed on the old code while everything *looked* deployed.

## Usage

Run it as the **last step** of every deploy, after `git push` and `clasp push`:

```bash
# 1. push to both targets, capturing the clasp output so the guard can read it:
git add -A && git commit -m "…" && git push
clasp push --force 2>&1 | tee .clasp_last_push.log

# 2. verify both targets:
node scripts/verify_deploy.js --clasp-log .clasp_last_push.log
```

Exit code is **0** when both targets are consistent, **1** otherwise (CI-friendly).

GitHub-only (skip the Apps Script check):

```bash
node scripts/verify_deploy.js
```

Run the guard's own unit tests:

```bash
node scripts/verify_deploy.js --self-test     # 15 checks, exit 0 when green
```

## What it checks

| Check | Catches | Method |
|-------|---------|--------|
| GitHub version + content | local tree not pushed / partial push / wrong branch / **file content drift (4.16.1)** | per-file sha256 of all pushable `.gs`/`.js` vs `raw.githubusercontent.com/main`, CRLF-normalized |
| clasp push result | **silent clasp failure (4.22.0)** — auth/reauth, error blob, missing success line | scans the captured `clasp push` log for failure signatures and the `Pushed N files` success line |

## Honest scope (what it does NOT catch)

A self-consistent-but-**wrong** local tree (local == GitHub, both wrong) is not
caught here — both sides hash equal. That class is the job of the behavior tests
(`scripts/full_selftest.js`) plus the discipline of shipping minimal, scoped file
sets so an old copy never clobbers a good one. This guard is specifically the
*deployment-target consistency* layer.

`.claspignore` is respected: files clasp never pushes (`scripts/**`, `**/*.md`,
etc.) are excluded from the GitHub content check too, so docs/tooling edits don't
raise false diffs. The guard itself lives under `scripts/` and is therefore never
shipped to Apps Script.
