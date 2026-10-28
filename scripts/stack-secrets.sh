#!/usr/bin/env bash
# Copy the two local Zitadel secrets the tests need out of a running synthwerk-infra
# stack into .stack/ (git-ignored, mode 0600): the IAM owner PAT of the bootstrap
# and the studio OIDC client. Local and ci stacks only; never point this at dev.
#
# Usage: scripts/stack-secrets.sh [compose project]   (default: synthwerk)
set -euo pipefail
cd "$(dirname "$0")/.."
project=${1:-${COMPOSE_PROJECT_NAME:-synthwerk}}
umask 077
mkdir -p .stack
for f in admin.pat studio-client.json; do
  docker run --rm -v "${project}_zitadel-admin:/b:ro" --user 0 --entrypoint cat \
    busybox:1.37.0@sha256:bdf57e528e45e4433820e045b29b4597825a1c9e38353532d90a01445013f82e "/b/$f" > ".stack/$f"
done
echo "Wrote .stack/admin.pat and .stack/studio-client.json from project $project."
