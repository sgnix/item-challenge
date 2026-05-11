# Architecture

## What's here

Three endpoints (`POST /api/items`, `GET /api/items/:id`, `GET /api/items`) implemented as Lambda-native handlers. The local HTTP server adapts Node requests into `APIGatewayProxyEventV2`, so the same handler runs locally and behind API Gateway. Dev uses in-memory storage; production would be DynamoDB. Infrastructure is in `infrastructure/` (AWS CDK). I picked three working endpoints over six partial ones; see "What I left out" below.

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
- List by subject (+ optional status filter, time-ordered) → `Query` on `gsi1` with `gsi1pk = SUBJECT#<subject>` and `begins_with(gsi1sk, "STATUS#<status>#")`, or no sk condition for all statuses.
- Audit trail for an item → `Query` on `pk = ITEM#<id>` with `begins_with(sk, "VERSION#")`.
- Create a new version → `TransactWriteItems` writing the new `CURRENT` and a `VERSION#<n>` row atomically, so a partial failure can't leave the item with a missing snapshot.

Padded version number (e.g. `VERSION#000001`) so lexical sort matches numeric sort up to 6 digits. Fine for this domain.

The `MemoryStorage` in `src/storage/memory.ts` follows the same logical access patterns (current state plus a version list per item). The DynamoDB port lives in `src/storage/dynamodb.ts`; the factory picks it up when `USE_DYNAMODB=true`. `createItem`, `getItem`, and `updateItem` are implemented. `listItems`, `createVersion`, and `getAuditTrail` are stubs that throw; see below.

## Infrastructure choices

- **HTTP API (API Gateway v2)** instead of REST API. Cheaper per request, lower latency, and we don't need REST API features (request validation models, usage plans, API keys). If those become needed later, switch.
- **One Lambda per route** rather than a monolith. IAM is read-only on the get/list functions and write-only on create. Bundles stay small (each ~60kb), and changes to one route don't redeploy the others. The price is three cold-start surfaces, acceptable on `arm64` with esbuild minification.
- **DynamoDB on-demand billing** because the workload shape is unknown. Switching to provisioned with autoscaling is a config change later if traffic stabilizes.
- **CloudWatch log retention** is 1 week for dev, 1 month for prod. CloudWatch is the most expensive line item if you forget to set retention.
- **Point-in-time recovery** on the table. Cheap insurance for a data store with versioned writes.
- **DynamoDB stream** is on (`NEW_AND_OLD_IMAGES`) but not consumed yet. It's a hook for emitting an audit log to S3 or feeding a search index later.

The CDK stack reads `env` from context (`-c env=prod`) and uses it to name resources and pick removal/retention policies. There's deliberately no separate `dev`/`prod` stack file; the differences are small and parameterizing a single stack is simpler.

## Security

- IAM grants are per-function: `grantWriteData` only on the create handler, `grantReadData` on get and list. No `*` actions.
- DynamoDB is encrypted at rest by default (AWS-owned KMS key), TLS in transit by default for both API Gateway and DynamoDB.
- The `securityLevel` field on items (`standard` / `secure` / `highly-secure`) is where access control would gate. Wiring an authorizer (Cognito, JWT, or a Lambda authorizer) into the HTTP API is the next step; not implemented here.
- No CORS allowlist on the deployed API. The local server returns `Access-Control-Allow-Origin: *` for convenience. Tighten before shipping.
- No rate limiting or WAF. With HTTP API, AWS WAF is added at the stage level when needed.

## Scalability notes

- DynamoDB partition key is `ITEM#<id>` where id is a UUID, which spreads load across partitions. The hot-spot risk is the GSI: subjects with many items concentrate on `SUBJECT#<subject>`. AP courses are a small enumerated set, so this becomes a concern at high item volumes. Mitigation: shard the GSI partition key (`SUBJECT#<subject>#<shard-suffix>`).
- Lambda is `arm64` for ~20% better price/perf vs x86. Memory is 512 MB, which Node startup is comfortable with; CloudWatch metrics will tell us whether to bump it.
- HTTP API has a default account-level throttle of 10k req/s; raise via support ticket before you'd need to.

## What I left out, and why

- **`PUT /api/items/:id`, `POST /api/items/:id/versions`, `GET /api/items/:id/audit`.** Time budget. The data model and `MemoryStorage` already support them; wiring the handlers is mechanical.
- **`listItems`, `createVersion`, and `getAuditTrail` on the DynamoDB layer.** The other three methods are implemented. These are mechanical translations of the access patterns above using the same `toCurrentRow`/`toVersionRow`/`stripKeys` helpers.
- **Authentication.** Out of scope for this exercise.
- **Integration tests against real AWS.** Vitest runs against `MemoryStorage`. To exercise the DynamoDB path locally I'd add a `dynamodb-local` container and a small `INTEGRATION_TEST=1` switch; same handler code, different storage backend.
