const test = require('node:test');
const assert = require('node:assert/strict');

const {
  hasAnyConsentPageState,
  findLoopbackCallbackUrl,
  isConsentUrl,
  isConsentPageState,
  isLoopbackCallbackUrl,
} = require('../shared/oauth-flow.js');

test('isConsentUrl matches the exact known consent URL', () => {
  assert.equal(
    isConsentUrl('https://auth.openai.com/sign-in-with-chatgpt/codex/consent'),
    true
  );
});

test('isConsentUrl rejects unrelated auth routes', () => {
  assert.equal(
    isConsentUrl('https://auth.openai.com/u/signup/identifier'),
    false
  );
});

test('isConsentPageState accepts sign-in-with-chatgpt routes when a continue button is visible', () => {
  assert.equal(
    isConsentPageState({
      url: 'https://auth.openai.com/sign-in-with-chatgpt/codex/consent?state=abc',
      hasVisibleContinueButton: true,
    }),
    true
  );
});

test('isConsentPageState rejects sign-in-with-chatgpt routes without a visible continue button when URL is not exact', () => {
  assert.equal(
    isConsentPageState({
      url: 'https://auth.openai.com/sign-in-with-chatgpt/codex/checkpoint',
      hasVisibleContinueButton: false,
    }),
    false
  );
});

test('hasAnyConsentPageState returns true when consent appears after an initial non-consent state', () => {
  assert.equal(
    hasAnyConsentPageState([
      {
        url: 'https://auth.openai.com/u/signup/profile',
        hasVisibleContinueButton: false,
      },
      {
        url: 'https://auth.openai.com/sign-in-with-chatgpt/codex/consent?state=abc',
        hasVisibleContinueButton: true,
      },
    ]),
    true
  );
});

test('isLoopbackCallbackUrl accepts localhost callback URLs', () => {
  assert.equal(
    isLoopbackCallbackUrl('http://localhost:1455/auth/callback?code=abc&state=123'),
    true
  );
});

test('isLoopbackCallbackUrl accepts 127.0.0.1 callback URLs', () => {
  assert.equal(
    isLoopbackCallbackUrl('http://127.0.0.1:8317/codex/callback?code=abc&state=123'),
    true
  );
});

test('isLoopbackCallbackUrl rejects non-loopback callback URLs', () => {
  assert.equal(
    isLoopbackCallbackUrl('https://example.com/callback?code=abc&state=123'),
    false
  );
});

test('findLoopbackCallbackUrl returns the first loopback callback URL from candidates', () => {
  assert.equal(
    findLoopbackCallbackUrl([
      'https://auth.openai.com/sign-in-with-chatgpt/codex/consent',
      'http://127.0.0.1:8317/codex/callback?code=abc&state=123',
      'http://localhost:1455/auth/callback?code=def&state=456',
    ]),
    'http://127.0.0.1:8317/codex/callback?code=abc&state=123'
  );
});

test('findLoopbackCallbackUrl returns null when no loopback callback URL exists', () => {
  assert.equal(
    findLoopbackCallbackUrl([
      'https://auth.openai.com/sign-in-with-chatgpt/codex/consent',
      'https://example.com/callback?code=abc&state=123',
    ]),
    null
  );
});
