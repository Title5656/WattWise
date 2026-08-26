import assert from 'node:assert/strict';
import test from 'node:test';

import { findSymbolIcons } from '../scripts/check-ui-icons.mjs';

test('finds symbol-based icons without flagging currency text', () => {
  assert.deepEqual(findSymbolIcons('<button>☰</button><p>฿1,250</p><span>→</span>'), ['☰', '→']);
  assert.deepEqual(findSymbolIcons('<p>กำลังไฟ × จำนวน</p>'), []);
  assert.deepEqual(findSymbolIcons('<button>×</button>'), ['×']);
  assert.deepEqual(findSymbolIcons('<Bell /><ArrowRight />'), []);
});
