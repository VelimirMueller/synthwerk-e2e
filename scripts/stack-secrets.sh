#!/usr/bin/env bash
# Copy the local Zitadel secrets the tests need out of a running synthwerk-infra
# stack into .stack/ (git-ignored, mode 0600): the IAM owner PAT of the bootstrap,
# the login-client PAT and the studio OIDC client. Local and ci stacks only; never point this at dev.
# Also writes .stack/site-org-id: the Zitadel id of the demo org, the site org of the public
# site journey (stack/compose.e2e.yaml, SYNTHWERK_SITE_ORG_ID). Needs curl and jq.
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
# The PAT goes in through a header file, so it never shows in the process list.
curl -fsS "http://127.0.0.1:${E2E_ZITADEL_API_PORT:-8090}/admin/v1/orgs/_search" \
  -H "Host: ${E2E_AUTH_DOMAIN:-auth.localhost}:${E2E_EDGE_PORT:-8080}" \
  -H @<(printf 'Authorization: Bearer %s\n' "$(cat .stack/admin.pat)") \
  -H 'Content-Type: application/json' \
  -d '{"queries":[{"nameQuery":{"name":"demo","method":"TEXT_QUERY_METHOD_EQUALS"}}]}' |
  jq -er '.result[0].id' > .stack/site-org-id ||
  { rm -f .stack/site-org-id; echo "stack-secrets: no org \"demo\" in Zitadel (run the zitadel-bootstrap first)" >&2; exit 1; }
echo "Wrote .stack/admin.pat, .stack/login-client.pat, .stack/studio-client.json and .stack/site-org-id from project $project."
