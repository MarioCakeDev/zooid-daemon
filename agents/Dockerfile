# Custom Zooid agent image: the upstream agent-opencode image ships Node
# (node/npm/npx) but not `uv`/`uvx`, which the `docker` and `truenas` MCP
# servers (declared as `uvx <pkg>` in each agent's opencode.json) require.
#
# Build:  docker build -t zooid-agent-opencode:local agents/
# Then set `container.image` in zooid.yaml to `zooid-agent-opencode:local`.
FROM ghcr.io/zooid-ai/agent-opencode:latest

# Elicitation requirement (zooid 0.17): the daemon now uses ACP *form*
# elicitation. For an agent to be able to ask the human a question, the
# `opencode` bundled in this base image must advertise `elicitation.form` in its
# ACP `initialize` capabilities (opencode PR #38311). This image does not build
# opencode — it inherits it from the base — so the requirement is met only when
# the pinned `ghcr.io/zooid-ai/agent-opencode:latest` actually ships an
# opencode with that capability. After the image is rebuilt, verify inside a
# running agent container:
#   - `opencode --version` (confirm the expected build)
#   - the ACP `initialize` response's `agentCapabilities.elicitation`
#     (the daemon logs the session capabilities on establish; absence means
#     every elicitation is refused with -32602).
# Do not change the tag without that verification: a base image without the
# capability compiles and runs, but silently loses interactive questions.

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && curl -LsSf https://astral.sh/uv/install.sh | UV_INSTALL_DIR=/usr/local/bin sh \
    && rm -rf /var/lib/apt/lists/* \
    && uv --version && uvx --version
