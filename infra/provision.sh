#!/usr/bin/env bash
# One-time Azure set-up for Lumovy Choice Awards.
# Run in Azure Cloud Shell (bash) or a terminal with `az login` done. Review the variables first.
# Creates: resource group, PostgreSQL Flexible Server + database, App Service plan + Linux web app (Node 22),
# app settings, persistent upload folder, health check, HTTPS only, and a GitHub OIDC identity for deployments.
set -euo pipefail

# ---------- edit these ----------
SUB="<subscription id>"
RG="rg-choice-awards-prod"
LOC="centralindia"                       # closest to India employees
APP="lumovy-choice-awards"               # becomes <APP>.azurewebsites.net (must be globally unique)
PLAN="plan-choice-awards"
SKU="P1v3"                               # B2 is fine for testing; P1v3 recommended for production
PG="pg-choice-awards"                    # PostgreSQL server name (globally unique)
PG_ADMIN="choiceadmin"
PG_PASS="$(openssl rand -base64 24 | tr -d '=+/')"   # generated; stored in App Settings below
APP_SECRET="$(openssl rand -hex 48)"
CUSTOM_URL="https://choice.lumovy.com"   # public address you will map (or use https://$APP.azurewebsites.net first)
GH_REPO="Lumovy-Technology-Solutions-LLC/lumovy-choice-awards"
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
  --tier Burstable --sku-name Standard_B2s --storage-size 32 --version 16 \
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
  SCM_DO_BUILD_DURING_DEPLOYMENT=false \
  APP_URL="$CUSTOM_URL" \
  APP_SECRET="$APP_SECRET" \
  DATABASE_URL="$DB_URL" \
  UPLOAD_DIR=/home/data/uploads \
  DATA_DIR=/home/data \
  MAIL_TRANSPORT=smtp MAIL_FROM="$MAIL_FROM" \
  SMTP_HOST="$SMTP_HOST" SMTP_PORT="$SMTP_PORT" SMTP_USER="$SMTP_USER" SMTP_PASS="$SMTP_PASS" \
  BOOTSTRAP_ADMIN_EMAIL="$ADMIN_EMAIL" BOOTSTRAP_ADMIN_NAME="$ADMIN_NAME" BOOTSTRAP_ADMIN_PASSWORD="$ADMIN_TEMP_PASSWORD"

echo "Creating GitHub deployment identity (OIDC, no stored passwords)..."
APP_ID=$(az ad app create --display-name "gh-$APP" --query appId -o tsv)
az ad sp create --id "$APP_ID" -o none
SCOPE=$(az group show -n "$RG" --query id -o tsv)
az role assignment create --assignee "$APP_ID" --role "Website Contributor" --scope "$SCOPE" -o none
az ad app federated-credential create --id "$APP_ID" --parameters "{
  \"name\": \"github-main\", \"issuer\": \"https://token.actions.githubusercontent.com\",
  \"subject\": \"repo:${GH_REPO}:environment:production\", \"audiences\": [\"api://AzureADTokenExchange\"] }" -o none

TENANT=$(az account show --query tenantId -o tsv)
cat <<EOF

=========== DONE ===========
Add these in GitHub  (repo > Settings > Secrets and variables > Actions):
  Secrets:    AZURE_CLIENT_ID=$APP_ID
              AZURE_TENANT_ID=$TENANT
              AZURE_SUBSCRIPTION_ID=$SUB
  Variables:  AZURE_WEBAPP_NAME=$APP
              AZURE_WEBAPP_HOSTNAME=$APP.azurewebsites.net
Create the GitHub environment named "production" (repo > Settings > Environments).

First sign-in:  $CUSTOM_URL   user: $ADMIN_EMAIL   temporary password: $ADMIN_TEMP_PASSWORD
(change it immediately, then delete BOOTSTRAP_ADMIN_PASSWORD from App Settings)

Save the generated APP_SECRET and database password in Key Vault or your password manager:
  APP_SECRET=$APP_SECRET
  Database password=$PG_PASS
EOF
