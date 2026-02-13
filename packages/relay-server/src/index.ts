import { createRelayServer } from "./router.js";

const host = process.env.RELAY_HOST ?? "0.0.0.0";
const port = Number(process.env.RELAY_PORT ?? "8787");

const app = createRelayServer();

void app.listen({ host, port }).then(() => {
  app.log.info({ host, port }, "relay server started");
});

