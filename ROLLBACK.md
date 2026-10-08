# Rollback: OpenCode V2 agent image → V1

The V2 agent image is published as
`ghcr.io/mariocakedev/zooid-agent-opencode:opencode-v2` (and an immutable
`:sha-<commit>` tag). The historically published `:latest` tag is the **V1**
image and is never overwritten by the V2 workflow, so it is a ready rollback
target.

No rebuild and no config edit are required:

1. In the worker `zooid.yaml`
   (`/opt/matrix/zooid/workforce/zooid.yaml`), set `container.image` back to
   `ghcr.io/mariocakedev/zooid-agent-opencode:latest`.
2. Restart the daemon and respawn the agents so they pick up the V1 image:
   ```
   docker restart zooid
   docker rm -f $(docker ps -aq -f name=zooid-agent-)
   ```
3. Restore the global OpenCode config if it was migrated
   (`/root/.config/opencode`), from the pre-deploy backup:
   ```
   rm -rf /root/.config/opencode
   cp -a /root/.config/opencode.bak-<timestamp> /root/.config/opencode
   ```

The MatrixAgent setup repo ships `scripts/rollback-opencode-v2.sh`, which
performs the image flip, restart, and config restore (dry-run by default; pass
`--yes` to apply).
