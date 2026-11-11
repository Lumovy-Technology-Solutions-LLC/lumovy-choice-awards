#!/usr/bin/env bash
# One-time Azure set-up for Lumovy Choice Awards.
# Run in Azure Cloud Shell (bash) or a terminal with `az login` done. Pass settings inline (see below), nothing to edit.
# Creates: resource group, (optional) PostgreSQL Flexible Server, Azure Communication Services email (SMTP),
# App Service plan + Linux web app (Node 22), app settings, persistent upload folder, health check and HTTPS only. Deploy afterwards with infra/deploy.sh (manual zip).
set -euo pipefail

# ---------- settings: pass them inline, nothing to edit ----------
# Required:  SUB (subscription id), ADMIN_EMAIL (first HR admin).  Everything else has a default; override any of them inline, e.g.
#   SUB=xxxx ADMIN_EMAIL=hr@lumovy.com APP=lumovy-choice-awards PG=pg-lumovy-choice bash infra/provision.sh
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
ACS="${ACS:-acs-$APP}"                           # Azure Communication Services resource (sends the email)
ACS_EMAIL="${ACS_EMAIL:-acse-$APP}"              # its Email Communication Service
ACS_DATA_LOCATION="${ACS_DATA_LOCATION:-India}"  # where ACS stores its data
MAIL_NAME="${MAIL_NAME:-Lumovy Choice Awards}"   # display name; the sender address comes from the Azure managed domain (see docs/DEPLOYMENT.md to switch to your own domain)
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

echo "Creating Azure Communication Services (email)..."
az extension add --name communication --upgrade --only-show-errors -y
az communication create -n "$ACS" -g "$RG" --location global --data-location "$ACS_DATA_LOCATION" -o none
az communication email create -n "$ACS_EMAIL" -g "$RG" --location global --data-location "$ACS_DATA_LOCATION" -o none
# Free Azure managed sender domain (DoNotReply@<guid>.azurecomm.net). Good for go-live; switch to lumovy.com later.
az communication email domain create --domain-name AzureManagedDomain --email-service-name "$ACS_EMAIL" \
  -g "$RG" --location global --domain-management AzureManaged -o none
MAIL_DOMAIN="$(az communication email domain show --domain-name AzureManagedDomain --email-service-name "$ACS_EMAIL" \
  -g "$RG" --query mailFromSenderDomain -o tsv)"
DOMAIN_ID="$(az communication email domain show --domain-name AzureManagedDomain --email-service-name "$ACS_EMAIL" \
  -g "$RG" --query id -o tsv)"
az communication update -n "$ACS" -g "$RG" --linked-domains "$DOMAIN_ID" -o none
ACS_ID="$(az communication show -n "$ACS" -g "$RG" --query id -o tsv)"

# SMTP sign-in for ACS is an Entra app (service principal) that may send email through this ACS resource only.
# Needs permission to create app registrations in your tenant; if this fails, see docs/DEPLOYMENT.md (manual steps).
SP_NAME="sp-$APP-smtp"
SP_ID="$(az ad sp list --display-name "$SP_NAME" --query "[0].appId" -o tsv)"
if [ -n "$SP_ID" ]; then   # rerun: keep the same app, just issue a fresh secret
  mapfile -t SP < <(az ad sp credential reset --id "$SP_ID" --years 2 --query "[appId,password,tenant]" -o tsv)
else
  mapfile -t SP < <(az ad sp create-for-rbac --name "$SP_NAME" --role "Communication and Email Service Owner" \
    --scopes "$ACS_ID" --years 2 --query "[appId,password,tenant]" -o tsv)
fi
# Make sure the app may send through this ACS resource (create-for-rbac can silently skip it). Safe to repeat.
az role assignment create --assignee-object-id "$(az ad sp show --id "${SP[0]}" --query id -o tsv)" --assignee-principal-type ServicePrincipal   --role "Communication and Email Service Owner" --scope "$ACS_ID" -o none
SMTP_HOST="smtp.azurecomm.net"; SMTP_PORT=587
SMTP_USER="${ACS}.${SP[0]}.${SP[2]}"
SMTP_PASS="${SP[1]}"
MAIL_FROM="${MAIL_NAME} <DoNotReply@${MAIL_DOMAIN}>"

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
  MAIL_TRANSPORT=smtp MAIL_FROM="$MAIL_FROM" \
  SMTP_HOST="$SMTP_HOST" SMTP_PORT="$SMTP_PORT" SMTP_USER="$SMTP_USER" SMTP_PASS="$SMTP_PASS" \
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

Email is sent through Azure Communication Services as: $MAIL_FROM
(SMTP settings are already in App Settings. To send from your own domain, see "Email" in docs/DEPLOYMENT.md.)

Save the generated secrets in Key Vault or your password manager:
  APP_SECRET=$APP_SECRET
  SMTP password (Entra app secret)=$SMTP_PASS
EOF
if [ "$DB" = postgres ]; then echo "  Database password=$PG_PASS"; else
  echo ""; echo "Database: SQLite file /home/data/choice.db, automatic backups in /home/data/backups."
  echo "Keep this app on ONE instance (do not scale out). See docs/DEPLOYMENT.md > Database."; fi
