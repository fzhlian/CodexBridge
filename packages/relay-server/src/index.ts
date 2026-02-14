import { createRelayServer } from "./router.js";

const host = process.env.RELAY_HOST ?? "0.0.0.0";
const port = Number(process.env.RELAY_PORT ?? "8787");

void (async () => {
  const app = await createRelayServer();
  await app.listen({ host, port });
  app.log.info({ host, port }, "relay server started");
})().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error("[relay-server] startup failed", message);
  process.exitCode = 1;
});
