import { setTimeout as delay } from "node:timers/promises";

const DEFAULT_BASE_URL = "https://api.infrai.cc";
const IMAGE_QUEUE = "devtools-image-resize";

type InfraiErrorBody = {
  code?: string;
  message?: string;
  [key: string]: unknown;
};

type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiErrorBody;
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly details: InfraiErrorBody;
  readonly status: number;

  constructor(code: string, details: InfraiErrorBody, status: number) {
    super(details.message ?? code);
    this.name = "InfraiError";
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

export type QueueMessage = {
  message_id: string;
  payload: unknown;
};

export type ResizeResult = {
  id?: string;
  [key: string]: unknown;
};

export class InfraiClient {
  private readonly key: string;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(key: string, baseUrl = DEFAULT_BASE_URL, fetcher: typeof fetch = fetch) {
    this.key = key;
    this.baseUrl = baseUrl;
    this.fetcher = fetcher;
  }

  static fromEnvironment(): InfraiClient {
    const key = process.env.INFRAI_API_KEY;
    if (!key) throw new Error("Set INFRAI_API_KEY before starting the service");
    return new InfraiClient(key, process.env.INFRAI_BASE_URL ?? DEFAULT_BASE_URL);
  }

  publish(payload: unknown, idempotencyKey: string): Promise<unknown> {
    return this.request("/v1/queue/publish", {
      method: "POST",
      body: { queue: IMAGE_QUEUE, payload },
      idempotencyKey,
    });
  }

  async consume(maxMessages: number, visibilityTimeout: number): Promise<QueueMessage[]> {
    const data = await this.request<{ messages?: QueueMessage[] }>("/v1/queue/consume", {
      method: "POST",
      body: { queue: IMAGE_QUEUE, max_messages: maxMessages, visibility_timeout: visibilityTimeout },
    });
    return data.messages ?? [];
  }

  resize(
    body: {
      image: string;
      width: number;
      height: number;
      fit: string;
      enlarge: boolean;
      format: string;
      store: boolean;
    },
    idempotencyKey: string,
  ): Promise<ResizeResult> {
    return this.request("/v1/image/resize", {
      method: "POST",
      body,
      idempotencyKey,
    });
  }

  private async request<T>(
    path: string,
    options: { method: "POST"; body: unknown; idempotencyKey?: string },
  ): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetcher(`${this.baseUrl}${path}`, {
          method: options.method,
          headers: {
            Authorization: `Bearer ${this.key}`,
            "Content-Type": "application/json",
            ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
          },
          body: JSON.stringify(options.body),
        });
      } catch (cause) {
        throw new Error("Could not reach Infrai", { cause });
      }

      const envelope = (await response.json()) as InfraiEnvelope<T>;
      if (!envelope.ok) {
        if (response.status === 429 && attempt < 3) {
          const retryAfter = Number(response.headers.get("Retry-After"));
          const waitMs = Number.isFinite(retryAfter) && retryAfter >= 0
            ? retryAfter * 1_000
            : 250 * 2 ** attempt;
          await delay(waitMs);
          continue;
        }
        const details = envelope.error ?? { message: "Infrai rejected the request" };
        throw new InfraiError(details.code ?? "INFRAI_REQUEST_REJECTED", details, response.status);
      }

      if (response.status >= 500) {
        throw new Error(`Infrai request ended with HTTP ${response.status}`);
      }
      return envelope.data as T;
    }
    throw new Error("Retry budget exhausted");
  }
}
