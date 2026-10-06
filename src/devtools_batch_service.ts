import { createServer } from "node:http";
import { InfraiClient, InfraiError } from "./infrai_client.js";
import { batchRequestSchema, enqueueBuild, releaseOperation } from "./release_workflow.js";

const client = InfraiClient.fromEnvironment();
const port = Number(process.env.PORT ?? 3000);

async function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.method !== "POST" || request.url !== "/build-image-batches") {
    response.writeHead(404).end(JSON.stringify({ error: "Route not found" }));
    return;
  }

  try {
    const parsed = batchRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      response.writeHead(400).end(JSON.stringify({ error: "Invalid request", details: parsed.error.flatten() }));
      return;
    }
    const event = await enqueueBuild(client, parsed.data);
    response.writeHead(202).end(JSON.stringify({
      event,
      releaseOperation: releaseOperation(parsed.data.release.channel),
    }));
  } catch (error) {
    if (error instanceof SyntaxError) {
      response.writeHead(400).end(JSON.stringify({ error: "Request body must be JSON" }));
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      response.writeHead(status).end(JSON.stringify({ error: error.message, code: error.code }));
      return;
    }
    response.writeHead(502).end(JSON.stringify({ error: "Upstream request did not complete" }));
  }
});

server.listen(port, () => {
  console.log(`Devtools image batch service listening on http://localhost:${port}`);
});
