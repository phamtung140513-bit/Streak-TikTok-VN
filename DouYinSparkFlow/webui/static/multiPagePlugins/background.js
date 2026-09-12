// background.js — Service Worker: orchestration, state, tab management, message routing

importScripts('data/names.js', 'shared/oauth-flow.js', 'shared/email-provider.js');

const LOG_PREFIX = '[MultiPage:bg]';
const DUCK_AUTOFILL_URL = 'https://duckduckgo.com/email/settings/autofill';
const RELAY_FIREFOX_PROFILE_URL = 'https://relay.firefox.com/accounts/profile/';
const CLOUDFLARE_TEMP_EMAIL_INJECT_FILES = [
  'content/utils.js',
  'shared/cloudflare-temp-email.js',
  'content/cloudflare-temp-email.js',
];
const STOP_ERROR_MESSAGE = 'Flow stopped by user.';
const HUMAN_STEP_DELAY_MIN = 700;
const HUMAN_STEP_DELAY_MAX = 2200;

const {
  DEFAULT_CLOUDFLARE_TEMP_EMAIL_ADMIN_URL = 'https://mail.cloudflare.com/admin',
  EMAIL_PROVIDER_CLOUDFLARE_TEMP_EMAIL = 'cloudflare_temp_email',
  EMAIL_PROVIDER_DUCK = 'duckduckgo',
  EMAIL_PROVIDER_RELAY_FIREFOX = 'relay_firefox',
  getEmailProviderDisplayName = (value) => value === 'relay_firefox'
    ? 'Firefox Relay'
    : value === 'cloudflare_temp_email'
      ? 'Cloudflare Temp Email'
      : 'DuckDuckGo',
  isCloudflareTempEmailProvider = (value) => value === 'cloudflare_temp_email',
  isRelayFirefoxProvider = (value) => value === 'relay_firefox',
  normalizeCloudflareTempEmailAdminUrl = (value) => value || DEFAULT_CLOUDFLARE_TEMP_EMAIL_ADMIN_URL,
  normalizeEmailProvider = (value) => {
    if (value === 'relay_firefox') return 'relay_firefox';
    if (value === 'cloudflare_temp_email') return 'cloudflare_temp_email';
    return 'duckduckgo';
  },
  shouldUseEmailSourceForVerification = (value) => value === 'cloudflare_temp_email',
  shouldSkipStep9Cleanup = (value) => value !== 'relay_firefox',
} = globalThis.MultiPageEmailProvider || {};

initializeSessionStorageAccess();

// ============================================================
// State Management (chrome.storage.session)
// ============================================================

const DEFAULT_STATE = {
  currentStep: 0,
  stepStatuses: {
    1: 'pending', 2: 'pending', 3: 'pending', 4: 'pending', 5: 'pending',
    6: 'pending', 7: 'pending', 8: 'pending', 9: 'pending',
  },
  oauthUrl: null,
  email: null,
  password: null,
  accounts: [], // { email, password, emailProvider, createdAt }
  lastEmailTimestamp: null,
  localhostUrl: null,
  flowStartTime: null,
  tabRegistry: {},
  logs: [],
  vpsUrl: '',
  customPassword: '',
  emailProvider: EMAIL_PROVIDER_DUCK,
  mailProvider: '163', // 'qq' or '163'
  cloudflareTempEmailAdminUrl: '',
  inbucketHost: '',
  inbucketMailbox: '',
  activeCloudflareMailbox: null,
  activeRelayMask: null,
};

async function getState() {
  const state = await chrome.storage.session.get(null);
  return { ...DEFAULT_STATE, ...state };
}

async function initializeSessionStorageAccess() {
  try {
    if (chrome.storage?.session?.setAccessLevel) {
      await chrome.storage.session.setAccessLevel({
        accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS',
      });
      console.log(LOG_PREFIX, 'Enabled storage.session for content scripts');
    }
  } catch (err) {
    console.warn(LOG_PREFIX, 'Failed to enable storage.session for content scripts:', err?.message || err);
  }
}

async function setState(updates) {
  console.log(LOG_PREFIX, 'storage.set:', JSON.stringify(updates).slice(0, 200));
  await chrome.storage.session.set(updates);
}

function broadcastDataUpdate(payload) {
  chrome.runtime.sendMessage({
    type: 'DATA_UPDATED',
    payload,
  }).catch(() => {});
}

async function setEmailState(email) {
  await setState({ email });
  broadcastDataUpdate({ email });
}

async function setEmailProviderState(emailProvider) {
  const nextProvider = normalizeEmailProvider(emailProvider);
  await setState({ emailProvider: nextProvider });
  broadcastDataUpdate({ emailProvider: nextProvider });
}

async function setPasswordState(password) {
  await setState({ password });
  broadcastDataUpdate({ password });
}

async function setActiveRelayMaskState(activeRelayMask) {
  await setState({ activeRelayMask: activeRelayMask || null });
}

async function setActiveCloudflareMailboxState(activeCloudflareMailbox) {
  await setState({ activeCloudflareMailbox: activeCloudflareMailbox || null });
}

function getCloudflareTempEmailAdminUrl(state = {}) {
  return normalizeCloudflareTempEmailAdminUrl(state.cloudflareTempEmailAdminUrl || '');
}

async function resetState() {
  console.log(LOG_PREFIX, 'Resetting all state');
  // Preserve settings and persistent data across resets
  const prev = await chrome.storage.session.get([
    'seenCodes',
    'seenInbucketMailIds',
    'accounts',
    'tabRegistry',
    'vpsUrl',
    'customPassword',
    'emailProvider',
    'mailProvider',
    'cloudflareTempEmailAdminUrl',
    'inbucketHost',
    'inbucketMailbox',
  ]);
  await chrome.storage.session.clear();
  await chrome.storage.session.set({
    ...DEFAULT_STATE,
    seenCodes: prev.seenCodes || [],
    seenInbucketMailIds: prev.seenInbucketMailIds || [],
    accounts: prev.accounts || [],
    tabRegistry: prev.tabRegistry || {},
    vpsUrl: prev.vpsUrl || '',
    customPassword: prev.customPassword || '',
    emailProvider: normalizeEmailProvider(prev.emailProvider),
    mailProvider: prev.mailProvider || '163',
    cloudflareTempEmailAdminUrl: prev.cloudflareTempEmailAdminUrl || '',
    inbucketHost: prev.inbucketHost || '',
    inbucketMailbox: prev.inbucketMailbox || '',
  });
}

/**
 * Generate a random password: 14 chars, mix of uppercase, lowercase, digits, symbols.
 */
function generatePassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%&*?';
  const all = upper + lower + digits + symbols;

  // Ensure at least one of each type
  let pw = '';
  pw += upper[Math.floor(Math.random() * upper.length)];
  pw += lower[Math.floor(Math.random() * lower.length)];
  pw += digits[Math.floor(Math.random() * digits.length)];
  pw += symbols[Math.floor(Math.random() * symbols.length)];

  // Fill remaining 10 chars
  for (let i = 0; i < 10; i++) {
    pw += all[Math.floor(Math.random() * all.length)];
  }

  // Shuffle
  return pw.split('').sort(() => Math.random() - 0.5).join('');
}

// ============================================================
// Tab Registry
// ============================================================

async function getTabRegistry() {
  const state = await getState();
  return state.tabRegistry || {};
}

async function registerTab(source, tabId) {
  const registry = await getTabRegistry();
  registry[source] = { tabId, ready: true };
  await setState({ tabRegistry: registry });
  console.log(LOG_PREFIX, `Tab registered: ${source} -> ${tabId}`);
}

async function isTabAlive(source) {
  const registry = await getTabRegistry();
  const entry = registry[source];
  if (!entry) return false;
  try {
    await chrome.tabs.get(entry.tabId);
    return true;
  } catch {
    // Tab no longer exists — clean up registry
    registry[source] = null;
    await setState({ tabRegistry: registry });
    return false;
  }
}

async function getTabId(source) {
  const registry = await getTabRegistry();
  return registry[source]?.tabId || null;
}

// ============================================================
// Command Queue (for content scripts not yet ready)
// ============================================================

const pendingCommands = new Map(); // source -> { message, resolve, reject, timer }

function queueCommand(source, message, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCommands.delete(source);
      const err = `Content script on ${source} did not respond in ${timeout / 1000}s. Try refreshing the tab and retry.`;
      console.error(LOG_PREFIX, err);
      reject(new Error(err));
    }, timeout);
    pendingCommands.set(source, { message, resolve, reject, timer });
    console.log(LOG_PREFIX, `Command queued for ${source} (waiting for ready)`);
  });
}

function flushCommand(source, tabId) {
  const pending = pendingCommands.get(source);
  if (pending) {
    clearTimeout(pending.timer);
    pendingCommands.delete(source);
    chrome.tabs.sendMessage(tabId, pending.message).then(pending.resolve).catch(pending.reject);
    console.log(LOG_PREFIX, `Flushed queued command to ${source} (tab ${tabId})`);
  }
}

function cancelPendingCommands(reason = STOP_ERROR_MESSAGE) {
  for (const [source, pending] of pendingCommands.entries()) {
    clearTimeout(pending.timer);
    pending.reject(new Error(reason));
    pendingCommands.delete(source);
    console.log(LOG_PREFIX, `Cancelled queued command for ${source}`);
  }
}

// ============================================================
// Reuse or create tab
// ============================================================

async function reuseOrCreateTab(source, url, options = {}) {
  const alive = await isTabAlive(source);
  if (alive) {
    const tabId = await getTabId(source);
    const currentTab = await chrome.tabs.get(tabId);
    const sameUrl = currentTab.url === url;
    const shouldReloadOnReuse = sameUrl && options.reloadIfSameUrl;

    const registry = await getTabRegistry();
    if (sameUrl) {
      await chrome.tabs.update(tabId, { active: true });
      console.log(LOG_PREFIX, `Reused tab ${source} (${tabId}) on same URL`);

      if (shouldReloadOnReuse) {
        if (registry[source]) registry[source].ready = false;
        await setState({ tabRegistry: registry });
        await chrome.tabs.reload(tabId);

        await new Promise((resolve) => {
          const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 30000);
          const listener = (tid, info) => {
            if (tid === tabId && info.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              clearTimeout(timer);
              resolve();
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
        });
      }

      // For dynamically injected pages like the VPS panel, re-inject immediately.
      if (options.inject) {
        if (registry[source]) registry[source].ready = false;
        await setState({ tabRegistry: registry });
        if (options.injectSource) {
          await chrome.scripting.executeScript({
            target: { tabId },
            func: (injectedSource) => {
              window.__MULTIPAGE_SOURCE = injectedSource;
            },
            args: [options.injectSource],
          });
        }
        await chrome.scripting.executeScript({
          target: { tabId },
          files: options.inject,
        });
        await new Promise(r => setTimeout(r, 500));
      }

      return tabId;
    }

    // Mark as not ready BEFORE navigating — so READY signal from new page is captured correctly
    if (registry[source]) registry[source].ready = false;
    await setState({ tabRegistry: registry });

    // Navigate existing tab to new URL
    await chrome.tabs.update(tabId, { url, active: true });
    console.log(LOG_PREFIX, `Reused tab ${source} (${tabId}), navigated to ${url.slice(0, 60)}`);

    // Wait for page load complete (with 30s timeout)
    await new Promise((resolve) => {
      const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 30000);
      const listener = (tid, info) => {
        if (tid === tabId && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          clearTimeout(timer);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });

    // If dynamic injection needed (VPS panel), re-inject after navigation
    if (options.inject) {
      if (options.injectSource) {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: (injectedSource) => {
            window.__MULTIPAGE_SOURCE = injectedSource;
          },
          args: [options.injectSource],
        });
      }
      await chrome.scripting.executeScript({
        target: { tabId },
        files: options.inject,
      });
    }

    // Wait a bit for content script to inject and send READY
    await new Promise(r => setTimeout(r, 500));

    return tabId;
  }

  // Create new tab
  const tab = await chrome.tabs.create({ url, active: true });
  console.log(LOG_PREFIX, `Created new tab ${source} (${tab.id})`);

  // If dynamic injection needed (VPS panel), inject scripts after load
  if (options.inject) {
    await new Promise((resolve) => {
      const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 30000);
      const listener = (tabId, info) => {
        if (tabId === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          clearTimeout(timer);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
    if (options.injectSource) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (injectedSource) => {
          window.__MULTIPAGE_SOURCE = injectedSource;
        },
        args: [options.injectSource],
      });
    }
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: options.inject,
    });
  }

  return tab.id;
}

// ============================================================
// Send command to content script (with readiness check)
// ============================================================

async function sendToContentScript(source, message) {
  const registry = await getTabRegistry();
  const entry = registry[source];

  if (!entry || !entry.ready) {
    console.log(LOG_PREFIX, `${source} not ready, queuing command`);
    return queueCommand(source, message);
  }

  // Verify tab is still alive
  const alive = await isTabAlive(source);
  if (!alive) {
    // Tab was closed — queue the command, it will be sent when tab is reopened
    console.log(LOG_PREFIX, `${source} tab was closed, queuing command`);
    return queueCommand(source, message);
  }

  console.log(LOG_PREFIX, `Sending to ${source} (tab ${entry.tabId}):`, message.type);
  return chrome.tabs.sendMessage(entry.tabId, message);
}

// ============================================================
// Logging
// ============================================================

async function addLog(message, level = 'info') {
  const state = await getState();
  const logs = state.logs || [];
  const entry = { message, level, timestamp: Date.now() };
  logs.push(entry);
  // Keep last 500 logs
  if (logs.length > 500) logs.splice(0, logs.length - 500);
  await setState({ logs });
  // Broadcast to side panel
  chrome.runtime.sendMessage({ type: 'LOG_ENTRY', payload: entry }).catch(() => {});
}

async function completeStepFromBackground(step, payload = {}, options = {}) {
  const { logMessage = null, logLevel = 'info' } = options;

  if (logMessage) {
    await addLog(logMessage, logLevel);
  }

  await setStepStatus(step, 'completed');
  await addLog(`Step ${step} completed`, 'ok');
  await handleStepData(step, payload);
  notifyStepComplete(step, payload);
}

async function getSignupPageState() {
  const tabId = await getTabId('signup-page');
  if (!tabId) {
    return { url: '', hasVisibleContinueButton: false, isConsentPage: false };
  }

  const alive = await isTabAlive('signup-page');
  if (!alive) {
    return { url: '', hasVisibleContinueButton: false, isConsentPage: false };
  }

  const tab = await chrome.tabs.get(tabId);
  const currentUrl = tab?.url || '';
  if (MultiPageOAuthFlow.isConsentUrl(currentUrl)) {
    return { url: currentUrl, hasVisibleContinueButton: false, isConsentPage: true };
  }

  try {
    const pageState = await sendToContentScript('signup-page', {
      type: 'GET_PAGE_STATE',
      source: 'background',
      payload: {},
    });

    return {
      url: pageState?.url || currentUrl,
      hasVisibleContinueButton: Boolean(pageState?.hasVisibleContinueButton),
      isConsentPage: Boolean(pageState?.isConsentPage),
    };
  } catch (err) {
    console.warn(LOG_PREFIX, 'Consent page state check failed:', err?.message || err);
    return {
      url: currentUrl,
      hasVisibleContinueButton: false,
      isConsentPage: false,
    };
  }
}

async function isSignupConsentPageReady() {
  const pageState = await getSignupPageState();
  return pageState.isConsentPage;
}

async function waitForConsentPageAfterStep5(timeoutMs = 12000, pollMs = 300) {
  const observedStates = [];
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    throwIfStopped();

    const pageState = await getSignupPageState();
    observedStates.push(pageState);

    if (MultiPageOAuthFlow.hasAnyConsentPageState(observedStates)) {
      return true;
    }

    await sleepWithStop(pollMs);
  }

  return false;
}

async function skipStepBecauseConsentReady(step) {
  await completeStepFromBackground(step, { skipped: true, reason: 'consent_ready' }, {
    logMessage: `Step ${step} skipped: consent page already ready`,
  });
}

// ============================================================
// Step Status Management
// ============================================================

async function setStepStatus(step, status) {
  const state = await getState();
  const statuses = { ...state.stepStatuses };
  statuses[step] = status;
  await setState({ stepStatuses: statuses, currentStep: step });
  // Broadcast to side panel
  chrome.runtime.sendMessage({
    type: 'STEP_STATUS_CHANGED',
    payload: { step, status },
  }).catch(() => {});
}

function isStopError(error) {
  const message = typeof error === 'string' ? error : error?.message;
  return message === STOP_ERROR_MESSAGE;
}

function clearStopRequest() {
  stopRequested = false;
}

function throwIfStopped() {
  if (stopRequested) {
    throw new Error(STOP_ERROR_MESSAGE);
  }
}

async function sleepWithStop(ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    throwIfStopped();
    await new Promise(r => setTimeout(r, Math.min(100, ms - (Date.now() - start))));
  }
}

async function humanStepDelay(min = HUMAN_STEP_DELAY_MIN, max = HUMAN_STEP_DELAY_MAX) {
  const duration = Math.floor(Math.random() * (max - min + 1)) + min;
  await sleepWithStop(duration);
}

async function clickWithDebugger(tabId, rect) {
  if (!tabId) {
    throw new Error('No auth tab found for debugger click.');
  }
  if (!rect || !Number.isFinite(rect.centerX) || !Number.isFinite(rect.centerY)) {
    throw new Error('Step 8 debugger fallback needs a valid button position.');
  }

  const target = { tabId };
  try {
    await chrome.debugger.attach(target, '1.3');
  } catch (err) {
    throw new Error(
      `Debugger attach failed during step 8 fallback: ${err.message}. ` +
      'If DevTools is open on the auth tab, close it and retry.'
    );
  }

  try {
    const x = Math.round(rect.centerX);
    const y = Math.round(rect.centerY);

    await chrome.debugger.sendCommand(target, 'Page.bringToFront');
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
      button: 'none',
      buttons: 0,
      clickCount: 0,
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
  } finally {
    await chrome.debugger.detach(target).catch(() => {});
  }
}

async function broadcastStopToContentScripts() {
  const registry = await getTabRegistry();
  for (const entry of Object.values(registry)) {
    if (!entry?.tabId) continue;
    try {
      await chrome.tabs.sendMessage(entry.tabId, {
        type: 'STOP_FLOW',
        source: 'background',
        payload: {},
      });
    } catch {}
  }
}

let stopRequested = false;

// ============================================================
// Message Handler (central router)
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log(LOG_PREFIX, `Received: ${message.type} from ${message.source || 'sidepanel'}`, message);

  handleMessage(message, sender).then(response => {
    sendResponse(response);
  }).catch(err => {
    console.error(LOG_PREFIX, 'Handler error:', err);
    sendResponse({ error: err.message });
  });

  return true; // async response
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'CONTENT_SCRIPT_READY': {
      const tabId = sender.tab?.id;
      if (tabId && message.source) {
        await registerTab(message.source, tabId);
        flushCommand(message.source, tabId);
        await addLog(`Content script ready: ${message.source} (tab ${tabId})`);
      }
      return { ok: true };
    }

    case 'LOG': {
      const { message: msg, level } = message.payload;
      await addLog(`[${message.source}] ${msg}`, level);
      return { ok: true };
    }

    case 'STEP_COMPLETE': {
      if (stopRequested) {
        await setStepStatus(message.step, 'stopped');
        notifyStepError(message.step, STOP_ERROR_MESSAGE);
        return { ok: true };
      }
      await setStepStatus(message.step, 'completed');
      await addLog(`Step ${message.step} completed`, 'ok');
      await handleStepData(message.step, message.payload);
      notifyStepComplete(message.step, message.payload);
      return { ok: true };
    }

    case 'STEP_ERROR': {
      if (isStopError(message.error)) {
        await setStepStatus(message.step, 'stopped');
        await addLog(`Step ${message.step} stopped by user`, 'warn');
        notifyStepError(message.step, message.error);
      } else {
        await setStepStatus(message.step, 'failed');
        await addLog(`Step ${message.step} failed: ${message.error}`, 'error');
        notifyStepError(message.step, message.error);
      }
      return { ok: true };
    }

    case 'GET_STATE': {
      return await getState();
    }

    case 'RESET': {
      clearStopRequest();
      await resetState();
      await addLog('Flow reset', 'info');
      return { ok: true };
    }

    case 'EXECUTE_STEP': {
      clearStopRequest();
      const step = message.payload.step;
      // Save email if provided (from side panel step 3)
      if (message.payload.email) {
        await setEmailState(message.payload.email);
      }
      await executeStep(step);
      return { ok: true };
    }

    case 'AUTO_RUN': {
      clearStopRequest();
      const totalRuns = message.payload?.totalRuns || 1;
      autoRunLoop(totalRuns);  // fire-and-forget
      return { ok: true };
    }

    case 'RESUME_AUTO_RUN': {
      clearStopRequest();
      if (message.payload.email) {
        await setEmailState(message.payload.email);
        const state = await getState();
        if (isRelayFirefoxProvider(state.emailProvider) && !state.activeRelayMask) {
          await setActiveRelayMaskState({ email: message.payload.email, label: null, inferred: true });
        }
        if (isCloudflareTempEmailProvider(state.emailProvider)) {
          await setActiveCloudflareMailboxState({
            email: message.payload.email,
            addressId: null,
            provenance: 'manual_existing',
            acquiredAt: Date.now(),
          });
        }
      }
      resumeAutoRun();  // fire-and-forget
      return { ok: true };
    }

    case 'SAVE_SETTING': {
      const updates = {};
      if (message.payload.vpsUrl !== undefined) updates.vpsUrl = message.payload.vpsUrl;
      if (message.payload.customPassword !== undefined) updates.customPassword = message.payload.customPassword;
      if (message.payload.emailProvider !== undefined) {
        updates.emailProvider = normalizeEmailProvider(message.payload.emailProvider);
      }
      if (message.payload.mailProvider !== undefined) updates.mailProvider = message.payload.mailProvider;
      if (message.payload.cloudflareTempEmailAdminUrl !== undefined) {
        updates.cloudflareTempEmailAdminUrl = String(message.payload.cloudflareTempEmailAdminUrl || '').trim();
      }
      if (message.payload.inbucketHost !== undefined) updates.inbucketHost = message.payload.inbucketHost;
      if (message.payload.inbucketMailbox !== undefined) updates.inbucketMailbox = message.payload.inbucketMailbox;
      await setState(updates);
      return { ok: true };
    }

    // Side panel data updates
    case 'SAVE_EMAIL': {
      await setEmailState(message.payload.email);
      return { ok: true, email: message.payload.email };
    }

    case 'FETCH_PROVIDER_EMAIL': {
      clearStopRequest();
      const email = await fetchEmailFromProvider(message.payload || {});
      return { ok: true, email };
    }

    case 'FETCH_DUCK_EMAIL': {
      clearStopRequest();
      const email = await fetchEmailFromProvider({
        ...(message.payload || {}),
        provider: EMAIL_PROVIDER_DUCK,
      });
      return { ok: true, email };
    }

    case 'STOP_FLOW': {
      await requestStop();
      return { ok: true };
    }

    default:
      console.warn(LOG_PREFIX, `Unknown message type: ${message.type}`);
      return { error: `Unknown message type: ${message.type}` };
  }
}

// ============================================================
// Step Data Handlers
// ============================================================

async function handleStepData(step, payload) {
  switch (step) {
    case 1:
      if (payload.oauthUrl) {
        await setState({ oauthUrl: payload.oauthUrl });
        broadcastDataUpdate({ oauthUrl: payload.oauthUrl });
      }
      break;
    case 3:
      if (payload.email) await setEmailState(payload.email);
      break;
    case 4:
      if (payload.emailTimestamp) await setState({ lastEmailTimestamp: payload.emailTimestamp });
      break;
    case 8:
      if (payload.localhostUrl) {
        await setState({ localhostUrl: payload.localhostUrl });
        broadcastDataUpdate({ localhostUrl: payload.localhostUrl });
      }
      break;
  }
}

// ============================================================
// Step Completion Waiting
// ============================================================

// Map of step -> { resolve, reject } for waiting on step completion
const stepWaiters = new Map();
let resumeWaiter = null;

function waitForStepComplete(step, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    throwIfStopped();
    const timer = setTimeout(() => {
      stepWaiters.delete(step);
      reject(new Error(`Step ${step} timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    stepWaiters.set(step, {
      resolve: (data) => { clearTimeout(timer); stepWaiters.delete(step); resolve(data); },
      reject: (err) => { clearTimeout(timer); stepWaiters.delete(step); reject(err); },
    });
  });
}

function notifyStepComplete(step, payload) {
  const waiter = stepWaiters.get(step);
  if (waiter) waiter.resolve(payload);
}

function notifyStepError(step, error) {
  const waiter = stepWaiters.get(step);
  if (waiter) waiter.reject(new Error(error));
}

async function markRunningStepsStopped() {
  const state = await getState();
  const runningSteps = Object.entries(state.stepStatuses || {})
    .filter(([, status]) => status === 'running')
    .map(([step]) => Number(step));

  for (const step of runningSteps) {
    await setStepStatus(step, 'stopped');
  }
}

async function requestStop() {
  if (stopRequested) return;

  stopRequested = true;
  cancelPendingCommands();
  if (webNavListener) {
    chrome.webNavigation.onBeforeNavigate.removeListener(webNavListener);
    webNavListener = null;
  }

  await addLog('Stop requested. Cancelling current operations...', 'warn');
  await broadcastStopToContentScripts();

  for (const waiter of stepWaiters.values()) {
    waiter.reject(new Error(STOP_ERROR_MESSAGE));
  }
  stepWaiters.clear();

  if (resumeWaiter) {
    resumeWaiter.reject(new Error(STOP_ERROR_MESSAGE));
    resumeWaiter = null;
  }

  await markRunningStepsStopped();
  autoRunActive = false;
  await setState({ autoRunning: false });
  chrome.runtime.sendMessage({
    type: 'AUTO_RUN_STATUS',
    payload: { phase: 'stopped', currentRun: autoRunCurrentRun, totalRuns: autoRunTotalRuns },
  }).catch(() => {});
}

// ============================================================
// Step Execution
// ============================================================

async function executeStep(step) {
  console.log(LOG_PREFIX, `Executing step ${step}`);
  throwIfStopped();
  await setStepStatus(step, 'running');
  await addLog(`Step ${step} started`);
  await humanStepDelay();

  const state = await getState();

  // Set flow start time on first step
  if (step === 1 && !state.flowStartTime) {
    await setState({ flowStartTime: Date.now() });
  }

  try {
    switch (step) {
      case 1: await executeStep1(state); break;
      case 2: await executeStep2(state); break;
      case 3: await executeStep3(state); break;
      case 4: await executeStep4(state); break;
      case 5: await executeStep5(state); break;
      case 6: await executeStep6(state); break;
      case 7: await executeStep7(state); break;
      case 8: await executeStep8(state); break;
      case 9: await executeStep9(state); break;
      default:
        throw new Error(`Unknown step: ${step}`);
    }
  } catch (err) {
    if (isStopError(err)) {
      await setStepStatus(step, 'stopped');
      await addLog(`Step ${step} stopped by user`, 'warn');
      throw err;
    }
    await setStepStatus(step, 'failed');
    await addLog(`Step ${step} failed: ${err.message}`, 'error');
    throw err;
  }
}

/**
 * Execute a step and wait for it to complete before returning.
 * @param {number} step
 * @param {number} delayAfter - ms to wait after completion (for page transitions)
 */
async function executeStepAndWait(step, delayAfter = 2000) {
  throwIfStopped();
  const promise = waitForStepComplete(step, 120000);
  await executeStep(step);
  await promise;
  // Extra delay for page transitions / DOM updates
  if (delayAfter > 0) {
    await sleepWithStop(delayAfter + Math.floor(Math.random() * 1200));
  }
}

async function fetchEmailFromProvider(options = {}) {
  const state = await getState();
  const provider = normalizeEmailProvider(options.provider || state.emailProvider);

  if (isCloudflareTempEmailProvider(provider)) {
    return fetchCloudflareTempEmail(options);
  }

  if (isRelayFirefoxProvider(provider)) {
    await setActiveCloudflareMailboxState(null);
    return fetchRelayMaskEmail(options);
  }

  await setActiveCloudflareMailboxState(null);
  await setActiveRelayMaskState(null);
  return fetchDuckEmail(options);
}

async function fetchDuckEmail(options = {}) {
  throwIfStopped();
  const { generateNew = true } = options;

  await addLog(`Duck Mail: Opening autofill settings (${generateNew ? 'generate new' : 'reuse current'})...`);
  await reuseOrCreateTab('duck-mail', DUCK_AUTOFILL_URL);

  const result = await sendToContentScript('duck-mail', {
    type: 'FETCH_DUCK_EMAIL',
    source: 'background',
    payload: { generateNew },
  });

  if (result?.error) {
    throw new Error(result.error);
  }
  if (!result?.email) {
    throw new Error('Duck email not returned.');
  }

  await setEmailState(result.email);
  await addLog(`Duck Mail: ${result.generated ? 'Generated' : 'Loaded'} ${result.email}`, 'ok');
  return result.email;
}

async function fetchRelayMaskEmail(options = {}) {
  throwIfStopped();
  const { generateNew = true } = options;

  await setActiveCloudflareMailboxState(null);
  await addLog(`Relay: Opening profile page (${generateNew ? 'create new mask' : 'reuse current'})...`);
  await reuseOrCreateTab('relay-firefox', RELAY_FIREFOX_PROFILE_URL);

  const result = await sendToContentScript('relay-firefox', {
    type: 'CREATE_RELAY_MASK',
    source: 'background',
    payload: { generateNew },
  });

  if (result?.error) {
    throw new Error(result.error);
  }
  if (!result?.email) {
    throw new Error('Relay mask email not returned.');
  }

  await setEmailState(result.email);
  await setActiveRelayMaskState({
    email: result.email,
    label: result.label || null,
  });
  await addLog(`Relay: Created ${result.email}${result.label ? ` (${result.label})` : ''}`, 'ok');
  return result.email;
}

async function fetchCloudflareTempEmail(options = {}) {
  throwIfStopped();
  const { generateNew = true } = options;
  const state = await getState();
  const adminUrl = getCloudflareTempEmailAdminUrl(state);

  await addLog(`Cloudflare Temp Email: Opening admin page (${generateNew ? 'create new mailbox' : 'reuse current'})...`);
  await reuseOrCreateTab('cloudflare-temp-email', adminUrl, {
    inject: CLOUDFLARE_TEMP_EMAIL_INJECT_FILES,
    injectSource: 'cloudflare-temp-email',
    reloadIfSameUrl: true,
  });

  const result = await sendToContentScript('cloudflare-temp-email', {
    type: 'CREATE_CLOUDFLARE_TEMP_EMAIL',
    source: 'background',
    payload: { generateNew },
  });

  if (result?.error) {
    throw new Error(result.error);
  }
  if (!result?.email) {
    throw new Error('Cloudflare Temp Email mailbox was not returned.');
  }

  await setActiveRelayMaskState(null);
  await setEmailState(result.email);
  await setActiveCloudflareMailboxState({
    email: result.email,
    addressId: result.addressId ?? null,
    provenance: result.provenance || 'created',
    acquiredAt: Date.now(),
  });
  await addLog(`Cloudflare Temp Email: ${result.generated ? 'Created' : 'Loaded'} ${result.email}`, 'ok');
  return result.email;
}

async function deleteRelayMask(activeRelayMask) {
  throwIfStopped();
  if (!activeRelayMask?.email) {
    throw new Error('No Relay mask recorded for cleanup.');
  }

  await addLog(`Relay: Opening profile page to delete ${activeRelayMask.email}...`);
  await reuseOrCreateTab('relay-firefox', RELAY_FIREFOX_PROFILE_URL);

  const result = await sendToContentScript('relay-firefox', {
    type: 'DELETE_RELAY_MASK',
    source: 'background',
    payload: { email: activeRelayMask.email },
  });

  if (result?.error) {
    throw new Error(result.error);
  }
  if (!result?.deleted) {
    throw new Error(`Relay mask ${activeRelayMask.email} was not deleted.`);
  }

  await setActiveRelayMaskState(null);
  await addLog(`Relay: Deleted ${activeRelayMask.email}`, 'ok');
}

// ============================================================
// Auto Run Flow
// ============================================================

let autoRunActive = false;
let autoRunCurrentRun = 0;
let autoRunTotalRuns = 1;

// Outer loop: runs the full flow N times
async function autoRunLoop(totalRuns) {
  if (autoRunActive) {
    await addLog('Auto run already in progress', 'warn');
    return;
  }

  clearStopRequest();
  autoRunActive = true;
  autoRunTotalRuns = totalRuns;
  await setState({ autoRunning: true });

  for (let run = 1; run <= totalRuns; run++) {
    autoRunCurrentRun = run;

    // Reset everything at the start of each run (keep VPS/mail settings)
    const prevState = await getState();
    const keepSettings = {
      vpsUrl: prevState.vpsUrl,
      emailProvider: normalizeEmailProvider(prevState.emailProvider),
      mailProvider: prevState.mailProvider,
      inbucketHost: prevState.inbucketHost,
      inbucketMailbox: prevState.inbucketMailbox,
      autoRunning: true,
    };
    await resetState();
    await setState(keepSettings);
    // Tell side panel to reset all UI
    chrome.runtime.sendMessage({ type: 'AUTO_RUN_RESET' }).catch(() => {});
    await sleepWithStop(500);

    await addLog(`=== Auto Run ${run}/${totalRuns} — Phase 1: Get OAuth link & open signup ===`, 'info');
    const status = (phase) => ({ type: 'AUTO_RUN_STATUS', payload: { phase, currentRun: run, totalRuns } });

    try {
      throwIfStopped();
      chrome.runtime.sendMessage(status('running')).catch(() => {});

      await executeStepAndWait(1, 2000);
      await executeStepAndWait(2, 2000);

      const currentState = await getState();
      const emailProvider = normalizeEmailProvider(currentState.emailProvider);
      const providerName = getEmailProviderDisplayName(emailProvider);
      let emailReady = false;
      try {
        const providerEmail = await fetchEmailFromProvider({ provider: emailProvider, generateNew: true });
        await addLog(`=== Run ${run}/${totalRuns} — ${providerName} email ready: ${providerEmail} ===`, 'ok');
        emailReady = true;
      } catch (err) {
        await addLog(`${providerName} auto-fetch failed: ${err.message}`, 'warn');
      }

      if (!emailReady) {
        await addLog(`=== Run ${run}/${totalRuns} PAUSED: Fetch ${providerName} email or paste manually, then continue ===`, 'warn');
        chrome.runtime.sendMessage(status('waiting_email')).catch(() => {});

        // Wait for RESUME_AUTO_RUN — sets a promise that resumeAutoRun resolves
        await waitForResume();

        const resumedState = await getState();
        if (!resumedState.email) {
          await addLog('Cannot resume: no email address.', 'error');
          break;
        }
      }

      await addLog(`=== Run ${run}/${totalRuns} — Phase 2: Register, verify, login, complete ===`, 'info');
      chrome.runtime.sendMessage(status('running')).catch(() => {});

      const signupTabId = await getTabId('signup-page');
      if (signupTabId) {
        await chrome.tabs.update(signupTabId, { active: true });
      }

      await executeStepAndWait(3, 3000);
      await executeStepAndWait(4, 2000);
      await executeStepAndWait(5, 3000);
      if (await waitForConsentPageAfterStep5()) {
        await addLog('Consent page detected after step 5; skipping steps 6 and 7', 'info');
        await skipStepBecauseConsentReady(6);
        await skipStepBecauseConsentReady(7);
      } else {
        await executeStepAndWait(6, 3000);
        await executeStepAndWait(7, 2000);
      }
      await executeStepAndWait(8, 2000);
      await executeStepAndWait(9, 1000);

      await addLog(`=== Run ${run}/${totalRuns} COMPLETE! ===`, 'ok');

    } catch (err) {
      if (isStopError(err)) {
        await addLog(`Run ${run}/${totalRuns} stopped by user`, 'warn');
      } else {
        await addLog(`Run ${run}/${totalRuns} failed: ${err.message}`, 'error');
      }
      chrome.runtime.sendMessage(status('stopped')).catch(() => {});
      break; // Stop on error
    }
  }

  const completedRuns = autoRunCurrentRun;
  if (stopRequested) {
    await addLog(`=== Stopped after ${Math.max(0, completedRuns - 1)}/${autoRunTotalRuns} runs ===`, 'warn');
    chrome.runtime.sendMessage({ type: 'AUTO_RUN_STATUS', payload: { phase: 'stopped', currentRun: completedRuns, totalRuns: autoRunTotalRuns } }).catch(() => {});
  } else if (completedRuns >= autoRunTotalRuns) {
    await addLog(`=== All ${autoRunTotalRuns} runs completed successfully ===`, 'ok');
    chrome.runtime.sendMessage({ type: 'AUTO_RUN_STATUS', payload: { phase: 'complete', currentRun: completedRuns, totalRuns: autoRunTotalRuns } }).catch(() => {});
  } else {
    await addLog(`=== Stopped after ${completedRuns}/${autoRunTotalRuns} runs ===`, 'warn');
    chrome.runtime.sendMessage({ type: 'AUTO_RUN_STATUS', payload: { phase: 'stopped', currentRun: completedRuns, totalRuns: autoRunTotalRuns } }).catch(() => {});
  }
  autoRunActive = false;
  await setState({ autoRunning: false });
  clearStopRequest();
}

function waitForResume() {
  return new Promise((resolve, reject) => {
    throwIfStopped();
    resumeWaiter = { resolve, reject };
  });
}

async function resumeAutoRun() {
  throwIfStopped();
  const state = await getState();
  if (!state.email) {
    await addLog('Cannot resume: no email address. Paste email in Side Panel first.', 'error');
    return;
  }
  if (resumeWaiter) {
    resumeWaiter.resolve();
    resumeWaiter = null;
  }
}

// ============================================================
// Step 1: Get OAuth Link (via vps-panel.js)
// ============================================================

async function executeStep1(state) {
  if (!state.vpsUrl) {
    throw new Error('No VPS URL configured. Enter VPS address in Side Panel first.');
  }
  await addLog(`Step 1: Opening VPS panel...`);
  await reuseOrCreateTab('vps-panel', state.vpsUrl, {
    inject: ['content/utils.js', 'content/vps-panel.js'],
    reloadIfSameUrl: true,
  });

  await sendToContentScript('vps-panel', {
    type: 'EXECUTE_STEP',
    step: 1,
    source: 'background',
    payload: {},
  });
}

// ============================================================
// Step 2: Open Signup Page (Background opens tab, signup-page.js clicks Register)
// ============================================================

async function executeStep2(state) {
  if (!state.oauthUrl) {
    throw new Error('No OAuth URL. Complete step 1 first.');
  }
  await addLog(`Step 2: Opening auth URL...`);
  await reuseOrCreateTab('signup-page', state.oauthUrl);

  await sendToContentScript('signup-page', {
    type: 'EXECUTE_STEP',
    step: 2,
    source: 'background',
    payload: {},
  });
}

// ============================================================
// Step 3: Fill Email & Password (via signup-page.js)
// ============================================================

async function executeStep3(state) {
  const emailProvider = normalizeEmailProvider(state.emailProvider);
  let email = state.email;

  if (isRelayFirefoxProvider(emailProvider)) {
    if (state.activeRelayMask?.email) {
      email = state.activeRelayMask.email;
      await setEmailState(email);
      await addLog(`Step 3: Reusing Relay mask ${email}`, 'info');
    } else {
      email = await fetchRelayMaskEmail({ generateNew: true });
    }
  } else if (isCloudflareTempEmailProvider(emailProvider)) {
    const activeMailbox = state.activeCloudflareMailbox;
    const canReuseCloudflareMailbox = activeMailbox?.email
      && activeMailbox.email === state.email
      && (activeMailbox.provenance === 'created' || activeMailbox.provenance === 'manual_existing');

    if (canReuseCloudflareMailbox) {
      email = activeMailbox.email;
      await setEmailState(email);
      await addLog(`Step 3: Reusing Cloudflare Temp Email mailbox ${email}`, 'info');
    } else {
      email = await fetchCloudflareTempEmail({ generateNew: true });
    }
  } else if (!email) {
    throw new Error('No email address. Paste email in Side Panel first.');
  }

  const password = state.customPassword || generatePassword();
  await setPasswordState(password);

  // Save account record
  const accounts = state.accounts || [];
  accounts.push({ email, password, emailProvider, createdAt: new Date().toISOString() });
  await setState({ accounts });

  await addLog(
    `Step 3: Filling email ${email}, password ${state.customPassword ? 'customized' : 'generated'} (${password.length} chars)`
  );
  await sendToContentScript('signup-page', {
    type: 'EXECUTE_STEP',
    step: 3,
    source: 'background',
    payload: { email, password },
  });
}

// ============================================================
// Step 4: Get Signup Verification Code (qq-mail.js polls, then fills in signup-page.js)
// ============================================================

function getMailConfig(state) {
  const provider = state.mailProvider || 'qq';
  if (provider === '163') {
    return { source: 'mail-163', url: 'https://mail.163.com/js6/main.jsp?df=mail163_letter#module=mbox.ListModule%7C%7B%22fid%22%3A1%2C%22order%22%3A%22date%22%2C%22desc%22%3Atrue%7D', label: '163 Mail' };
  }
  if (provider === 'inbucket') {
    const host = normalizeInbucketOrigin(state.inbucketHost);
    const mailbox = (state.inbucketMailbox || '').trim();
    if (!host) {
      return { error: 'Inbucket host is empty or invalid.' };
    }
    if (!mailbox) {
      return { error: 'Inbucket mailbox name is empty.' };
    }
    return {
      source: 'inbucket-mail',
      url: `${host}/m/${encodeURIComponent(mailbox)}/`,
      label: `Inbucket Mailbox (${mailbox})`,
      navigateOnReuse: true,
      inject: ['content/utils.js', 'content/inbucket-mail.js'],
      injectSource: 'inbucket-mail',
    };
  }
  return { source: 'qq-mail', url: 'https://wx.mail.qq.com/', label: 'QQ Mail' };
}

function normalizeInbucketOrigin(rawValue) {
  const value = (rawValue || '').trim();
  if (!value) return '';

  const candidate = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(value) ? value : `https://${value}`;

  try {
    const parsed = new URL(candidate);
    return parsed.origin;
  } catch {
    return '';
  }
}

async function pollCodeFromCloudflareAdmin(step, state, options = {}) {
  if (!state.email) {
    throw new Error('No email. Complete step 3 first.');
  }
  const adminUrl = getCloudflareTempEmailAdminUrl(state);

  await addLog(`Step ${step}: Opening Cloudflare Temp Email admin...`);
  await reuseOrCreateTab('cloudflare-temp-email', adminUrl, {
    inject: CLOUDFLARE_TEMP_EMAIL_INJECT_FILES,
    injectSource: 'cloudflare-temp-email',
    reloadIfSameUrl: true,
  });

  const result = await sendToContentScript('cloudflare-temp-email', {
    type: 'POLL_EMAIL',
    step,
    source: 'background',
    payload: {
      filterAfterTimestamp: options.filterAfterTimestamp || 0,
      senderFilters: options.senderFilters || [],
      subjectFilters: options.subjectFilters || [],
      targetEmail: state.email,
      maxAttempts: options.maxAttempts || 20,
      intervalMs: options.intervalMs || 3000,
    },
  });

  if (result?.error) {
    throw new Error(result.error);
  }
  if (!result?.code) {
    throw new Error(`Cloudflare Temp Email did not return a verification code for step ${step}.`);
  }

  return result;
}

async function executeStep4(state) {
  let result = null;

  if (shouldUseEmailSourceForVerification(state.emailProvider)) {
    result = await pollCodeFromCloudflareAdmin(4, state, {
      filterAfterTimestamp: state.flowStartTime || 0,
      senderFilters: ['openai', 'noreply', 'verify', 'auth', 'duckduckgo', 'forward'],
      subjectFilters: ['verify', 'verification', 'code', '验证', 'confirm'],
    });
  } else {
    const mail = getMailConfig(state);
    if (mail.error) throw new Error(mail.error);
    await addLog(`Step 4: Opening ${mail.label}...`);

    // For mail tabs, only create if not alive — don't navigate (preserves login session)
    const alive = await isTabAlive(mail.source);
    if (alive) {
      if (mail.navigateOnReuse) {
        await reuseOrCreateTab(mail.source, mail.url, {
          inject: mail.inject,
          injectSource: mail.injectSource,
        });
      } else {
        const tabId = await getTabId(mail.source);
        await chrome.tabs.update(tabId, { active: true });
      }
    } else {
      await reuseOrCreateTab(mail.source, mail.url, {
        inject: mail.inject,
        injectSource: mail.injectSource,
      });
    }

    result = await sendToContentScript(mail.source, {
      type: 'POLL_EMAIL',
      step: 4,
      source: 'background',
      payload: {
        filterAfterTimestamp: state.flowStartTime || 0,
        senderFilters: ['openai', 'noreply', 'verify', 'auth', 'duckduckgo', 'forward'],
        subjectFilters: ['verify', 'verification', 'code', '验证', 'confirm'],
        targetEmail: state.email,
        maxAttempts: 20,
        intervalMs: 3000,
      },
    });

    if (result && result.error) {
      throw new Error(result.error);
    }
  }

  if (result && result.code) {
    await setState({ lastEmailTimestamp: result.emailTimestamp });
    await addLog(`Step 4: Got verification code: ${result.code}`);

    // Switch to signup tab and fill code
    const signupTabId = await getTabId('signup-page');
    if (signupTabId) {
      await chrome.tabs.update(signupTabId, { active: true });
      await sendToContentScript('signup-page', {
        type: 'FILL_CODE',
        step: 4,
        source: 'background',
        payload: { code: result.code },
      });
    } else {
      throw new Error('Signup page tab was closed. Cannot fill verification code.');
    }
  }
}

// ============================================================
// Step 5: Fill Name & Birthday (via signup-page.js)
// ============================================================

async function executeStep5(state) {
  const { firstName, lastName } = generateRandomName();
  const { year, month, day } = generateRandomBirthday();

  await addLog(`Step 5: Generated name: ${firstName} ${lastName}, Birthday: ${year}-${month}-${day}`);

  await sendToContentScript('signup-page', {
    type: 'EXECUTE_STEP',
    step: 5,
    source: 'background',
    payload: { firstName, lastName, year, month, day },
  });
}

// ============================================================
// Step 6: Login ChatGPT (Background opens tab, chatgpt.js handles login)
// ============================================================

async function executeStep6(state) {
  if (await isSignupConsentPageReady()) {
    await skipStepBecauseConsentReady(6);
    return;
  }

  if (!state.oauthUrl) {
    throw new Error('No OAuth URL. Complete step 1 first.');
  }
  if (!state.email) {
    throw new Error('No email. Complete step 3 first.');
  }

  await addLog(`Step 6: Opening OAuth URL for login...`);
  // Reuse the signup-page tab — navigate it to the OAuth URL
  await reuseOrCreateTab('signup-page', state.oauthUrl);

  // signup-page.js will inject (same auth.openai.com domain) and handle login
  await sendToContentScript('signup-page', {
    type: 'EXECUTE_STEP',
    step: 6,
    source: 'background',
    payload: { email: state.email, password: state.password },
  });
}

// ============================================================
// Step 7: Get Login Verification Code (qq-mail.js polls, then fills in chatgpt.js)
// ============================================================

async function executeStep7(state) {
  if (await isSignupConsentPageReady()) {
    await skipStepBecauseConsentReady(7);
    return;
  }

  let result = null;

  if (shouldUseEmailSourceForVerification(state.emailProvider)) {
    result = await pollCodeFromCloudflareAdmin(7, state, {
      filterAfterTimestamp: state.lastEmailTimestamp || state.flowStartTime || 0,
      senderFilters: ['openai', 'noreply', 'verify', 'auth', 'chatgpt', 'duckduckgo', 'forward'],
      subjectFilters: ['verify', 'verification', 'code', '验证', 'confirm', 'login'],
    });
  } else {
    const mail = getMailConfig(state);
    if (mail.error) throw new Error(mail.error);
    await addLog(`Step 7: Opening ${mail.label}...`);

    const alive = await isTabAlive(mail.source);
    if (alive) {
      if (mail.navigateOnReuse) {
        await reuseOrCreateTab(mail.source, mail.url, {
          inject: mail.inject,
          injectSource: mail.injectSource,
        });
      } else {
        const tabId = await getTabId(mail.source);
        await chrome.tabs.update(tabId, { active: true });
      }
    } else {
      await reuseOrCreateTab(mail.source, mail.url, {
        inject: mail.inject,
        injectSource: mail.injectSource,
      });
    }

    result = await sendToContentScript(mail.source, {
      type: 'POLL_EMAIL',
      step: 7,
      source: 'background',
      payload: {
        filterAfterTimestamp: state.lastEmailTimestamp || state.flowStartTime || 0,
        senderFilters: ['openai', 'noreply', 'verify', 'auth', 'chatgpt', 'duckduckgo', 'forward'],
        subjectFilters: ['verify', 'verification', 'code', '验证', 'confirm', 'login'],
        targetEmail: state.email,
        maxAttempts: 20,
        intervalMs: 3000,
      },
    });

    if (result && result.error) {
      throw new Error(result.error);
    }
  }

  if (result && result.code) {
    await addLog(`Step 7: Got login verification code: ${result.code}`);

    // Switch to signup/auth tab and fill code
    const signupTabId = await getTabId('signup-page');
    if (signupTabId) {
      await chrome.tabs.update(signupTabId, { active: true });
      await sendToContentScript('signup-page', {
        type: 'FILL_CODE',
        step: 7,
        source: 'background',
        payload: { code: result.code },
      });
    } else {
      throw new Error('Auth page tab was closed. Cannot fill verification code.');
    }
  }
}

// ============================================================
// Step 8: Complete OAuth (auto click + localhost listener)
// ============================================================

let webNavListener = null;

async function executeStep8(state) {
  if (!state.oauthUrl) {
    throw new Error('No OAuth URL. Complete step 1 first.');
  }

  await addLog('Step 8: Setting up localhost redirect listener...');

  // Register webNavigation listener (scoped to this step)
  return new Promise((resolve, reject) => {
    let resolved = false;

    const cleanupListener = () => {
      if (webNavListener) {
        chrome.webNavigation.onBeforeNavigate.removeListener(webNavListener);
        webNavListener = null;
      }
    };

    const finishStep8WithCallbackUrl = async (url) => {
      const matchedUrl = MultiPageOAuthFlow.findLoopbackCallbackUrl([url]);
      if (!matchedUrl || resolved) {
        return false;
      }

      resolved = true;
      cleanupListener();
      clearTimeout(timeout);

      try {
        await completeStepFromBackground(8, { localhostUrl: matchedUrl }, {
          logMessage: `Step 8: Captured callback URL: ${matchedUrl}`,
          logLevel: 'ok',
        });
        resolve();
      } catch (err) {
        reject(err);
      }

      return true;
    };

    const timeout = setTimeout(() => {
      cleanupListener();
      resolved = true;
      reject(new Error('Loopback callback URL not captured after 120s. Step 8 click may have been blocked.'));
    }, 120000);

    webNavListener = (details) => {
      if (MultiPageOAuthFlow.isLoopbackCallbackUrl(details.url)) {
        console.log(LOG_PREFIX, `Captured loopback redirect: ${details.url}`);
        void finishStep8WithCallbackUrl(details.url);
      }
    };

    chrome.webNavigation.onBeforeNavigate.addListener(webNavListener);

    // After step 7, the auth page shows a consent screen ("使用 ChatGPT 登录到 Codex")
    // with a "继续" button. We locate the button in-page, then click it through
    // the debugger Input API directly.
    (async () => {
      try {
        let signupTabId = await getTabId('signup-page');
        if (signupTabId) {
          await chrome.tabs.update(signupTabId, { active: true });
          await addLog('Step 8: Switched to auth page. Preparing debugger click...');
        } else {
          signupTabId = await reuseOrCreateTab('signup-page', state.oauthUrl);
          await addLog('Step 8: Auth tab reopened. Preparing debugger click...');
        }

        const clickResult = await sendToContentScript('signup-page', {
          type: 'STEP8_FIND_AND_CLICK',
          source: 'background',
          payload: {},
        });

        if (clickResult?.error) {
          throw new Error(clickResult.error);
        }

        if (!resolved) {
          await clickWithDebugger(signupTabId, clickResult?.rect);
          await addLog('Step 8: Debugger click dispatched, waiting for redirect...');

          (async () => {
            while (!resolved) {
              const tab = await chrome.tabs.get(signupTabId).catch(() => null);
              const matchedUrl = MultiPageOAuthFlow.findLoopbackCallbackUrl([tab?.url || '']);
              if (matchedUrl) {
                console.log(LOG_PREFIX, `Detected loopback callback via tab polling: ${matchedUrl}`);
                await finishStep8WithCallbackUrl(matchedUrl);
                return;
              }
              await new Promise((resume) => setTimeout(resume, 250));
            }
          })().catch((err) => {
            if (!resolved) {
              clearTimeout(timeout);
              cleanupListener();
              reject(err);
            }
          });
        }
      } catch (err) {
        clearTimeout(timeout);
        cleanupListener();
        reject(err);
      }
    })();
  });
}

// ============================================================
// Step 9: Cleanup Email Resource
// ============================================================

async function executeStep9(state) {
  const emailProvider = normalizeEmailProvider(state.emailProvider);
  const providerName = getEmailProviderDisplayName(emailProvider);

  if (shouldSkipStep9Cleanup(emailProvider)) {
    await completeStepFromBackground(9, { skipped: true, reason: 'no_cleanup_needed' }, {
      logMessage: `Step 9 skipped: no cleanup needed for ${providerName}`,
      logLevel: 'info',
    });
    return;
  }

  const targetMask = state.activeRelayMask?.email
    ? state.activeRelayMask
    : (state.email ? { email: state.email, label: null, inferred: true } : null);

  if (!targetMask?.email) {
    throw new Error('No Relay mask recorded for cleanup.');
  }

  await deleteRelayMask(targetMask);
  await completeStepFromBackground(9, { deletedMaskEmail: targetMask.email }, {
    logMessage: `Step 9: Relay cleanup complete for ${targetMask.email}`,
    logLevel: 'ok',
  });
}

// ============================================================
// Open Side Panel on extension icon click
// ============================================================

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
