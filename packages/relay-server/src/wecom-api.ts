type TokenCache = {
  token: string;
  expiresAt: number;
};

const tokenState: { cache?: TokenCache } = {};

export type WeComApiConfig = {
  corpId: string;
  agentSecret: string;
  agentId: number;
  baseUrl?: string;
};

export async function sendWeComTextMessage(
  config: WeComApiConfig,
  userId: string,
  content: string
): Promise<void> {
  const token = await getAccessToken(config);
  const url = `${getBaseUrl(config)}/cgi-bin/message/send?access_token=${encodeURIComponent(token)}`;
  const payload = {
    touser: userId,
    msgtype: "text",
    agentid: config.agentId,
    text: {
      content: content.slice(0, 1900)
    },
    safe: 0,
    enable_id_trans: 0,
    enable_duplicate_check: 0
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = (await response.json()) as { errcode?: number; errmsg?: string };
  if (data.errcode !== 0) {
    throw new Error(`wecom send message failed: code=${data.errcode} msg=${data.errmsg}`);
  }
}

async function getAccessToken(config: WeComApiConfig): Promise<string> {
  const now = Date.now();
  if (tokenState.cache && tokenState.cache.expiresAt > now + 30_000) {
    return tokenState.cache.token;
  }

  const baseUrl = getBaseUrl(config);
  const url = `${baseUrl}/cgi-bin/gettoken?corpid=${encodeURIComponent(config.corpId)}&corpsecret=${encodeURIComponent(config.agentSecret)}`;
  const response = await fetch(url, { method: "GET" });
  const data = (await response.json()) as {
    errcode?: number;
    errmsg?: string;
    access_token?: string;
    expires_in?: number;
  };
  if (data.errcode !== 0 || !data.access_token) {
    throw new Error(`wecom get token failed: code=${data.errcode} msg=${data.errmsg}`);
  }

  tokenState.cache = {
    token: data.access_token,
    expiresAt: now + (data.expires_in ?? 7200) * 1000
  };
  return data.access_token;
}

function getBaseUrl(config: WeComApiConfig): string {
  return config.baseUrl ?? "https://qyapi.weixin.qq.com";
}

