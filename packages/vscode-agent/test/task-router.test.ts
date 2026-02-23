import { describe, expect, it } from "vitest";
import { routeTaskIntent, sanitizeCommandCandidate } from "../src/nl/taskRouter.js";

describe("routeTaskIntent", () => {
  it.each([
    { input: "help", kind: "help" },
    { input: "show status", kind: "status" },
    { input: "fix login null pointer in src/auth/service.ts", kind: "change" },
    { input: "implement user profile endpoint", kind: "change" },
    { input: "refactor src/api/router.ts for readability", kind: "change" },
    { input: "add tests for src/nl/taskRouter.ts", kind: "change" },
    { input: "update readme and docs/usage.md", kind: "change" },
    { input: "run pnpm -r test", kind: "run" },
    { input: "execute npm run lint", kind: "run" },
    { input: "build project in packages/vscode-agent", kind: "run" },
    { input: "test with `pnpm test -- --watch=false`", kind: "run" },
    { input: "sync github repo", kind: "git_sync" },
    { input: "\u540c\u6b65\u9879\u76ee\u5230github", kind: "git_sync" },
    { input: "\u540c\u6b65 github \u4ed3\u5e93", kind: "git_sync" },
    { input: "why does this function throw", kind: "explain" },
    { input: "explain what does TaskEngine do", kind: "explain" },
    { input: "how does router confidence work", kind: "explain" },
    { input: "meaning of codex fallback mode", kind: "explain" },
    { input: "error: stacktrace in auth middleware", kind: "diagnose" },
    { input: "build failed in CI for eslint", kind: "diagnose" },
    { input: "exception when parsing json", kind: "diagnose" },
    { input: "find where router is defined", kind: "search" },
    { input: "locate task state machine", kind: "search" },
    { input: "search for requestApproval usage", kind: "search" },
    { input: "review this diff", kind: "review" },
    { input: "code review current changes", kind: "review" },
    { input: "check latest patch", kind: "review" },
    { input: "\u5ba1\u6838\u4ee3\u7801", kind: "review" },
    { input: "\u5ba1\u6821\u4ee3\u7801", kind: "review" }
  ])("routes '$input' to $kind", ({ input, kind }) => {
    const intent = routeTaskIntent(input);
    expect(intent.kind).toBe(kind);
  });

  it("extracts file hints", () => {
    const intent = routeTaskIntent("fix bug in src/auth/service.ts and src/auth/index.ts");
    expect(intent.params?.files).toContain("src/auth/service.ts");
    expect(intent.params?.files).toContain("src/auth/index.ts");
  });

  it("captures run command candidate", () => {
    const intent = routeTaskIntent("run pnpm test --filter @codexbridge/shared");
    expect(intent.kind).toBe("run");
    expect(intent.params?.cmd).toBe("pnpm test --filter @codexbridge/shared");
  });

  it("maps git sync requests to git_sync intent by default", () => {
    const intent = routeTaskIntent("\u8bf7\u540c\u6b65 github \u4ed3\u5e93");
    expect(intent.kind).toBe("git_sync");
    expect(intent.params?.mode).toBe("sync");
  });

  it("prioritizes git sync when review and sync are requested together", () => {
    const intent = routeTaskIntent("\u5ba1\u6838\u4ee3\u7801\u5e76\u540c\u6b65 github");
    expect(intent.kind).toBe("git_sync");
    expect(intent.params?.mode).toBe("sync");
  });

  it("keeps sync-from-github requests in git_sync intent", () => {
    const intent = routeTaskIntent("\u4ece github \u540c\u6b65\u5230\u672c\u5730");
    expect(intent.kind).toBe("git_sync");
    expect(intent.params?.mode).toBe("sync");
  });

  it("keeps explain intent for explanatory git sync requests", () => {
    const intent = routeTaskIntent("\u89e3\u91ca\u5982\u4f55\u540c\u6b65\u5230github");
    expect(intent.kind).toBe("explain");
  });

  it("normalizes full-width github text in sync requests", () => {
    const intent = routeTaskIntent("\u540c\u6b65\u5230\uff27\uff49\uff54\uff28\uff55\uff42");
    expect(intent.kind).toBe("git_sync");
    expect(intent.params?.mode).toBe("sync");
  });

  it("detects push-only git sync mode", () => {
    const intent = routeTaskIntent("only push to github");
    expect(intent.kind).toBe("git_sync");
    expect(intent.params?.mode).toBe("push_only");
  });

  it("detects commit-only git sync mode", () => {
    const intent = routeTaskIntent("only commit local changes to github repo");
    expect(intent.kind).toBe("git_sync");
    expect(intent.params?.mode).toBe("commit_only");
  });

  it("respects explicit git command when provided directly", () => {
    const intent = routeTaskIntent("git pull origin main");
    expect(intent.kind).toBe("run");
    expect(intent.params?.cmd).toBe("git pull origin main");
  });

  it("uses rebase pull when sync request asks for rebase", () => {
    const intent = routeTaskIntent("sync git repo with rebase");
    expect(intent.kind).toBe("git_sync");
    expect(intent.params?.mode).toBe("sync");
  });

  it("extracts search query", () => {
    const intent = routeTaskIntent("find approval gate implementation");
    expect(intent.kind).toBe("search");
    expect(intent.params?.query?.toLowerCase()).toContain("approval gate");
  });

  it("keeps dsl-like @dev test mapped as run", () => {
    const intent = routeTaskIntent("@dev test pnpm -r test");
    expect(intent.kind).toBe("run");
    expect(intent.params?.cmd).toBe("pnpm -r test");
  });

  it("maps strict dsl patch/plan/apply safely", () => {
    expect(routeTaskIntent("@dev patch add null guard").kind).toBe("change");
    expect(routeTaskIntent("@dev plan migrate module").kind).toBe("explain");
    expect(routeTaskIntent("@dev apply 123e4567-e89b-12d3-a456-426614174000").kind).toBe("review");
  });

  it("falls back to explain for ambiguous input", () => {
    const intent = routeTaskIntent("take a look at this");
    expect(intent.kind).toBe("explain");
    expect(intent.confidence).toBeLessThan(0.6);
  });

  it("falls back to change with low threshold override", () => {
    const intent = routeTaskIntent("unclear request", { confidenceThreshold: 0.4 });
    expect(intent.kind).toBe("change");
  });
});

describe("sanitizeCommandCandidate", () => {
  it("removes chained shell fragments", () => {
    expect(sanitizeCommandCandidate("pnpm test && rm -rf /")).toBe("pnpm test");
  });
});
