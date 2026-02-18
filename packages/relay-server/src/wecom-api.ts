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
  let token = await getAccessToken(config);
  let result = await postTextMessage(config, token, userId, content);

  if (shouldRefreshToken(result.errcode)) {
    tokenState.cache = undefined;
    token = await getAccessToken(config);
    result = await postTextMessage(config, token, userId, content);
  }

  if (result.errcode !== 0) {
    throw new Error(
      `wecom send message failed: http=${result.httpStatus} code=${result.errcode} msg=${result.errmsg}`
    );
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
  const data = (await parseJsonSafe(response)) as {
    errcode?: number;
    errmsg?: string;
    access_token?: string;
    expires_in?: number;
  };
  if (data.errcode !== 0 || !data.access_token) {
    throw new Error(
      `wecom get token failed: http=${response.status} code=${data.errcode} msg=${data.errmsg}`
    );
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

async function postTextMessage(
  config: WeComApiConfig,
  token: string,
  userId: string,
  content: string
): Promise<{ errcode?: number; errmsg?: string; httpStatus: number }> {
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
  const data = (await parseJsonSafe(response)) as {
    errcode?: number;
    errmsg?: string;
  };
  return {
    errcode: data.errcode,
    errmsg: data.errmsg,
    httpStatus: response.status
  };
}

function shouldRefreshToken(errcode?: number): boolean {
  return errcode === 40014 || errcode === 42001 || errcode === 40001;
}

async function parseJsonSafe(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {
      errcode: -1,
      errmsg: `non_json_response: ${text.slice(0, 160)}`
    };
  }
}
