// Behavioral probe for the retry-patched bootstrap.
// Builds a Matrix transport with a fake client whose registerBot fails the
// first two times, then drives BotPool.bootstrap() directly. Expectation:
// bootstrap retries and eventually resolves — registerBot called 3x and two
// retry delays scheduled. setTimeout is stubbed so the test does not sleep.
import { readdirSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const DIST = "/usr/local/lib/node_modules/zooid/dist";
const chunkFile = readdirSync(DIST).find(
  (f) =>
    f.endsWith(".js") &&
    readFileSync(DIST + "/" + f, "utf8").includes("__bootstrapOnce"),
);
if (!chunkFile) {
  console.log("PROBE_FAIL no patched chunk found");
  process.exit(2);
}

const ns = await import(pathToFileURL(DIST + "/" + chunkFile).href);
const createMatrixTransport = ns.createMatrixTransport;
if (typeof createMatrixTransport !== "function") {
  console.log("PROBE_FAIL createMatrixTransport not exported");
  process.exit(2);
}

const delays = [];
const realTimeout = globalThis.setTimeout;
globalThis.setTimeout = function (fn, ms) {
  delays.push(ms);
  return realTimeout(fn, 0);
};

const stats = { registerBot: 0, setDisplayName: 0 };
const client = new Proxy(
  {
    async registerBot() {
      stats.registerBot += 1;
      if (stats.registerBot < 3) throw new Error("503 Service Unavailable");
    },
    async setDisplayName() {
      stats.setDisplayName += 1;
    },
  },
  {
    get(target, prop) {
      if (prop in target) return target[prop];
      return async function () {};
    },
  },
);

let transport;
try {
  transport = createMatrixTransport({
    agents: [{ name: "probe", userId: "@agent.probe:example.org", rooms: [] }],
    client,
    bindings: [{ name: "probe", userId: "@agent.probe:example.org", rooms: [] }],
    approvals: { on: function () {} },
  });
} catch (err) {
  globalThis.setTimeout = realTimeout;
  console.log("PROBE_FAIL construct: " + err.message);
  process.exit(2);
}

let outcome = "resolved";
try {
  await transport.pool.bootstrap({});
} catch (err) {
  outcome = "rejected: " + err.message;
} finally {
  globalThis.setTimeout = realTimeout;
}

console.log(
  "PROBE_RESULT " +
    JSON.stringify({
      outcome,
      registerBotCalls: stats.registerBot,
      setDisplayNameCalls: stats.setDisplayName,
      retryDelaysMs: delays,
    }),
);
