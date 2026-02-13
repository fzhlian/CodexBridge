import type { CommandKind } from "./protocol.js";

export type ParsedDevCommand = {
  kind: CommandKind;
  prompt?: string;
  refId?: string;
};

const DEV_PREFIX = "@dev";

export function parseDevCommand(input: string): ParsedDevCommand | null {
  const raw = input.trim();
  if (!raw.startsWith(DEV_PREFIX)) {
    return null;
  }

  const body = raw.slice(DEV_PREFIX.length).trim();
  if (!body) {
    return null;
  }

  const [keyword, ...rest] = body.split(/\s+/);
  const payload = rest.join(" ").trim();

  switch (keyword) {
    case "help":
    case "status":
      return { kind: keyword };
    case "test":
      return payload ? { kind: "test", prompt: payload } : { kind: "test" };
    case "plan":
    case "patch":
      if (!payload) {
        return null;
      }
      return { kind: keyword, prompt: payload };
    case "apply":
      if (!payload) {
        return null;
      }
      return { kind: "apply", refId: payload };
    default:
      return null;
  }
}
