import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createWeComSignature,
  decryptWeComMessage,
  encryptWeComMessage,
  verifyWeComSignature
} from "../src/wecom.js";

describe("verifyWeComSignature", () => {
  it("returns true for valid signature", () => {
    const token = "token1";
    const timestamp = "1700000000";
    const nonce = "nonce1";
    const encrypted = "encrypted-body";
    const signature = createHash("sha1")
      .update([token, timestamp, nonce, encrypted].sort().join(""), "utf8")
      .digest("hex");

    expect(
      verifyWeComSignature({
        token,
        timestamp,
        nonce,
        encrypted,
        signature
      })
    ).toBe(true);
  });

  it("returns false for invalid signature", () => {
    expect(
      verifyWeComSignature({
        token: "token1",
        timestamp: "1700000000",
        nonce: "nonce1",
        encrypted: "encrypted-body",
        signature: "bad"
      })
    ).toBe(false);
  });

  it("matches create signature helper", () => {
    const signature = createWeComSignature(
      "token1",
      "1700000000",
      "nonce1",
      "encrypted-body"
    );
    const expected = createHash("sha1")
      .update(["token1", "1700000000", "nonce1", "encrypted-body"].sort().join(""), "utf8")
      .digest("hex");
    expect(signature).toBe(expected);
  });

  it("supports encrypt/decrypt roundtrip", () => {
    const key = Buffer.alloc(32, 7).toString("base64").slice(0, 43);
    const plaintext = "success";
    const receiveId = "ww123456";
    const encrypted = encryptWeComMessage(plaintext, key, receiveId);
    const decrypted = decryptWeComMessage(encrypted, key);
    expect(decrypted).toBe(plaintext);
  });
});
