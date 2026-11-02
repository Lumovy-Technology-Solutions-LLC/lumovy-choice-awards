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

az webapp deploy --resource-group "$RG" --name "$APP" --src-path ~/deploy-azure.zip --type zip
echo "Deployed. Check: https://$(az webapp show -g "$RG" -n "$APP" --query defaultHostName -o tsv)/api/health"
