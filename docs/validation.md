# Validation

Checked locally on 31 October 2026 with macOS, Node 24.11.1 and npm 11.6.2. The [published GitHub Actions run](https://github.com/daley-tyler/daley-dynamics-website/actions/runs/41178742656) also passed on Ubuntu with Node 22.23.4 and 24.22.1. Both jobs passed installation, lint, formatting, the build, all 23 backend tests and all six HTTP checks, without failed or skipped tests. These checks do not establish a production deployment or real inbox delivery.

| Check                     | Result                                                                                                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dependency installation   | Fresh `npm ci` succeeded with the reviewed lockfile.                                                                                                                                                                                  |
| JavaScript and formatting | ESLint and Prettier passed.                                                                                                                                                                                                           |
| Existing backend suite    | All 23 tests passed, without skips.                                                                                                                                                                                                   |
| Production build          | Vite 8.3.5 built all seven HTML entry points.                                                                                                                                                                                         |
| Built-site integration    | All six checks passed, including local SMTP acceptance and missing SMTP configuration.                                                                                                                                                |
| Links and resources       | All retained local HTML links, fragment targets and referenced built CSS resources resolved. Public images and the font notice were served successfully.                                                                              |
| Browser rendering         | All seven URLs rendered at widths of 320, 390, 768 and 1440 pixels without document-level horizontal overflow. No broken HTML images or missing form labels were found.                                                               |
| Keyboard and forms        | Mobile menu opening and Escape focus restoration passed. Escape with the menu closed preserved link focus. Native required-field validation, category preselection, unavailable feedback, status focus and retry availability passed. |
| Visual fallback           | The existing `effects=off&motion=reduce` switches retained readable content and selected the static background. The normal homepage also reached the live WebGL state.                                                                |
| Screenshots               | Actual local desktop and mobile homepage captures, stored in `docs/screenshots/`.                                                                                                                                                     |

The HTTP integration checks use the actual production Node server and Nodemailer with an isolated loopback SMTP sink. No production credentials are inherited and no external email is sent. They also cover cache behavior, HEAD requests, malformed URLs, missing pages, path traversal, unsupported methods, invalid input and origin rejection.

The initial sandbox run could not bind loopback listeners. The same checks passed when local listener access was allowed. This was an execution-environment restriction, not an application failure.

## Dependency audit

Vite was updated from 8.3.0 to 8.3.5, Nodemailer from 10.0.10 to 10.1.4, and transitive source-map-js from 1.2.1 to 1.2.2 after checking the reported advisories. Direct dependency versions are exact and the lockfile is committed.

The final npm audit reports no high or critical findings and no runtime dependency findings. Five moderate entries remain in the development-only ESLint/minimatch chain. These entries trace to one [minimatch denial-of-service advisory](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249); they are not five independent runtime defects. The installed minimatch is 10.2.6 and the reported fix is 11.0.1. ESLint and its configuration package still declare version 10 ranges. I have not forced an unsupported major override or accepted npm's suggested downgrade to ESLint 4. The linter runs only against this project's trusted source; a production install can omit dev dependencies after building.

## Limits

Actual SMTP authentication, relay TLS and inbox delivery were not tested. The browser form check used missing SMTP configuration; the local integration check exercised successful SMTP acceptance. No public deployment, real enquiry, client system or production service was used.

Browser checks used the in-app browser. They are basic responsive and accessibility checks, not a full WCAG, screen-reader, contrast or cross-browser audit. Reduced motion was exercised using the site's existing query switch. Node 22 and Linux validation passed in the hosted run linked above. No performance, uptime or professional project outcome is claimed from these checks.
