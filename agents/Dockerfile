# Custom Zooid agent image.
#
# Base: the upstream agent-opencode image ships Node (node/npm/npx) but not
# `uv`/`uvx`, which the `docker` and `truenas` MCP servers (declared as
# `uvx <pkg>` in each agent's opencode.json) require.
#
# OpenCode: this image ships OpenCode **V2** (`@opencode/cli`, npm). The base
# image bundles OpenCode V1 (`opencode-ai`); we remove it and install the pinned
# V2 CLI. The `opencode` binary keeps the same name and still serves ACP
# protocol v1, so the zooid `opencode` preset (`command: opencode, args: [acp]`)
# is unchanged.
#
# Elicitation requirement (zooid 0.17): the daemon uses ACP *form* elicitation.
# The `opencode acp` in this image must advertise `elicitation.form` in its ACP
# `initialize` capabilities. Verify after the base/image is rebuilt:
#   - `opencode --version` (confirm the expected build)
#   - the ACP `initialize` response's `agentCapabilities.elicitation`.
#
# Build:  docker build -t zooid-agent-opencode:local agents/
# Then set `container.image` in zooid.yaml to `zooid-agent-opencode:local`.
#
# ROLLBACK: the published `:latest` tag is the V1 image and is never moved. To
# roll back, point `container.image` at
# `ghcr.io/mariocakedev/zooid-agent-opencode:latest` and respawn the agents —
# no rebuild, no config edit. See ../ROLLBACK.md.
FROM ghcr.io/zooid-ai/agent-opencode:latest

USER root

# Pin V2 explicitly: a floating `@opencode/cli` would make image contents
# unreproducible. Bump deliberately.
ARG OPENCODE_V2_VERSION=2.0.25

# Keep uv/uvx (needed by the docker/truenas MCP servers).
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && curl -LsSf https://astral.sh/uv/install.sh | UV_INSTALL_DIR=/usr/local/bin sh \
    && rm -rf /var/lib/apt/lists/*

# Remove the bundled V1 CLI (npm package), then install the pinned V2 CLI.
RUN npm uninstall -g opencode-ai >/dev/null 2>&1 || true

RUN set -eux; \
    old="$(command -v opencode 2>/dev/null || true)"; \
    [ -n "$old" ] && rm -f "$old" || true; \
    rm -f /usr/local/bin/opencode2 || true; \
    npm install -g "@opencode/cli@${OPENCODE_V2_VERSION}"; \
    opencode --version; \
    opencode --version | grep -q "${OPENCODE_V2_VERSION}" || { echo "opencode version mismatch (expected ${OPENCODE_V2_VERSION})" >&2; exit 1; }; \
    uv --version && uvx --version
