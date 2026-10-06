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

- Public Hosting URLs: the default Firebase domain `https://trade-assistant-508806.web.app`
  and the custom domain `https://app.teamhandso.me`. Both serve the same SPA (root returns
  HTTP 200) with the same strict CSP + `X-Content-Type-Options` + `Referrer-Policy` +
  `X-Frame-Options` headers from `firebase.json`.
- Rewrite target: `dashboard-read-proxy` Cloud Run service, region `europe-west1`
  (Ready=True), URL `https://dashboard-read-proxy-uy5jewntfq-ew.a.run.app`.
- Invoker binding: the proxy was deployed authenticated-only, so the `/api/**` rewrite
  returned 403. Firebase Hosting→Cloud Run rewrites authenticate at the edge as `allUsers`
  (there is no `firebasehosting` service agent in this project to bind). With operator
  approval, `roles/run.invoker` was granted to `allUsers` on `dashboard-read-proxy`; the
  rewrite then reached the proxy application. The proxy retains its endpoint allowlist,
  SELECT-only queries, rate limiting, CSP, and the SELECT-only `dashboard_reader` DB role.

### Resolved: `/api` prefix normalization

The `/api` prefix mismatch was fixed in `services/read-proxy/src/app.ts` via `stripApiPrefix`,
which strips a single leading `/api` segment before allowlist resolution; this is covered by
`services/read-proxy/src/apiPrefix.test.ts`. Redeployed as proxy revision
`dashboard-read-proxy-00002-k6c`. `GET /api/decision-dates` through the rewrite now returns
HTTP 200 end-to-end (rows may be empty until a run is persisted to hosted Supabase).

Task 17's full smoke check (serving the latest Decision_Date) still requires at least one
persisted run in hosted Supabase.
