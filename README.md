# Inbound Lead Intake

This project now powers the public `claudeaiblog.com` landing pages and the
U.S.-wide Claude update signup flow.

It captures:

- `name`
- `email`
- `phone`
- `address`
- `best_time_start`
- `best_time_end`
- landing/source attribution (`utm_*`, `gclid`, `fbclid`, `msclkid`, referrer, landing path)
- automation fields (`priority`, `lead_score`, `routing_lane`, `follow_up_deadline`, repeat submission tracking)

Current public pages:

- `/`
- `/join.html`
- `/privacy.html`
- `/thanks.html`

Current behavior:

- the join page is U.S.-wide
- legacy `/consumer-ca.html` and `/consumer-ga.html` redirect to `/join.html`
- time selection on the join page is generated from 15-minute dropdown options
- the address field is wired for Google Maps Places autocomplete when `GOOGLE_MAPS_API_KEY` is configured
- the homepage, join page, privacy page, and thank-you page share the same refreshed nav/footer system
- the public privacy page now uses consumer-facing copy and avoids exposing internal lead-routing or admin details

It stores submissions in ordered local files:

- `data/leads.json`
- `data/leads.csv`
- `data/notes-export.txt`
- `data/webhook-queue.ndjson` when webhook delivery fails

## Run locally

```bash
npm start
```

Then open:

- `http://localhost:3030/`
- `http://localhost:3030/notes`

## Config

- `HOST`
- `PORT`
- `DATA_DIR`
- `ALLOW_LEAD_READS`
- `BASIC_AUTH_USERNAME`
- `BASIC_AUTH_PASSWORD`
- `LEAD_WEBHOOK_URL`
- `LEAD_WEBHOOK_TOKEN`
- `LEAD_WEBHOOK_TIMEOUT_MS`
- `GTM_CONTAINER_ID`
- `GA_MEASUREMENT_ID`
- `META_PIXEL_ID`
- `GOOGLE_MAPS_API_KEY`

If `BASIC_AUTH_USERNAME` and `BASIC_AUTH_PASSWORD` are not set, the app falls back to the local credential file at `data/admin-credentials.json`.

## Automation hooks

The website now keeps ad/source attribution attached to the lead all the way from the landing page to the form submit. That gives you workable routing data instead of anonymous form fills.

Two automation paths are available without adding dependencies:

1. Existing notes pipeline
   - new leads are still written to `data/notes-export.txt`
   - your existing `/notes` -> `save-live-leads.sh` -> `forward-leads.sh` Telegram flow keeps working
   - the note lines now include priority, routing lane, follow-up deadline, source attribution, and repeat-submission markers

2. Direct webhook routing
   - set `LEAD_WEBHOOK_URL` to a Make, Zapier, n8n, Slack, or custom HTTPS endpoint
   - optionally set `LEAD_WEBHOOK_TOKEN` for bearer auth
   - if delivery fails, the event is queued into `data/webhook-queue.ndjson` instead of being dropped

3. Optional conversion tracking
   - set `GTM_CONTAINER_ID` or `GA_MEASUREMENT_ID` to enable browser tracking from runtime config
   - set `META_PIXEL_ID` if you want Meta Lead events from the thank-you page
   - the thank-you page is the clean conversion destination for paid traffic

4. Optional address autocomplete
   - set `GOOGLE_MAPS_API_KEY` to enable Google Maps Places autocomplete on the join-page address field
   - the key is exposed to the browser through runtime config because Places autocomplete runs client-side

Example webhook target types:

- Make custom webhook
- Zapier catch hook
- n8n webhook trigger
- your own CRM/ops endpoint

## Simple hosting

This repo now includes [render.yaml](/Users/m5cs/inbound-lead-intake/render.yaml) for a basic Render deployment.

Recommended hosted settings:

- `HOST=0.0.0.0`
- `DATA_DIR=/var/data`
- set both basic auth env vars in the Render dashboard
- keep `ALLOW_LEAD_READS=false`
- set `LEAD_WEBHOOK_URL` if you want direct lead routing
- optionally set `LEAD_WEBHOOK_TOKEN`
- optionally set `GTM_CONTAINER_ID` or `GA_MEASUREMENT_ID`
- optionally set `META_PIXEL_ID`
- optionally set `GOOGLE_MAPS_API_KEY`

Important:

- Hosted deployments are no longer local-only.
- Lead data should live on a persistent disk, not ephemeral container storage.
- This app still captures only inbound, self-submitted leads.

## Notes

- This is an inbound-only capture system.
- It does not source or scrape consumer contact data.
- It does not verify phone ownership. Carrier or OTP verification would require an SMS provider.
- The notes export remains ordered by submission timestamp.
