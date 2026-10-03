// Applies structural patches to the globally-installed `zooid` package.
//
// Every patch verifies its anchor before replacing and exits non-zero if an
// anchor is missing. A silently-unpatched image is the failure mode we are
// avoiding: Docker image layering would install fine and only misbehave at
// runtime, which is exactly how the original boot race stayed invisible.
//
// Anchors are matched against the *emitted* dist (esbuild output, not the TS
// source), so they tolerate esbuild's identifier renumbering (a colliding
// `localpart`/`opts`/`userId` becomes `localpart2`, `opts2`, ...) and optional
// trailing commas. Verified against zooid 0.17.0 (fork ref e65d018) dist.
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
// zooid registers appservice users without `inhibit_login`, which MSC3861
// homeservers reject with 400 "the inhibit_login parameter must be set to true
// for appservice registrations". The register body is emitted as:
//     type: "m.login.application_service",
//     username: localpart2            (esbuild renames the param on collision)
// so match `username: <ident>` (optional numbered suffix, optional trailing
// comma) and append the flag.
const INHIBIT_RE = /username: (localpart\d*)(,)?$/m;
const INHIBIT_APPLIED_RE = /username: localpart\d*, inhibit_login: true/;
let inhibitHits = 0;
let inhibitAlready = 0;
for (const f of jsFiles) {
  const p = join(DIST, f);
  const before = readFileSync(p, "utf8");
  const after = before.replace(INHIBIT_RE, "username: $1, inhibit_login: true");
  if (after !== before) {
    writeFileSync(p, after);
    inhibitHits += 1;
  } else if (INHIBIT_APPLIED_RE.test(before)) {
    inhibitAlready += 1;
  }
}
if (inhibitHits === 0 && inhibitAlready === 0) {
  die("inhibit_login anchor 'username: localpart<digits>' not found");
}

// --- Patch 2: retry the one-shot Matrix bootstrap with backoff --------------
// transport.bootstrap() runs once at startup and swallows every per-agent
// Matrix error with console.warn. On a host restart the daemon can come up
// before Synapse/MAS, 503 its whole bootstrap, and never retry — leaving every
// agent permanently unregistered ("no agent matched"). Wrap the original body
// in a retry loop that treats any `[matrix] … failed` warning as a failure and
// re-runs with capped exponential backoff until a clean pass.
//
// The emitted method is `async bootstrap(opts = {}) {` (types erased), followed
// later in the same class by `findByUserId(userId) {`. Both identifiers may be
// renumbered by esbuild, so capture and reuse them rather than hardcoding.
const BOOTSTRAP_DECL_RE = /^([ \t]*)async bootstrap\((opts\d*) = \{\}\) \{$/m;
const FIND_BY_USER_RE = /^([ \t]*)findByUserId\((?:userId\d*)\) \{$/m;
const chunk = jsFiles.find((f) => {
  const text = readFileSync(join(DIST, f), "utf8");
  return BOOTSTRAP_DECL_RE.test(text) && FIND_BY_USER_RE.test(text);
});
if (!chunk) die("chunk containing the bootstrap() + findByUserId() methods not found");

const chunkPath = join(DIST, chunk);
let src = readFileSync(chunkPath, "utf8");
if (src.includes("__bootstrapOnce")) die("bootstrap already patched");

const declMatch = src.match(BOOTSTRAP_DECL_RE);
const nextMatch = src.match(FIND_BY_USER_RE);
if (!declMatch) die("anchor 'async bootstrap(opts = {}) {' not found");
if (!nextMatch) die("anchor 'findByUserId(userId) {' not found");

const indent = declMatch[1];
const optsParam = declMatch[2];

// Rename the original method; the wrapper below calls it.
src = src.replace(
  declMatch[0],
  `${indent}async __bootstrapOnce(${optsParam} = {}) {`,
);

const wrapper = `${indent}async bootstrap(${optsParam} = {}) {
${indent}  for (let attempt = 1; ; attempt++) {
${indent}    const failures = [];
${indent}    const originalWarn = console.warn;
${indent}    console.warn = (...args) => {
${indent}      if (typeof args[0] === "string" && args[0].startsWith("[matrix]") && args[0].includes("failed")) {
${indent}        failures.push(args[0]);
${indent}      }
${indent}      return originalWarn.apply(console, args);
${indent}    };
${indent}    try {
${indent}      await this.__bootstrapOnce(${optsParam});
${indent}    } finally {
${indent}      console.warn = originalWarn;
${indent}    }
${indent}    if (failures.length === 0) return;
${indent}    const delay = Math.min(60000, 2000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 1000);
${indent}    originalWarn(
${indent}      \`[matrix] bootstrap incomplete (\${failures.length} failure(s)); retrying in \${delay}ms\`
${indent}    );
${indent}    await new Promise((resolve) => setTimeout(resolve, delay));
${indent}  }
${indent}}
`;

src = src.replace(nextMatch[0], wrapper + nextMatch[0]);
writeFileSync(chunkPath, src);

// Verify the patched chunk still parses before the image is committed.
try {
  execFileSync(process.execPath, ["--check", chunkPath], { stdio: "inherit" });
} catch {
  die(`syntax check failed on patched ${chunk}`);
}

console.log(
  `[patch-zooid] ok: inhibit_login applied=${inhibitHits} already=${inhibitAlready}, bootstrap retry in ${chunk}`,
);
