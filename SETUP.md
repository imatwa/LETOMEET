# LETOMEET updated app

## What is included
The original Flask/SQLAlchemy app, Russian interface, stylesheet and navigation are retained. The existing registration/login screens and event cover/color/emoji/tagline controls are retained and hardened. Added: a map page (`/#map` or `/map`) with four school floor plans, room suggestions in event creation, event pins and an explicit list of unmapped events; comments with signed-in posting, author/admin deletion, and posting cooldown; decoded/re-encoded image uploads.

## Run locally (PowerShell, Python 3.11+)
From the extracted LETOMEET-main directory:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
$env:SECRET_KEY = (python -c "import secrets; print(secrets.token_hex(32))")
$env:MAIL_MODE = "console"
python main.py
```
Open http://127.0.0.1:5000. Register with a @student.letovo.ru or @letovo.ru address. In console mode the six-digit code appears in the server terminal. This is a deliberate local testing option. Codes expire after ten minutes, are stored hashed, and are consumed after verification. Requests are limited per email and IP; five verification attempts per email per ten minutes. Resends invalidate older codes.

`.env.example` documents settings; Flask does not automatically load that file. Set environment variables in the shell or your host's secrets/settings panel. No credentials are included. The package starts with an empty database. The original uploaded database and personal upload photos are excluded from delivery.

To make an administrator, set ADMIN_EMAIL to a mailbox you control before starting the app. That account is created and must sign in with an email code. New events are pending until approved from the admin page. With no ADMIN_EMAIL configured no administrator is automatically created. Do not set this to someone else's address.

## Real email and production
Set APP_ENV=production, a stable random SECRET_KEY, SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASSWORD and EMAIL_FROM (an authorized sender). Remove MAIL_MODE. SMTP uses STARTTLS and authentication. Missing email credentials produce a delivery error, never a successful simulated delivery. Provider credentials and an actual test mailbox are required to verify real delivery; that has not been tested here.

Deploy behind HTTPS using a production WSGI server. Production cookies require HTTPS. Configure the reverse proxy so the app sees the public host/scheme, and enforce trusted hosts at the proxy. Do not use the Flask development server for public hosting. Keep secrets outside source control. Changing SECRET_KEY invalidates sessions. Without a supplied development key, restarts also invalidate sessions.

New photo uploads are stored as binary data in the database and served at `/media/<filename>`. They do not require a writable upload directory on Vercel. With Neon, keep DATABASE_URL configured to your existing database. Local SQLite requires a persistent writable database directory. Photos accept JPG/PNG/WebP up to 4 MiB and 20 megapixels. See UPDATE-NOTES.md for details and migrations/001_event_features.sql for the additive database update. UPLOAD_FOLDER is retained only for reading pre-update local files.

DATABASE_URL optionally selects PostgreSQL. Use `postgresql+psycopg://...` with the bundled psycopg 3 driver. Back up database and uploads together. Existing compatible databases gain two new tables (`comment`, `security_counter`) through create_all; existing columns are unchanged. Back up and test a copy before migrating any live database. create_all is not a general schema migration tool.

The original vercel.json is retained. Vercel needs an external database such as your existing Neon database; SQLite cannot persist there. New photo uploads now persist in that database too. No cloud resources, SMTP account, or paid services were provisioned.

## Map provenance and behavior
Floor images come from the supplied letovo-navigator-main.zip. 149 ClassNode records come from the supplied Levels.java.txt. Reference image dimensions come from LetovoNavigator2Application.java: floor 0 = 2135x3339; 1 = 11411x7663; 2 = 10976x7360; 3 = 10764x7225. Coordinates are scaled proportionally, not assumed to be actual PNG pixels. Rooms match exactly, ignoring case/whitespace and normalizing Cyrillic c before numbers. Use the suggestions on the creation form. Unknown or outdoor locations remain visible in the unmapped list. Multiple events at one room may share a pin position; the adjacent list links to every event. There is no route finding or geolocation. Verify source room positions with school staff before relying on them.

## Tests and limits
```powershell
python -m unittest -v test_features
python -m py_compile main.py
```
Eleven integration tests cover registration/login, consumed/expired codes, throttling, email failure, image validation/serving, comment permissions/visibility, map coordinate bounds and cross-origin rejection. JavaScript syntax was checked separately. This is a Flask app with no frontend build step. Browser map/color checks passed; photo-picker UI testing and live SMTP/PostgreSQL delivery remain unverified.

Comments show the latest 100 entries, newest first, and preserve escaped text. Signed-in users can remove their own comments; admins can remove any comment. No email notifications, reporting workflow, pagination, or comment editing is included. Existing card customization is available at event creation; an owner editing workflow is not added. Uploaded image database rows are not automatically garbage collected when an abandoned event form is discarded. Add storage quotas/cleanup and backup retention suitable for your school.

The database-backed rate counters are suitable for modest traffic; multi-worker concurrent updates are not atomic. Before wider deployment, add centralized atomic throttling at the gateway or in Redis, database uniqueness/atomic consumption for concurrent OTP verification, retention cleanup for counters/codes, and provider-level sending limits. The retained app's account/event APIs can disclose school email addresses to authorized administrators; review school privacy and moderation requirements before launch.

## Changed files
main.py; static/script.js; static/style.css (additive styles); templates/index.html (map link); requirements.txt (Pillow); new static/maps/*; test_features.py; migrations/001_event_features.sql; UPDATE-NOTES.md; .env.example; SETUP.md. Original uploaded ZIPs and GitHub repository were not modified.
