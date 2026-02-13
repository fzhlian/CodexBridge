import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

type VerifyInput = {
  token: string;
  timestamp: string;
  nonce: string;
  encrypted: string;
  signature: string;
};

export function verifyWeComSignature(input: VerifyInput): boolean {
  const digest = createWeComSignature(
    input.token,
    input.timestamp,
    input.nonce,
    input.encrypted
  );
  return digest === input.signature;
}

export function createWeComSignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypted: string
): string {
  const values = [token, timestamp, nonce, encrypted].sort();
  return createHash("sha1").update(values.join(""), "utf8").digest("hex");
}

export function decryptWeComMessage(encryptedBase64: string, encodingAesKey: string): string {
  const key = decodeEncodingAesKey(encodingAesKey);
  const iv = key.subarray(0, 16);
  const encrypted = Buffer.from(encryptedBase64, "base64");

  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(false);
  const deciphered = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  const plain = pkcs7Unpad(deciphered);

  if (plain.length < 20) {
    throw new Error("invalid decrypted payload");
  }
  const msgLen = plain.readUInt32BE(16);
  const msgStart = 20;
  const msgEnd = msgStart + msgLen;
  if (msgEnd > plain.length) {
    throw new Error("invalid message length");
  }
  return plain.subarray(msgStart, msgEnd).toString("utf8");
}

export function encryptWeComMessage(
  message: string,
  encodingAesKey: string,
  receiveId: string
): string {
  const key = decodeEncodingAesKey(encodingAesKey);
  const iv = key.subarray(0, 16);

  const random16 = randomBytes(16);
  const msgBuffer = Buffer.from(message, "utf8");
  const msgLen = Buffer.alloc(4);
  msgLen.writeUInt32BE(msgBuffer.length, 0);
  const receiveIdBuf = Buffer.from(receiveId, "utf8");
  const raw = Buffer.concat([random16, msgLen, msgBuffer, receiveIdBuf]);
  const padded = pkcs7Pad(raw, 32);

  const cipher = createCipheriv("aes-256-cbc", key, iv);
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);
  return encrypted.toString("base64");
}

function decodeEncodingAesKey(key: string): Buffer {
  const normalized = key.trim();
  if (normalized.length !== 43) {
    throw new Error("encoding aes key should be 43 chars");
  }
  return Buffer.from(`${normalized}=`, "base64");
}

function pkcs7Unpad(buf: Buffer): Buffer {
  const pad = buf[buf.length - 1];
  if (pad <= 0 || pad > 32) {
    throw new Error("invalid pkcs7 padding");
  }
  for (let i = buf.length - pad; i < buf.length; i += 1) {
    if (buf[i] !== pad) {
      throw new Error("invalid pkcs7 padding bytes");
    }
  }
  return buf.subarray(0, buf.length - pad);
}

function pkcs7Pad(buf: Buffer, blockSize: number): Buffer {
  const remainder = buf.length % blockSize;
  const pad = remainder === 0 ? blockSize : blockSize - remainder;
  const padding = Buffer.alloc(pad, pad);
  return Buffer.concat([buf, padding]);
}
