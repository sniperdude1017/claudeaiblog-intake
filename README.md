# Inbound Lead Intake

This project provides a local, dependency-free inbound lead intake flow for:

- California consumers
- Georgia consumers

It captures:

- `name`
- `email`
- `phone`
- `ZIP`
- phone ownership attestation
- explicit consent for email and SMS follow-up

It stores submissions in ordered local files:

- `data/leads.json`
- `data/leads.csv`
- `data/notes-export.txt`

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

If `BASIC_AUTH_USERNAME` and `BASIC_AUTH_PASSWORD` are not set, the app falls back to the local credential file at `data/admin-credentials.json`.

## Simple hosting

This repo now includes [render.yaml](/Users/m5cs/inbound-lead-intake/render.yaml) for a basic Render deployment.

Recommended hosted settings:

- `HOST=0.0.0.0`
- `DATA_DIR=/var/data`
- set both basic auth env vars in the Render dashboard
- keep `ALLOW_LEAD_READS=false`

Important:

- Hosted deployments are no longer local-only.
- Lead data should live on a persistent disk, not ephemeral container storage.
- This app still captures only inbound, self-submitted leads.

## Notes

- This is an inbound-only capture system.
- It does not source or scrape consumer contact data.
- It does not verify phone ownership beyond self-attestation. Carrier or OTP verification would require an SMS provider.
- The notes export remains ordered by submission timestamp.
