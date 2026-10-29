#!/usr/bin/env bash
# Copy the local Zitadel secrets the tests need out of a running synthwerk-infra
# stack into .stack/ (git-ignored, mode 0600): the IAM owner PAT of the bootstrap,
# the login-client PAT and the studio OIDC client. Local and ci stacks only; never point this at dev.
#
# Usage: scripts/stack-secrets.sh [compose project]   (default: synthwerk)
set -euo pipefail
cd "$(dirname "$0")/.."
project=${1:-${COMPOSE_PROJECT_NAME:-synthwerk}}
umask 077
mkdir -p .stack
busybox=busybox:1.37.0@sha256:bdf57e528e45e4433820e045b29b4597825a1c9e38353532d90a01445013f82e
for f in admin.pat studio-client.json; do
  docker run --rm -v "${project}_zitadel-admin:/b:ro" --user 0 --entrypoint cat "$busybox" "/b/$f" > ".stack/$f"
done
# The login-client PAT finishes sign-ins through the Session API (synthwerk#94 journey).
docker run --rm -v "${project}_zitadel-bootstrap:/b:ro" --user 0 --entrypoint cat "$busybox" /b/login-client.pat > .stack/login-client.pat
echo "Wrote .stack/admin.pat, .stack/login-client.pat and .stack/studio-client.json from project $project."
