// Applies structural patches to the globally-installed `zooid` package.
//
// Every patch verifies its anchor before replacing and exits non-zero if an
// anchor is missing. A silently-unpatched image is the failure mode we are
// avoiding: Docker image layering would install fine and only misbehave at
// runtime, which is exactly how the original boot race stayed invisible.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIST = "/usr/local/lib/node_modules/zooid/dist";
const die = (msg) => {
  console.error(`[patch-zooid] FATAL: ${msg}`);
  process.exit(1);
};

const jsFiles = readdirSync(DIST).filter((f) => f.endsWith(".js"));
if (jsFiles.length === 0) die(`no .js files under ${DIST}`);

// --- Patch 1: MAS/OAuth2 appservice registration needs inhibit_login ---------
// zooid 0.14.x registers appservice users without `inhibit_login`, which
// MSC3861 homeservers reject with 400 "the inhibit_login parameter must be set
// to true for appservice registrations".
let inhibitHits = 0;
let inhibitAlready = 0;
for (const f of jsFiles) {
  const p = join(DIST, f);
  const before = readFileSync(p, "utf8");
  const after = before.replace(
    /username: localpart2$/m,
    "username: localpart2, inhibit_login: true",
  );
  if (after !== before) {
    writeFileSync(p, after);
    inhibitHits += 1;
  } else if (before.includes("username: localpart2, inhibit_login: true")) {
    inhibitAlready += 1;
  }
}
if (inhibitHits === 0 && inhibitAlready === 0) {
  die("inhibit_login anchor 'username: localpart2' not found");
}

// --- Patch 2: retry the one-shot Matrix bootstrap with backoff --------------
// transport.bootstrap() runs once at startup and swallows every per-agent
// Matrix error with console.warn. On a host restart the daemon can come up
// before Synapse/MAS, 503 its whole bootstrap, and never retry — leaving every
// agent permanently unregistered ("no agent matched"). Wrap the original body
// in a retry loop that treats any `[matrix] … failed` warning as a failure and
// re-runs with capped exponential backoff until a clean pass.
const chunk = jsFiles.find((f) =>
  readFileSync(join(DIST, f), "utf8").includes("async bootstrap(opts = {}) {"),
);
if (!chunk) die("chunk containing 'async bootstrap(opts = {}) {' not found");

const chunkPath = join(DIST, chunk);
let src = readFileSync(chunkPath, "utf8");
const DECL = "  async bootstrap(opts = {}) {";
const NEXT = "\n  findByUserId(userId) {";
if (!src.includes(DECL)) die(`anchor '${DECL.trim()}' not found`);
if (!src.includes(NEXT)) die("anchor 'findByUserId(userId) {' not found");
if (src.includes("__bootstrapOnce")) die("bootstrap already patched");

src = src.replace(DECL, "  async __bootstrapOnce(opts = {}) {");

const wrapper = `  async bootstrap(opts = {}) {
    for (let attempt = 1; ; attempt++) {
      const failures = [];
      const originalWarn = console.warn;
      console.warn = (...args) => {
        if (typeof args[0] === "string" && args[0].startsWith("[matrix]") && args[0].includes("failed")) {
          failures.push(args[0]);
        }
        return originalWarn.apply(console, args);
      };
      try {
        await this.__bootstrapOnce(opts);
      } finally {
        console.warn = originalWarn;
      }
      if (failures.length === 0) return;
      const delay = Math.min(60000, 2000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 1000);
      originalWarn(
        \`[matrix] bootstrap incomplete (\${failures.length} failure(s)); retrying in \${delay}ms\`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
`;

src = src.replace(NEXT, "\n" + wrapper + "  findByUserId(userId) {");
writeFileSync(chunkPath, src);

// Verify the patched chunk still parses before the image is committed.
try {
  execFileSync(process.execPath, ["--check", chunkPath], { stdio: "inherit" });
} catch {
  die(`syntax check failed on patched ${chunk}`);
}

// --- Patch 3: make the per-room open-task cap configurable ------------------
// transport-matrix's task-registry.ts hardcodes MAX_OPEN_TASKS_PER_ROOM = 5;
// both the registry getter and the "at_capacity" refusal message read it. Make
// it an env-tunable so the cap can be raised per deployment without a rebuild.
// Default stays 5 when the variable is unset or invalid. The value is resolved
// once at import time, so it must be set before the daemon process starts.
const CAP_DECL = "var MAX_OPEN_TASKS_PER_ROOM = 5;";
const CAP_MARK = "process.env.MAX_OPEN_TASKS_PER_ROOM";
const CAP_PATCH = `var MAX_OPEN_TASKS_PER_ROOM = (() => {
  const raw = process.env.MAX_OPEN_TASKS_PER_ROOM;
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 5;
})();`;
let capHits = 0;
let capAlready = 0;
let capPath = null;
for (const f of jsFiles) {
  const p = join(DIST, f);
  const before = readFileSync(p, "utf8");
  if (before.includes(CAP_MARK)) {
    capAlready += 1;
    capPath = p;
    continue;
  }
  if (!before.includes(CAP_DECL)) continue;
  writeFileSync(p, before.replace(CAP_DECL, CAP_PATCH));
  capHits += 1;
  capPath = p;
}
if (capHits === 0 && capAlready === 0) {
  die("MAX_OPEN_TASKS_PER_ROOM anchor 'var MAX_OPEN_TASKS_PER_ROOM = 5;' not found");
}
try {
  execFileSync(process.execPath, ["--check", capPath], { stdio: "inherit" });
} catch {
  die(`syntax check failed on patched ${capPath}`);
}

console.log(
  `[patch-zooid] ok: inhibit_login applied=${inhibitHits} already=${inhibitAlready}, ` +
    `bootstrap retry in ${chunk}, task cap env-driven applied=${capHits} already=${capAlready}`,
);
