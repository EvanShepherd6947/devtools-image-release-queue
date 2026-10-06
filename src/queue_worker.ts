import { InfraiClient } from "./infrai_client.js";
import { processMessage } from "./release_workflow.js";

const client = InfraiClient.fromEnvironment();
const messages = await client.consume(10, 60);
const diagnostics = await Promise.all(messages.map((message) => processMessage(client, message)));

console.log(JSON.stringify({ event: "build.images.processed", diagnostics }, null, 2));
