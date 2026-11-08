# Dashboard UI (web)

Standalone read-only dashboard SPA (React + Vite + TypeScript). Deployed to Firebase
Hosting. Under the public-data model the SPA reads a single static JSON snapshot
(`dashboard.json`) that the Cloud Run Job writes at the end of each daily run — there is no
read-proxy, no `/api` rewrite, and no authentication gate, and the SPA holds no credential
(simplify-to-cloud-minimal R4, R5).

## Local development

```bash
npm install
npm run dev
```

`npm run dev` starts the Vite dev server. The SPA fetches ONE static `dashboard.json` snapshot
(`loadSnapshot()` in `src/api/snapshot.ts`). The URL is `VITE_SNAPSHOT_URL`, baked in at build
time: the deployed bundle points at the public GCS bucket (cross-origin), while an unset value
falls back to the same-origin `/dashboard.json`, which is what local dev and preview use - place a
copy in the served root. The format is documented in `../docs/DASHBOARD-SNAPSHOT-CONTRACT.md`. The rest of the app
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
- Catch-all `**` rewrite → `/index.html` for SPA client-side routing fallback. There is NO
  `/api` rewrite — the read-proxy has been removed; the SPA fetches the static
  `dashboard.json` the Job publishes.
- Strict CSP and security headers applied to all responses
  (`Content-Security-Policy` with `connect-src 'self'` so the same-origin snapshot fetch is
  allowed, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`).

The target Firebase project is `trade-assistant-508806` (`.firebaserc` `projects.default`).

> The sections below are a historical record of past live-cloud operator actions from when
> the read-proxy was still deployed. They are retained for provenance; the read-proxy service
> and its GCP resources are removed by the simplify-to-cloud-minimal spec (code removal in
> Phase 5; the live GCP resource deletion is a separate operator-approved task).

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

Task 17's full smoke check (serving the latest Decision_Date) now passes — see the
"Task 17 read-only smoke verification" section below.

## Task 17 read-only smoke verification — dashboard-data-activation Task 16 (LIVE CLOUD, Req 10)

Post-activation read-only smoke verification of `dashboard-ui` Task 17 against real
hosted data produced by the Gate_Run (dashboard-data-activation Task 10) and the daily
re-run (Task 11), performed under the Live Cloud Execution Protocol (operator-approved).
Read-only HTTP checks only — no writes, no permission changes, no secrets. Non-secret
references only.

Reconciliation (performed before the live checks):

- Active gcloud project `trade-assistant-508806` matches `GCP_PROJECT_ID`; active account
  `allum.phil@gmail.com`.
- Resolved Supabase target `hosted` (`SUPABASE_TARGET=hosted`).
- Public URLs: `https://app.teamhandso.me` (custom domain) and
  `https://trade-assistant-508806.web.app` (Firebase default); `/api/**` rewrite → the
  `dashboard-read-proxy` Cloud Run service, revision `dashboard-read-proxy-00002-k6c`,
  region `europe-west1`.

Results (all three checks hold):

1. **Serves the latest firing Decision_Date (Req 10.1):** `GET /api/decision-dates`
   returns HTTP 200 with `v_decision_dates` → `{"decision_date":"2026-09-14"}` on both
   the custom and default domains. `GET /api/firing-setups?decisionDate=2026-09-14`
   returns HTTP 200 with one real `v_firing_setups` row (pair `USDJPY`, direction `DOWN`,
   horizon 1, `earned_confidence` ≈ 0.571, `surfaced: true`) — a real firing setup from
   recorded verdicts, not forced.
2. **Rejects a write with HTTP 405 (Req 10.2):** `POST`, `DELETE`, and `PUT` to the `/api`
   endpoints each return HTTP 405 (confirmed on both domains).
3. **Rejects a disallowed query/resource with 400 or 404 (Req 10.3):** an unknown path
   (`/api/not-a-real-endpoint`) returns HTTP 404; a known endpoint with an invalid param
   value (`decisionDate=not-a-date`) returns HTTP 400; a disallowed param name
   (`decision_date=…`) returns HTTP 400.

**Activation complete (Req 10.4):** the public URL serves a real Decision_Date AND the
Read_Proxy rejects a write with 405 AND rejects a disallowed query with 400/404. The
checks pass because real recorded verdicts produced a real firing Decision_Date — the
Read_Proxy firing logic, the gate math, and the `fires()` predicate were not modified to
force them (Req 10.5).

## Invoker review — Task 14 (LIVE CLOUD, Req 7, Req 9)

`allUsers` `roles/run.invoker` review on the `dashboard-read-proxy` Cloud Run
service, performed under the Live Cloud Execution Protocol (operator-approved).
Non-secret references only.

Reconciliation (performed before any live inspection):

- Active gcloud project `trade-assistant-508806` matches `GCP_PROJECT_ID`; active
  account `allum.phil@gmail.com` (sole authenticated identity).
- Resolved Supabase target `hosted` (`SUPABASE_TARGET=hosted`), hosted project ref
  `bffzhjnpzxxuqvmnmylk` reachable.
- Service: `dashboard-read-proxy`, region `europe-west1`, latest ready revision
  `dashboard-read-proxy-00002-k6c`, URL
  `https://dashboard-read-proxy-uy5jewntfq-ew.a.run.app`, ingress `all`.

Current invoker posture (inspected read-only via
`gcloud run services get-iam-policy dashboard-read-proxy`): a single binding —
`roles/run.invoker` → `allUsers`. No other invoker bindings exist.

**Decision: RETAIN `allUsers` `roles/run.invoker`, with documented justification
(Req 7.6).** A named least-privilege Invoker_Identity is NOT reliably workable for
the Firebase Hosting `/api` rewrite path on this project. Firebase Hosting rewrites
to Cloud Run issue server-side fetches that arrive unauthenticated at the Cloud Run
IAM layer — they do not present a per-service-account OIDC token Cloud Run IAM can
authorize as a named principal. The project has no `firebasehosting` service agent
that could be bound as a scoped invoker (only the Firebase Admin SDK SA
`firebase-adminsdk-fbsvc@…` and the general Firebase service agent
`service-794110228539@gcp-sa-firebase…` exist, neither of which is the Hosting
rewrite's edge-fetch identity). Replacing `allUsers` with a scoped service account
would cause Cloud Run IAM to reject the Hosting rewrite (403), leaving the public
`/api` path unreachable — so a working invoker configuration is retained (Req 7.6).

Because the review does not change the posture, no permission-reducing IAM command
was executed. For the record, the permission-reducing command that WOULD apply a
scoped-identity replacement (NOT executed) is, with its distinguishable warning:

> ⚠️ PERMISSION-REDUCING IAM CHANGE — affected resource:
> `dashboard-read-proxy` (Cloud Run, region `europe-west1`); effect: removes the
> public `allUsers` `roles/run.invoker` grant and replaces it with a scoped
> service account. This would break the public `/api` rewrite on this project —
> DO NOT RUN. Shown for provenance only; requires explicit operator approval.
>
> ```
> gcloud run services remove-iam-policy-binding dashboard-read-proxy \
>   --project trade-assistant-508806 --region europe-west1 \
>   --member=allUsers --role=roles/run.invoker
> gcloud run services add-iam-policy-binding dashboard-read-proxy \
>   --project trade-assistant-508806 --region europe-west1 \
>   --member=serviceAccount:<scoped-invoker-sa>@trade-assistant-508806.iam.gserviceaccount.com \
>   --role=roles/run.invoker
> ```

App-level protections are preserved regardless of invoker posture (Req 7.3) — the
IAM binding is unchanged, and the Read_Proxy request-layer enforcement
(`services/read-proxy/src/app.ts`) is untouched: GET-only (405 on non-GET), the
read-only select-only endpoint Allowlist (`buildQueryForPath` → 400/404 before any
DB round-trip), the per-IP + global rate limit (429), the CSP + security headers on
every response, and the SELECT-only Supabase read transport.

End-to-end `/api` confirmation (posture unchanged, so already working): `GET
/api/decision-dates` returns HTTP 200 through the custom domain
`https://app.teamhandso.me`, the Firebase default domain
`https://trade-assistant-508806.web.app`, and the direct Cloud Run URL.
