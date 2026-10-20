# J K S TOURISM L.L.C. website

The public website plus an admin panel for managing packages, enquiries and contact details.

## Run it

You need [Node.js](https://nodejs.org) 18 or newer. There is nothing to install.

```
npm start
```

- Website: http://localhost:8080/
- Admin panel: http://localhost:8080/admin

The first time it starts, the server prints an admin password in the terminal. Sign in with it, then change it under **Settings**.

Forgot the password? Run `npm run reset-password`. It prints a new one and signs everyone out.

## What the admin panel does

- **Dashboard**: new enquiries, recent activity and a setup checklist.
- **Enquiries**: everything sent through the website's form. Set a status (new, contacted, booked, closed), keep private notes, reply on WhatsApp or by email in one click, and download everything as a CSV file for Excel.
- **Packages**: add, edit, hide, reorder and delete tour packages, and upload photos. Changes go live immediately.
- **Settings**: WhatsApp number, email, phone, location, trade licence number, the price note, and the admin password.

## Files

| Path | What it is |
|---|---|
| `server.js` | The web server and admin API. No dependencies. |
| `jks-tourism/` | The public website (`index.html`, logo and icons). |
| `admin/index.html` | The admin panel. |
| `data/` | Created on first run: live packages and settings, enquiries, the password hash and uploaded photos. **Back this folder up.** It is not part of the code. |

## Hosting

The admin panel needs a host that runs Node.js, for example a VPS, Render, Railway or Fly.io. Plain static hosting (GitHub Pages, basic cPanel) can show the website, but the admin panel and saved enquiries won't work there. On those hosts the enquiry form falls back to opening WhatsApp or email.

Settings, all optional:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | Port to listen on. |
| `HOST` | `0.0.0.0` | Address to listen on. |
| `DATA_DIR` | `./data` | Where content, enquiries and uploads are stored. Point this at a persistent disk on hosts that wipe files on redeploy. |
| `ADMIN_PASSWORD` | random | Password to create on first run instead of a random one. |
| `TRUST_PROXY` | off | Set to `1` behind a reverse proxy or load balancer, so rate limits see real visitor IPs. |
| `SECURE_COOKIES` | auto | Set to `1` to always mark the sign-in cookie as HTTPS-only. |

Always serve the live site over HTTPS so the admin password is encrypted in transit.

### Hostinger

Needs a **Business Web Hosting** or **Cloud** plan (Premium and Single plans can't run Node.js).

1. In the Hostinger dashboard: **Websites → Create Website → Web App → Upload your website files**, and upload the zip.
2. Build settings: framework **Other**, entry file `server.js`, Node.js **22.x**. No build command is needed.
3. Environment variables:
   - `ADMIN_PASSWORD` = the admin password you want
   - `DATA_DIR` = `~/jks-tourism-data` (Hostinger replaces the app folder on every deploy, so data must live outside it)
   - `TRUST_PROXY` = `1`
   - `SECURE_COOKIES` = `1`
   - Leave `PORT` and `HOST` empty.
4. **Deploy**, then open `https://your-domain/admin`.

To update the site later, upload a new zip the same way. Your packages, enquiries and photos stay in `~/jks-tourism-data`.
