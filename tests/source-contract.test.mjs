import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

test('profile and card management sources use GAS extensions', () => {
  assert.equal(fs.existsSync(path.join(root, 'Profiles.gs')), true);
  assert.equal(fs.existsSync(path.join(root, 'Cards.gs')), true);
  assert.equal(fs.existsSync(path.join(root, 'Profiles')), false);
  assert.equal(fs.existsSync(path.join(root, 'Cards')), false);
});

test('spreadsheet menu functions are present in deployable sources', () => {
  const profileSource = fs.readFileSync(path.join(root, 'Profiles.gs'), 'utf8');
  const cardSource = fs.readFileSync(path.join(root, 'Cards.gs'), 'utf8');

  assert.match(profileSource, /^function confirmAndSyncProfiles\s*\(/m);
  assert.match(cardSource, /^function syncCardsNow\s*\(/m);
});
