const test = require('node:test');
const assert = require('node:assert');
const m = require('./solution');
test('simple', () => assert.strictEqual(m.isPalindrome('Racecar'), true));
test('not', () => assert.strictEqual(m.isPalindrome('hello'), false));
