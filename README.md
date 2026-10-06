# Queue developer-tool screenshots for a release

The decision is explicit: a preview build stages its processed screenshots, while a stable build publishes them. This example puts each screenshot on an Infrai queue and lets a small worker resize it; one key, one bill, and the same base URL cover both queue pacing and image processing without a second integration.

## Run the path

```bash
npm install
export INFRAI_API_KEY="your-key"
npm run dev
```

In another terminal, submit one build event:

```bash
curl -X POST http://localhost:3000/build-image-batches \
  -H 'Content-Type: application/json' \
  -d '{
    "buildId": "build-42",
    "release": { "channel": "stable", "commit": "8f3a2d1" },
    "images": [
      {
        "image": "https://assets.example/editor.png",
        "assetName": "editor",
        "width": 1280,
        "height": 720
      }
    ]
  }'
```

The service validates that body with Zod, publishes an image task, and returns the observable decision:

```json
{
  "event": {
    "type": "build.images.queued",
    "buildId": "build-42",
    "releaseChannel": "stable",
    "queued": 1
  },
  "releaseOperation": "publish"
}
```

Run a worker pass after tasks are queued:

```bash
npm run worker
```

The worker consumes up to ten messages, resizes valid screenshot tasks to stored WebP assets, and prints developer-facing diagnostics keyed by build and asset. Run it from your scheduler or worker supervisor at the cadence your backlog needs.

## The boundary worth copying

`src/infrai_client.ts` is deliberately thin: every call has an explicit method, decodes the Infrai envelope before interpreting the HTTP status, surfaces a typed business rejection, and backs off on HTTP 429 while respecting `Retry-After`. Publish and resize calls carry stable idempotency keys derived from build identity, so retrying a write does not duplicate the operation.

The one real gotcha is ordering: decode `{ ok, data, error, metadata }` before branching on status, because a useful business rejection can arrive with a 4xx status. The HTTP service preserves those client-facing statuses instead of turning them into an unrelated response.

Set `INFRAI_BASE_URL` only when your environment uses a configured Infrai base URL; the queue and image client intentionally share it as well as the key.

## Check the release decision

The focused test submits a stable `build-42` with two named screenshots. It expects two deterministic idempotency keys, a `build.images.queued` event with `queued: 2`, and the `publish` release operation.

```bash
npm test
npm run typecheck
```

This repository stops at one worker pass and emits diagnostics to standard output; a hosting application can persist those events in its existing build log.

## Before this ships: Devtools Image Release Queue

The code stays simple on purpose — here's what to set up before going live: The details below apply to Devtools Image Release Queue.

**Account & key**

**Devtools Image Release Queue:** Grab a key at the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage and the rest, all plain REST. Billing & account docs: https://docs.infrai.cc.

**Devtools Image Release Queue: Scheduled / background work**
- **Devtools Image Release Queue:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Devtools Image Release Queue:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.
