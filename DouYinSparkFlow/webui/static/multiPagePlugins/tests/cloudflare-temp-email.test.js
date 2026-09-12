const test = require('node:test');
const assert = require('node:assert/strict');

const {
  combineDistinctTextParts,
  extractVerificationCode,
  generateReadableLocalPart,
  parseAdminTimestamp,
  parseCloudflareMailboxCredential,
  pickRandomSuffix,
  selectVerificationMessage,
} = require('../shared/cloudflare-temp-email.js');

function createJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}

test('parseCloudflareMailboxCredential decodes email and address id from JWT token', () => {
  const token = createJwt({
    address: 'newmask@co.example.test',
    address_id: 42,
  });

  assert.deepEqual(parseCloudflareMailboxCredential(token), {
    addressId: 42,
    domain: 'co.example.test',
    email: 'newmask@co.example.test',
    localPart: 'newmask',
    provenance: 'created',
  });
});

test('parseAdminTimestamp parses admin timestamps into epoch milliseconds', () => {
  const value = parseAdminTimestamp('2026/4/7 10:33:07');
  assert.equal(Number.isFinite(value), true);
  assert.equal(new Date(value).getFullYear(), 2026);
});

test('extractVerificationCode reads six-digit codes from mixed-language subjects', () => {
  assert.equal(extractVerificationCode('Your ChatGPT code is 377680'), '377680');
  assert.equal(extractVerificationCode('你的 ChatGPT 代码为 479637，请勿泄露。'), '479637');
});

test('combineDistinctTextParts collapses duplicated text fragments from DOM sources', () => {
  const value = combineDistinctTextParts([
    '账号',
    '账号',
    '  账号  ',
    '',
    null,
  ]);

  assert.equal(value, '账号');
});

test('combineDistinctTextParts keeps distinct fragments in order', () => {
  const value = combineDistinctTextParts([
    '邮箱地址凭证',
    'token-value',
    'token-value',
    '关闭',
  ]);

  assert.equal(value, '邮箱地址凭证 token-value 关闭');
});

test('generateReadableLocalPart creates three lowercase hyphenated words', () => {
  const value = generateReadableLocalPart(() => 0);

  assert.match(value, /^[a-z]+-[a-z]+-[a-z]+$/);
  assert.equal(value.split('-').length, 3);
});

test('generateReadableLocalPart is deterministic for a fixed random sequence', () => {
  const sequence = [0.02, 0.31, 0.58];
  let index = 0;
  const value = generateReadableLocalPart(() => sequence[index++]);

  assert.equal(value, 'anew-dotted-latch');
});

test('generateReadableLocalPart retries until the generated local part fits the max length', () => {
  const sequence = [
    0.98, 0.98, 0.98,
    0.02, 0.31, 0.58,
  ];
  let index = 0;
  const value = generateReadableLocalPart(() => sequence[index++], 20);

  assert.equal(value.length <= 20, true);
  assert.equal(value, 'anew-dotted-latch');
});

test('generateReadableLocalPart can use newly added higher-range words', () => {
  const sequence = [0.9, 0.9, 0.9];
  let index = 0;
  const value = generateReadableLocalPart(() => sequence[index++]);

  assert.equal(value, 'vantage-velvet-zephyr');
});

test('generateReadableLocalPart can use extended top-range words', () => {
  const sequence = [0.97, 0.97, 0.97];
  let index = 0;
  const value = generateReadableLocalPart(() => sequence[index++]);

  assert.equal(value, 'whimsy-marbled-solstice');
});

test('generateReadableLocalPart can use extended mid-range words', () => {
  const sequence = [0.962, 0.962, 0.962];
  let index = 0;
  const value = generateReadableLocalPart(() => sequence[index++]);

  assert.equal(value, 'ivory-rusted-starling');
});

test('generateReadableLocalPart can use extended apex-range words', () => {
  const sequence = [0.993, 0.993, 0.993];
  let index = 0;
  const value = generateReadableLocalPart(() => sequence[index++]);

  assert.equal(value, 'atlas-bronze-cosmos');
});

test('pickRandomSuffix selects a deterministic suffix from the available options', () => {
  const value = pickRandomSuffix([
    'co.example.test',
    'de.example.test',
    'ice.example.test',
    'work.example.test',
  ], () => 0.74);

  assert.equal(value, 'ice.example.test');
});

test('pickRandomSuffix ignores empty and duplicate suffix values', () => {
  const value = pickRandomSuffix([
    ' co.example.test ',
    '',
    null,
    'de.example.test',
    '@ICE.example.test',
    'de.example.test',
  ], () => 0.9);

  assert.equal(value, 'ice.example.test');
});

test('selectVerificationMessage ignores messages for other recipients', () => {
  const result = selectVerificationMessage([
    {
      combinedText: 'Your ChatGPT code is 123456',
      emailTimestamp: parseAdminTimestamp('2026/4/7 10:33:07'),
      matchedEmail: 'someone-else@co.example.test',
      messageId: '11',
      subject: 'Your ChatGPT code is 123456',
    },
  ], {
    filterAfterTimestamp: 0,
    senderFilters: ['openai'],
    subjectFilters: ['code'],
    targetEmail: 'target@co.example.test',
  });

  assert.equal(result, null);
});

test('selectVerificationMessage requires a strictly newer timestamp than filterAfterTimestamp', () => {
  const ts = parseAdminTimestamp('2026/4/7 10:33:07');
  const result = selectVerificationMessage([
    {
      combinedText: 'Enter this temporary verification code to continue: 377680',
      emailTimestamp: ts,
      matchedEmail: 'target@co.example.test',
      messageId: '11',
      subject: 'Your ChatGPT code is 377680',
    },
  ], {
    filterAfterTimestamp: ts,
    senderFilters: ['openai'],
    subjectFilters: ['code'],
    targetEmail: 'target@co.example.test',
  });

  assert.equal(result, null);
});

test('selectVerificationMessage picks the newest matching message after the threshold', () => {
  const result = selectVerificationMessage([
    {
      combinedText: '旧验证码 111111',
      emailTimestamp: parseAdminTimestamp('2026/4/7 10:30:00'),
      matchedEmail: 'target@co.example.test',
      messageId: '8',
      subject: 'Your ChatGPT code is 111111',
    },
    {
      combinedText: 'Enter this temporary verification code to continue: 377680',
      emailTimestamp: parseAdminTimestamp('2026/4/7 10:33:07'),
      matchedEmail: 'target@co.example.test',
      messageId: '11',
      subject: 'Your ChatGPT code is 377680',
    },
  ], {
    filterAfterTimestamp: parseAdminTimestamp('2026/4/7 10:31:00'),
    senderFilters: ['openai'],
    subjectFilters: ['code'],
    targetEmail: 'target@co.example.test',
  });

  assert.deepEqual(result, {
    code: '377680',
    emailTimestamp: parseAdminTimestamp('2026/4/7 10:33:07'),
    matchedEmail: 'target@co.example.test',
    messageId: '11',
    subject: 'Your ChatGPT code is 377680',
  });
});
