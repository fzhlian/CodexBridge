import process from "node:process";
import { createInterface } from "node:readline/promises";

export async function requireLocalConfirmation(question: string): Promise<boolean> {
  if (process.env.CODEXBRIDGE_AUTO_APPROVE === "1") {
    return true;
  }
  if (process.env.CODEXBRIDGE_AUTO_REJECT === "1") {
    return false;
  }
  if (!process.stdin.isTTY) {
    return false;
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const answer = await rl.question(`${question} [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

