# Supplier Management — Supplier Onboarding & Approval

CodeUp Praktikum case study (4th season). One CAP (Node.js) backend serves two freestyle SAPUI5 apps:

| App | Users | Authentication |
|---|---|---|
| **Supplier Portal** (`app/portal`) | external suppliers | own accounts (bcrypt) + session token |
| **Supplier Approvals** (`app/approvals`) | internal approvers | XSUAA, scope `Approval` |

Both apps open as tiles in a local Fiori launchpad (`app/index.html`) and every request goes through the approuter on **:5000**.

## Architecture

```
Browser ──► Approuter :5000 ──────────────────────────────► CAP :4004 ──► SQLite
            │  xs-app.json: route order decides who may pass     │
            │   1. supplier actions + certificate PUT  -> none   ├─ @requires 'any'  (supplier side)
            │   2. everything else under /odata/v4/supplier      ├─ @restrict / @requires 'Approval'
            │                       -> xsuaa + scope Approval    │   (approver side)
            │   3. /approvals/*     -> xsuaa + scope Approval    │
            │   4. /portal/*        -> none                      └─ analyzeWithAI ──► Destination
            │   5. launchpad        -> xsuaa (user in header)          "openrouter-api" ──► OpenRouter LLM
            └─ XSUAA (BTP) login, JWT forwarded to CAP
```

**Security is enforced twice** (defense in depth):
1. **Approuter** (`approuter/xs-app.json`): only the listed public supplier paths are reachable without login. Routes are evaluated top-down, so the narrow public routes come *before* the catch-all `xsuaa` route. Anything not explicitly public (also a public path with an unexpected query string) falls through to `xsuaa` + `$XSAPPNAME.Approval`.
2. **CAP** (`srv/supplier-service.cds`): `@requires: 'any'` on supplier actions, `@restrict … to: 'Approval'` on `Suppliers` and its bound actions, `@requires: 'Approval'` on `getStatusCounts`. Even if a route were misconfigured, CAP still rejects approver calls without the role.

Suppliers are **not** BTP users. `register`/`login` return a random 256-bit token; only its SHA-256 hash is stored (`SupplierSessions`), it is sent back in the `X-Supplier-Token` header, and `logout` deletes it.

### Data model (`db/schema.cds`)
- `SupplierAccounts` – e-mail (unique) + bcrypt hash
- `SupplierSessions` – token hash, account, expiry (8 h)
- `Suppliers` – the application (form fields, status, decision audit trail, certificate as media data)

Status lifecycle: `DRAFT → SUBMITTED → IN_REVIEW → APPROVED | REJECTED → (re-apply) SUBMITTED`.
Drafts are invisible to approvers (`where status != 'DRAFT'` in the projection).

### Validation — frontend **and** backend
| Rule | UI | Backend (`srv/supplier-service.js`) |
|---|---|---|
| unique e-mail | message on the field | `409 EMAIL_ALREADY_EXISTS` (+ unique constraint for races) |
| strong password | live checklist, turns green per rule | same 5 regex rules, `400 PASSWORD_WEAK` |
| wrong login | one generic message | same message for unknown e-mail / wrong password, constant-time compare |
| required fields | `*` labels, value states | `400 COMPANY_NAME_REQUIRED`, `CONTACT_PERSON_REQUIRED`, `CERTIFICATE_REQUIRED` |
| PDF only | `fileType` + `mimeType` on FileUploader | `Content-Type` **and** magic bytes `%PDF-` → `415` |
| max 10 MB | `maximumFileSize` | `Content-Length` check + hard limit while reading the stream → `413` |
| reject needs comment | value state on TextArea | `400 REJECTION_COMMENT_REQUIRED` |
| re-apply | only requested fields editable | changes to other fields → `403 FIELD_NOT_REVISABLE`; new certificate required if requested |
| double decision | — | atomic `UPDATE … WHERE status IN (SUBMITTED, IN_REVIEW)` → `409 ALREADY_DECIDED` |

All backend messages are translated (`_i18n/messages*.properties`, chosen by `Accept-Language`).

### AI analysis
`analyzeWithAI` (bound action) extracts the PDF text (`pdf-parse`), sends it with the applicant data to an LLM through the CAP remote service `openrouter`, which only knows the **destination name** `openrouter-api` (URL + API key live in the BTP destination).
- **Timeout** `requestTimeout: 20000` per call
- **Retry** up to 3 attempts with exponential backoff, only for transient errors (timeouts, 429, 5xx) and invalid model output
- **Output validation**: the answer must be JSON `{decision: APPROVE|REJECT, reason}`; anything else is retried / rejected
- **Prompt-injection guard**: the certificate text is delimited and declared as untrusted data
- No text layer (scanned PDF) → `422 AI_NO_TEXT`; AI down → `502 AI_UNAVAILABLE` → approver decides manually
- A rejection by the AI writes the reason as rejection comment, so the supplier always sees why

### UI
- Standard SAPUI5 controls and theme only, **no custom CSS**
- All texts from i18n (`en`, `tr`), language follows the browser automatically — no language switch
- Process flow (`sap.suite.ui.commons.ProcessFlow`): *Submitted → In review → Result*, same component logic in both apps
- Approvals: IconTabBar status tabs with counts, search (company / contact / e-mail), settings dialog (category filter, sorting, show/hide 12 columns), "Clear filters" button visible only while a filter is active

## Run locally

Prerequisites: Node.js 22+, `npm i -g @sap/cds-dk`.

```bash
npm install
npm install --prefix approuter
```

**Development (no BTP):** `npm run watch` → http://localhost:4004 — mocked users `approver/approver` (role Approval) and `norole/norole`.
`npm run seed` creates demo applications, `npm run test:api` runs the backend scenario test (success + failure cases).

**Hybrid (real XSUAA, as required):** see [docs/KURULUM.md](docs/KURULUM.md), then

```bash
npm run watch:hybrid     # terminal 1: CAP on :4004 with XSUAA + destination bindings
npm run router:hybrid    # terminal 2: approuter on :5000
```

Open http://localhost:5000.

## Project structure

```
db/schema.cds                 data model
srv/supplier-service.cds      service + authorization annotations
srv/supplier-service.js       handlers (auth, validation, upload, decisions)
srv/lib/ai-analyzer.js        PDF text extraction, LLM call (timeout/retry/validation)
_i18n/                        backend messages (en, tr)
app/index.html                local Fiori launchpad (ushell sandbox)
app/appconfig/                tiles + target resolution
app/portal/webapp             Supplier Portal (UI5 freestyle)
app/approvals/webapp          Supplier Approvals (UI5 freestyle)
approuter/xs-app.json         routes (public vs. xsuaa vs. scope)
xs-security.json              scope, role template, role collection
test/files                    sample PDFs for the demo (valid, expired, unrelated, > 10 MB, fake PDF)
test/requests.http            backend checks without the UI
scripts/                      seed + API scenario test
```
