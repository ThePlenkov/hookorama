---
id: fork-upstream-auto-merge-on-sync
type: lesson
tags: [fork, upstream, workflow, pr-auto-merge]
created: 2026-07-11
summary: Syncing fork main from upstream main auto-closes fork PRs whose SHAs are already in upstream main.
---

# Lesson — fork PRs auto-merge on `main` sync

## Rule

When fork `main` is synced from `upstream/main`, GitHub
auto-marks any fork PR as merged if all of its commits' SHAs
already exist in `upstream/main`. This works because the
feature branch in the fork and the feature branch pushed to
upstream are the same bytes — no cherry-pick, no rebase, no
squash. GitHub recognises that the fork PR's tip is already
present in `upstream/main` and transitions the fork PR to
`MERGED` automatically. The polecat does **not** run
`gh pr close` on the fork PR; the sync is the closing event.

## Applies when

- A polecat lands fix-up commits on a fork feature branch
  (`feat/*`) and pushes them to `origin` (the fork) with the
  same SHAs later pushed to `upstream` (upstream).
- The upstream PR with the same branch head has already been
  merged by the refinery into upstream `main`.
- The fork `main` is being synced (`git fetch upstream &&
git merge upstream/main --no-ff`). The fork PR will flip
  to `MERGED` on its own; do not `gh pr close` it manually.
- Conversely, if the fork PR does **not** auto-close after
  the sync, the SHAs diverged between the fork branch and the
  upstream branch — re-read
  `.agents/memory/retros/toast-act-pr2-2026-07-10.md` and the
  fork-upstream ADR (`docs/adr/0005-fork-upstream-workflow.md`),
  re-push the fork branch tip to upstream, then re-sync.
- When the user asks "is the fork PR closed?" — answer by
  checking whether `upstream/main` already contains the fork
  PR's tip SHA, not by running `gh pr view` on the fork PR
  (which may lag by minutes).
