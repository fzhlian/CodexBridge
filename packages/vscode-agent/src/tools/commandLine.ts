import path from "node:path";

export type ParsedVsixInstallCommand = {
  vsixPath: string;
  force: boolean;
};

export function parseVsixInstallCommand(commandText: string): ParsedVsixInstallCommand | undefined {
  const normalized = commandText.trim();
  if (!normalized) {
    return undefined;
  }
  const tokens = tokenizeCommandLine(normalized);
  if (tokens.length < 3) {
    return undefined;
  }
  const command = tokens[0]?.toLowerCase();
  if (command !== "code" && command !== "code.cmd" && command !== "code-insiders") {
    return undefined;
  }
  if ((tokens[1] || "").toLowerCase() !== "--install-extension") {
    return undefined;
  }
  const vsixPath = tokens[2]?.trim();
  if (!vsixPath) {
    return undefined;
  }
  const force = tokens.some((token) => token.toLowerCase() === "--force");
  return { vsixPath, force };
}

export function firstCommandToken(commandText: string): string | undefined {
  const tokens = tokenizeCommandLine(commandText.trim());
  return tokens[0];
}

export function resolveCommandPath(cwd: string, commandPath: string): string {
  if (path.isAbsolute(commandPath)) {
    return commandPath;
  }
  return path.resolve(cwd, commandPath);
}

export function quoteCommandArg(value: string): string {
  if (!/[\s"]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, "\\\"")}"`;
}

export function tokenizeCommandLine(text: string): string[] {
  const output: string[] = [];
  let current = "";
  let quote: "\"" | "'" | undefined;
  let escaping = false;

  const push = (): void => {
    if (!current) {
      return;
    }
    output.push(current);
    current = "";
  };

  for (const char of text) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      push();
      continue;
    }
    current += char;
  }
  push();
  return output;
}
