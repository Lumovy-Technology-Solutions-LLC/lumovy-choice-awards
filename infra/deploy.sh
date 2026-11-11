#!/usr/bin/env bash
# Manual deploy, run in Azure Cloud Shell.
#   On Windows (after pushing):  git archive --format zip --output deploy.zip HEAD
#   Upload deploy.zip to Cloud Shell, then:  RG=<resource group> APP=<web app> bash infra/deploy.sh ~/deploy.zip
# Dependencies are installed HERE (Cloud Shell, Linux x64, same as Azure) and shipped inside the zip, so Azure builds nothing.
# (Building on a small B1 plan was slow and failed.) The native modules used (better-sqlite3, sharp) ship Linux x64 binaries.
set -euo pipefail
SRC="${1:-$HOME/deploy.zip}"
RG="${RG:?set RG=<resource group>}"
APP="${APP:?set APP=<web app name>}"

cd ~ && rm -rf lumovy-build && mkdir lumovy-build && cd lumovy-build
unzip -q "$SRC"
npm --prefix web ci
npm --prefix web run build

[ "$(uname -m)" = x86_64 ] || { echo "This shell is $(uname -m), not x86_64: the packaged native modules would not run on Azure." >&2; exit 1; }
npm --prefix server ci --omit=dev

# Package: server code + its production node_modules + built web app (no tests, no web source, no secrets)
rm -f ~/deploy-azure.zip
zip -qr ~/deploy-azure.zip package.json server web/dist \
  -x "server/test/*" -x "server/data/*" -x "server/.env" -x "*/.git/*"
echo "Package size: $(du -h ~/deploy-azure.zip | cut -f1)"

# No build on Azure: it just unpacks the zip and starts the app.
az webapp config appsettings set -g "$RG" -n "$APP" -o none --settings SCM_DO_BUILD_DURING_DEPLOYMENT=false ENABLE_ORYX_BUILD=false

# --async: a large upload can outlast the 4-minute request limit, which shows up as "504 GatewayTimeout" even though the
# deployment is fine. So start it, then wait for the site to answer instead.
az webapp deploy --resource-group "$RG" --name "$APP" --src-path ~/deploy-azure.zip --type zip --async true

HOST="$(az webapp show -g "$RG" -n "$APP" --query defaultHostName -o tsv)"
echo "Upload accepted. Azure is unpacking and starting the app (a few minutes). Waiting for https://$HOST/api/health ..."
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
