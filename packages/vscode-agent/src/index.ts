import { RelayAgent } from "./agent.js";

const relayBase = process.env.RELAY_WS_URL ?? "ws://127.0.0.1:8787/agent";
const machineId = process.env.MACHINE_ID ?? "local-dev-machine";

const agent = new RelayAgent({
  relayUrl: relayBase,
  machineId
});

agent.start();
