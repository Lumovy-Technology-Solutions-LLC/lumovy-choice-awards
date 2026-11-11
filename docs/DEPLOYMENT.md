# Deployment on Azure (App Service)

The portal runs as **one Azure App Service (Linux, Node 22) web app** with **Azure Database for PostgreSQL Flexible Server**, deployed **manually with a zip** (the same way as World Cup Arena). The web app serves both the API and the built React site from the same address, so there is a single thing to deploy, monitor and scale.

```
Employees ──HTTPS──> App Service (Node 22)  ──> PostgreSQL Flexible Server
                         │  /home (persistent) = uploaded files
                         └──> SMTP (Microsoft 365 / SendGrid / ACS) for email
You (Windows) ─ git archive ─> Cloud Shell ─ build + az webapp deploy ─> App Service
```

| Piece | Choice | Why |
| --- | --- | --- |
| Hosting | App Service plan B1 (up to about 250 employees), Linux, Node 22 LTS | Managed, health checks, easy to scale up to B2 or P1v3 |
| Region | Central India | Employees are in India at launch |
| Database | PostgreSQL Flexible Server 16, Burstable B1ms | Managed backups, point-in-time restore |
| Files | App Service persistent storage at `/home/data/uploads` | Shared across instances, no extra service for v1 |
| Email | SMTP (Microsoft 365, SendGrid or Azure Communication Services) | Works with the built-in mail queue |
| Secrets | App Settings (optionally Key Vault references) | No secrets in the repository |
| Deploy | Manual zip deploy from Cloud Shell (`infra/deploy.sh`) | Simple, same as World Cup Arena. No pipeline for now |
| Domain | Custom domain + free App Service managed certificate | HTTPS |

Match this to how World Cup Arena was set up if it differs (for example an existing resource group, plan, Key Vault or domain). The scripts below are plain Azure CLI so they are easy to adapt.

## Before you start

- An Azure subscription where you can create resources, and Cloud Shell access.
- The public address you want (for example `https://choice.lumovy.com`) and DNS access.
- SMTP details for the sender address (with SPF and DKIM set up for the domain).
- The first HR admin's name and email.

## Step by step

### 1. Provision Azure (once)

Open **Azure Cloud Shell (bash)**, clone the repo (or upload `infra/provision.sh`), edit the variables at the top (subscription, names, SMTP, first admin, URL), then run:

```bash
bash infra/provision.sh
```

It creates the resource group, PostgreSQL server and database, App Service plan and web app, sets HTTPS-only, TLS 1.2, health check `/api/health`, Always On and all app settings. At the end it prints the first-admin sign-in. **Save the printed `APP_SECRET` and database password in your password manager or Key Vault.**

App settings it configures:

| Setting | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `APP_URL` | public address (used in email links) |
| `APP_SECRET` | random 96 hex characters. Signs sessions, protects voter receipts. Do not change later |
| `DATABASE_URL` | PostgreSQL URL with `sslmode=require` |
| `UPLOAD_DIR`, `DATA_DIR` | `/home/data/uploads`, `/home/data` (persistent) |
| `MAIL_TRANSPORT`, `MAIL_FROM`, `SMTP_*` | `smtp` and your sender |
| `BOOTSTRAP_ADMIN_*` | first HR admin (remove the password after first sign-in) |
| `WEBSITES_ENABLE_APP_SERVICE_STORAGE` | `true` (keeps `/home` persistent) |

### 2. Deploy the code (manual, every release)

On Windows, in the project folder, after committing and pushing:

```bash
git archive --format zip --output deploy.zip HEAD
```

Upload `deploy.zip` to Azure Cloud Shell (Upload button), then in Cloud Shell (clone the repo once, or upload `infra/deploy.sh` too):

```bash
RG=rg-choice-awards-prod APP=lumovy-choice-awards bash infra/deploy.sh ~/deploy.zip
```

`infra/deploy.sh` does the same as the World Cup Arena steps:

1. unzips `deploy.zip` into a clean folder,
2. installs and builds the web app (`web/dist`),
3. zips only what Azure needs (`package.json`, `server/` code, `web/dist`; no tests, web source, node_modules or secrets),
4. runs `az webapp deploy --resource-group <RG> --name <APP> --src-path deploy-azure.zip --type zip`.

App Service installs the server's production dependencies itself while deploying (the root `package.json` `postinstall` does it), so the zip stays small and native packages are built for Azure's Linux. The first deploy takes a few minutes. When it finishes, open `https://<app>.azurewebsites.net/api/health`; it should answer `{"ok":true,...}`. On first start the app creates the database tables and the first HR admin automatically.

Do **not** use `-x "server/src/*"` like the World Cup Arena command: this app runs from `server/src`.

### 3. Custom domain and HTTPS

1. In DNS add a CNAME `choice` → `<app>.azurewebsites.net` and the TXT verification record shown in **App Service > Custom domains > Add custom domain**.
2. Add the domain, then **Add binding** with an **App Service Managed Certificate** (free).
3. Make sure `APP_URL` is the final `https://` address, then restart the app.

### 4. First sign-in and set-up

1. Open the address, sign in with the first admin email and the temporary password, then change it (account menu > Change password).
2. In **App Service > Environment variables**, delete `BOOTSTRAP_ADMIN_PASSWORD`, save and restart.
3. **Users & regions:** confirm India is switched on, **Import spreadsheet** (name, email, team, region) for all employees, add the other HR admins.
4. **Email test:** create a draft contest, open **Emails** and **Send test to me**. Check it arrives and its links open the right address.

### 5. Dry run before launch

1. Create a test contest with 3 entries, a near end time and 2-3 test employees (a staging slot or a separate staging app is ideal).
2. Start it, vote as the test employees, confirm the "Your vote is in" email.
3. Let it close, check the results, publish, confirm the results email.

PostgreSQL has been exercised mainly through SQLite so far, so this dry run on the real Azure database is required before the first real contest.

### 6. Go live

- [ ] HTTPS works on the custom domain, `APP_URL` matches
- [ ] SMTP sends real email and passes SPF/DKIM
- [ ] All employees imported with a region, India on
- [ ] HR admins added, bootstrap password removed
- [ ] Backups confirmed (below), a restore tested
- [ ] Dry run completed
- [ ] Announce, create the first contest, click **Start contest**

## Operations

- **Backups:** PostgreSQL Flexible Server takes automated backups with point-in-time restore (set retention to 14-35 days). Uploaded files are on `/home`; enable **App Service Backup** (App Service > Backups) so files and settings are protected too. Restore the database and files from the same point in time.
- **Monitoring:** turn on **Application Insights** (App Service > Application Insights), add an availability test on `/api/health`, and alerts on HTTP 5xx and response time. **Log stream** shows live logs.
- **Email problems:** failed emails show in **Admin > Email outbox**. Several app instances are safe: emails are claimed atomically.
- **Scaling:** scale **up** the plan (B1 → B2 → P1v3, one command or a few clicks, no redeploy) if uploads or voting feel slow; scaling **out** to 2+ instances is supported because voting is decided by database constraints and `/home` is shared. Raise PostgreSQL to General Purpose if you see database CPU pressure in the last hour of a big contest.
- **Updates:** run the three-step manual deploy above. Run `npm test` locally first. Migrations run automatically on start. Avoid deploying in the last hour of a live contest (a restart takes seconds and loses no votes).
- **Staging:** create a second web app (or a deployment slot) with its own database for rehearsals; deploy to it with the same script.
- **Secrets hygiene:** rotate the SMTP and database passwords yearly. Keep `APP_SECRET` as it is; changing it makes existing voter receipts unreadable (votes and results are unaffected).

## Security on Azure

- HTTPS only, TLS 1.2+, FTPS disabled, managed certificate.
- PostgreSQL allows only Azure services; for stricter setups use a private endpoint and VNet integration, and Key Vault references for secrets.
- Optional: restrict access to the company network with App Service **Access restrictions**, or put Azure Front Door with WAF in front.
- Deploy access is whoever can run `az webapp deploy` (give people only the Website Contributor role on the resource group).

## Rollback

Keep the previous `deploy-azure.zip` (rename it with the date). To roll back, run `az webapp deploy` with that older zip. Do not roll the database back unless you restore a backup taken before the bad release.

## Estimated monthly cost (Central India, list prices, approximate)

Sized for the basic need: up to about 250 employees and up to 5 contests a month (about 4,000 emails a month). Contest count barely changes the bill because compute and database are flat monthly charges.

| Item | Approx. |
| --- | --- |
| App Service B1 (Always On, HTTPS, custom domain, free certificate) | about 15 USD |
| PostgreSQL Flexible B1ms + 32 GB storage, automated backups | about 15-20 USD |
| Email (Microsoft 365 SMTP free; Azure Communication Services under 1 USD) | 0-1 USD |
| Application Insights, backup storage | about 2-4 USD |
| **Total** | **about 30-40 USD per month** |

Options: B2 (about 30 USD) gives more headroom for bulk uploads and big deadline rushes, so the total is about 50 USD. A 1-year reservation lowers the price by roughly 30-40%. A staging app is optional; create it only for dry runs and delete it afterwards. Azure Front Door with WAF is not needed at this size. Check the Azure pricing calculator for current numbers.
