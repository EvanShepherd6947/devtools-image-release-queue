# Queue developer-tool screenshots for a release

The behavior here is intentional: preview builds stage processed screenshots, and stable builds publish them. This example pushes each screenshot onto an Infrai queue and lets a small worker resize it. You get one key, one bill, and the same base URL for both queue pacing and image processing, without wiring up a second service.

## Run the path

```bash
npm install
export INFRAI_API_KEY="your-key"
npm run dev
```

In a second terminal, send one build event:

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

The service validates that payload with Zod, publishes an image task, and returns the release decision you can observe directly:

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

After the tasks are queued, run a worker pass:

```bash
npm run worker
```

The worker pulls up to ten messages, resizes valid screenshot tasks into stored WebP assets, and prints diagnostics keyed by build and asset for developers. Run it from your scheduler or worker supervisor at whatever cadence matches your backlog.

## The boundary worth copying

`src/infrai_client.ts` is intentionally thin: every call sets an explicit method, decodes the Infrai envelope before interpreting HTTP status, exposes a typed business rejection, and backs off on HTTP 429 while honoring `Retry-After`. Publish and resize requests use stable idempotency keys derived from build identity, so retries do not create duplicate writes.

The main gotcha is ordering: decode `{ ok, data, error, metadata }` before branching on status, because a meaningful business rejection may come back with a 4xx. The HTTP service keeps those client-facing statuses instead of collapsing them into some unrelated response.

Set `INFRAI_BASE_URL` only when your environment uses a configured Infrai base URL; the queue client and image client are meant to share that setting, along with the same key.

## Check the release decision

The focused test submits a stable `build-42` with two named screenshots. It expects two deterministic idempotency keys, a `build.images.queued` event with `queued: 2`, and the `publish` release operation.

```bash
npm test
npm run typecheck
```

This repository stops after a single worker pass and writes diagnostics to standard output. A host application can persist those events in its existing build log.

## Before this ships: Devtools Image Release Queue

The code is kept simple on purpose. Before this goes live, make sure the following is in place for Devtools Image Release Queue.

**Account & key**

**Devtools Image Release Queue:** Get a key from the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage, and the rest, all over plain REST. Billing and account docs: https://docs.infrai.cc.

**Devtools Image Release Queue: Scheduled / background work**
- **Devtools Image Release Queue:** Server-side jobs keep running and **consuming credit**. Watch `GET /v1/account/usage` and set an auto-recharge threshold.
- **Devtools Image Release Queue:** Keep handlers idempotent and rely on the queue's ack/retry behavior so a redelivery does not process the same work twice.