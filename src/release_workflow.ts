import { z } from "zod";
import type { InfraiClient, QueueMessage, ResizeResult } from "./infrai_client.js";

export const batchRequestSchema = z.object({
  buildId: z.string().min(1),
  release: z.object({
    channel: z.enum(["preview", "stable"]),
    commit: z.string().min(7),
  }),
  images: z.array(z.object({
    image: z.string().min(1),
    assetName: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })).min(1).max(100),
});

export const queuedImageSchema = z.object({
  kind: z.literal("devtools.image.resize"),
  buildId: z.string(),
  release: z.object({ channel: z.enum(["preview", "stable"]), commit: z.string() }),
  image: z.string(),
  assetName: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export type BatchRequest = z.infer<typeof batchRequestSchema>;
export type QueuedImage = z.infer<typeof queuedImageSchema>;

export type BuildEvent = {
  type: "build.images.queued";
  buildId: string;
  releaseChannel: "preview" | "stable";
  queued: number;
};

export type ImageDiagnostic = {
  buildId: string;
  assetName: string;
  outcome: "ready" | "invalid-message";
  output?: ResizeResult;
  messageId: string;
};

export function releaseOperation(channel: "preview" | "stable"): "stage" | "publish" {
  return channel === "stable" ? "publish" : "stage";
}

export async function enqueueBuild(client: InfraiClient, input: BatchRequest): Promise<BuildEvent> {
  await Promise.all(input.images.map((image, index) => {
    const payload: QueuedImage = {
      kind: "devtools.image.resize",
      buildId: input.buildId,
      release: input.release,
      ...image,
    };
    return client.publish(payload, `build:${input.buildId}:image:${index}`);
  }));
  return {
    type: "build.images.queued",
    buildId: input.buildId,
    releaseChannel: input.release.channel,
    queued: input.images.length,
  };
}

export async function processMessage(client: InfraiClient, message: QueueMessage): Promise<ImageDiagnostic> {
  const parsed = queuedImageSchema.safeParse(message.payload);
  if (!parsed.success) {
    return {
      buildId: "unknown",
      assetName: "unknown",
      outcome: "invalid-message",
      messageId: message.message_id,
    };
  }

  const job = parsed.data;
  const output = await client.resize({
    image: job.image,
    width: job.width,
    height: job.height,
    fit: "cover",
    enlarge: false,
    format: "webp",
    store: true,
  }, `resize:${job.buildId}:${job.assetName}`);

  return {
    buildId: job.buildId,
    assetName: job.assetName,
    outcome: "ready",
    output,
    messageId: message.message_id,
  };
}
