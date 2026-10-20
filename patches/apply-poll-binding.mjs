#!/usr/bin/env node
// Build-time patch: bind the poll MCP server to each agent session.
//
// Why: poll-mcp used to trust the room_id/thread_id the model passed, so a
// session working in #general could place a poll in an #infra thread
// (2026-10-20). opencode accepts an `http` mcpServers entry in ACP
// `session/new` / `session/load`, so the daemon can hand every session its own
// poll server whose headers carry that session's room and thread root;
// poll-mcp treats those headers as authoritative.
//
// zooid 0.18.0 runs the tsup bundle in dist/ (Node refuses type stripping under
// node_modules), so this patches the bundled chunk, not the @zooid/acp-client
// sources. The build fails if the anchor is gone instead of silently shipping an
// unbound poll tool.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIST = "/usr/local/lib/node_modules/zooid/dist";
const MARKER = "[zooid-poll-binding]";

const ANCHOR =
  "    const mcpServers = this.options.contextSpawn ? [await this.options.contextSpawn(contextThreadId ?? threadId, channelId, threadId)] : [];";

const INJECT = `${ANCHOR}
    // ${MARKER} Give this session its own poll server, bound to the room and
    // thread root it is working in. poll-mcp refuses to place a poll anywhere
    // else, so a model that grounded on the wrong room cannot ask a question
    // into a foreign thread.
    const pollSender = this.options.agent.env?.MATRIX_SENDER;
    if (process.env.POLL_MCP_TOKEN && pollSender) {
      mcpServers.push({
        name: "poll",
        type: "http",
        url: process.env.POLL_MCP_URL ?? "http://poll-mcp.coolify.lan/mcp",
        headers: [
          { name: "Authorization", value: "Bearer " + process.env.POLL_MCP_TOKEN },
          { name: "X-Zooid-Sender", value: pollSender },
          { name: "X-Zooid-Room", value: channelId ?? contextThreadId ?? threadId },
          { name: "X-Zooid-Thread", value: contextThreadId ?? threadId },
        ],
      });
    } else {
      process.stderr.write(
        "[acp-client] poll binding NOT injected: POLL_MCP_TOKEN or MATRIX_SENDER is missing\\n",
      );
    }`;

let files;
try {
  files = readdirSync(DIST).filter((f) => f.endsWith(".js"));
} catch (error) {
  console.error(`poll-binding patch: cannot read ${DIST} — ${error.message}`);
  process.exit(1);
}

let patched = 0;
let already = 0;
for (const file of files) {
  const path = join(DIST, file);
  const source = readFileSync(path, "utf8");
  if (source.includes(MARKER)) {
    already += 1;
    continue;
  }
  if (!source.includes(ANCHOR)) continue;
  writeFileSync(path, source.replace(ANCHOR, INJECT), "utf8");
  patched += 1;
  console.log(`poll-binding patch: applied to dist/${file}`);
}

if (patched === 0 && already === 0) {
  console.error(
    "poll-binding patch: ensureSession anchor not found in zooid/dist — zooid changed, refusing to build",
  );
  process.exit(1);
}
if (patched === 0) console.log("poll-binding patch: already applied");
