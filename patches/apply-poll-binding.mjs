#!/usr/bin/env node
// Build-time patch: bind the poll MCP server to each agent session.
//
// Why: poll-mcp used to trust the room_id/thread_id the model passed, so a
// session working in #general could place a poll in an #infra thread
// (2026-10-20). opencode accepts an `http` mcpServers entry in ACP
// `session/new` / `session/load`, so the daemon can hand every session its own
// poll server whose headers carry that session's room and thread root. poll-mcp
// treats those headers as authoritative.
//
// The patch is anchored on a pinned zooid release; if the anchor disappears the
// build fails instead of silently shipping an unbound poll tool.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const TARGET =
  "/usr/local/lib/node_modules/zooid/node_modules/@zooid/acp-client/src/acp-client.ts";
const MARKER = "[zooid-poll-binding]";

const ANCHOR = `    const mcpServers = this.options.contextSpawn
      ? [await this.options.contextSpawn(contextThreadId ?? threadId, channelId, threadId)]
      : []`;

const INJECT = `${ANCHOR}
    // ${MARKER} Give this session its own poll server, bound to the room and
    // thread root it is working in. poll-mcp refuses to place a poll anywhere
    // else, so a model that grounded on the wrong room cannot ask a question
    // into a foreign thread.
    if (process.env.POLL_MCP_TOKEN && this.options.agent.matrix?.user_id) {
      mcpServers.push({
        name: 'poll',
        type: 'http',
        url: process.env.POLL_MCP_URL ?? 'http://poll-mcp.coolify.lan/mcp',
        headers: [
          { name: 'Authorization', value: \`Bearer \${process.env.POLL_MCP_TOKEN}\` },
          { name: 'X-Zooid-Sender', value: this.options.agent.matrix.user_id },
          { name: 'X-Zooid-Room', value: channelId ?? contextThreadId ?? threadId },
          { name: 'X-Zooid-Thread', value: contextThreadId ?? threadId },
        ],
      } as never)
    } else {
      process.stderr.write(
        '[acp-client] poll binding NOT injected: POLL_MCP_TOKEN or agents.<name>.matrix.user_id is missing\\n',
      )
    }`;

if (!existsSync(TARGET)) {
  console.error(`poll-binding patch: ${TARGET} not found — zooid layout changed, refusing to build`);
  process.exit(1);
}

const source = readFileSync(TARGET, "utf8");
if (source.includes(MARKER)) {
  console.log("poll-binding patch: already applied");
  process.exit(0);
}
if (!source.includes(ANCHOR)) {
  console.error(
    "poll-binding patch: ensureSession anchor not found — zooid's acp-client changed, refusing to build",
  );
  process.exit(1);
}

writeFileSync(TARGET, source.replace(ANCHOR, INJECT), "utf8");
console.log("poll-binding patch: applied");
