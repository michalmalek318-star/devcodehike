---
name: run-devcodehike
description: Build, run, render and screenshot devcodehike, the Remotion + Code Hike code-transition video. Use when asked to start the Remotion studio, render the video or a still, screenshot a frame or code step, check a change to src/ or public/code* snippets, or lint the project.
---

devcodehike is a Remotion video: each `public/code*` file is one step, animated with Code Hike token transitions and annotated by twoslash (type popovers, `// @errors`). Drive it headless with **`.claude/skills/run-devcodehike/driver.mjs`**. It wraps the Remotion CLI and adds the workarounds this container needs (see Gotchas).

All paths are relative to the project root (`devcodehike/`). Run every command from there.

## Prerequisites

Node 22 (tested with v22.23.4). Also needs the preinstalled Chromium at `/opt/pw-browsers/chromium-*/chrome-linux64/chrome`, a global `playwright` (studio command only) and `ffmpeg` on PATH (`frame` command only). No `apt-get` was needed in this container.

## Setup

```bash
npm i
```

Takes about 70 s. `npm i` creates an untracked `package-lock.json`; the repo ships none.

## Run (agent path)

```bash
node .claude/skills/run-devcodehike/driver.mjs steps          # one PNG per code step -> /tmp/devcodehike/steps/step{1..4}.png  (~20 s)
node .claude/skills/run-devcodehike/driver.mjs frame 100      # exact frame of the real video -> /tmp/devcodehike/frame100.png
node .claude/skills/run-devcodehike/driver.mjs still 60       # single frame via `remotion still` -> /tmp/devcodehike/still.png
node .claude/skills/run-devcodehike/driver.mjs render         # full video -> /tmp/devcodehike/out.mp4  (~30 s, 360 frames)
node .claude/skills/run-devcodehike/driver.mjs compositions   # prints: Main  30  1106x1080  360 (12.00 sec)
node .claude/skills/run-devcodehike/driver.mjs studio /tmp/devcodehike/studio.png 135   # studio UI seeked to frame 135
```

All output goes to `/tmp/devcodehike/`. Look at the PNG files with Read.

| command | what it does |
|---|---|
| `steps [dir]` | `remotion still` at frame `90*i+75` for each step: settled code, popovers and error boxes visible. Best first check after editing `src/` or `public/code*`. |
| `frame <n> [png]` | Renders `out.mp4` if any file in `src/`/`public/` is newer, then extracts frame n with ffmpeg. Use it for frames inside a transition. |
| `still [n] [png]` | One `remotion still` (default frame 75). Only reliable on settled frames (see Gotchas). |
| `render [mp4]` | `remotion render Main`. |
| `compositions` | Resolved width/height/duration after `calculateMetadata`. Width changes with the longest snippet line. |
| `studio [png] [frame]` | Starts `remotion studio` on :3123, loads `/Main` in headless Chromium, seeks with Shift+→ (30 frames) and → (1 frame), screenshots, prints unexpected failed requests, then kills the studio. |

Timing: each step is 90 frames at 30 fps. The first 30 frames of each step are the token transition. 4 snippets give 360 frames.

## Run (human path)

```bash
npm run dev   # remotion studio -> "Server ready - Local: http://localhost:3000"; Ctrl-C to stop
```

This is useless headless. It also uses the plain `remotion.config.ts` without the twoslash shim, so it reaches the blocked CDN. Use `driver.mjs studio`.

## Test

```bash
npm run lint   # tsc && eslint src - passes clean
```

There is no test suite. Lint plus `steps` screenshots is the check.

## Gotchas

- **playgroundcdn.typescriptlang.org is blocked by the egress proxy.** twoslash (`src/calculate-metadata/process-snippet.ts`) fetches `lib.*.d.ts` from it inside `calculateMetadata`, so a plain `npx remotion still` fails with `ERR_NAME_NOT_RESOLVED` and then times out. The driver serves `node_modules/typescript/lib` on `127.0.0.1:4719` and passes `--config=.claude/skills/run-devcodehike/remotion.offline.config.ts`. That config is a copy of `remotion.config.ts` plus an rspack alias `twoslash-cdn$` → `twoslash-shim.mjs`, which injects a `fetcher` that rewrites the CDN URL. **Project code stays untouched.** If `remotion.config.ts` changes, mirror the change in the offline config. Snippets that `import` npm packages would also need `cdn.jsdelivr.net` (also blocked); the current snippets import nothing.
- **Remotion tries to download Chrome Headless Shell from remotion.media** (`getaddrinfo ENOTFOUND`). The driver passes `--browser-executable` pointing at the preinstalled Chromium. Override it with `REMOTION_BROWSER=/path/to/chrome`.
- **Use full Chromium, not `chromium_headless_shell`.** The headless shell ignores the NSS store holding the proxy CA, so Google Fonts (Roboto Mono via `@remotion/google-fonts`) fails with `ERR_CERT_AUTHORITY_INVALID` and the render times out on `delayRender "Fetching Roboto Mono font"`. Full `chrome-linux64/chrome` trusts it.
- **`remotion still` inside a transition renders a blank code area.** For example, frame 100 = step 2 + 10 frames. `CodeTransition` mounts on that frame with no previous DOM snapshot, so tokens never appear. The real video at the same frame is fine. Use `frame <n>` (mp4 + ffmpeg) for transition frames and `steps`/`still` only for frames ≥ 30 into a step. Frame 0 also shows no code, because step 1 animates in from empty.
- **404s on `lib.core.d.ts`, `lib.es7.d.ts`, `lib.core.es6.d.ts`, `lib.es2022.sharedmemory.d.ts` are expected.** twoslash asks for legacy names that TypeScript 5.9 no longer ships; output is unaffected. The driver hides them, along with the blocked `bugs.remotion.dev` ping.
- **The "Version mismatch: zod installed 4.5.4, required 4.6.7" banner** prints on every command. Renders work regardless. Not fixed, because `package.json` pins zod 4.5.4.

## Troubleshooting

- **`Error: Timeout (30000ms) exceeded ... Open delayRender() handles: "Fetching Roboto Mono font"`** with `ERR_CERT_AUTHORITY_INVALID`: you are on chrome-headless-shell. Use the full Chromium (the driver default).
- **`... at src/calculate-metadata/process-snippet.ts:22` after `Failed to load resource ... playgroundcdn.typescriptlang.org`**: you ran the Remotion CLI directly without the offline config. Go through `driver.mjs`.
- **`EADDRINUSE 127.0.0.1:4719`**: another driver run is still active. Wait for it or kill it. The studio uses :3123 and is killed at the end of `studio`.
