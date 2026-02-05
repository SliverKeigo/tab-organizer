import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBookmarksInfo, buildPrompt, chunkArray, parseJsonResponse } from '../popup/ai-utils.js';

test('chunkArray splits items into batches', () => {
  const items = [1, 2, 3, 4, 5, 6, 7];
  const batches = chunkArray(items, 3);
  assert.deepEqual(batches, [[1, 2, 3], [4, 5, 6], [7]]);
});

test('buildBookmarksInfo includes indices and hostnames', () => {
  const bookmarks = [
    { title: 'Example', url: 'https://example.com/path' },
    { title: '', url: 'not-a-url' }
  ];
  const info = buildBookmarksInfo(bookmarks);
  assert.equal(info, '0. Example (example.com)\n1. 无标题');
});

test('buildPrompt injects bookmarks info and instructions', () => {
  const info = '0. Example (example.com)';
  const prompt = buildPrompt(info);
  assert.ok(prompt.includes(info));
  assert.ok(prompt.includes('只返回JSON'));
});

test('parseJsonResponse handles fenced JSON', () => {
  const text = '```json\n{"技术": [0, 1]}\n```';
  const result = parseJsonResponse(text);
  assert.deepEqual(result, { '技术': [0, 1] });
});

test('parseJsonResponse extracts JSON from mixed text', () => {
  const text = 'Here is result: {"技术": [2]} end.';
  const result = parseJsonResponse(text);
  assert.deepEqual(result, { '技术': [2] });
});

test('parseJsonResponse handles JSON array', () => {
  const text = 'Result: ["工具", "娱乐"]';
  const result = parseJsonResponse(text);
  assert.deepEqual(result, ['工具', '娱乐']);
});

test('parseJsonResponse throws on invalid JSON', () => {
  assert.throws(() => parseJsonResponse('no json here'));
});
