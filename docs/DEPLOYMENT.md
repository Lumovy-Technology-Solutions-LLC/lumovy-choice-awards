# Deployment on Azure (App Service)

The portal runs as **one Azure App Service (Linux, Node 22) web app** with a **built-in SQLite database stored on the app's persistent storage** (default), or optionally **Azure Database for PostgreSQL Flexible Server**, deployed **manually with a zip** (the same way as World Cup Arena). The web app serves both the API and the built React site from the same address, so there is a single thing to deploy, monitor and scale.

```
Employees ──HTTPS──> App Service (Node 22)  ──> SQLite file in /home/data  (or PostgreSQL Flexible Server)
                         │  /home (persistent) = uploaded files
                         └──> Microsoft Graph (sends as one Microsoft 365 mailbox) for email
You (Windows) ─ git archive ─> Cloud Shell ─ build + az webapp deploy ─> App Service
```

| Piece | Choice | Why |
| --- | --- | --- |
| Hosting | App Service plan B1 (up to about 250 employees), Linux, Node 22 LTS | Managed, health checks, easy to scale up to B2 or P1v3 |
| Region | Central India | Employees are in India at launch |
| Database | SQLite file in `/home/data/choice.db` (default, `DB=sqlite`), or PostgreSQL Flexible Server 16 (`DB=postgres`) | No extra cost and no extra service for up to about 250 employees and 50-100 voters per contest; PostgreSQL gives managed point-in-time restore and more than one instance |
| Files | App Service persistent storage at `/home/data/uploads` | Shared across instances, no extra service for v1 |
| Email | Microsoft Graph `sendMail`, sending as one Microsoft 365 mailbox (for example `alerts@lumovy.com`) | No Azure email resources, no mailbox password, mail to colleagues is internal so it reaches the inbox, 30 a minute and 10,000 a day |
| Secrets | App Settings (optionally Key Vault references) | No secrets in the repository |
| Deploy | Manual zip deploy from Cloud Shell (`infra/deploy.sh`) | Simple, same as World Cup Arena. No pipeline for now |
| Domain | Custom domain + free App Service managed certificate | HTTPS |

Match this to how World Cup Arena was set up if it differs (for example an existing resource group, plan, Key Vault or domain). The scripts below are plain Azure CLI so they are easy to adapt.

## Before you start

- An Azure subscription where you can create resources, and Cloud Shell access.
- The public address you want (for example `https://choice.lumovy.com`) and DNS access.
- Permission to create an app registration in your Entra tenant (the script creates the email sign-in). If you do not have it, ask your IT admin to run step 1 or do the manual email steps below.
- Optional, for later: DNS access for `lumovy.com` to send from your own address (see "Email" below). Not needed to go live.
- The first HR admin's name and email.

## Step by step

### 1. Provision Azure (once)

Open **Azure Cloud Shell (bash)**, clone the repo (or upload `infra/provision.sh`) and pass your settings inline. Nothing in the file needs editing. `SUB` (subscription id) and `ADMIN_EMAIL` are required; everything else has a default you can override the same way (`APP`, `PG`, `RG`, `LOC`, `SKU`, `CUSTOM_URL`, `ADMIN_NAME`, and so on). `APP` and `PG` must be globally unique (`PG` is only used with `DB=postgres` and defaults to `pg-<APP>`). Use the `azurewebsites.net` address for `CUSTOM_URL` until your domain's DNS is ready:

```bash
SUB=<subscription id> ADMIN_EMAIL=<first HR admin email> APP=lumovy-choice-awards \
CUSTOM_URL=https://lumovy-choice-awards.azurewebsites.net bash infra/provision.sh
```

It creates the resource group, the database (nothing to create for the default SQLite; a PostgreSQL server only if you pass `DB=postgres`), the App Service plan and web app, sets HTTPS-only, TLS 1.2, health check `/api/health`, Always On and all app settings. **It creates nothing else:** no Azure Communication Services and no Entra app. Email goes through your existing Microsoft 365 mailbox, so pass `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET` and `GRAPH_SENDER` to the command (see "Email through your own Microsoft 365 mailbox" below for creating the app). Without them the portal starts in email test mode and you add them later. At the end it prints the first-admin sign-in. **Save the printed `APP_SECRET` and database password in your password manager or Key Vault.**

App settings it configures:

| Setting | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `APP_URL` | public address (used in email links) |
| `APP_SECRET` | random 96 hex characters. Signs sessions, protects voter receipts. Do not change later |
| `SQLITE_JOURNAL`, `BACKUP_HOURS` | SQLite only: `delete` (safe on Azure's network storage) and the automatic backup interval (6 hours) |
| `DATABASE_URL` | PostgreSQL only: URL with `sslmode=require`. Leave it unset for SQLite |
| `UPLOAD_DIR`, `DATA_DIR` | `/home/data/uploads`, `/home/data` (persistent) |
| `MAIL_TRANSPORT`, `MAIL_FROM` | `smtp` and the sender, for example `Lumovy Choice Awards <DoNotReply@<guid>.azurecomm.net>` |
| `MAIL_MAX_PER_MINUTE`, `MAIL_MAX_PER_HOUR` | Optional sending pace (default 20 a minute, no hourly cap). See "Sending limits" under Email |
| `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `GRAPH_SENDER` | Only with `MAIL_TRANSPORT=graph` (send through a Microsoft 365 mailbox, see "Email through your own Microsoft 365 mailbox") |
| `SMTP_HOST`, `SMTP_PORT` | `smtp.azurecomm.net`, `587` |
| `SMTP_USER`, `SMTP_PASS` (only with `MAIL_TRANSPORT=smtp`) | `<ACS resource name>.<Entra app client id>.<tenant id>` and the Entra app client secret |
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

### Email: the two ways to send

The portal sends all mail through its own queue. **The recommended way is Microsoft Graph with a Microsoft 365 mailbox** (the next section), and it is the only one `provision.sh` configures. The rest of this section describes the older **Azure Communication Services (ACS)** option, which `provision.sh` no longer creates. Use it only if you cannot use a Microsoft 365 mailbox: create the ACS resources yourself in the Azure portal and set `MAIL_TRANSPORT=smtp` with the `SMTP_*` settings. ACS on the free Azure managed domain sends from `DoNotReply@<guid>.azurecomm.net`, which some mail systems put in spam.

**Send from your own address (recommended before the first real contest):**

1. Azure portal > your Email Communication Service (`acse-choice-awards`) > **Provision domains > Add domain > Custom domain**, enter `lumovy.com` (or a sub-domain such as `choice.lumovy.com`).
2. Add the DNS records it shows (a TXT to verify, SPF, and two DKIM CNAMEs) at your DNS host, then click **Verify**.
3. Open the domain > **MailFrom addresses > Add**, for example `choice-awards` (the full address becomes `choice-awards@lumovy.com`).
4. In the Communication Service resource (`acs-choice-awards`) > **Email > Domains**, connect the new domain.
5. In the web app > **Environment variables**, set `MAIL_FROM` to `Lumovy Choice Awards <choice-awards@lumovy.com>`, save and restart.

### Email through your own Microsoft 365 mailbox (Microsoft Graph)

This replaces ACS. The portal sends as one Lumovy mailbox (for example `choice-awards@lumovy.com`) through Microsoft Graph. There is no mailbox password and no SMTP password, mail to colleagues is internal (so it normally reaches the inbox, not junk), and the limit is Microsoft 365's: **30 emails a minute and 10,000 recipients a day**, with no hourly cap, so a 250-person send finishes in about 10 minutes. Set `MAIL_TRANSPORT=graph` to use it. Setting it up needs a Microsoft 365 / Entra admin for steps 1 to 3.

1. **Mailbox.** Exchange admin center > Recipients > Mailboxes > **Add a shared mailbox** named `choice-awards@lumovy.com`. A shared mailbox needs no licence.
2. **Entra app.** Entra admin center > App registrations > **New registration** (`lumovy-choice-awards-mail`, this tenant only). Copy the **Application (client) ID** and **Directory (tenant) ID**. Under **Certificates & secrets** create a client secret and copy its **Value** (put a calendar reminder 1 month before it expires). Under **API permissions** > Add > Microsoft Graph > **Application permissions** > `Mail.Send`, then **Grant admin consent**.
3. **Limit the app to that one mailbox (do not skip).** `Mail.Send` as an application permission can otherwise send as *anyone* in the company. In Exchange Online PowerShell:
   ```powershell
   Connect-ExchangeOnline
   New-DistributionGroup -Name "Choice Awards Mail Senders" -Alias choice-awards-senders -Type Security -Members choice-awards@lumovy.com
   New-ApplicationAccessPolicy -AppId <client id> -PolicyScopeGroupId choice-awards-senders@lumovy.com -AccessRight RestrictAccess -Description "Choice Awards sends only as choice-awards@lumovy.com"
   Test-ApplicationAccessPolicy -AppId <client id> -Identity choice-awards@lumovy.com   # AccessCheckResult should be Granted
   ```
   The policy can take up to an hour to take effect. Until then sending may answer "403 access denied". The portal keeps the emails queued and retries by itself.
4. **App settings** (Cloud Shell; the app restarts by itself):
   ```bash
   az webapp config appsettings set -n lumovy-choice-awards-dev -g rg-lumovy-choice-awards --settings      MAIL_TRANSPORT=graph MAIL_FROM="Lumovy Choice Awards <choice-awards@lumovy.com>" GRAPH_SENDER=choice-awards@lumovy.com      GRAPH_TENANT_ID=<tenant id> GRAPH_CLIENT_ID=<client id> GRAPH_CLIENT_SECRET=<secret value>      MAIL_MAX_PER_MINUTE=25 MAIL_MAX_PER_HOUR=0 MAIL_REPLY_TO=hradmin@lumovy.com
   ```
   The old `SMTP_*` settings can stay or be deleted.
5. **Check.** In **Admin > Settings** the mode reads **Live (Microsoft 365 mailbox)**; send yourself a test email. In **Admin > Email outbox**, a message that says "not allowed to send as ..." means step 3 is not finished yet, and "Microsoft sign-in for the mail app failed" means the tenant ID, client ID or secret is wrong. Queued emails are not lost: they send by themselves once it is fixed.

For external recipients, also turn on DKIM for `lumovy.com` in Microsoft Defender > Email & collaboration > Policies > Email authentication settings > DKIM. Renewing the secret: create a new one in Entra, update `GRAPH_CLIENT_SECRET`, restart.

**Why emails land in junk, and the fix (when using ACS).** Mail from `...@<guid>.azurecomm.net` is sent by Azure on a shared domain with no reputation of its own, and Microsoft 365 often treats it as suspicious. Sending as `lumovy.com` from the portal only helps if `lumovy.com` proves the portal is allowed to send for it. Do both of these:

1. **Use your own verified domain** (steps above) and make sure DNS has all of: the **SPF** record ACS gives you (`v=spf1 include:spf.protection.outlook.com -all`, merged into any existing SPF record for the domain, never a second one), the two **DKIM** CNAMEs, and a **DMARC** record such as `_dmarc.lumovy.com` TXT `v=DMARC1; p=none; rua=mailto:hradmin@lumovy.com`. Check them with the Microsoft Remote Connectivity Analyzer or `mail-tester.com`.
2. **Tell Microsoft 365 the sender is trusted** (needed for the first weeks, since new senders have no reputation). In the Exchange admin center > Mail flow > Rules > **Add a rule**: apply when the sender is `choice-awards@lumovy.com` (or the azurecomm.net address) and the message header `Auto-Submitted` is `auto-generated`; then **Set the spam confidence level (SCL) to -1**. Or add the sender under Defender > Policies & rules > Threat policies > **Tenant Allow/Block List**. Ask recipients to mark one email "Not junk" as well.

The portal already marks every email as an automatic message and sends a plain-text copy beside the HTML one. You can set `MAIL_REPLY_TO` to a real mailbox (for example `hradmin@lumovy.com`) so replies go somewhere.

**Sending limits ("450 4.5.127 Excessive message rate").** Azure Communication Services limits how fast one sender can send: roughly **a few emails a minute on the free Azure managed domain**, and about **30 a minute and 100 an hour on a verified own domain** for new resources. Going over gets the SMTP error `450 4.5.127 Message rejected. Excessive message rate from sender`. The portal handles this itself:

- Bulk emails (contest started, reminders, results) go out in small batches within `MAIL_MAX_PER_MINUTE` (default 20) and, if set, `MAIL_MAX_PER_HOUR`. The rest wait in the queue and are sent as each minute or hour resets, until everyone has been emailed. Set the caps a little under your provider's limit, for example `MAIL_MAX_PER_MINUTE=4` on the managed domain, or `MAIL_MAX_PER_MINUTE=25` and `MAIL_MAX_PER_HOUR=90` on an own domain.
- If the provider still answers "too fast", the emails stay queued (they do **not** count as failed), sending pauses for 2 minutes (doubling up to 15), then resumes by itself.
- Sign-in codes and vote confirmations are always sent before bulk emails, so a company-wide send never delays a login.
- **Admin > Email outbox** shows how many are waiting, and has **Retry failed** to put earlier failed emails (for example from before this change) back in the queue.
- To send faster, raise the limit with an Azure support request (Communication Services > Help > New support request > "Email rate limit increase"), then raise the two settings.

**Setting up ACS SMTP by hand:** create an app registration and client secret in Entra ID, give it the **Communication and Email Service Owner** role on the `acs-choice-awards` resource (Access control (IAM)), then set `SMTP_USER` to `<ACS resource name>.<app client id>.<tenant id>` and `SMTP_PASS` to the client secret in App Service environment variables.

**Switching email off:** HR admins can turn email off at any time in **Admin > Settings**, with no redeploy. There are two switches. **Email notifications** covers the contest started, vote confirmation, results, reminder and deadline emails; when off they are skipped (not stored), and anything still waiting in the outbox is cancelled. **Email sign-in codes** covers the 6-digit code login; when off, the sign-in page shows the password option only. Turn the second one off only if people have passwords (Settings shows how many active users do not), because they would otherwise be unable to sign in. Both are on by default. The setting is stored in the database, so it survives restarts and applies to every instance.

**SMTP secret expiry (ACS only):** the Entra app secret you create for ACS has a lifetime you choose (2 years is typical). Put a reminder on a shared team calendar for **1 month before it expires** (the date is shown in Entra ID > App registrations > `sp-<APP>-smtp` > Certificates & secrets). To renew, add a new secret there, put it in the `SMTP_PASS` environment variable of the web app, save and restart. If it is missed, emails fail (see **Settings > Email delivery** and **Email outbox**), voting and password sign-in keep working, and you can switch email off in Settings until it is fixed.

**Limits:** ACS applies sending rate limits to new resources (enough for a few thousand messages a month). If a contest start email to everyone is held back, the portal retries it, and **Admin > Email outbox** shows what is waiting.

### 4. First sign-in and set-up

1. Open the address, sign in with the first admin email and the temporary password, then change it (account menu > Change password).
2. In **App Service > Environment variables**, delete `BOOTSTRAP_ADMIN_PASSWORD`, save and restart.
3. **Users & regions:** confirm India is switched on, **Import spreadsheet** (name, email, team, region) for all employees, add the other HR admins.
4. **Email test:** create a draft contest, open **Emails** and **Send test to me**. Check it arrives and its links open the right address.

### 5. Dry run before launch

1. Create a test contest with 3 entries, a near end time and 2-3 test employees (a staging slot or a separate staging app is ideal).
2. Start it, vote as the test employees, confirm the "Your vote is in" email.
3. Let it close, check the results, publish, confirm the results email.

The dry run on the real Azure setup is required before the first real contest. SQLite is the best-tested path in this project; PostgreSQL has had less testing, so run an extra careful dry run if you choose `DB=postgres`.

### 6. Go live

- [ ] HTTPS works on the custom domain, `APP_URL` matches
- [ ] Test email arrives (check the spam folder once); if it lands in spam, move to your own domain (see "Email")
- [ ] All employees imported with a region, India on
- [ ] HR admins added, bootstrap password removed
- [ ] Backups confirmed (below), a restore tested
- [ ] Dry run completed
- [ ] Announce, create the first contest, click **Start contest**

## Database (SQLite by default)

The portal stores everything in one SQLite file, `/home/data/choice.db`: people and regions, contests, entries' details, votes and voter receipts, drafts, email queue, settings and the activity log. Uploaded entry files and banners are in `/home/data/uploads`. Both are on the web app's persistent storage, so they survive restarts and redeploys (a zip deploy replaces the code, not `/home`). The setup is sized for up to about 250 employees and 50-100 voters per contest, which is far below what SQLite handles.

Safe-by-default choices for Azure's network storage:
- The journal mode is set to `delete` (not the faster `wal`) with full syncing, which SQLite documents as the safe mode on network file systems.
- **Keep exactly one instance.** Do not scale out. Scale up (B1 → B2) if you need more power.
- Automatic and on-demand backups, described under Operations below. Download a copy after every contest.

To move to PostgreSQL later: provision with `DB=postgres` (or create the server and set `DATABASE_URL`) and ask for help to copy the data across. It is a one-off migration, not automatic.

## Operations

- **Backups (SQLite):** the app saves a consistent copy of the database to `/home/data/backups` every 6 hours, when a contest starts and when voting closes (last 40 kept), and **Admin > Settings > Back up now** takes one on demand. These are on the same storage as the database, so also keep a copy outside Azure: after each contest, download the newest file with **App Service > Development Tools > Advanced Tools (Kudu) > Bash/File browser** or `az webapp ssh`, and store it safely. Enable **App Service Backup** for `/home` as an extra layer. **To restore:** stop the web app, copy a backup over `/home/data/choice.db`, delete `/home/data/choice.db-wal` and `choice.db-shm` if present, and start the app.
- **Backups (PostgreSQL):** PostgreSQL Flexible Server takes automated backups with point-in-time restore (set retention to 14-35 days). Uploaded files are on `/home`; enable **App Service Backup** (App Service > Backups) so files and settings are protected too. Restore the database and files from the same point in time.
- **Monitoring:** turn on **Application Insights** (App Service > Application Insights), add an availability test on `/api/health`, and alerts on HTTP 5xx and response time. **Log stream** shows live logs.
- **Email problems:** failed emails show in **Admin > Email outbox**. Several app instances are safe: emails are claimed atomically.
- **Scaling:** scale **up** the plan (B1 → B2 → P1v3, one command or a few clicks, no redeploy) if uploads or voting feel slow; scaling **out** to 2+ instances is supported **only with PostgreSQL** (with SQLite keep exactly one instance, because one database file cannot be shared by several running copies). Raise PostgreSQL to General Purpose if you see database CPU pressure in the last hour of a big contest.
- **Updates:** run the three-step manual deploy above. Run `npm test` locally first. Migrations run automatically on start. Avoid deploying in the last hour of a live contest (a restart takes seconds and loses no votes).
- **Staging:** create a second web app (or a deployment slot) with its own database for rehearsals; deploy to it with the same script.
- **Secrets hygiene:** rotate the database password yearly, and renew the SMTP password (the Entra app client secret, valid 2 years) before it expires (see "SMTP secret expiry" above). Keep `APP_SECRET` as it is; changing it makes existing voter receipts unreadable (votes and results are unaffected).

## Security on Azure

- HTTPS only, TLS 1.2+, FTPS disabled, managed certificate.
- With PostgreSQL, the server allows only Azure services; for stricter setups use a private endpoint and VNet integration, and Key Vault references for secrets.
- Optional: restrict access to the company network with App Service **Access restrictions**, or put Azure Front Door with WAF in front.
- Deploy access is whoever can run `az webapp deploy` (give people only the Website Contributor role on the resource group).

## Rollback

Keep the previous `deploy-azure.zip` (rename it with the date). To roll back, run `az webapp deploy` with that older zip. Do not roll the database back unless you restore a backup taken before the bad release.

## Estimated monthly cost (Central India, list prices, approximate)

Sized for the basic need: up to about 250 employees and up to 5 contests a month (about 4,000 emails a month). Contest count barely changes the bill because compute and database are flat monthly charges.

| Item | Approx. |
| --- | --- |
| App Service B1 (Always On, HTTPS, custom domain, free certificate) | about 15 USD |
| Database: SQLite on the web app's storage (default) | 0 USD |
| Database, only if you choose PostgreSQL Flexible B1ms + 32 GB | about 15-20 USD |
| Email (Microsoft 365 mailbox through Graph: no Azure charge; ACS would be about 0.25 USD per 1,000) | 0 |
| Application Insights, backup storage | about 2-4 USD |
| **Total (SQLite)** | **about 18-22 USD per month** |
| **Total (with PostgreSQL)** | **about 33-42 USD per month** |

Options: B2 (about 30 USD) gives more headroom for large uploads and big deadline rushes, so the total is about 50 USD. A 1-year reservation lowers the price by roughly 30-40%. A staging app is optional; create it only for dry runs and delete it afterwards. Azure Front Door with WAF is not needed at this size. Check the Azure pricing calculator for current numbers.
