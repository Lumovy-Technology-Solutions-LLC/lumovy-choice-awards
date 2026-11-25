import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OTP_REDACTED } from '../src/lib/mail.js';

test('redacted sign-in email carries no digits', () => {
  for (const v of Object.values(OTP_REDACTED)) assert.doesNotMatch(v, /\d{4,}/);
});
