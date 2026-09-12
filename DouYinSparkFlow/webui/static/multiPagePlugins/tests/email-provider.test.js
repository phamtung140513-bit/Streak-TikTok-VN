const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_CLOUDFLARE_TEMP_EMAIL_ADMIN_URL,
  EMAIL_PROVIDER_DUCK,
  EMAIL_PROVIDER_CLOUDFLARE_TEMP_EMAIL,
  EMAIL_PROVIDER_RELAY_FIREFOX,
  getEmailProviderDisplayName,
  getNextRelayMaskLabel,
  isCloudflareTempEmailProvider,
  normalizeCloudflareTempEmailAdminUrl,
  normalizeEmailProvider,
  shouldUseEmailSourceForVerification,
  shouldSkipStep9Cleanup,
} = require('../shared/email-provider.js');

test('normalizeEmailProvider keeps relay_firefox as-is', () => {
  assert.equal(normalizeEmailProvider('relay_firefox'), EMAIL_PROVIDER_RELAY_FIREFOX);
});

test('normalizeEmailProvider keeps cloudflare_temp_email as-is', () => {
  assert.equal(
    normalizeEmailProvider('cloudflare_temp_email'),
    EMAIL_PROVIDER_CLOUDFLARE_TEMP_EMAIL
  );
});

test('normalizeEmailProvider falls back to duckduckgo for unknown values', () => {
  assert.equal(normalizeEmailProvider('something-else'), EMAIL_PROVIDER_DUCK);
});

test('isCloudflareTempEmailProvider identifies cloudflare_temp_email', () => {
  assert.equal(isCloudflareTempEmailProvider('cloudflare_temp_email'), true);
});

test('isCloudflareTempEmailProvider rejects relay_firefox', () => {
  assert.equal(isCloudflareTempEmailProvider('relay_firefox'), false);
});

test('getEmailProviderDisplayName returns Cloudflare Temp Email label', () => {
  assert.equal(
    getEmailProviderDisplayName('cloudflare_temp_email'),
    'Cloudflare Temp Email'
  );
});

test('DEFAULT_CLOUDFLARE_TEMP_EMAIL_ADMIN_URL uses the public open-source-safe admin URL', () => {
  assert.equal(
    DEFAULT_CLOUDFLARE_TEMP_EMAIL_ADMIN_URL,
    'https://mail.cloudflare.com/admin'
  );
});

test('normalizeCloudflareTempEmailAdminUrl falls back to the default URL for empty values', () => {
  assert.equal(
    normalizeCloudflareTempEmailAdminUrl(''),
    DEFAULT_CLOUDFLARE_TEMP_EMAIL_ADMIN_URL
  );
});

test('normalizeCloudflareTempEmailAdminUrl trims whitespace and prepends https when protocol is missing', () => {
  assert.equal(
    normalizeCloudflareTempEmailAdminUrl(' custom.example.com/admin '),
    'https://custom.example.com/admin'
  );
});

test('normalizeCloudflareTempEmailAdminUrl normalizes the default admin URL path', () => {
  assert.equal(
    normalizeCloudflareTempEmailAdminUrl('https://mail.cloudflare.com/admin/'),
    DEFAULT_CLOUDFLARE_TEMP_EMAIL_ADMIN_URL
  );
});

test('getNextRelayMaskLabel returns t1 when there are no existing labels', () => {
  assert.equal(getNextRelayMaskLabel([]), 't1');
});

test('getNextRelayMaskLabel fills the first numeric gap', () => {
  assert.equal(getNextRelayMaskLabel(['t1', 'hello', 't3']), 't2');
});

test('shouldSkipStep9Cleanup returns false for relay_firefox', () => {
  assert.equal(shouldSkipStep9Cleanup('relay_firefox'), false);
});

test('shouldUseEmailSourceForVerification returns true for cloudflare_temp_email', () => {
  assert.equal(shouldUseEmailSourceForVerification('cloudflare_temp_email'), true);
});

test('shouldUseEmailSourceForVerification returns false for relay_firefox', () => {
  assert.equal(shouldUseEmailSourceForVerification('relay_firefox'), false);
});

test('shouldUseEmailSourceForVerification returns false for duckduckgo', () => {
  assert.equal(shouldUseEmailSourceForVerification('duckduckgo'), false);
});

test('shouldSkipStep9Cleanup returns true for duckduckgo', () => {
  assert.equal(shouldSkipStep9Cleanup('duckduckgo'), true);
});

test('shouldSkipStep9Cleanup returns true for cloudflare_temp_email', () => {
  assert.equal(shouldSkipStep9Cleanup('cloudflare_temp_email'), true);
});
