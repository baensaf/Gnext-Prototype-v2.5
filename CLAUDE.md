# Working in this repository

Several Claude sessions work on this repository at the same time. These rules keep them out
of each other's way.

## One worktree per session

- Don't edit files in the main checkout (`D:\VibeCode\ClaudeCode\Gnext-Prototype-v2.5`) while
  another session might be using it. Two sessions editing the same working tree mix their
  uncommitted changes, and one of them ends up committing the other's.
- Start each task in its own worktree on a fresh branch from `origin/main`:

  ```bash
  git fetch origin main
  git worktree add -b <type>/<topic> ../Gnext-<topic> origin/main
  ```

- `node_modules` is not in a new worktree. Either run `npm ci --legacy-peer-deps`, or link
  the main checkout's folders with `New-Item -ItemType Junction`. **Remove a junction with
  `cmd /c rmdir <path>` before `git worktree remove`**, or the removal deletes the main
  checkout's `node_modules` along with it.
- `backend/.env` and `starter-vite-ts/.env` are untracked; copy them in to run tests, and
  delete the copies before removing the worktree.
- When the work is merged, remove the worktree and delete its branch, locally and on origin.

## Shipping

- `main` deploys to the VPS on every green push (`.github/workflows/ci-cd.yml`). It changes
  only through a pull request: push the branch, open a PR, wait for `backend` and `frontend`
  to pass, then `gh pr merge <n> --rebase`.
- A local `pre-push` hook refuses direct pushes to `main`. Don't bypass it with `--no-verify`.
- Before pushing, run what CI runs: `npm run typecheck` and `npx jest` in `backend`,
  `npm run lint` and `npm run build` in `starter-vite-ts`.
- `en.json` and `fa.json` in `starter-vite-ts/src/locales` must have exactly the same keys.
  `r27-e2e.spec.ts` fails otherwise, and a red `main` blocks every deploy.
