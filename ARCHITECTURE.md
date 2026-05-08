# Architecture

## What's here

Three endpoints — `POST /api/items`, `GET /api/items/:id`, `GET /api/items` — implemented as Lambda-native handlers and exercised by a local HTTP server that adapts Node requests into `APIGatewayProxyEventV2` so the handlers run identically locally and behind API Gateway. The dev server uses in-memory storage; production storage would be DynamoDB. Infrastructure is defined with AWS CDK in `infrastructure/`. I prioritized making fewer endpoints work end-to-end over partially shipping all six — see "What I left out" below.

Run:

```bash
pnpm install && pnpm test          # 14 tests
pnpm dev                           # http://localhost:3000
cd infrastructure && pnpm install --ignore-workspace && npx cdk synth
```

## Data model

Single-table DynamoDB, partition key `pk`, sort key `sk`.

| Entity | pk | sk |
|---|---|---|
| Current item | `ITEM#<id>` | `CURRENT` |
| Version snapshot | `ITEM#<id>` | `VERSION#<padded-version>` |

GSI `gsi1`:

| | gsi1pk | gsi1sk |
|---|---|---|
| Item | `SUBJECT#<subject>` | `STATUS#<status>#<lastModified>` |

Access patterns:

- Get item by id → `GetItem` on (`ITEM#<id>`, `CURRENT`).
- List by subject (+ optional status filter, time-ordered) → `Query` on `gsi1` with `gsi1pk = SUBJECT#<subject>` and `begins_with(gsi1sk, "STATUS#<status>#")` or no condition for all statuses.
- Audit trail for an item → `Query` on `pk = ITEM#<id>` with `begins_with(sk, "VERSION#")`.
- Create a new version → `TransactWriteItems` writing the new `CURRENT` and a `VERSION#<n>` row atomically, so a partial failure can't leave the item with a missing snapshot.

Padded version number (e.g. `VERSION#000001`) so lexical sort matches numeric sort up to 6 digits — fine for this domain.

The `MemoryStorage` in `src/storage/memory.ts` follows the same logical access patterns (current state plus a version list per item) so the production layer is a mechanical port. I didn't ship that port — see below.

## Infrastructure choices

- **HTTP API (API Gateway v2)** instead of REST API. Lower per-request cost, lower latency, simpler IAM. We don't need request validation models, usage plans, or API keys here; if those become needed later, REST API is the right move.
- **One Lambda per route** rather than a monolith. IAM is read-only on the get/list functions and write-only on create. Bundles stay small (each ~60kb), and changes to one route don't redeploy the others. The cost is three cold-start surfaces — acceptable on `arm64` with esbuild minification.
- **DynamoDB on-demand billing** because the workload shape is unknown. Switching to provisioned with autoscaling is a flip-of-a-switch later if traffic stabilizes.
- **CloudWatch log retention** is 1 week for dev, 1 month for prod. CloudWatch is the most expensive line item if you forget to set retention.
- **Point-in-time recovery** on the table. Cheap insurance for a data store with versioned writes.
- **DynamoDB stream** is on (`NEW_AND_OLD_IMAGES`) but not consumed yet; it's the obvious hook for emitting an audit log to S3 or fanning out to a search index.

The CDK stack reads `env` from context (`-c env=prod`) and uses it to name resources and pick removal/retention policies. There's deliberately no separate `dev`/`prod` stack file — the differences are small and parameterizing a single stack reads better.

## Security

- IAM grants are per-function: `grantWriteData` only on the create handler, `grantReadData` on get and list. No `*` actions.
- DynamoDB is encrypted at rest by default (AWS-owned KMS key), TLS in transit by default for both API Gateway and DynamoDB.
- The `securityLevel` field on items is the natural place to gate access (`standard` / `secure` / `highly-secure`). Wiring an authorizer (Cognito, JWT, or a Lambda authorizer) into the HTTP API is the next step; not implemented here.
- No CORS allowlist on the deployed API — the local server returns `Access-Control-Allow-Origin: *` for convenience. Tighten before shipping.
- No rate limiting or WAF. With HTTP API, AWS WAF is added at the stage level when needed.

## Scalability notes

- DynamoDB partition key is `ITEM#<id>` where id is a UUID, which spreads load uniformly. The hot-spot risk is the GSI: subjects with many items concentrate on `SUBJECT#<subject>`. AP courses are a small enumerated set, so this is a real concern at scale. Mitigation if it becomes a problem: shard the GSI partition key (`SUBJECT#<subject>#<shard-suffix>`).
- Lambda is `arm64` for ~20% better price/perf vs x86. Memory is 512 MB — Node startup is happy there, and bumping it later is observable from CloudWatch metrics rather than guesswork.
- HTTP API has a default account-level throttle of 10k req/s; raise via support ticket before you'd need to.

## What I left out, and why

- **`PUT /api/items/:id`, `POST /api/items/:id/versions`, `GET /api/items/:id/audit`.** Time budget. The data model and `MemoryStorage` already support them; wiring the handlers is mechanical.
- **The DynamoDB storage layer.** README marks it as optional. The schema design above is the load-bearing artifact; the implementation is straightforward marshalling + the access patterns listed.
- **Authentication.** Out of scope for this exercise; called out as the next step.
- **Integration tests against real AWS.** Vitest runs against `MemoryStorage`. To exercise the DynamoDB path locally I'd add a `dynamodb-local` container and a small `INTEGRATION_TEST=1` switch — same handler code, different storage backend.
- **Custom domain, WAF, observability dashboards.** Standard add-ons for a real deployment but not needed to validate the design.
