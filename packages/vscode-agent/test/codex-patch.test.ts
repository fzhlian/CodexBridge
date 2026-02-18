import { describe, expect, it } from "vitest";
import { decodeExecOutputBuffer } from "../src/codex-patch.js";

describe("decodeExecOutputBuffer", () => {
  it("keeps utf8 output on win32 auto mode", () => {
    const expected = "通过企业微信指令";
    const actual = decodeExecOutputBuffer(Buffer.from(expected, "utf8"), {
      platform: "win32",
      mode: "auto"
    });
    expect(actual).toBe(expected);
  });

  it("decodes gbk bytes on win32 auto mode", () => {
    const gbkBytes = Buffer.from([
      0xcd, 0xa8, 0xb9, 0xfd,
      0xc6, 0xf3, 0xd2, 0xb5,
      0xce, 0xa2, 0xd0, 0xc5,
      0xd6, 0xb8, 0xc1, 0xee
    ]);
    const actual = decodeExecOutputBuffer(gbkBytes, {
      platform: "win32",
      mode: "auto"
    });
    expect(actual).toBe("通过企业微信指令");
  });

  it("keeps utf8 decoding on non-windows in auto mode", () => {
    const gbkBytes = Buffer.from([0xcd, 0xa8, 0xb9, 0xfd]);
    const actual = decodeExecOutputBuffer(gbkBytes, {
      platform: "linux",
      mode: "auto"
    });
    expect(actual).toBe(gbkBytes.toString("utf8"));
  });
});
