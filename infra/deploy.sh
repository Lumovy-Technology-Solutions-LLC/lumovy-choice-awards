#!/usr/bin/env bash
# Manual deploy, run in Azure Cloud Shell.
#   On Windows (after pushing):  git archive --format zip --output deploy.zip HEAD
#   Upload deploy.zip to Cloud Shell, then:  RG=<resource group> APP=<web app> bash infra/deploy.sh ~/deploy.zip
# App Service installs the server's production dependencies itself (root package.json postinstall).
set -euo pipefail
SRC="${1:-$HOME/deploy.zip}"
RG="${RG:?set RG=<resource group>}"
APP="${APP:?set APP=<web app name>}"

cd ~ && rm -rf lumovy-build && mkdir lumovy-build && cd lumovy-build
unzip -q "$SRC"
npm --prefix web ci
npm --prefix web run build

# Package: server code + built web app only (no tests, no web source, no node_modules, no secrets)
rm -f ~/deploy-azure.zip
zip -qr ~/deploy-azure.zip package.json server web/dist \
  -x "server/node_modules/*" -x "server/test/*" -x "server/data/*" -x "server/.env" -x "*.git*"

# --async: the build on Azure (installing packages) can outlast the 4-minute request limit on a small plan, which shows up as
# "504 GatewayTimeout" even though the deployment is fine. So start it, then wait for the site to answer instead.
az webapp deploy --resource-group "$RG" --name "$APP" --src-path ~/deploy-azure.zip --type zip --async true

HOST="$(az webapp show -g "$RG" -n "$APP" --query defaultHostName -o tsv)"
echo "Upload accepted. Azure is building the app (first deploy: 5-10 minutes). Waiting for https://$HOST/api/health ..."
for i in $(seq 1 60); do
  if curl -fsS --max-time 10 "https://$HOST/api/health" >/dev/null 2>&1; then
    echo "Deployed and healthy: https://$HOST"; exit 0
  fi
  printf '.'; sleep 15
done
echo
echo "Not answering yet after 15 minutes. See what Azure is doing:"
echo "  az webapp log deployment show -g $RG -n $APP"
echo "  az webapp log tail -g $RG -n $APP"
exit 1
