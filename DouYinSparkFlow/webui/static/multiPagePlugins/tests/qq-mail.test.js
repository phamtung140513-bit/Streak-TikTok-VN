const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractVerificationCode,
  findNewQQVerificationCode,
} = require('../shared/qq-mail.js');

test('extractVerificationCode reads 6-digit codes from QQ mail text', () => {
  assert.equal(
    extractVerificationCode('你的 ChatGPT 代码为 479637，请勿泄露。'),
    '479637'
  );
});

test('findNewQQVerificationCode rejects matching emails that already existed before polling', () => {
  const result = findNewQQVerificationCode([
    {
      mailId: 'old-1',
      sender: 'OpenAI',
      subject: '你的 ChatGPT 代码为 479637',
      digest: '用于验证你的邮箱地址',
    },
  ], {
    existingMailIds: ['old-1'],
    senderFilters: ['openai', 'verify'],
    subjectFilters: ['code', '验证'],
  });

  assert.equal(result, null);
});

test('findNewQQVerificationCode accepts the first new matching email', () => {
  const result = findNewQQVerificationCode([
    {
      mailId: 'old-1',
      sender: 'OpenAI',
      subject: '你的 ChatGPT 代码为 111111',
      digest: '旧邮件',
    },
    {
      mailId: 'new-1',
      sender: 'OpenAI',
      subject: '你的 ChatGPT 代码为 222222',
      digest: '新邮件',
    },
  ], {
    existingMailIds: ['old-1'],
    senderFilters: ['openai', 'verify'],
    subjectFilters: ['code', '验证'],
  });

  assert.deepEqual(result, {
    code: '222222',
    mailId: 'new-1',
    source: 'new',
    subject: '你的 ChatGPT 代码为 222222',
  });
});
