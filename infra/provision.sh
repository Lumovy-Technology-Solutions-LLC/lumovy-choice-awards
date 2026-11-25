#!/usr/bin/env bash
# One-time Azure set-up for Lumovy Employee Choice Awards.
# Run in Azure Cloud Shell (bash) or a terminal with `az login` done. Pass settings inline (see below), nothing to edit.
# Creates ONLY: resource group, App Service plan + Linux web app (Node 22), app settings, persistent upload folder, health check and
# HTTPS only (plus a PostgreSQL Flexible Server if you pass DB=postgres). Nothing else: email is sent through Microsoft Graph as an existing
# Microsoft 365 mailbox, so no Azure Communication Services and no Entra app are created here. Deploy afterwards with infra/deploy.sh (manual zip).
set -euo pipefail

# ---------- settings: pass them inline, nothing to edit ----------
# Required:  SUB (subscription id), ADMIN_EMAIL (first HR admin).  Everything else has a default; override any of them inline, e.g.
#   SUB=xxxx ADMIN_EMAIL=hr@lumovy.com APP=lumovy-choice-awards PG=pg-lumovy-choice bash infra/provision.sh
# Email (recommended, pass all four): GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET (an Entra app that has Mail.Send) and GRAPH_SENDER
#   (the Microsoft 365 mailbox to send as, e.g. alerts@lumovy.com). See docs/DEPLOYMENT.md > "Email through your own Microsoft 365 mailbox".
#   Leave them out to create the app with email in test mode and add them later with `az webapp config appsettings set`.
SUB="${SUB:?Set SUB to your subscription id, e.g. SUB=xxxx bash infra/provision.sh}"
ADMIN_EMAIL="${ADMIN_EMAIL:?Set ADMIN_EMAIL to the first HR admin email}"
RG="${RG:-rg-choice-awards-prod}"
LOC="${LOC:-centralindia}"                       # closest to India employees
APP="${APP:-lumovy-choice-awards}"               # becomes <APP>.azurewebsites.net (must be globally unique)
PLAN="${PLAN:-plan-choice-awards}"
SKU="${SKU:-B1}"                                 # enough for ~250 employees; scale up to B2/P1v3 later if needed (az appservice plan update --sku B2)
DB="${DB:-sqlite}"                               # sqlite (no extra cost, one app instance, stored in /home/data) or postgres (managed, point-in-time restore)
PG="${PG:-pg-$APP}"                              # PostgreSQL server name (globally unique)
PG_ADMIN="${PG_ADMIN:-choiceadmin}"
PG_TIER="${PG_TIER:-Burstable}"                  # if SkuNotAvailable: list sizes with  az postgres flexible-server list-skus -l $LOC -o table  and pass PG_SKU=...
PG_SKU="${PG_SKU:-Standard_B1ms}"
PG_PASS="$(openssl rand -base64 24 | tr -d '=+/')"   # generated; stored in App Settings below
APP_SECRET="$(openssl rand -hex 48)"
CUSTOM_URL="${CUSTOM_URL:-https://lumovychoiceawards.com}"   # public address you will map (use https://$APP.azurewebsites.net until DNS is ready)
ADMIN_NAME="${ADMIN_NAME:-HR Admin}"
ADMIN_TEMP_PASSWORD="$(openssl rand -base64 18 | tr -d '=+/')A1!"
GRAPH_TENANT_ID="${GRAPH_TENANT_ID:-}"; GRAPH_CLIENT_ID="${GRAPH_CLIENT_ID:-}"; GRAPH_CLIENT_SECRET="${GRAPH_CLIENT_SECRET:-}"; GRAPH_SENDER="${GRAPH_SENDER:-}"
MAIL_NAME="${MAIL_NAME:-Lumovy Employee Choice Awards}"   # sender display name
MAIL_MAX_PER_MINUTE="${MAIL_MAX_PER_MINUTE:-20}" # stay under Microsoft 365's 30 a minute per mailbox (lower it if the mailbox is shared with other senders)
MAIL_REPLY_TO="${MAIL_REPLY_TO:-$ADMIN_EMAIL}"   # where replies go
# --------------------------------

az account set --subscription "$SUB"
az group create -n "$RG" -l "$LOC" -o none

case "$DB" in
  sqlite) DB_SETTINGS=(SQLITE_JOURNAL=delete BACKUP_HOURS=6)   # database file lives in /home/data (persistent); no DATABASE_URL
          echo "Database: built-in SQLite in /home/data (no separate server)." ;;
  postgres)
    echo "Creating PostgreSQL (takes a few minutes)..."
    az postgres flexible-server create -g "$RG" -n "$PG" -l "$LOC" \
      --admin-user "$PG_ADMIN" --admin-password "$PG_PASS" \
      --tier "$PG_TIER" --sku-name "$PG_SKU" --storage-size 32 --version 16 \
      --public-access 0.0.0.0 -o none          # 0.0.0.0 = allow Azure services only
    az postgres flexible-server db create -g "$RG" -s "$PG" -d choice -o none
    DB_SETTINGS=(DATABASE_URL="postgres://${PG_ADMIN}:${PG_PASS}@${PG}.postgres.database.azure.com:5432/choice?sslmode=require") ;;
  *) echo "DB must be sqlite or postgres" >&2; exit 1 ;;
esac

if [ -n "$GRAPH_TENANT_ID" ] && [ -n "$GRAPH_CLIENT_ID" ] && [ -n "$GRAPH_CLIENT_SECRET" ] && [ -n "$GRAPH_SENDER" ]; then
  MAIL_SETTINGS=(MAIL_TRANSPORT=graph MAIL_FROM="$MAIL_NAME <$GRAPH_SENDER>" GRAPH_SENDER="$GRAPH_SENDER"
                 GRAPH_TENANT_ID="$GRAPH_TENANT_ID" GRAPH_CLIENT_ID="$GRAPH_CLIENT_ID" GRAPH_CLIENT_SECRET="$GRAPH_CLIENT_SECRET"
                 MAIL_MAX_PER_MINUTE="$MAIL_MAX_PER_MINUTE" MAIL_MAX_PER_HOUR=0 MAIL_REPLY_TO="$MAIL_REPLY_TO")
  MAIL_NOTE="Email: sent through Microsoft Graph as $GRAPH_SENDER."
else
  MAIL_SETTINGS=(MAIL_TRANSPORT=dev)
  MAIL_NOTE="Email: NOT configured yet (test mode: nothing is sent, so email sign-in codes will not arrive; password sign-in works). Add MAIL_TRANSPORT=graph, MAIL_FROM, GRAPH_SENDER, GRAPH_TENANT_ID, GRAPH_CLIENT_ID and GRAPH_CLIENT_SECRET in App Settings (docs/DEPLOYMENT.md)."
fi

echo "Creating App Service..."
az appservice plan show -g "$RG" -n "$PLAN" -o none 2>/dev/null || az appservice plan create -g "$RG" -n "$PLAN" --is-linux --sku "$SKU" -o none
az webapp show -g "$RG" -n "$APP" -o none 2>/dev/null || az webapp create -g "$RG" -p "$PLAN" -n "$APP" --runtime "NODE:22-lts" -o none
az webapp update -g "$RG" -n "$APP" --https-only true -o none
az webapp config set -g "$RG" -n "$APP" \
  --startup-file "node server/src/index.js" --always-on true \
  --min-tls-version 1.2 --ftps-state Disabled -o none
# Health check: restarts an unhealthy instance. Not fatal if this CLI version cannot set it (set it in the portal: App Service > Health check).
az webapp config set -g "$RG" -n "$APP" --generic-configurations '{"healthCheckPath": "/api/health"}' -o none \
  || echo "NOTE: could not set the health check path automatically. Optional: set /api/health in App Service > Health check."

# /home is persistent, shared storage on Linux App Service. Uploads and temp files live there.
az webapp config appsettings set -g "$RG" -n "$APP" -o none --settings \
  NODE_ENV=production \
  WEBSITES_ENABLE_APP_SERVICE_STORAGE=true \
  SCM_DO_BUILD_DURING_DEPLOYMENT=false \
  APP_URL="$CUSTOM_URL" \
  APP_SECRET="$APP_SECRET" \
  "${DB_SETTINGS[@]}" \
  UPLOAD_DIR=/home/data/uploads \
  DATA_DIR=/home/data \
  "${MAIL_SETTINGS[@]}" \
  BOOTSTRAP_ADMIN_EMAIL="$ADMIN_EMAIL" BOOTSTRAP_ADMIN_NAME="$ADMIN_NAME" BOOTSTRAP_ADMIN_PASSWORD="$ADMIN_TEMP_PASSWORD"
# Switching from PostgreSQL to SQLite on a rerun: a leftover DATABASE_URL would make the app ignore SQLite.
if [ "$DB" = sqlite ]; then az webapp config appsettings delete -g "$RG" -n "$APP" --setting-names DATABASE_URL -o none; fi

cat <<EOF

=========== DONE ===========
Next: deploy the code (see docs/DEPLOYMENT.md):
  1. On Windows:  git archive --format zip --output deploy.zip HEAD
  2. Upload deploy.zip to Cloud Shell, then:  RG=$RG APP=$APP bash infra/deploy.sh ~/deploy.zip

First sign-in:  $CUSTOM_URL   user: $ADMIN_EMAIL   temporary password: $ADMIN_TEMP_PASSWORD
(change it immediately, then delete BOOTSTRAP_ADMIN_PASSWORD from App Settings)

$MAIL_NOTE

Save the generated secrets in Key Vault or your password manager:
  APP_SECRET=$APP_SECRET
EOF
if [ "$DB" = postgres ]; then echo "  Database password=$PG_PASS"; else
  echo ""; echo "Database: SQLite file /home/data/choice.db, automatic backups in /home/data/backups."
  echo "Keep this app on ONE instance (do not scale out). See docs/DEPLOYMENT.md > Database."; fi
