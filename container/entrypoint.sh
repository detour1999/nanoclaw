#!/bin/bash
# ABOUTME: Container entrypoint — registers the mapped host UID, then compiles and runs the agent runner.
# ABOUTME: Input JSON arrives on stdin; output JSON goes to stdout.
set -e

# The host launches this container with --user <hostUid>:<hostGid> so that
# mounted files stay writable (see container-runner.ts). On macOS that UID is
# typically 501, which has no /etc/passwd entry, and OpenSSH refuses to run at
# all without one — "No user exists for uid 501". Register the UID so ssh,
# whoami, and anything else calling getpwuid() work.
if ! getent passwd "$(id -u)" >/dev/null 2>&1; then
  echo "agent:x:$(id -u):$(id -g)::/home/node:/bin/bash" >>/etc/passwd || true
fi

cd /app && npx tsc --outDir /tmp/dist 2>&1 >&2
ln -s /app/node_modules /tmp/dist/node_modules
chmod -R a-w /tmp/dist
cat >/tmp/input.json
node /tmp/dist/index.js </tmp/input.json
