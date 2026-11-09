#!/usr/bin/env node
// Headless driver for devcodehike (Remotion + Code Hike code-transition video).
// Run from the project root:  node .claude/skills/run-devcodehike/driver.mjs <cmd> [...]
//
//   still [frame] [out.png]   render one frame to PNG       (default: 75, /tmp/devcodehike/still.png)
//   steps [outDir]            one PNG per code step (settled frame, after the transition)
//   frame <n> [out.png]       exact frame n of the real video (renders mp4 if stale, extracts w/ ffmpeg)
//   render [out.mp4]          render the whole video        (default: /tmp/devcodehike/out.mp4)
//   compositions              list compositions + resolved width/height/duration
//   studio [png] [frame]      start `remotion studio` on :3123, open in headless Chromium, seek, screenshot, stop
//
// What it does for you (each is a trap in a sandboxed Linux container):
//   * serves node_modules/typescript/lib on 127.0.0.1:4719 and passes --config pointing at
//     remotion.offline.config.ts, which aliases twoslash-cdn to a shim that fetches from there
//     instead of playgroundcdn.typescriptlang.org (blocked by the egress proxy);
//   * passes --browser-executable to the preinstalled Chromium (Remotion would otherwise try to
//     download Chrome Headless Shell from remotion.media, which does not resolve).
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
if (!existsSync(path.join(ROOT, "remotion.config.ts"))) {
  console.error("Run this from the devcodehike project root (where remotion.config.ts is).");
  process.exit(2);
}
const SKILL = ".claude/skills/run-devcodehike";
const OUT = "/tmp/devcodehike";
const STEP_FRAMES = 90; // defaultStepDuration in src/calculate-metadata/calculate-metadata.tsx

// Full Chromium, NOT chrome-headless-shell: the headless shell ignores the NSS store that holds
// the proxy CA, so every Google Fonts fetch fails with ERR_CERT_AUTHORITY_INVALID.
const BROWSER =
  process.env.REMOTION_BROWSER ??
  ["/opt/pw-browsers/chromium-1243/chrome-linux64/chrome",
   ...(existsSync("/opt/pw-browsers")
     ? readdirSync("/opt/pw-browsers").filter((d) => /^chromium-\d+$/.test(d))
         .map((d) => `/opt/pw-browsers/${d}/chrome-linux64/chrome`)
     : [])].find(existsSync);

function startLibServer() {
  const libDir = path.join(ROOT, "node_modules/typescript/lib");
  const server = createServer((req, res) => {
    const name = path.basename(decodeURIComponent(req.url.split("?")[0]));
    const file = path.join(libDir, name);
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (!name.endsWith(".d.ts") || !existsSync(file)) { res.statusCode = 404; return res.end(); }
    res.setHeader("Content-Type", "text/plain");
    res.end(readFileSync(file));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(4719, "127.0.0.1", () => resolve(server));
  });
}

function remotion(args) {
  const full = ["remotion", ...args, `--config=${SKILL}/remotion.offline.config.ts`];
  if (BROWSER) full.push(`--browser-executable=${BROWSER}`);
  console.error(`$ npx ${full.join(" ")}`);
  return new Promise((resolve) => {
    const p = spawn("npx", full, { stdio: ["ignore", "pipe", "pipe"] });
    const noise = /memory|Memory|docker run|Using the lower|^\s*$|Bundling \d+%/;
    const pipe = (s, to) => s.on("data", (b) => {
      for (const l of b.toString().split("\n")) if (!noise.test(l)) to.write(l + "\n");
    });
    pipe(p.stdout, process.stdout); pipe(p.stderr, process.stderr);
    p.on("close", resolve);
  });
}

async function studio(png, frame) {
  // Playwright is not a project dependency; use the globally installed one.
  const { createRequire } = await import("node:module");
  const { execSync } = await import("node:child_process");
  const globalRoot = execSync("npm root -g").toString().trim();
  const { chromium } = createRequire(globalRoot + "/")("playwright");
  const port = 3123;
  const p = spawn("npx", ["remotion", "studio", "--no-open", `--port=${port}`,
    `--config=${SKILL}/remotion.offline.config.ts`], { stdio: ["ignore", "pipe", "pipe"], detached: true });
  let log = ""; p.stdout.on("data", (b) => (log += b)); p.stderr.on("data", (b) => (log += b));
  try {
    for (let i = 0; i < 120 && !log.includes(`localhost:${port}`); i++) await new Promise((r) => setTimeout(r, 500));
    const browser = await chromium.launch({ executablePath: BROWSER });
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const errors = [];
    // Expected noise: Remotion's bug-check ping (blocked egress) and legacy lib names TS 5.9 no longer ships.
    const expected = /bugs\.remotion\.dev|127\.0\.0\.1:4719\/lib\./;
    page.on("requestfailed", (r) => errors.push(`${r.failure()?.errorText} ${r.url()}`));
    page.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
    await page.goto(`http://localhost:${port}/Main`, { waitUntil: "domcontentloaded" });
    // Studio is ready once the player canvas renders code tokens.
    await page.waitForFunction(() => document.body.innerText.includes("Main"), null, { timeout: 60000 });
    await page.waitForTimeout(8000); // calculateMetadata (fonts + twoslash) runs in the page
    // Seek: Shift+ArrowRight = +1 s (30 frames), ArrowRight = +1 frame. Frame 0 shows no code
    // (step 1 transitions in from empty), so default to 75 = step 1 settled.
    const f = Number(frame ?? 75);
    await page.mouse.click(800, 350); // focus the canvas area, not an input
    for (let i = 0; i < Math.floor(f / 30); i++) await page.keyboard.press("Shift+ArrowRight");
    for (let i = 0; i < f % 30; i++) await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: png });
    console.log(`studio screenshot -> ${png}`);
    errors.splice(0, errors.length, ...errors.filter((e) => !expected.test(e)));
    if (errors.length) console.log("console errors:\n  " + errors.slice(0, 10).join("\n  "));
    await browser.close();
  } finally {
    try { process.kill(-p.pid, "SIGTERM"); } catch {}
  }
}

const [cmd = "help", ...rest] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const server = await startLibServer();
let code = 0;
try {
  switch (cmd) {
    case "still": {
      const [frame = "75", out = `${OUT}/still.png`] = rest;
      code = await remotion(["still", "Main", out, `--frame=${frame}`]);
      if (!code) console.log(`still -> ${out}`);
      break;
    }
    case "steps": {
      const [dir = `${OUT}/steps`] = rest;
      mkdirSync(dir, { recursive: true });
      const n = readdirSync(path.join(ROOT, "public")).filter((f) => f.startsWith("code")).length;
      for (let i = 0; i < n && !code; i++) {
        // STEP*i+75 = settled code of step i. Do NOT `still` a frame inside the first 30 frames of a
        // step (the transition): `remotion still` mounts CodeTransition on that frame, it has no
        // previous snapshot, and the code area renders blank. Use `frame <n>` for those.
        code = await remotion(["still", "Main", `${dir}/step${i + 1}.png`, `--frame=${STEP_FRAMES * i + 75}`]);
      }
      if (!code) console.log(`steps -> ${dir}/`);
      break;
    }
    case "frame": {
      const [n, out = `${OUT}/frame${n}.png`] = rest;
      if (!/^\d+$/.test(n ?? "")) { console.error("usage: frame <n> [out.png]"); code = 2; break; }
      const mp4 = `${OUT}/out.mp4`;
      const newest = (d) => readdirSync(d, { recursive: true }).map((f) => statSync(path.join(d, f)).mtimeMs);
      const stale = !existsSync(mp4) ||
        Math.max(...newest(path.join(ROOT, "src")), ...newest(path.join(ROOT, "public"))) > statSync(mp4).mtimeMs;
      if (stale) code = await remotion(["render", "Main", mp4]);
      if (code) break;
      code = await new Promise((r) => spawn("ffmpeg", ["-loglevel", "error", "-y", "-i", mp4,
        "-vf", `select=eq(n\\,${n})`, "-vframes", "1", out], { stdio: "inherit" }).on("close", r));
      if (!code) console.log(`frame ${n} -> ${out}`);
      break;
    }
    case "render": {
      const [out = `${OUT}/out.mp4`] = rest;
      code = await remotion(["render", "Main", out]);
      if (!code) console.log(`video -> ${out}`);
      break;
    }
    case "compositions":
      code = await remotion(["compositions"]);
      break;
    case "studio":
      await studio(rest[0] ?? `${OUT}/studio.png`, rest[1]);
      break;
    default:
      console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 10).map((l) => l.slice(3)).join("\n"));
  }
} finally {
  server.close();
}
process.exit(code ?? 0);
