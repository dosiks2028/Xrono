import test from 'node:test';
import assert from 'node:assert/strict';
import { compareYear } from '../server.mjs';

test('Wordle comparison handles exact, misplaced, absent and repeated digits',() => {
  assert.deepEqual(compareYear('1123','1211'),['correct','present','present','absent']);
  assert.deepEqual(compareYear('1123','1111'),['correct','correct','absent','absent']);
  assert.deepEqual(compareYear('1211','1121'),['correct','present','present','correct']);
  assert.deepEqual(compareYear('1492','1492'),['correct','correct','correct','correct']);
  assert.deepEqual(compareYear('1492','0000'),['absent','absent','absent','absent']);
});

test('comparison rejects malformed guesses',() => {
  for (const guess of ['149','14920','14a2',' 492','']) {
    assert.throws(() => compareYear('1492',guess),TypeError);
  }
});
