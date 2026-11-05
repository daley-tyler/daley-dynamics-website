# Development and deployment

## Local email checks

`npm run build && npm run check:site` exercises the actual Node endpoint and Nodemailer against a temporary local SMTP sink. The sink discards messages; the fixture uses `.invalid` addresses and no production credentials.

For manual form testing, run the sink in a separate terminal:

```bash
node scripts/mock-smtp-sink.mjs
```

Create an ignored `.env.local` with synthetic settings:

```dotenv
SMTP_HOST=127.0.0.1
SMTP_PORT=2525
SMTP_SECURE=false
ENQUIRY_TO_EMAIL=enquiries@example.invalid
ENQUIRY_FROM_EMAIL=website@example.invalid
ENQUIRY_ALLOWED_ORIGINS=http://127.0.0.1:5173
TRUST_PROXY=false
HOST=127.0.0.1
PORT=5173
```

Leave SMTP user and password unset for this sink. Run `npm run dev`, then submit synthetic details. The sink must remain bound to loopback and must never be used as a public email service.

## Production runtime

The site needs a Node-capable host to serve both `dist/` and `POST /api/enquiries` on the same origin. No hosting provider, domain or deployment is configured by this release.

1. Install a supported Node version and run `npm ci` and `npm run build`.
2. Retain `server/`, `package.json`, the lockfile, `dist/` and runtime dependencies. A separate runtime directory can use `npm ci --omit=dev`; development dependencies are required to build.
3. Inject `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, both enquiry mailbox variables, and SMTP authentication when required. Use the host's secret storage. `npm start` does not load `.env.local`.
4. Set `ENQUIRY_ALLOWED_ORIGINS` to the exact HTTPS origin, plus any explicitly approved additional origin. Set `HOST` and `PORT` as required by the host and run `npm start`.
5. Provide HTTPS through the host or reverse proxy. Set `TRUST_PROXY=true` only when that proxy replaces client-supplied forwarding headers and direct access to the Node listener is restricted.

The server returns HTML with `no-cache`. Fingerprinted JS, CSS and WOFF2 bundles receive immutable caching; public files with stable names must revalidate. Unknown routes return 404. Canonical page links end with `/`; directory URLs without that slash are not redirected automatically.

The limiter is in memory and resets on restart. Multiple instances need shared limiting or an upstream control. There is no enquiry database or delivery retry queue. A browser timeout can occur after SMTP accepted a message, so retrying may duplicate an enquiry. Configure mail authentication and delivery monitoring with the chosen provider, then test actual inbox delivery separately.

Before a business launch, review enquiry privacy text and retention, permitted public content, final domain, operational monitoring and proxy settings. Local and hosted validation do not establish production readiness or professional disclosure permission.

## GitHub Pages

[GitHub Pages is static hosting](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), so it cannot run this Node/SMTP endpoint. A static preview would require an explicit form strategy. The current root-relative links and asset URLs also assume deployment at `/`; a project site under `/daley-dynamics-website/` would require path changes beyond [Vite's base setting](https://vite.dev/guide/static-deploy.html#github-pages). A Node host is the closer fit for the existing implementation. Publishing source and launching the business website are separate decisions.
