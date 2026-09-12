#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { Blob } from "node:buffer";

const SDK_BUNDLES = [
  "https://lf-fe-creator.douyinstatic.com/obj/douyn-creator-scm-cdn/douyin-creator-mono-pc-data/static/js/lib-polyfill.f81f86eb.js",
  "https://lf-fe-creator.douyinstatic.com/obj/douyn-creator-scm-cdn/douyin-creator-mono-pc-data/static/js/lib-router.5ab9ff10.js",
  "https://lf-fe-creator.douyinstatic.com/obj/douyn-creator-scm-cdn/douyin-creator-mono-pc-data/static/js/2105.f8d74876.js",
  "https://lf-fe-creator.douyinstatic.com/obj/douyn-creator-scm-cdn/douyin-creator-mono-pc-data/static/js/douyin_creator_data_old.2f971672.js",
  "https://lf-fe-creator.douyinstatic.com/obj/douyn-creator-scm-cdn/douyin-creator-mono-pc-data/static/js/async/argus-builder-strategy.5a053c46.js",
  "https://lf-fe-creator.douyinstatic.com/obj/douyn-creator-scm-cdn/douyin-creator-mono-pc-data/static/js/async/7676.a4cd4900.js",
  "https://lf-fe-creator.douyinstatic.com/obj/douyn-creator-scm-cdn/douyin-creator-mono-pc-data/static/js/async/4916.56c33d22.js",
  "https://lf-fe-creator.douyinstatic.com/obj/douyn-creator-scm-cdn/douyin-creator-mono-pc-data/static/js/async/8198.b5c0b108.js",
  "https://lf-fe-creator.douyinstatic.com/obj/douyn-creator-scm-cdn/douyin-creator-mono-pc-data/static/js/async/4168.b2e72401.js",
  "https://lf-fe-creator.douyinstatic.com/obj/douyn-creator-scm-cdn/douyin-creator-mono-pc-data/static/js/async/7771.d27d1891.js",
  "https://lf-fe-creator.douyinstatic.com/obj/douyn-creator-scm-cdn/douyin-creator-mono-pc-data/static/js/async/6682.2a991dfb.js",
  "https://lf-fe-creator.douyinstatic.com/obj/douyn-creator-scm-cdn/douyin-creator-mono-pc-data/static/js/async/361.4fc40815.js",
  "https://lf-fe-creator.douyinstatic.com/obj/douyn-creator-scm-cdn/douyin-creator-mono-pc-data/static/js/async/pages-chat.c817de31.js",
];

const CREATOR_CHAT_URL = "https://creator.douyin.com/creator-micro/data/following/chat";
const USER_AGENT =
  (process.env.SPARKFLOW_PROTOCOL_USER_AGENT ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36").trim();

function noop() {}

function toCookieString(cookies) {
  return (cookies || [])
    .filter((item) => item?.name && item?.value !== undefined)
    .map((item) => `${item.name}=${item.value}`)
    .join("; ");
}

function normalizeNickname(value) {
  return String(value || "").trim();
}

function stableNow() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNonNegativeInteger(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function normalizeSendStrategy(raw = {}) {
  const intervalMin = toNonNegativeInteger(raw.messageIntervalSecondsMin, 0);
  const intervalMax = Math.max(intervalMin, toNonNegativeInteger(raw.messageIntervalSecondsMax, intervalMin));
  return {
    messageIntervalSecondsMin: intervalMin,
    messageIntervalSecondsMax: intervalMax,
  };
}

function randomBetweenInclusive(min, max) {
  if (max <= min) {
    return min;
  }
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const SEND_MESSAGE_STATUS_NAMES = {
  0: "Succeeded",
  1: "UserNotInConversation",
  2: "CheckConversationNotPass",
  3: "CheckMessageNotPass",
  4: "CheckMessageNotPassButSelfVisible",
  5: "UserHasBeenBlock",
};

function sendMessageStatusName(statusCode) {
  if (statusCode === null || statusCode === undefined) {
    return "";
  }
  return SEND_MESSAGE_STATUS_NAMES[Number(statusCode)] || "Unknown";
}

function publicSendResultSummary(sendResult) {
  if (!sendResult || typeof sendResult !== "object") {
    return {};
  }
  const summary = {};
  for (const key of ["success", "statusCode", "statusMsg", "checkCode", "checkMsg", "errorCode", "errorMsg"]) {
    if (sendResult[key] !== undefined) {
      summary[key] = sendResult[key];
    }
  }
  summary.rawKeys = Object.keys(sendResult).sort();
  return summary;
}

async function readStdinJson() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    throw new Error("Missing JSON payload on stdin");
  }
  return JSON.parse(raw);
}

async function ensureBundles(cacheDir) {
  await fs.promises.mkdir(cacheDir, { recursive: true });
  for (const url of SDK_BUNDLES) {
    const filename = url.split("/").at(-1);
    const filePath = path.join(cacheDir, filename);
    if (fs.existsSync(filePath)) {
      const response = await fetch(url, { method: "HEAD", headers: { "User-Agent": USER_AGENT } });
      if (!response.ok) {
        throw new Error(`Cached SDK bundle is stale or unreachable ${url}: ${response.status}`);
      }
      continue;
    }
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!response.ok) {
      throw new Error(`Failed to download SDK bundle ${url}: ${response.status}`);
    }
    const text = await response.text();
    await fs.promises.writeFile(filePath, text, "utf8");
  }
}

function createWebpackRequire(bundleDir, cookieString) {
  const modules = {};
  const cache = {};

  function requireModule(id) {
    if (cache[id]) {
      return cache[id].exports;
    }
    if (!modules[id]) {
      throw new Error(`Missing webpack module ${id}`);
    }
    const module = { exports: {} };
    cache[id] = module;
    modules[id].call(module.exports, module, module.exports, requireModule);
    return module.exports;
  }

  requireModule.d = (exports, definition) => {
    for (const key of Object.keys(definition)) {
      if (!Object.prototype.hasOwnProperty.call(exports, key)) {
        Object.defineProperty(exports, key, {
          enumerable: true,
          get: definition[key],
        });
      }
    }
  };
  requireModule.o = (obj, prop) => Object.prototype.hasOwnProperty.call(obj, prop);
  requireModule.r = (exports) => {
    if (typeof Symbol !== "undefined" && Symbol.toStringTag) {
      Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    }
    Object.defineProperty(exports, "__esModule", { value: true });
  };
  requireModule.n = (mod) => {
    const getter = mod && mod.__esModule ? () => mod.default : () => mod;
    requireModule.d(getter, { a: getter });
    return getter;
  };
  requireModule.g = globalThis;
  requireModule.hmd = (module) => module;
  requireModule.nmd = (module) => module;

  const chunkArray = [];
  chunkArray.push = (chunk) => Object.assign(modules, chunk[1]);

  const fakeElement = () => ({
    style: {},
    setAttribute: noop,
    appendChild: noop,
    removeChild: noop,
    addEventListener: noop,
    removeEventListener: noop,
    getContext: () => ({}),
  });
  const documentRef = {
    cookie: cookieString,
    referrer: CREATOR_CHAT_URL,
    createElement: fakeElement,
    getElementsByTagName: () => [],
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    removeEventListener: noop,
    body: { appendChild: noop, removeChild: noop },
    head: { appendChild: noop, removeChild: noop },
    documentElement: { style: {} },
  };
  function XMLHttpRequestStub() {
    this.open = noop;
    this.setRequestHeader = noop;
    this.send = noop;
  }
  function WebSocketStub() {
    this.readyState = 1;
    this.send = noop;
    this.close = noop;
  }

  const context = {
    self: { webpackChunkdouyin_creator_data: chunkArray },
    window: {},
    globalThis: null,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Buffer,
    TextDecoder,
    TextEncoder,
    Blob,
    document: documentRef,
    navigator: {
      userAgent: USER_AGENT,
      language: "en-US",
      cookieEnabled: true,
      onLine: true,
      platform: "Linux x86_64",
      sendBeacon: undefined,
      appName: "Netscape",
    },
    location: {
      href: CREATOR_CHAT_URL,
      protocol: "https:",
      search: "",
      pathname: "/creator-micro/data/following/chat",
      hostname: "creator.douyin.com",
    },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    performance: { now: () => Date.now() },
    fetch,
    XMLHttpRequest: XMLHttpRequestStub,
    WebSocket: WebSocketStub,
    URL,
    URLSearchParams,
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    crypto,
  };
  context.window = context;
  context.globalThis = context;

  for (const entry of fs.readdirSync(bundleDir).filter((name) => name.endsWith(".js")).sort()) {
    const code = fs.readFileSync(path.join(bundleDir, entry), "utf8");
    try {
      vm.runInNewContext(code, context, { filename: entry });
    } catch {
      // Some bundles execute browser-only entrypoints after registering modules.
    }
  }

  return requireModule;
}

class ProtocolError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ProtocolError";
    this.details = details;
  }
}

function extractCookieMap(cookies) {
  const items = {};
  for (const item of cookies || []) {
    if (item?.name) {
      items[item.name] = item.value ?? "";
    }
  }
  return items;
}

function buildCreatorHeaders(cookieString, cookieMap, referer = CREATOR_CHAT_URL) {
  return {
    "User-Agent": USER_AGENT,
    Referer: referer,
    Origin: "https://creator.douyin.com",
    Accept: "application/json, text/javascript",
    "Content-Type": "application/x-www-form-urlencoded",
    Cookie: cookieString,
    "x-tt-passport-csrf-token":
      cookieMap.passport_csrf_token || cookieMap.passport_csrf_token_default || "",
  };
}

function buildImHeaders(cookieString) {
  return {
    "User-Agent": USER_AGENT,
    Referer: CREATOR_CHAT_URL,
    Origin: "https://creator.douyin.com",
    Cookie: cookieString,
  };
}

async function fetchJson(url, options = {}) {
  const timeoutMs = options.timeoutMs || 15000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(url, {
    ...options,
    signal: controller.signal,
  });
  const text = await response.text();
  clearTimeout(timer);
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { response, text, data };
}

async function fetchSessionIdentity(cookieString, cookieMap) {
  const headers = buildCreatorHeaders(cookieString, cookieMap);
  const params = new URLSearchParams({
    aid: "2906",
    app_name: "aweme_creator_platform",
    device_platform: "web",
    referer: "",
    user_agent: USER_AGENT,
    cookie_enabled: "true",
    screen_width: "1280",
    screen_height: "720",
    browser_language: "en-US@posix",
    browser_platform: "Linux x86_64",
    browser_name: "Mozilla",
    browser_version: USER_AGENT,
    browser_online: "true",
    timezone_name: "Asia/Shanghai",
  });
  const { response, data, text } = await fetchJson(
    `https://creator.douyin.com/aweme/v1/creator/im/user_token/?${params.toString()}`,
    { headers },
  );
  if (!response.ok || data?.status_code !== 0 || !data?.user_id) {
    throw new ProtocolError("Failed to resolve creator IM session identity", {
      status: response.status,
      body: text,
    });
  }
  return {
    userId: String(data.user_id),
    sessionToken: String(data.token || ""),
  };
}

async function fetchIdentitySecurityToken(cookieString, cookieMap) {
  const headers = buildCreatorHeaders(cookieString, cookieMap);
  const params = new URLSearchParams({
    scene: "im_send_msg",
    auto_retry_req: "0",
    skip_verify: "0",
    identity_token_force_get_tag: "0",
    passport_jssdk_version: "5.1.4",
    passport_jssdk_type: "lite",
    is_from_ttaccountsdk: "1",
    aid: "2906",
    language: "zh",
    account_app_language: "en-US",
    id_token_version: "2.1.5",
  });
  const { response, data, text } = await fetchJson(
    `https://creator.douyin.com/passport/safe/get_identity_security_token/?${params.toString()}`,
    { headers },
  );
  if (!response.ok || data?.message !== "success" || !data?.data?.identity_security_token) {
    throw new ProtocolError("Failed to resolve identity security token", {
      status: response.status,
      body: text,
    });
  }
  return {
    identitySecurityHeader: JSON.stringify({ token: data.data.identity_security_token }),
    realDeviceId: String(data.data.device_id || ""),
  };
}

async function fetchProfileNickname(cookieString, secUid) {
  const url =
    "https://www.douyin.com/aweme/v1/web/user/profile/other/?" +
    new URLSearchParams({ sec_user_id: secUid }).toString();
  const { response, data, text } = await fetchJson(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Referer: `https://www.douyin.com/user/${secUid}`,
      Cookie: cookieString,
      Accept: "application/json, text/javascript",
    },
  });
  if (!response.ok || data?.status_code !== 0) {
    return "";
  }
  return normalizeNickname(data?.user?.nickname);
}

function stringifyMaybeLong(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  if (typeof value.toString === "function" && value.toString !== Object.prototype.toString) {
    return value.toString();
  }
  return String(value);
}

function selectPeerParticipant(conversation, selfUserId) {
  const participants = conversation?.firstPageParticipant?.participants || [];
  for (const participant of participants) {
    const currentUserId = stringifyMaybeLong(participant?.user_id);
    if (currentUserId && currentUserId !== selfUserId) {
      return participant;
    }
  }
  return null;
}

async function createProtocolClient({ bundleDir, cookieString, cookieMap, userId }) {
  const requireModule = createWebpackRequire(bundleDir, cookieString);
  const sdk = requireModule(61724);
  const { BytedIM } = requireModule(26440);

  class AdditionalParamsPlugin extends sdk.BasePlugin {
    install() {}

    async sendPacket(packet) {
      packet.device_id = 0;
      packet.device_platform = "douyin_creator";
      packet.headers = {
        ...(packet.headers || {}),
        aid_new: 2906,
        app_name: "douyin_creator",
      };
      return packet;
    }
  }

  class NodeHttpClient extends sdk.IMHttpClient {
    async send(url, method, body) {
      const fullUrl = /^https?:/i.test(url)
        ? url
        : `${String(this.option.apiUrl).replace(/\/$/, "")}/${String(url).replace(/^\//, "")}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      const response = await fetch(fullUrl, {
        method,
        headers: this.headers,
        body: body ? Buffer.from(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);
      return response.arrayBuffer();
    }

    sendByBeacon() {
      return false;
    }
  }

  const client = new BytedIM(
    {
      appId: 2906,
      fpId: 9,
      appKey: "e1bd35ec9db7b8d846de66ed140b1ad9",
      service: 5,
      apiUrl: "https://imapi.douyin.com",
      frontierUrl: "wss://frontier-im.douyin.com/ws/v2",
      inboxType: 1,
      token: "",
      userId,
      deviceId: userId,
      authType: sdk.im_proto.AuthType.SESSION_AUTH,
      devicePlatform: "douyin_pc",
      timeout: 20000,
      acceptIncorrectInboxType: true,
      biz: "douyin_creator",
      withCredentials: false,
      httpHeaders: buildImHeaders(cookieString),
      headers: {},
      webSocketLevel: sdk.WebSocketLevel.PushOnly,
      debug: false,
      http: (ctx) => new NodeHttpClient(ctx),
    },
    [AdditionalParamsPlugin],
  );

  const initResult = await client.init();
  if (initResult !== sdk.InitResult.Succeeded) {
    throw new ProtocolError("Protocol IM init did not succeed", { initResult });
  }

  return { client };
}

async function buildConversationCache({
  client,
  selfUserId,
  cookieString,
  existingCache = [],
  targetNames = [],
}) {
  const cachedBySecUid = new Map(
    (existingCache || []).filter((entry) => entry?.secUid).map((entry) => [entry.secUid, entry]),
  );
  const wantedTargets = new Set((targetNames || []).map(normalizeNickname).filter(Boolean));
  const matchedTargets = new Set();
  const conversations = await client.getConversationListOnline();
  const cacheEntries = [];

  for (const conversation of conversations) {
    if (conversation?.type !== 1) {
      continue;
    }

    const peer = selectPeerParticipant(conversation, selfUserId);
    if (!peer) {
      continue;
    }

    const peerUserId = stringifyMaybeLong(peer.user_id);
    const secUid = peer.sec_uid || "";
    if (!peerUserId || !secUid) {
      continue;
    }

    let nickname = normalizeNickname(cachedBySecUid.get(secUid)?.nickname);
    if (!nickname) {
      try {
        nickname = await fetchProfileNickname(cookieString, secUid);
      } catch {
        nickname = "";
      }
    }

    cacheEntries.push({
      nickname,
      peerUserId,
      secUid,
      conversationId: conversation.id,
      conversationShortId: conversation.shortId,
      updatedAt: stableNow(),
    });

    if (nickname && wantedTargets.has(nickname)) {
      matchedTargets.add(nickname);
      if (matchedTargets.size === wantedTargets.size) {
        break;
      }
    }
  }

  const deduped = new Map();
  for (const entry of existingCache || []) {
    if (!entry?.nickname || !entry?.secUid) {
      continue;
    }
    deduped.set(entry.secUid, entry);
  }
  for (const entry of cacheEntries) {
    if (!entry.nickname) {
      continue;
    }
    deduped.set(entry.secUid, entry);
  }
  return Array.from(deduped.values()).sort((left, right) =>
    left.nickname.localeCompare(right.nickname, "zh-CN"),
  );
}

function buildTargetLookup(cacheEntries) {
  const byNickname = new Map();
  for (const entry of cacheEntries) {
    const key = normalizeNickname(entry.nickname);
    if (key && !byNickname.has(key)) {
      byNickname.set(key, entry);
    }
  }
  return byNickname;
}

async function sendMessages({
  client,
  cacheEntries,
  messagesByTarget,
  dryRun,
  cookieString,
  cookieMap,
  sendStrategy,
}) {
  if (!dryRun) {
    const identity = await fetchIdentitySecurityToken(cookieString, cookieMap);
    client.updateSendMessageHeaders({
      identity_security_token: identity.identitySecurityHeader,
      identity_security_device_id: identity.realDeviceId,
      identity_security_aid: "2906",
    });
  }

  const byNickname = buildTargetLookup(cacheEntries);
  const resolved = [];
  const unresolved = [];
  const sent = [];
  const normalizedStrategy = normalizeSendStrategy(sendStrategy);

  for (const [target, message] of Object.entries(messagesByTarget)) {
    const mapping = byNickname.get(normalizeNickname(target));
    if (!mapping) {
      unresolved.push({ target, reason: "conversation_not_found" });
      continue;
    }

    const conversation = client.getConversation({ conversationId: mapping.conversationId });
    if (!conversation) {
      unresolved.push({ target, reason: "conversation_not_loaded", mapping });
      continue;
    }

    resolved.push({
      target,
      nickname: mapping.nickname,
      peerUserId: mapping.peerUserId,
      conversationId: mapping.conversationId,
      conversationShortId: mapping.conversationShortId,
    });

    let delayBeforeSendSeconds = 0;
    if (!dryRun && sent.length > 0 && normalizedStrategy.messageIntervalSecondsMax > 0) {
      delayBeforeSendSeconds = randomBetweenInclusive(
        normalizedStrategy.messageIntervalSecondsMin,
        normalizedStrategy.messageIntervalSecondsMax,
      );
      if (delayBeforeSendSeconds > 0) {
        await sleep(delayBeforeSendSeconds * 1000);
      }
    }

    const payload = JSON.stringify({ text: message, aweType: 774 });
    const messageObject = await client.createMessage({
      type: 7,
      content: payload,
      conversation,
      insert: false,
    });

    if (dryRun) {
      sent.push({
        target,
        dryRun: true,
        message,
        payload,
        conversationId: mapping.conversationId,
        delayBeforeSendSeconds,
      });
      continue;
    }

    const sendResult = await client.sendMessage({ message: messageObject });
    const statusCode = sendResult?.statusCode ?? null;
    sent.push({
      target,
      dryRun: false,
      message,
      success: Boolean(sendResult?.success),
      statusCode,
      statusName: sendMessageStatusName(statusCode),
      statusMsg: sendResult?.statusMsg ?? "",
      sendResultSummary: publicSendResultSummary(sendResult),
      conversationId: mapping.conversationId,
      delayBeforeSendSeconds,
      sentAt: stableNow(),
    });
  }

  return { resolved, unresolved, sent };
}

async function main() {
  const payload = await readStdinJson();
  const repoRoot = payload.repoRoot || process.cwd();
  const bundleDir = path.join(repoRoot, ".im_sdk_cache");
  await ensureBundles(bundleDir);

  const account = payload.account || {};
  const cookieString = toCookieString(account.cookies);
  const cookieMap = extractCookieMap(account.cookies);
  const { userId } = await fetchSessionIdentity(cookieString, cookieMap);
  const { client } = await createProtocolClient({
    bundleDir,
    cookieString,
    cookieMap,
    userId,
  });

  const cacheEntries = await buildConversationCache({
    client,
    selfUserId: userId,
    cookieString,
    existingCache: account.protocol_targets_cache || [],
    targetNames: Object.keys(payload.messagesByTarget || {}),
  });
  const execution = await sendMessages({
    client,
    cacheEntries,
    messagesByTarget: payload.messagesByTarget || {},
    dryRun: Boolean(payload.dryRun),
    cookieString,
    cookieMap,
    sendStrategy: payload.sendStrategy || {},
  });

  try {
    console.log(
      JSON.stringify(
        {
          ok: true,
          username: account.username || "",
          userId,
          dryRun: Boolean(payload.dryRun),
          protocol_targets_cache: cacheEntries,
          ...execution,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.dispose();
  }
}

main().catch((error) => {
  console.log(
    JSON.stringify(
      {
        ok: false,
        error: error?.message || String(error),
        details: error?.details || {},
        stack: error?.stack || "",
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
