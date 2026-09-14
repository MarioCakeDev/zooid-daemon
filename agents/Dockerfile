# Custom Zooid agent image: the upstream agent-opencode image ships Node
# (node/npm/npx) but not `uv`/`uvx`, which the `docker` and `truenas` MCP
# servers (declared as `uvx <pkg>` in each agent's opencode.json) require.
#
# Build:  docker build -t zooid-agent-opencode:local agents/
# Then set `container.image` in zooid.yaml to `zooid-agent-opencode:local`.
FROM ghcr.io/zooid-ai/agent-opencode:latest

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && curl -LsSf https://astral.sh/uv/install.sh | UV_INSTALL_DIR=/usr/local/bin sh \
    && rm -rf /var/lib/apt/lists/* \
    && uv --version && uvx --version
