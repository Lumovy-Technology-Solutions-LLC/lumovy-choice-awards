#!/usr/bin/env bash
# One-time Azure set-up for Lumovy Choice Awards.
# Run in Azure Cloud Shell (bash) or a terminal with `az login` done. Review the variables first.
# Creates: resource group, PostgreSQL Flexible Server + database, App Service plan + Linux web app (Node 22),
# app settings, persistent upload folder, health check and HTTPS only. Deploy afterwards with infra/deploy.sh (manual zip).
set -euo pipefail

# ---------- edit these ----------
SUB="<subscription id>"
RG="rg-choice-awards-prod"
LOC="centralindia"                       # closest to India employees
APP="lumovy-choice-awards"               # becomes <APP>.azurewebsites.net (must be globally unique)
PLAN="plan-choice-awards"
SKU="B1"                                 # enough for ~250 employees; scale up to B2/P1v3 later if needed (az appservice plan update --sku B2)
PG="pg-choice-awards"                    # PostgreSQL server name (globally unique)
PG_ADMIN="choiceadmin"
PG_PASS="$(openssl rand -base64 24 | tr -d '=+/')"   # generated; stored in App Settings below
APP_SECRET="$(openssl rand -hex 48)"
CUSTOM_URL="https://choice.lumovy.com"   # public address you will map (or use https://$APP.azurewebsites.net first)
ADMIN_EMAIL="<first HR admin email>"
ADMIN_NAME="HR Admin"
ADMIN_TEMP_PASSWORD="$(openssl rand -base64 18 | tr -d '=+/')A1!"
SMTP_HOST="<smtp host>"; SMTP_PORT=587; SMTP_USER="<smtp user>"; SMTP_PASS="<smtp password>"
MAIL_FROM="Lumovy Choice Awards <choice-awards@lumovy.com>"
# --------------------------------

az account set --subscription "$SUB"
az group create -n "$RG" -l "$LOC" -o none

echo "Creating PostgreSQL (takes a few minutes)..."
az postgres flexible-server create -g "$RG" -n "$PG" -l "$LOC" \
  --admin-user "$PG_ADMIN" --admin-password "$PG_PASS" \
  --tier Burstable --sku-name Standard_B1ms --storage-size 32 --version 16 \
  --public-access 0.0.0.0 -o none          # 0.0.0.0 = allow Azure services only
az postgres flexible-server db create -g "$RG" -s "$PG" -d choice -o none
DB_URL="postgres://${PG_ADMIN}:${PG_PASS}@${PG}.postgres.database.azure.com:5432/choice?sslmode=require"

echo "Creating App Service..."
az appservice plan create -g "$RG" -n "$PLAN" --is-linux --sku "$SKU" -o none
az webapp create -g "$RG" -p "$PLAN" -n "$APP" --runtime "NODE:22-lts" -o none
az webapp update -g "$RG" -n "$APP" --https-only true -o none
az webapp config set -g "$RG" -n "$APP" \
  --startup-file "node server/src/index.js" --always-on true \
  --health-check-path "/api/health" --min-tls-version 1.2 --ftps-state Disabled -o none

# /home is persistent, shared storage on Linux App Service. Uploads and temp files live there.
az webapp config appsettings set -g "$RG" -n "$APP" -o none --settings \
  NODE_ENV=production \
  WEBSITES_ENABLE_APP_SERVICE_STORAGE=true \
  SCM_DO_BUILD_DURING_DEPLOYMENT=true \
  APP_URL="$CUSTOM_URL" \
  APP_SECRET="$APP_SECRET" \
  DATABASE_URL="$DB_URL" \
  UPLOAD_DIR=/home/data/uploads \
  DATA_DIR=/home/data \
  MAIL_TRANSPORT=smtp MAIL_FROM="$MAIL_FROM" \
  SMTP_HOST="$SMTP_HOST" SMTP_PORT="$SMTP_PORT" SMTP_USER="$SMTP_USER" SMTP_PASS="$SMTP_PASS" \
  BOOTSTRAP_ADMIN_EMAIL="$ADMIN_EMAIL" BOOTSTRAP_ADMIN_NAME="$ADMIN_NAME" BOOTSTRAP_ADMIN_PASSWORD="$ADMIN_TEMP_PASSWORD"

cat <<EOF

=========== DONE ===========
Next: deploy the code (see docs/DEPLOYMENT.md):
  1. On Windows:  git archive --format zip --output deploy.zip HEAD
  2. Upload deploy.zip to Cloud Shell, then:  RG=$RG APP=$APP bash infra/deploy.sh ~/deploy.zip

First sign-in:  $CUSTOM_URL   user: $ADMIN_EMAIL   temporary password: $ADMIN_TEMP_PASSWORD
(change it immediately, then delete BOOTSTRAP_ADMIN_PASSWORD from App Settings)

Save the generated APP_SECRET and database password in Key Vault or your password manager:
  APP_SECRET=$APP_SECRET
  Database password=$PG_PASS
EOF
