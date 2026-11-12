# Map zoom and event-form update

## Deploy to your existing Vercel project
1. Replace the app files in the GitHub repository connected to the existing Vercel project with this package's LETOMEET-main contents. Keep main.py at the configured project root.
2. Run migrations/001_event_features.sql in the Neon SQL Editor, selecting the same branch/database as Vercel DATABASE_URL. It only adds missing fields and the new event_image table. Existing approved statuses are preserved. If status did not previously exist, old events start pending and need admin approval.
3. Deploy the new commit to Production. Keep your existing DATABASE_URL, SECRET_KEY, SMTP settings and ADMIN_EMAIL. No new service credentials are required.
4. Check /#map: +/- buttons, keyboard-accessible zoom slider (50-300%), fit-to-width reset, and horizontal/vertical scrolling. Map pins scale with the floor plan. Check /#create: seven colored swatches, selected-color sample, photo help, preview and removal.

## Photo changes
New photos are saved in Neon/PostgreSQL (SQLite when running locally), not on Vercel's read-only filesystem. The old error handler treated disk write errors as invalid images; storage failures now have a separate message. Cyrillic filenames are supported. JPEG/PNG/WebP inputs are decoded, oriented from EXIF, reduced to at most 2400 pixels on the longest side, and re-encoded as JPEG. Transparent areas become white; metadata/animation are removed.

Input limits: 4 MiB per file; 20 million pixels. Any aspect ratio is allowed. Recommended cover: 1600x900 (16:9). HEIC, SVG and other formats are unsupported; convert to JPG/PNG first. The smaller file cap leaves space for multipart overhead on Vercel. The UI checks size/dimensions, previews the chosen file, and offers 'Убрать фото' before submitting. No photo is uploaded until the event form is submitted. Creating without a photo is supported.

Photos use the existing /media/<uuid>.jpg URL format and are public to anyone with their URL. Previous disk-only photos aren't automatically moved into Neon; re-upload any missing covers. Images increase database storage and transfer usage. Uploads abandoned after a failed event submission are not automatically garbage collected; high-volume use should add quotas/cleanup or migrate to object storage.

The date/time/place/room section is unchanged in this update. Email verification settings and database event content are not changed. This package is a local deliverable; no GitHub or Vercel changes were made on your behalf.

## Validation
11 Python integration tests passed, including uploads with local writes blocked, Cyrillic filename handling, retrieval with a new client/session, resizing/transparency, pixel/file limits, and separate storage-error handling. Python compilation and JavaScript syntax checks passed. Browser checks verified map zoom 100->200->100% and color selection updating the live preview. Browser file-picker selection/removal could not be completed because file-upload permission was declined. No live Neon write, live SMTP send, or production deployment was performed.
