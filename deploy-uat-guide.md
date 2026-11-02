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
| Central User Service (sign-in) | `https://users.wockregenerative.com` | `curl -sS https://users.wockregenerative.com/.well-known/jwks.json` (prints a key) |

What to do when a test fails:
- **Synapse:** the Azure Synapse firewall must allow this server's outbound public IP (`curl -s ifconfig.me`). Ask whoever administers the Azure workspace to add it.
- **Central User Service:** it runs on this same server behind Apache. A timeout means the name does not resolve from here; ask for `users.wockregenerative.com` to be reachable from 192.168.3.112.

**1.3a Register the dashboard in the Central User Service (once).** On its admin page (`https://users.wockregenerative.com/admin`, as a service admin), add a client app:
- **client_id** `ibb-insights`, **name** "IBB Insights" (it appears in the OTP email).
- **Roles:** nsm, zsm, rm, tm, bu-head, admin. **Divisions:** none ticked (all). **Token TTL:** 12h.
- The page shows the **API key once**: it goes into the API's `.env` as `CENTRAL_API_KEY` (section 4).

Everyone with an active account there can then sign in. Users, BU heads and admins are managed only on that admin page (section 7).

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
chmod 600 api/.env          # it holds the Synapse password and the sign-in API key
```

**Check `.env` before the first start** (`nano /var/www/ibb-insights/api/.env`). It is already filled in for UAT:

| Setting | UAT value | Notes |
|---|---|---|
| `PORT` / `HOST` | `8787` / `127.0.0.1` | change `PORT` only if 8787 was taken (step 1.2) |
| `NODE_ENV` | `production` | |
| `CORS_ORIGIN` | `https://uatIbbInsights.wockhardt.com,http://…` | |
| `SQL_*` | copied from the test server | the same Synapse data |
| `CENTRAL_USER_SERVICE_URL` / `CENTRAL_CLIENT_ID` | `https://users.wockregenerative.com` / `ibb-insights` | sign-in |
| `CENTRAL_API_KEY` | **fill in** | the key from step 1.3a; the API will not start without it |
| `ALL_DIVISION_MOBILES` | optional | comma-separated mobiles that see every division (the service's admins always do) |
| `CACHE_DRIVER` | `memory` | views are cached in the API and rebuilt when Synapse data changes — see section 11 |

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
2. Sign in with a mobile number registered in the Central User Service. The OTP arrives by **email**.
3. The Division tab loads. The first load takes 20–60 seconds, because figures are read live from Synapse.
4. A BU head signs in the same way (mobile + emailed OTP) and sees their division.

---

## 7. Users and access

Everyone signs in through the **Central User Service** (`https://users.wockregenerative.com/admin`):
- **Field force** (NSM, ZSM, RM, TM) come from Infinity's field structure via the service's sync, for all 8 sales divisions.
- **BU heads and admins** are added there by hand, with their division and an email address (the OTP is emailed).
- Disabling a person there ends their dashboard session within a minute.

What each person sees:

| Role | Sees |
|---|---|
| TM | their HQ(s) |
| RM | their region(s) |
| ZSM | their zone(s) |
| NSM, BU head, admin | their division |
| Service admins, and mobiles in `ALL_DIVISION_MOBILES` | every division |

HQs, regions and zones come from the service's field hierarchy, the same Infinity structure as before.

---

## 8. Updating to a new version

On the Windows machine, from `D:\Lavkush\salesDashborad`, rebuild the package:

```powershell
node package-uat.mjs
```

Sessions are the Central User Service's, so users stay signed in. Copy the two `.tar.gz` files to `/tmp` (section 2), then on the server:

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

## 9. (Retired) On-screen OTPs and SMS

Sign-in codes are now always emailed by the Central User Service. The old `SMS_*`, `SMTP_*`, `JWT_SECRET`, `USER_DATABASE_URL` and `INFINITY_*` settings are no longer read and can be deleted from `.env`.

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

---

## 11. The cache (why reloads are fast)

Each dashboard view (user scope × tab × filters) is kept in the API's memory after its first load. While the Synapse data is unchanged, the same view is served in well under a second.

Every `DATA_CHECK_MINUTES` (default 5) the API checks whether any source changed. When it has:
- Users still get the previous figures at once. The footer says "newer data is being loaded".
- In the background the API rebuilds the NSM, ZSM and BU-head default views (fiscal year to date) first. It then rebuilds the views opened in the last `WARM_HOT_HOURS`, `WARM_CONCURRENCY` at a time.
- The page picks up the new figures on its own within about 30 seconds of its view being rebuilt.

So figures are at most a few minutes behind Synapse. A user's first look at a filter combination nobody has opened yet still takes the full Synapse time once.

| Setting (`.env`) | Default | Meaning |
|---|---|---|
| `CACHE_DRIVER` | `memory` | `memory`: kept in the API process. `none`: no cache. |
| `DATA_CHECK_MINUTES` | `5` | How often to check for new Synapse data |
| `WARM_CONCURRENCY` | `1` | Views rebuilt at once (leaves Synapse room for users) |
| `WARM_MAX_VIEWS` | `300` | Recently used views rebuilt after a change |
| `WARM_HOT_HOURS` | `24` | How recent "recently used" is |
| `MEMORY_CACHE_MAX` | `1000` | Most views held in memory |

The memory cache empties when the API restarts (`pm2 reload`, a deploy). The senior defaults are rebuilt within minutes of the start; the log shows `cache warmer: views rebuilt`.

To clear the cache by hand, restart the API: `pm2 reload <app>`.

If the API is ever run as several processes, set `CACHE_DRIVER=redis` and `REDIS_URL=redis://127.0.0.1:6379/5` (after `sudo apt install redis-server`). It also suits a cache that should survive restarts. No code change is needed.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Browser shows another site's page | DNS for `uatIbbInsights.wockhardt.com` does not reach this server, or the site is not enabled. Check `sudo apache2ctl -S` lists `uatibbinsights.wockhardt.com`. |
| Login page loads, but every action says it cannot reach the server (502/503) | The API is not running, or the port differs between `.env` and the Apache site. Check `pm2 status` and `curl 127.0.0.1:8787/health`. |
| 503, and `pm2 status` shows the app **online**, but `pm2 logs` has no "Server listening" line | PM2 is running `dist/src/server.js`, which only starts itself when Node runs it directly. Run `dist/src/start.js` instead, as the packaged `ecosystem.config.cjs` does. |
| `pm2 logs` shows `Invalid environment configuration` | A setting in `.env` is missing or wrong. The message names it. |
| Login says "The login service is not reachable" | The Central User Service is down or unreachable from this server. Step 1.3. |
| `pm2 logs` says `CENTRAL_API_KEY is required` | Step 1.3a: put the app's API key in `.env`. |
| Login says "No active account is registered…" or the app is not allowed | The person is not active in the Central User Service, or the `ibb-insights` client does not allow their role. Fix it on its admin page. |
| Dashboard errors after login, and the log shows a Synapse connection or firewall error | Step 1.3, Azure Synapse firewall. |
| A dashboard load fails after about a minute with 504 | The Synapse query was slower than Apache allows. Raise both `timeout=` values and `ProxyTimeout` in the site file. |
| Old screens after an update | Ctrl+F5. The site file stops browsers caching `index.html`. |
