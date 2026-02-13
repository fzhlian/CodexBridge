import { describe, expect, it } from "vitest";
import { buildWeComEncryptedReplyXml, parseWeComXml } from "../src/wecom-xml.js";

describe("parseWeComXml", () => {
  it("parses plain text message fields", () => {
    const xml = `
      <xml>
        <ToUserName><![CDATA[toUser]]></ToUserName>
        <FromUserName><![CDATA[fromUser]]></FromUserName>
        <CreateTime>1700000000</CreateTime>
        <MsgType><![CDATA[text]]></MsgType>
        <Content><![CDATA[@dev status]]></Content>
        <MsgId>123456</MsgId>
      </xml>
    `;
    const parsed = parseWeComXml(xml);
    expect(parsed.fromUserName).toBe("fromUser");
    expect(parsed.content).toBe("@dev status");
    expect(parsed.msgId).toBe("123456");
  });

  it("parses encrypted callback envelope", () => {
    const xml = "<xml><Encrypt><![CDATA[abc]]></Encrypt></xml>";
    const parsed = parseWeComXml(xml);
    expect(parsed.encrypt).toBe("abc");
  });

  it("builds encrypted reply xml", () => {
    const xml = buildWeComEncryptedReplyXml({
      encrypt: "enc",
      signature: "sig",
      timestamp: "1700000000",
      nonce: "nonce1"
    });
    expect(xml).toContain("<Encrypt><![CDATA[enc]]></Encrypt>");
    expect(xml).toContain("<MsgSignature><![CDATA[sig]]></MsgSignature>");
    expect(xml).toContain("<TimeStamp>1700000000</TimeStamp>");
  });
});
