# Dashboard UI (web)

Standalone read-only dashboard SPA (React + Vite + TypeScript). Deployed to Firebase
Hosting; all data reads go through the Read_Proxy via the `/api` rewrite — the SPA never
holds Supabase credentials.

## Local development

```bash
npm install
npm run dev
```

`npm run dev` starts the Vite dev server. Requests to `/api/**` are forwarded to the
`dashboard-read-proxy` Cloud Run service (or a locally-run proxy) and the rest of the app
is served as a single-page application.

Other scripts:

- `npm run build` — type-checks (`tsc --noEmit`) then produces the static bundle in `dist/`.
- `npm run preview` — serves the built `dist/` bundle locally.
- `npm run test` — runs the Vitest unit + property suites.

## Production deploy (Firebase Hosting)

```bash
npm run build
firebase deploy
```

1. `npm run build` emits the production bundle to `web/dist`.
2. `firebase deploy` publishes it using `web/firebase.json` and `web/.firebaserc`.

Hosting config (`firebase.json`):

- `public: "dist"` — serves the Vite build output (`web/dist`), resolved relative to
  `web/firebase.json`.
- `/api/**` rewrite → the `dashboard-read-proxy` Cloud Run service
  (region `europe-west1`), so all reads flow through the Read_Proxy.
- Catch-all `**` rewrite → `/index.html` for SPA client-side routing fallback.
- Strict CSP and security headers applied to all responses
  (`Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy`,
  `X-Frame-Options`).

The target Firebase project is `trade-assistant-508806` (`.firebaserc` `projects.default`).

## Deployment record — Task 16 (LIVE CLOUD, Req 21.4)

Live `firebase deploy --only hosting --project trade-assistant-508806` executed under the
Live Cloud Execution Protocol (operator-approved). Non-secret references only:

- Public Hosting URL: `https://trade-assistant-508806.web.app` (root serves the SPA, HTTP 200,
  with the strict CSP + `X-Content-Type-Options` + `Referrer-Policy` + `X-Frame-Options`
  headers from `firebase.json`).
- Rewrite target: `dashboard-read-proxy` Cloud Run service, region `europe-west1`
  (Ready=True), URL `https://dashboard-read-proxy-uy5jewntfq-ew.a.run.app`.
- Invoker binding: the proxy was deployed authenticated-only, so the `/api/**` rewrite
  returned 403. Firebase Hosting→Cloud Run rewrites authenticate at the edge as `allUsers`
  (there is no `firebasehosting` service agent in this project to bind). With operator
  approval, `roles/run.invoker` was granted to `allUsers` on `dashboard-read-proxy`; the
  rewrite then reached the proxy application. The proxy retains its endpoint allowlist,
  SELECT-only queries, rate limiting, CSP, and the SELECT-only `dashboard_reader` DB role.

### Known gap for Task 17 (smoke verification)

`GET /api/decision-dates` through the rewrite returns the proxy's own `404 {"error":"Unknown
endpoint"}`. Firebase forwards the full matched path (`/api/decision-dates`) to Cloud Run,
but the proxy allowlist registers un-prefixed paths (`/decision-dates`). The proxy router
must strip the `/api` prefix (or the allowlist must carry it) for the SPA↔proxy path contract
to line up. This is a Read_Proxy change (Task 15 surface), not a Hosting-config change, and
must be resolved before Task 17's smoke check can pass.
