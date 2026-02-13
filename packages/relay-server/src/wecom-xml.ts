export type WeComXmlMessage = {
  toUserName?: string;
  fromUserName?: string;
  createTime?: string;
  msgType?: string;
  content?: string;
  msgId?: string;
  encrypt?: string;
};

export function parseWeComXml(xml: string): WeComXmlMessage {
  const normalized = xml.trim();
  return {
    toUserName: readTag(normalized, "ToUserName"),
    fromUserName: readTag(normalized, "FromUserName"),
    createTime: readTag(normalized, "CreateTime"),
    msgType: readTag(normalized, "MsgType"),
    content: readTag(normalized, "Content"),
    msgId: readTag(normalized, "MsgId"),
    encrypt: readTag(normalized, "Encrypt")
  };
}

export function isLikelyXml(input: string): boolean {
  return /^\s*</.test(input);
}

export function buildWeComEncryptedReplyXml(input: {
  encrypt: string;
  signature: string;
  timestamp: string;
  nonce: string;
}): string {
  return [
    "<xml>",
    `<Encrypt><![CDATA[${escapeCdata(input.encrypt)}]]></Encrypt>`,
    `<MsgSignature><![CDATA[${escapeCdata(input.signature)}]]></MsgSignature>`,
    `<TimeStamp>${escapeText(input.timestamp)}</TimeStamp>`,
    `<Nonce><![CDATA[${escapeCdata(input.nonce)}]]></Nonce>`,
    "</xml>"
  ].join("");
}

function readTag(xml: string, tag: string): string | undefined {
  const cdataRegex = new RegExp(`<${tag}>\\s*<!\\[CDATA\\[(.*?)\\]\\]>\\s*<\\/${tag}>`, "s");
  const plainRegex = new RegExp(`<${tag}>\\s*([^<]*?)\\s*<\\/${tag}>`, "s");
  const cdataMatch = cdataRegex.exec(xml);
  if (cdataMatch?.[1]) {
    return cdataMatch[1].trim();
  }
  const plainMatch = plainRegex.exec(xml);
  if (plainMatch?.[1]) {
    return plainMatch[1].trim();
  }
  return undefined;
}

function escapeCdata(value: string): string {
  return value.replace(/]]>/g, "]]]]><![CDATA[>");
}

function escapeText(value: string): string {
  return value.replace(/[<>&]/g, (ch) => {
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    return "&amp;";
  });
}
