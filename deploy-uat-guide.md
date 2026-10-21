# IBB Insights — UAT deployment guide

**Server:** 192.168.3.112 (Ubuntu, Apache, PM2) · **URL:** http://uatIbbInsights.wockhardt.com

This guide installs the sales dashboard alongside the sites already on the server. Nothing here changes the other sites: Apache gets one new site that answers only to `uatIbbInsights.wockhardt.com`, and PM2 gets one new app.

| Part | Where on the server | Runs as |
|---|---|---|
| Frontend (`ibb-insights-web`) | `/var/www/ibb-insights/web` | static files served by Apache |
| Backend (`ibb-insights-api`) | `/var/www/ibb-insights/api` | PM2 app `ibb-insights-api` on `127.0.0.1:8787` |
| Apache site (`apache/uatibbinsights.conf`) | `/etc/apache2/sites-available/` | — |

The browser only ever talks to Apache. Apache serves the frontend and forwards `/api/...` to the backend, so port 8787 stays private to the server.

---

## 1. Before you start

Run these on the UAT server (`ssh <user>@192.168.3.112`). The deployment cannot work until every check passes.

**1.1 Node.js 20.6 or newer** (PM2 runs the API with Node's `--env-file`):

```bash
node -v          # needs v20.6.0 or higher; v22 LTS recommended
pm2 -v
```

If the server's Node is older because other apps need it, install Node 22 alongside it (for example with `nvm`), and add `interpreter: '/path/to/node22/bin/node'` to `ecosystem.config.cjs`.

**1.2 Port 8787 is free:**

```bash
sudo ss -ltnp | grep ':8787' || echo "8787 is free"
```

If something already uses it, pick another free port (for example 8797). Change it in two places: `PORT=` in `/var/www/ibb-insights/api/.env`, and both `ProxyPass` lines in the Apache site.

**1.3 The server can reach the three back-end services.** The API reads:

| Service | Address | Test from the UAT server |
|---|---|---|
| Azure Synapse (sales data) | `sap-analytics-sql1.sql.azuresynapse.net:1433` | `nc -zv sap-analytics-sql1.sql.azuresynapse.net 1433` |
| Sign-in database (PostgreSQL) | `192.168.1.76:5432`, database `sales_dash_user_db` | `nc -zv 192.168.1.76 5432` |
| Infinity field-structure API | `https://infinityplus.wockhardt.com` | `curl -sS -o /dev/null -w '%{http_code}\n' https://infinityplus.wockhardt.com/plus/report` |

What to do when a test fails:
- **Synapse:** the Azure Synapse firewall must allow this server's outbound public IP (`curl -s ifconfig.me`). Ask whoever administers the Azure workspace to add it.
- **PostgreSQL:** on 192.168.1.76, `pg_hba.conf` must accept `192.168.3.112`, for example `host sales_dash_user_db postgres 192.168.3.112/32 scram-sha-256`. Then reload Postgres. The network must also allow 192.168.3.0 → 192.168.1.76:5432.
- **Infinity:** any HTTP code (200, 401, 404) means it is reachable. A timeout means outbound HTTPS is blocked.

UAT shares the sign-in database with the current test server (192.168.3.142). Users, BU-head accounts and sign-in history are the same on both.

**1.4 Apache modules:**

```bash
sudo a2enmod proxy proxy_http headers rewrite
```

---

## 2. Copy the package to the server

From the Windows machine that holds the package (`D:\Lavkush\salesDashborad\deploy\uat`), in PowerShell:

```powershell
cd D:\Lavkush\salesDashborad\deploy\uat
scp ibb-insights-web.tar.gz ibb-insights-api.tar.gz apache\uatibbinsights.conf <user>@192.168.3.112:/tmp/
```

(WinSCP works too. Copy the same three files to `/tmp`.)

---

## 3. Install the frontend

```bash
sudo mkdir -p /var/www/ibb-insights
cd /var/www/ibb-insights
sudo tar -xzf /tmp/ibb-insights-web.tar.gz
sudo rm -rf web && sudo mv ibb-insights-web web
sudo chown -R www-data:www-data web
ls web            # index.html, assets/, wing_white.png
```

---

## 4. Install the backend

The package already contains its runtime `node_modules`, so no `npm install` is needed and the server needs no internet access for packages.

```bash
cd /var/www/ibb-insights
sudo tar -xzf /tmp/ibb-insights-api.tar.gz
sudo rm -rf api && sudo mv ibb-insights-api api

# Owned by the account that runs PM2 (the same user as the other PM2 apps).
sudo chown -R $USER:$USER api
chmod 600 api/.env          # it holds database passwords and the session secret
```

**Check `.env` before the first start** (`nano /var/www/ibb-insights/api/.env`). It is already filled in for UAT:

| Setting | UAT value | Notes |
|---|---|---|
| `PORT` / `HOST` | `8787` / `127.0.0.1` | change `PORT` only if 8787 was taken (step 1.2) |
| `NODE_ENV` | `development` | sign-in codes (OTP) are **shown on the login screen**, as on the test server, because no SMS/e-mail sender is configured. See section 9 to send them by SMS instead. |
| `CORS_ORIGIN` | `https://uatIbbInsights.wockhardt.com,http://…` | |
| `SQL_*`, `USER_DATABASE_URL`, `INFINITY_*` | copied from the test server | same data sources as the test server |
| `JWT_SECRET` | generated for UAT | signs sign-in sessions; changing it signs everyone out |
| `CACHE_DRIVER` | `none` | every request reads the warehouse directly |

**Start it with PM2:**

```bash
cd /var/www/ibb-insights/api
pm2 start ecosystem.config.cjs
pm2 save                       # remember it across restarts
pm2 status                     # ibb-insights-api should be "online"
curl -s http://127.0.0.1:8787/health; echo
```

If PM2 is not yet set to start on boot on this server (the other apps may already have done this), run `pm2 startup` once and the `sudo …` command it prints, then `pm2 save` again.

If the app is not `online`, read the log. The startup check names every setting that is missing or wrong:

```bash
pm2 logs ibb-insights-api --lines 50
```

---

## 5. Enable the Apache site

```bash
sudo cp /tmp/uatibbinsights.conf /etc/apache2/sites-available/uatibbinsights.conf
sudo a2ensite uatibbinsights
sudo apache2ctl configtest      # must say "Syntax OK"
sudo systemctl reload apache2
```

`reload` (not `restart`) keeps the other sites' connections open.

**HTTPS:** if `uatIbbInsights.wockhardt.com` will be opened over `https://`, install the certificate on this server. Then uncomment the `<VirtualHost *:443>` block in the site file, set the three certificate paths, run `sudo a2enmod ssl`, and run the `configtest` and `reload` above again. If HTTPS is handled by a load balancer or firewall in front of the server, keep the port-80 site as it is.

---

## 6. Check it works

On the server:

```bash
curl -sI -H 'Host: uatIbbInsights.wockhardt.com' http://127.0.0.1/ | head -1            # 200
curl -s  -H 'Host: uatIbbInsights.wockhardt.com' http://127.0.0.1/api/meta/version; echo  # 401 JSON: the API answered through Apache
```

In a browser, open **http://uatIbbInsights.wockhardt.com** and check:

1. The login page loads. Refreshing on `/login` still shows it.
2. Sign in with a field-force mobile number. The OTP appears on the screen in UAT.
3. The Division tab loads. The first load takes 20–60 seconds, because figures are read live from Synapse.
4. **BU Head login** (`/login/bu-head`) works for an existing BU-head account.

---

## 7. BU-head (password) accounts

Accounts live in the shared sign-in database, so accounts created on the test server already work here. To manage them from the UAT server:

```bash
cd /var/www/ibb-insights/api
node --env-file=.env dist/tools/accounts.js list
node --env-file=.env dist/tools/accounts.js add --name "Full Name" --mobile 98XXXXXXXX --division 85 --email name@wockhardt.com
node --env-file=.env dist/tools/accounts.js reset  --mobile 98XXXXXXXX   # new temporary password, unlocks
node --env-file=.env dist/tools/accounts.js unlock --mobile 98XXXXXXXX
```

`add` and `reset` print a temporary password once. Give it to the person privately. They must change it at first sign-in.

---

## 8. Updating to a new version

On the Windows machine, from `D:\Lavkush\salesDashborad`, rebuild the package:

```powershell
node package-uat.mjs
```

It reuses the UAT session secret, so users stay signed in. Copy the two `.tar.gz` files to `/tmp` (section 2), then on the server:

```bash
# Frontend
cd /var/www/ibb-insights
sudo rm -rf ibb-insights-web && sudo tar -xzf /tmp/ibb-insights-web.tar.gz
sudo rm -rf web.old && sudo mv web web.old && sudo mv ibb-insights-web web
sudo chown -R www-data:www-data web

# Backend: keep the server's .env and logs, replace the rest
rm -rf ibb-insights-api && tar -xzf /tmp/ibb-insights-api.tar.gz
cp api/.env ibb-insights-api/.env && chmod 600 ibb-insights-api/.env
cp -r api/logs ibb-insights-api/ 2>/dev/null
rm -rf api.old && mv api api.old && mv ibb-insights-api api
cd api && pm2 reload ibb-insights-api && pm2 status
```

**Rolling back:** move `web.old` / `api.old` back into place, then run `pm2 reload ibb-insights-api`.

Users should press **Ctrl+F5** once after a frontend update.

---

## 9. Sending OTPs by SMS (optional, for production-like UAT)

To stop showing sign-in codes on screen, add the SMS gateway settings that the D2D portal uses to `.env`, set `NODE_ENV=production`, and run `pm2 reload ibb-insights-api`:

```
NODE_ENV=production
SMS_URL=...
SMS_USERNAME=...
SMS_PASSWORD=...
SMS_FROM=...
SMS_TEMPLATE_ID=...
SMS_OTP_TEXT=...{otp}...      # must match the DLT-registered template exactly
```

E-mail instead: set `SMTP_HOST`, `SMTP_PORT`, `EMAIL_FROM` (and `SMTP_USER` / `SMTP_PASSWORD` if the relay needs them). In production the API refuses to start unless one of the two is configured. `pm2 logs` will say so.

---

## 10. Day-to-day commands

| Task | Command |
|---|---|
| Status | `pm2 status` |
| API log (live) | `pm2 logs ibb-insights-api` |
| Restart the API | `pm2 reload ibb-insights-api` |
| API health | `curl -s http://127.0.0.1:8787/health` |
| Apache errors for this site | `sudo tail -f /var/log/apache2/ibb-insights-error.log` |
| Apache access log | `sudo tail -f /var/log/apache2/ibb-insights-access.log` |

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Browser shows another site's page | DNS for `uatIbbInsights.wockhardt.com` does not reach this server, or the site is not enabled. Check `sudo apache2ctl -S` lists `uatibbinsights.wockhardt.com`. |
| Login page loads, but every action says it cannot reach the server (502/503) | The API is not running, or the port differs between `.env` and the Apache site. Check `pm2 status` and `curl 127.0.0.1:8787/health`. |
| 503, and `pm2 status` shows the app **online**, but `pm2 logs` has no "Server listening" line | PM2 is running `dist/src/server.js`, which only starts itself when Node runs it directly. Run `dist/src/start.js` instead, as the packaged `ecosystem.config.cjs` does. |
| `pm2 logs` shows `Invalid environment configuration` | A setting in `.env` is missing or wrong. The message names it. |
| Login fails with a database error, or the log shows `ECONNREFUSED 192.168.1.76:5432` / `no pg_hba.conf entry` | Step 1.3, PostgreSQL. |
| Dashboard errors after login, and the log shows a Synapse connection or firewall error | Step 1.3, Azure Synapse firewall. |
| A dashboard load fails after about a minute with 504 | The Synapse query was slower than Apache allows. Raise both `timeout=` values and `ProxyTimeout` in the site file. |
| Old screens after an update | Ctrl+F5. The site file stops browsers caching `index.html`. |
