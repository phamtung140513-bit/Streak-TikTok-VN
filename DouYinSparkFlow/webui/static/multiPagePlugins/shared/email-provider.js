(function attachEmailProviderHelpers(globalScope) {
  const DEFAULT_CLOUDFLARE_TEMP_EMAIL_ADMIN_URL = 'https://mail.cloudflare.com/admin';
  const EMAIL_PROVIDER_DUCK = 'duckduckgo';
  const EMAIL_PROVIDER_RELAY_FIREFOX = 'relay_firefox';
  const EMAIL_PROVIDER_CLOUDFLARE_TEMP_EMAIL = 'cloudflare_temp_email';

  function normalizeEmailProvider(value) {
    if (value === EMAIL_PROVIDER_RELAY_FIREFOX) {
      return EMAIL_PROVIDER_RELAY_FIREFOX;
    }
    if (value === EMAIL_PROVIDER_CLOUDFLARE_TEMP_EMAIL) {
      return EMAIL_PROVIDER_CLOUDFLARE_TEMP_EMAIL;
    }
    return EMAIL_PROVIDER_DUCK;
  }

  function isRelayFirefoxProvider(value) {
    return normalizeEmailProvider(value) === EMAIL_PROVIDER_RELAY_FIREFOX;
  }

  function isCloudflareTempEmailProvider(value) {
    return normalizeEmailProvider(value) === EMAIL_PROVIDER_CLOUDFLARE_TEMP_EMAIL;
  }

  function getEmailProviderDisplayName(value) {
    if (isRelayFirefoxProvider(value)) {
      return 'Firefox Relay';
    }
    if (isCloudflareTempEmailProvider(value)) {
      return 'Cloudflare Temp Email';
    }
    return 'DuckDuckGo';
  }

  function shouldUseEmailSourceForVerification(value) {
    return isCloudflareTempEmailProvider(value);
  }

  function shouldSkipStep9Cleanup(value) {
    return !isRelayFirefoxProvider(value);
  }

  function normalizeCloudflareTempEmailAdminUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) {
      return DEFAULT_CLOUDFLARE_TEMP_EMAIL_ADMIN_URL;
    }

    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;

    try {
      const parsed = new URL(candidate);
      parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
      return parsed.toString();
    } catch {
      return DEFAULT_CLOUDFLARE_TEMP_EMAIL_ADMIN_URL;
    }
  }

  function getNextRelayMaskLabel(labels = []) {
    const used = new Set();

    for (const rawLabel of labels) {
      const match = String(rawLabel || '').trim().match(/^t(\d+)$/i);
      if (!match) continue;
      const nextValue = Number(match[1]);
      if (Number.isInteger(nextValue) && nextValue > 0) {
        used.add(nextValue);
      }
    }

    let candidate = 1;
    while (used.has(candidate)) {
      candidate += 1;
    }
    return `t${candidate}`;
  }

  const api = {
    DEFAULT_CLOUDFLARE_TEMP_EMAIL_ADMIN_URL,
    EMAIL_PROVIDER_CLOUDFLARE_TEMP_EMAIL,
    EMAIL_PROVIDER_DUCK,
    EMAIL_PROVIDER_RELAY_FIREFOX,
    getEmailProviderDisplayName,
    getNextRelayMaskLabel,
    isCloudflareTempEmailProvider,
    isRelayFirefoxProvider,
    normalizeCloudflareTempEmailAdminUrl,
    normalizeEmailProvider,
    shouldUseEmailSourceForVerification,
    shouldSkipStep9Cleanup,
  };

  globalScope.MultiPageEmailProvider = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
