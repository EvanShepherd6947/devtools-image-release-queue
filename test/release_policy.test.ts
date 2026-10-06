import assert from "node:assert/strict";
import test from "node:test";
import { batchRequestSchema, enqueueBuild, releaseOperation } from "../src/release_workflow.js";

test("a stable build queues every asset and selects publication", async () => {
  const published: Array<{ payload: unknown; key: string }> = [];
  const client = {
    publish: async (payload: unknown, key: string) => {
      published.push({ payload, key });
      return {};
    },
  };
  const input = batchRequestSchema.parse({
    buildId: "build-42",
    release: { channel: "stable", commit: "8f3a2d1" },
    images: [
      { image: "https://assets.example/editor.png", assetName: "editor", width: 1280, height: 720 },
      { image: "https://assets.example/terminal.png", assetName: "terminal", width: 1280, height: 720 },
    ],
  });

  const event = await enqueueBuild(client as never, input);

  assert.equal(releaseOperation(input.release.channel), "publish");
  assert.deepEqual(event, {
    type: "build.images.queued",
    buildId: "build-42",
    releaseChannel: "stable",
    queued: 2,
  });
  assert.deepEqual(published.map(({ key }) => key), [
    "build:build-42:image:0",
    "build:build-42:image:1",
  ]);
});
