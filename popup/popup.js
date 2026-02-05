import { buildBookmarksInfo, buildPrompt, chunkArray, parseJsonResponse } from './ai-utils.js';

// Gemini API helper
const DEFAULTS = {
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.5-flash'
  },
  openai: {
    baseUrl: 'http://127.0.0.1:2223/v1',
    model: 'local-model'
  }
};

const RATE_LIMIT_STATUS = new Set([429, 503]);

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeBaseUrl(url) {
  return url.replace(/\/+$/, '');
}

function getDefaults(provider) {
  return DEFAULTS[provider] ?? DEFAULTS.gemini;
}

function getConfigFromInputs() {
  const provider = apiProviderSelect.value;
  const defaults = getDefaults(provider);
  const baseUrl = normalizeBaseUrl(apiBaseInput.value.trim() || defaults.baseUrl);
  const model = apiModelInput.value.trim() || defaults.model;
  const apiKey = apiKeyInput.value.trim();
  return { provider, baseUrl, model, apiKey };
}

function normalizeCategoryName(category) {
  return String(category ?? '')
    .replace(/[\\／]/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitCategoryPath(category) {
  const normalized = normalizeCategoryName(category);
  if (!normalized) return [];
  return normalized.split('/').map(part => part.trim()).filter(Boolean);
}

function parseCategoryList(input) {
  if (!input) return [];
  const parts = input
    .split(/[\n,，;；]+/)
    .map(part => part.trim())
    .filter(Boolean);
  const unique = [];
  for (const part of parts) {
    if (!unique.includes(part)) {
      unique.push(part);
    }
  }
  return unique;
}

function buildCategorySummaries(assignments, bookmarks, sampleLimit = 6) {
  const summaries = new Map();

  for (const bookmark of bookmarks) {
    const entry = assignments.get(bookmark.id);
    const category = entry?.top || '其他';
    if (!summaries.has(category)) {
      summaries.set(category, { name: category, count: 0, samples: [] });
    }
    const data = summaries.get(category);
    data.count += 1;

    if (data.samples.length < sampleLimit) {
      const title = bookmark.title || '无标题';
      let sample = title;
      if (bookmark.url) {
        try {
          const hostname = new URL(bookmark.url).hostname;
          sample = `${title} (${hostname})`;
        } catch {
          sample = title;
        }
      }
      data.samples.push(sample);
    }
  }

  return Array.from(summaries.values());
}

function normalizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase();
    let pathname = url.pathname || '/';
    if (pathname.length > 1) {
      pathname = pathname.replace(/\/+$/, '');
    }
    return `${url.protocol}//${hostname}${pathname}${url.search}`;
  } catch {
    return rawUrl.trim();
  }
}

function getOtherBookmarks(assignments, bookmarks) {
  return bookmarks.filter(bookmark => {
    const entry = assignments.get(bookmark.id);
    const category = entry?.full || '其他';
    return category === '其他';
  });
}

async function getDuplicateBookmarks() {
  const { bookmarks } = await getAllBookmarks();
  const seen = new Map();
  const duplicates = [];

  for (const bookmark of bookmarks) {
    if (!bookmark.url) continue;
    const key = normalizeUrl(bookmark.url);
    if (seen.has(key)) {
      duplicates.push(bookmark);
    } else {
      seen.set(key, bookmark);
    }
  }

  return duplicates;
}

function sanitizeExportNode(node) {
  const sanitized = {
    title: node.title || '',
    url: node.url || null
  };

  if (node.children && node.children.length > 0) {
    sanitized.children = node.children.map(child => sanitizeExportNode(child));
  }

  return sanitized;
}

async function exportBookmarks() {
  const tree = await chrome.bookmarks.getTree();
  const rootChildren = tree?.[0]?.children || [];
  const payload = {
    exportedAt: new Date().toISOString(),
    tree: rootChildren.map(node => sanitizeExportNode(node))
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `bookmarks-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function importBookmarks(nodes, parentId) {
  for (const node of nodes) {
    if (node.url) {
      try {
        await chrome.bookmarks.create({
          parentId,
          title: node.title || '',
          url: node.url
        });
      } catch (error) {
        console.error('Failed to import bookmark:', node, error);
      }
    } else {
      try {
        const folder = await chrome.bookmarks.create({
          parentId,
          title: node.title || '未命名文件夹'
        });
        if (node.children && node.children.length > 0) {
          await importBookmarks(node.children, folder.id);
        }
      } catch (error) {
        console.error('Failed to import folder:', node, error);
      }
    }
  }
}

function extractImportNodes(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.tree)) return payload.tree;
  return null;
}

function buildSortPrompt(summaries) {
  const categoryNames = summaries.map(summary => summary.name);
  const lines = summaries
    .map(summary => `- ${summary.name} (${summary.count})：${summary.samples.join('；')}`)
    .join('\n');

  return `你是书签文件夹排序助手。请根据书签内容推断常用程度与通用性，给出分类排序。\n\n分类及示例：\n${lines}\n\n规则：\n1. 仅使用以下分类名，不要新增或遗漏：${categoryNames.join('、')}\n2. 返回 JSON 数组，按从常用到不常用排序，例如：["工具","技术","娱乐"]\n3. 游戏、临时、内网穿透、签到等偏不常用类别请靠后\n4. 如果无法判断，按数量多的排前\n\n只返回 JSON 数组，不要其他内容。`;
}

async function reorderTopLevelCategories(parentId, orderedNames, categorySet, cache, placeAfterNonCategories) {
  const children = await getChildrenCached(parentId, cache);
  const seen = new Set();
  const nameToNode = new Map();

  for (const child of children) {
    if (!child.url && categorySet.has(child.title)) {
      nameToNode.set(child.title, child);
    }
  }

  const orderedNodes = [];
  for (const name of orderedNames) {
    const node = nameToNode.get(name);
    if (node && !seen.has(name)) {
      orderedNodes.push(node);
      seen.add(name);
    }
  }

  for (const child of children) {
    if (!child.url && categorySet.has(child.title) && !seen.has(child.title)) {
      orderedNodes.push(child);
      seen.add(child.title);
    }
  }

  if (orderedNodes.length === 0) return;

  const nonCategoryCount = placeAfterNonCategories
    ? children.filter(child => !categorySet.has(child.title)).length
    : 0;

  for (let i = 0; i < orderedNodes.length; i++) {
    try {
      await chrome.bookmarks.move(orderedNodes[i].id, {
        parentId,
        index: nonCategoryCount + i
      });
    } catch (error) {
      console.error('Failed to reorder folder:', orderedNodes[i], error);
    }
  }
}

function normalizeCategories(categories, options) {
  const { categoryList = [], flatCategories = false, maxCategories = 0 } = options;
  const allowedSet = categoryList.length ? new Set(categoryList) : null;
  const fallback = allowedSet?.has('其他')
    ? '其他'
    : (categoryList[0] || '其他');

  const normalizedMap = new Map();

  for (const [category, indices] of Object.entries(categories)) {
    if (!Array.isArray(indices) || indices.length === 0) continue;

    let pathSegments = splitCategoryPath(category);
    if (pathSegments.length === 0) {
      pathSegments = [fallback];
    }

    let name = '';
    if (allowedSet) {
      const top = allowedSet.has(pathSegments[0]) ? pathSegments[0] : fallback;
      if (flatCategories) {
        name = top;
      } else {
        name = [top, ...pathSegments.slice(1)].join('/');
      }
    } else {
      name = flatCategories ? pathSegments[0] : pathSegments.join('/');
    }

    const finalName = name || fallback;
    if (!normalizedMap.has(finalName)) {
      normalizedMap.set(finalName, new Set());
    }
    const set = normalizedMap.get(finalName);
    for (const index of indices) {
      if (typeof index === 'number') {
        set.add(index);
      }
    }
  }

  const limit = Number.isFinite(maxCategories) ? Math.floor(maxCategories) : 0;
  if (limit > 0 && normalizedMap.size > limit) {
    const counts = Array.from(normalizedMap.entries())
      .map(([name, set]) => [name, set.size])
      .sort((a, b) => b[1] - a[1]);

    let keepNames = new Set(counts.slice(0, limit).map(([name]) => name));
    if (!keepNames.has(fallback) && normalizedMap.size > limit) {
      keepNames = new Set(counts.slice(0, Math.max(limit - 1, 0)).map(([name]) => name));
      keepNames.add(fallback);
    }

    if (!normalizedMap.has(fallback)) {
      normalizedMap.set(fallback, new Set());
    }

    for (const [name, set] of normalizedMap.entries()) {
      if (!keepNames.has(name)) {
        const fallbackSet = normalizedMap.get(fallback);
        for (const index of set) {
          fallbackSet.add(index);
        }
        normalizedMap.delete(name);
      }
    }
  }

  return normalizedMap;
}

async function getChildrenCached(parentId, cache) {
  if (cache.has(parentId)) {
    return cache.get(parentId);
  }
  const children = await chrome.bookmarks.getChildren(parentId);
  cache.set(parentId, children);
  return children;
}

async function findOrCreateFolder(parentId, title, cache) {
  const children = await getChildrenCached(parentId, cache);
  const existing = children.find(child => !child.url && child.title === title);
  if (existing) {
    return existing;
  }
  const created = await chrome.bookmarks.create({ parentId, title });
  children.push(created);
  return created;
}

async function moveBookmarksToFolder(bookmarks, folderId) {
  for (const bookmark of bookmarks) {
    try {
      await chrome.bookmarks.move(bookmark.id, { parentId: folderId });
    } catch (error) {
      console.error('Failed to move bookmark:', bookmark, error);
    }
  }
}

async function removeFoldersExcept(keepFolderIds) {
  const tree = await chrome.bookmarks.getTree();
  const rootIds = new Set(['0', '1', '2', '3']);

  async function removeNodes(nodes) {
    for (const node of nodes) {
      if (keepFolderIds.has(node.id)) {
        continue;
      }
      if (node.children) {
        if (rootIds.has(node.id)) {
          await removeNodes(node.children);
        } else {
          try {
            await chrome.bookmarks.removeTree(node.id);
          } catch (error) {
            console.error('Failed to remove folder:', node, error);
          }
        }
      }
    }
  }

  await removeNodes(tree);
}

async function moveRemainingFromBackup(tempFolderId, parentId, cache) {
  if (!tempFolderId) return 0;
  const children = await chrome.bookmarks.getChildren(tempFolderId);
  if (!children || children.length === 0) return 0;

  const otherFolder = await findOrCreateFolder(parentId, '其他', cache);
  let moved = 0;
  for (const child of children) {
    try {
      await chrome.bookmarks.move(child.id, { parentId: otherFolder.id });
      moved++;
    } catch (error) {
      console.error('Failed to move backup child:', child, error);
    }
  }
  return moved;
}

function getOpenAiEndpoint(baseUrl) {
  if (/\/(chat\/completions|completions|responses)$/.test(baseUrl)) {
    return baseUrl;
  }
  return `${baseUrl}/chat/completions`;
}

async function callGemini({ apiKey, baseUrl, model }, prompt) {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const url = `${normalizeBaseUrl(baseUrl)}/models/${model}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4096
        }
      })
    });

    if (!response.ok) {
      let errorMessage = 'API 调用失败';
      try {
        const error = await response.json();
        errorMessage = error.error?.message || errorMessage;
      } catch {
        // ignore parse error
      }

      const shouldRetry = RATE_LIMIT_STATUS.has(response.status);
      if (shouldRetry && attempt < maxAttempts) {
        await sleep(800 * attempt);
        continue;
      }

      if (/quota|rate limit/i.test(errorMessage)) {
        throw new Error('Gemini 配额或速率限制已用尽，请检查方案/计费或稍后重试');
      }

      throw new Error(errorMessage);
    }

    const data = await response.json();
    console.log('Gemini raw response:', data);
    
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!text) {
      throw new Error('API 返回为空');
    }

    console.log('Gemini text:', text);
    return text;
  }
}

async function callOpenAi({ apiKey, baseUrl, model }, prompt) {
  const maxAttempts = 3;
  const url = getOpenAiEndpoint(normalizeBaseUrl(baseUrl));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 4096
      })
    });

    if (!response.ok) {
      let errorMessage = 'API 调用失败';
      try {
        const error = await response.json();
        errorMessage = error.error?.message || errorMessage;
      } catch {
        // ignore parse error
      }

      const shouldRetry = RATE_LIMIT_STATUS.has(response.status);
      if (shouldRetry && attempt < maxAttempts) {
        await sleep(800 * attempt);
        continue;
      }

      throw new Error(errorMessage);
    }

    const data = await response.json();
    console.log('OpenAI raw response:', data);

    const text = data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text;
    if (!text) {
      throw new Error('API 返回为空');
    }

    console.log('OpenAI text:', text);
    return text;
  }
}

async function callModel(config, prompt) {
  if (config.provider === 'openai') {
    return callOpenAi(config, prompt);
  }
  return callGemini(config, prompt);
}

const BOOKMARKS_PER_BATCH = 50;
const CHECK_CONCURRENCY = 100;

// DOM elements
const apiProviderSelect = document.getElementById('api-provider');
const apiBaseInput = document.getElementById('api-base');
const apiModelInput = document.getElementById('api-model');
const autoDeleteCheckbox = document.getElementById('auto-delete');
const cleanupBeforeCheckbox = document.getElementById('cleanup-before');
const strictCheckCheckbox = document.getElementById('strict-check');
const aiSortCheckbox = document.getElementById('ai-sort');
const reviewOtherCheckbox = document.getElementById('review-other');
const resetStructureCheckbox = document.getElementById('reset-structure');
const flatCategoriesCheckbox = document.getElementById('flat-categories');
const maxCategoriesInput = document.getElementById('max-categories');
const customCategoriesInput = document.getElementById('custom-categories');
const apiKeyInput = document.getElementById('api-key');
const saveKeyBtn = document.getElementById('save-key');
const keyStatus = document.getElementById('key-status');
const totalBookmarksEl = document.getElementById('total-bookmarks');
const foldersCountEl = document.getElementById('folders-count');
const deadBookmarksEl = document.getElementById('dead-bookmarks');
const organizeBtn = document.getElementById('organize-btn');
const checkDeadBtn = document.getElementById('check-dead-btn');
const deadBookmarksSection = document.getElementById('dead-bookmarks-section');
const deadBookmarksList = document.getElementById('dead-bookmarks-list');
const deleteDeadBtn = document.getElementById('delete-dead-btn');
const exportBtn = document.getElementById('export-btn');
const importBtn = document.getElementById('import-btn');
const importFileInput = document.getElementById('import-file');
const dedupeBtn = document.getElementById('dedupe-btn');
const loadingEl = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');
const messageEl = document.getElementById('message');

let deadBookmarkIds = [];

// Get all bookmarks recursively
async function getAllBookmarks() {
  const tree = await chrome.bookmarks.getTree();
  const bookmarks = [];
  const folders = [];
  
  function traverse(nodes) {
    for (const node of nodes) {
      if (node.url) {
        bookmarks.push(node);
      } else if (node.children) {
        if (node.title) folders.push(node);
        traverse(node.children);
      }
    }
  }
  
  traverse(tree);
  return { bookmarks, folders };
}

// Initialize
async function init() {
  // Load saved API settings
  const stored = await chrome.storage.sync.get([
    'apiProvider',
    'apiBaseUrl',
    'apiModel',
    'autoDeleteDead',
    'cleanupBeforeOrganize',
    'strictDeadCheck',
    'aiSortCategories',
    'reviewOtherCategories',
    'resetBeforeOrganize',
    'flatCategories',
    'maxCategories',
    'customCategories',
    'apiKey',
    'geminiApiKey'
  ]);

  const provider = stored.apiProvider || 'gemini';
  const defaults = getDefaults(provider);
  apiProviderSelect.value = provider;
  apiBaseInput.value = stored.apiBaseUrl || defaults.baseUrl;
  apiModelInput.value = stored.apiModel || defaults.model;
  autoDeleteCheckbox.checked = stored.autoDeleteDead ?? true;
  cleanupBeforeCheckbox.checked = stored.cleanupBeforeOrganize ?? false;
  strictCheckCheckbox.checked = stored.strictDeadCheck ?? false;
  aiSortCheckbox.checked = stored.aiSortCategories ?? true;
  reviewOtherCheckbox.checked = stored.reviewOtherCategories ?? true;
  resetStructureCheckbox.checked = stored.resetBeforeOrganize ?? true;
  flatCategoriesCheckbox.checked = stored.flatCategories ?? true;
  maxCategoriesInput.value = stored.maxCategories ?? 12;
  customCategoriesInput.value = stored.customCategories || '';
  apiKeyInput.value = stored.apiKey || stored.geminiApiKey || '';

  if (apiKeyInput.value) {
    keyStatus.textContent = '✓ 设置已加载';
    keyStatus.className = 'status success';
  }

  // Update stats
  await updateStats();
}

// Update statistics
async function updateStats() {
  const { bookmarks, folders } = await getAllBookmarks();
  totalBookmarksEl.textContent = bookmarks.length;
  foldersCountEl.textContent = folders.length;
}

// Save API key
saveKeyBtn.addEventListener('click', async () => {
  const config = getConfigFromInputs();
  if (!config.baseUrl || !config.model) {
    keyStatus.textContent = '请填写 API Base 和 Model';
    keyStatus.className = 'status error';
    return;
  }

  await chrome.storage.sync.set({
    apiProvider: config.provider,
    apiBaseUrl: config.baseUrl,
    apiModel: config.model,
    autoDeleteDead: autoDeleteCheckbox.checked,
    cleanupBeforeOrganize: cleanupBeforeCheckbox.checked,
    strictDeadCheck: strictCheckCheckbox.checked,
    aiSortCategories: aiSortCheckbox.checked,
    reviewOtherCategories: reviewOtherCheckbox.checked,
    resetBeforeOrganize: resetStructureCheckbox.checked,
    flatCategories: flatCategoriesCheckbox.checked,
    maxCategories: Number(maxCategoriesInput.value) || 0,
    customCategories: customCategoriesInput.value.trim(),
    apiKey: config.apiKey
  });

  keyStatus.textContent = '✓ 设置已保存';
  keyStatus.className = 'status success';
});

apiProviderSelect.addEventListener('change', () => {
  const defaults = getDefaults(apiProviderSelect.value);
  if (!apiBaseInput.value.trim()) {
    apiBaseInput.value = defaults.baseUrl;
  }
  if (!apiModelInput.value.trim()) {
    apiModelInput.value = defaults.model;
  }
});

// Show loading
function showLoading(text) {
  loadingText.textContent = text;
  loadingEl.style.display = 'flex';
  organizeBtn.disabled = true;
  checkDeadBtn.disabled = true;
}

// Hide loading
function hideLoading() {
  loadingEl.style.display = 'none';
  organizeBtn.disabled = false;
  checkDeadBtn.disabled = false;
}

// Show message
function showMessage(text, type = 'success') {
  messageEl.textContent = text;
  messageEl.className = `message ${type}`;
  messageEl.style.display = 'block';
  setTimeout(() => {
    messageEl.style.display = 'none';
  }, 5000);
}

async function deleteDeadBookmarks({ confirmDelete } = { confirmDelete: true }) {
  if (deadBookmarkIds.length === 0) return { deleted: 0, failed: 0 };

  if (confirmDelete) {
    if (!confirm(`确定要删除 ${deadBookmarkIds.length} 个失效书签吗？此操作不可撤销！`)) {
      return { deleted: 0, failed: 0 };
    }
  }

  let deleted = 0;
  let failed = 0;
  for (const id of deadBookmarkIds) {
    try {
      await chrome.bookmarks.remove(id);
      deleted++;
    } catch (e) {
      failed++;
      console.error('Failed to remove bookmark:', e);
    }
  }

  deadBookmarkIds = [];
  deadBookmarksList.innerHTML = '';
  deadBookmarksSection.style.display = 'none';
  deadBookmarksEl.textContent = '0';
  await updateStats();
  return { deleted, failed };
}

async function detectDeadBookmarks({ showProgress = true, listDead = false, strictCheck = false } = {}) {
  deadBookmarkIds = [];
  if (listDead) {
    deadBookmarksList.innerHTML = '';
  }

  const { bookmarks } = await getAllBookmarks();
  const httpBookmarks = bookmarks.filter(b => b.url && b.url.startsWith('http'));

  let checked = 0;
  const total = httpBookmarks.length;
  let deadCount = 0;

  for (let i = 0; i < httpBookmarks.length; i += CHECK_CONCURRENCY) {
    const chunk = httpBookmarks.slice(i, i + CHECK_CONCURRENCY);

    const results = await Promise.allSettled(
      chunk.map(bookmark => chrome.runtime.sendMessage({
        action: 'checkUrl',
        url: bookmark.url,
        strict: strictCheck
      }))
    );

    results.forEach((result, index) => {
      const bookmark = chunk[index];
      if (!bookmark) return;

      if (result.status === 'fulfilled') {
        const checkResult = result.value;
        if (!checkResult.alive) {
          deadBookmarkIds.push(bookmark.id);
          if (listDead) {
            const li = document.createElement('li');
            li.innerHTML = `
              <span class="dead-title">${bookmark.title || '无标题'}</span>
              <span class="dead-status">${checkResult.status || checkResult.error || '无法访问'}</span>
              <br><span class="dead-url">${bookmark.url}</span>
            `;
            li.title = bookmark.url;
            deadBookmarksList.appendChild(li);
          }
          deadCount++;
        }
      } else {
        console.error('Check error for', bookmark.url, result.reason);
      }
    });

    checked += chunk.length;
    if (showProgress && total > 0) {
      showLoading(`检测中 (${checked}/${total})...`);
    }
  }

  return { deadCount, total };
}

async function scanAndDeleteDeadBookmarks({ showProgress = true, strictCheck = false } = {}) {
  try {
    await detectDeadBookmarks({ showProgress, listDead: false, strictCheck });
    const { deleted, failed } = await deleteDeadBookmarks({ confirmDelete: false });
    return { deleted, failed };
  } finally {
    deadBookmarkIds = [];
  }
}

// AI Organize bookmarks
organizeBtn.addEventListener('click', async () => {
  const config = getConfigFromInputs();
  if (config.provider === 'gemini' && !config.apiKey) {
    showMessage('请先设置 Gemini API Key', 'error');
    return;
  }
  if (!config.baseUrl || !config.model) {
    showMessage('请先设置 API Base 和 Model', 'error');
    return;
  }

  showLoading('正在获取书签...');

  try {
    if (cleanupBeforeCheckbox.checked) {
      showLoading('分类前清理失效书签...');
      const { deleted, failed } = await scanAndDeleteDeadBookmarks({
        showProgress: true,
        strictCheck: strictCheckCheckbox.checked
      });
      if (failed > 0) {
        showMessage(`清理完成：删除 ${deleted} 个，失败 ${failed} 个`, 'error');
      } else if (deleted > 0) {
        showMessage(`清理完成：已删除 ${deleted} 个失效书签`);
      }
    }

    const { bookmarks } = await getAllBookmarks();
    
    if (bookmarks.length === 0) {
      showMessage('没有书签可以分类', 'error');
      hideLoading();
      return;
    }

    const batches = chunkArray(bookmarks, BOOKMARKS_PER_BATCH);
    const categoryList = parseCategoryList(customCategoriesInput.value);
    const maxCategories = Number(maxCategoriesInput.value) || 0;
    const flatCategories = flatCategoriesCheckbox.checked;

    // Put AI folders in Bookmark Bar (id: "1")
    const parentId = "1";
    const shouldReset = resetStructureCheckbox.checked;
    let tempFolderId = null;
    let tempFolderTitle = null;
    let resetCompleted = false;

    if (shouldReset) {
      const confirmReset = confirm('将会清空现有书签文件夹结构，并重新分类所有书签。是否继续？');
      if (!confirmReset) {
        hideLoading();
        return;
      }

      const timestamp = new Date().toLocaleString('zh-CN', { 
        month: 'numeric', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit' 
      });
      tempFolderTitle = `AI_备份_${timestamp}`;

      showLoading('正在备份书签...');
      const tempFolder = await chrome.bookmarks.create({
        parentId,
        title: tempFolderTitle
      });
      tempFolderId = tempFolder.id;
      await moveBookmarksToFolder(bookmarks, tempFolderId);

      showLoading('正在清空原有分类...');
      await removeFoldersExcept(new Set([tempFolderId]));
    }

    let movedCount = 0;
    const folderCache = new Map();
    const usedCategoryPaths = new Set();
    const batchPlans = [];
    const globalCategoryCounts = new Map();

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const bookmarksToProcess = batches[batchIndex];
      const batchLabel = `${batchIndex + 1}/${batches.length}`;

      try {
        const bookmarksInfo = buildBookmarksInfo(bookmarksToProcess);
        const prompt = buildPrompt(bookmarksInfo, {
          categoryList,
          maxCategories,
          flatCategories
        });

        showLoading(`AI 正在分析 (${batchLabel})...`);
        const result = await callModel(config, prompt);

        const categories = parseJsonResponse(result);
        if (!categories || typeof categories !== 'object' || Object.keys(categories).length === 0) {
          throw new Error('AI 返回格式不正确，请重试');
        }

        showLoading(`正在整理书签 (${batchLabel})...`);

        const normalizedCategories = normalizeCategories(categories, {
          categoryList,
          maxCategories: 0,
          flatCategories
        });

        for (const [category, indexSet] of normalizedCategories.entries()) {
          const current = globalCategoryCounts.get(category) || 0;
          globalCategoryCounts.set(category, current + indexSet.size);
        }

        batchPlans.push({ bookmarks: bookmarksToProcess, categories: normalizedCategories });
      } catch (error) {
        throw new Error(`第 ${batchLabel} 批处理失败：${error.message}`);
      }
    }

    let allowedCategories = null;
    if (categoryList.length > 0) {
      allowedCategories = new Set(categoryList);
    } else if (maxCategories > 0) {
      const sorted = Array.from(globalCategoryCounts.entries())
        .sort((a, b) => b[1] - a[1]);
      const topNames = sorted.slice(0, maxCategories).map(([name]) => name);
      if (!topNames.includes('其他')) {
        if (topNames.length >= maxCategories) {
          topNames[topNames.length - 1] = '其他';
        } else {
          topNames.push('其他');
        }
      }
      allowedCategories = new Set(topNames);
    }

    const assignments = new Map();
    const categoryCounts = new Map();
    const otherBookmarks = [];

    for (const plan of batchPlans) {
      for (const [category, indexSet] of plan.categories.entries()) {
        let finalCategory = category;
        if (allowedCategories && !allowedCategories.has(finalCategory)) {
          finalCategory = '其他';
        }

        const indices = Array.from(indexSet);
        if (indices.length === 0) continue;

        for (const index of indices) {
          if (typeof index === 'number' && index >= 0 && index < plan.bookmarks.length) {
            const bookmark = plan.bookmarks[index];
            if (!bookmark) continue;
            const pathSegments = splitCategoryPath(finalCategory);
            const fullCategory = pathSegments.join('/') || '其他';
            const topCategory = pathSegments[0] || '其他';
            assignments.set(bookmark.id, { full: fullCategory, top: topCategory });
            categoryCounts.set(fullCategory, (categoryCounts.get(fullCategory) || 0) + 1);
            if (fullCategory === '其他') {
              otherBookmarks.push(bookmark);
            }
          }
        }
      }
    }

    let promotedCategory = null;

    if (maxCategories > 0 && categoryList.length === 0 && otherBookmarks.length > 0 && allowedCategories?.has('其他')) {
      showLoading('正在细分“其他”...');
      const otherBatches = chunkArray(otherBookmarks, BOOKMARKS_PER_BATCH);
      const otherCategoryCounts = new Map();
      const otherPlans = [];

      for (let otherIndex = 0; otherIndex < otherBatches.length; otherIndex++) {
        const otherBatch = otherBatches[otherIndex];
        const otherLabel = `${otherIndex + 1}/${otherBatches.length}`;
        try {
          const otherInfo = buildBookmarksInfo(otherBatch);
          const otherPrompt = buildPrompt(otherInfo, {
            maxCategories: Math.min(6, maxCategories),
            flatCategories
          });
          showLoading(`细分“其他” (${otherLabel})...`);
          const otherResult = await callModel(config, otherPrompt);
          const otherCategories = parseJsonResponse(otherResult);
          if (!otherCategories || typeof otherCategories !== 'object' || Object.keys(otherCategories).length === 0) {
            throw new Error('AI 返回格式不正确，请重试');
          }
          const normalizedOther = normalizeCategories(otherCategories, {
            maxCategories: 0,
            flatCategories
          });

          for (const [category, indexSet] of normalizedOther.entries()) {
            const current = otherCategoryCounts.get(category) || 0;
            otherCategoryCounts.set(category, current + indexSet.size);
          }

          otherPlans.push({ bookmarks: otherBatch, categories: normalizedOther });
        } catch (error) {
          throw new Error(`细分“其他”失败：${error.message}`);
        }
      }

      const sortedOther = Array.from(otherCategoryCounts.entries())
        .filter(([name]) => name !== '其他')
        .sort((a, b) => b[1] - a[1]);

      const topOther = sortedOther[0];
      if (topOther) {
        const [candidate, candidateCount] = topOther;
        const existingCounts = Array.from(categoryCounts.entries())
          .filter(([name]) => name !== '其他')
          .sort((a, b) => a[1] - b[1]);
        const smallest = existingCounts[0];

        if (!smallest || candidateCount > smallest[1]) {
          promotedCategory = candidate;
          let removedCategory = null;

          if (allowedCategories && allowedCategories.size >= maxCategories && smallest) {
            removedCategory = smallest[0];
            allowedCategories.delete(removedCategory);
          }

          if (allowedCategories) {
            allowedCategories.add(promotedCategory);
          }

          if (removedCategory) {
            for (const [id, entry] of assignments.entries()) {
              if (entry.full === removedCategory) {
                assignments.set(id, { full: '其他', top: '其他' });
              }
            }
          }

          for (const plan of otherPlans) {
            for (const [category, indexSet] of plan.categories.entries()) {
              if (category !== promotedCategory) continue;
              for (const index of indexSet) {
                if (typeof index === 'number' && index >= 0 && index < plan.bookmarks.length) {
                  const bookmark = plan.bookmarks[index];
                  if (bookmark) {
                    assignments.set(bookmark.id, { full: promotedCategory, top: splitCategoryPath(promotedCategory)[0] || '其他' });
                  }
                }
              }
            }
          }
        }
      }
    }

    if (reviewOtherCheckbox.checked) {
      const existingCategories = Array.from(new Set(
        Array.from(assignments.values())
          .map(entry => entry.full)
          .filter(category => category && category !== '其他')
      ));

      if (existingCategories.length > 0) {
        const reviewTargets = getOtherBookmarks(assignments, bookmarks);
        if (reviewTargets.length > 0) {
          showLoading('正在复查“其他”...');
          const reviewBatches = chunkArray(reviewTargets, BOOKMARKS_PER_BATCH);
          const reviewCategoryList = [...existingCategories, '其他'];

          for (let reviewIndex = 0; reviewIndex < reviewBatches.length; reviewIndex++) {
            const batch = reviewBatches[reviewIndex];
            const batchLabel = `${reviewIndex + 1}/${reviewBatches.length}`;

            try {
              const info = buildBookmarksInfo(batch);
              const prompt = buildPrompt(info, {
                categoryList: reviewCategoryList,
                maxCategories: 0,
                flatCategories
              });

              showLoading(`复查“其他” (${batchLabel})...`);
              const result = await callModel(config, prompt);
              const categories = parseJsonResponse(result);
              if (!categories || typeof categories !== 'object' || Object.keys(categories).length === 0) {
                continue;
              }

              const normalized = normalizeCategories(categories, {
                categoryList: reviewCategoryList,
                maxCategories: 0,
                flatCategories
              });

              for (const [category, indexSet] of normalized.entries()) {
                for (const index of indexSet) {
                  if (typeof index === 'number' && index >= 0 && index < batch.length) {
                    const bookmark = batch[index];
                    if (bookmark) {
                      const pathSegments = splitCategoryPath(category);
                      const fullCategory = pathSegments.join('/') || '其他';
                      const topCategory = pathSegments[0] || '其他';
                      assignments.set(bookmark.id, { full: fullCategory, top: topCategory });
                    }
                  }
                }
              }
            } catch (error) {
              console.error('Review other error:', error);
            }
          }
        }
      }
    }

    for (const bookmark of bookmarks) {
      const entry = assignments.get(bookmark.id);
      const finalCategory = entry?.full || '其他';

      const pathSegments = splitCategoryPath(finalCategory);
      if (pathSegments.length === 0) continue;

      let currentParentId = parentId;
      for (const segment of pathSegments) {
        const folder = await findOrCreateFolder(currentParentId, segment, folderCache);
        currentParentId = folder.id;
      }
      usedCategoryPaths.add(pathSegments.join('/'));

      try {
        await chrome.bookmarks.move(bookmark.id, {
          parentId: currentParentId
        });
        movedCount++;
      } catch (e) {
        console.error('Failed to move bookmark:', e);
      }
    }

    if (aiSortCheckbox.checked) {
      try {
        const summaries = buildCategorySummaries(assignments, bookmarks, 6);
        if (summaries.length > 0) {
          showLoading('AI 正在排序分类...');
          const sortPrompt = buildSortPrompt(summaries);
          const sortResult = await callModel(config, sortPrompt);
          const ordered = parseJsonResponse(sortResult);
          if (Array.isArray(ordered) && ordered.length > 0) {
            const topCategorySet = new Set(summaries.map(summary => summary.name));
            await reorderTopLevelCategories(parentId, ordered, topCategorySet, folderCache, !shouldReset);
          }
        }
      } catch (error) {
        console.error('AI sort error:', error);
      }
    }

    resetCompleted = true;

    if (tempFolderId) {
      const movedFromBackup = await moveRemainingFromBackup(tempFolderId, parentId, folderCache);
      if (movedFromBackup > 0) {
        usedCategoryPaths.add('其他');
        movedCount += movedFromBackup;
      }
      try {
        await chrome.bookmarks.removeTree(tempFolderId);
      } catch (error) {
        console.error('Failed to remove temp folder:', error);
      }
    }

    await updateStats();
    if (promotedCategory) {
      showMessage(`✓ 已整理 ${movedCount} 个书签到 ${usedCategoryPaths.size} 个分类（其他拆出：${promotedCategory}）`);
    } else {
      showMessage(`✓ 已整理 ${movedCount} 个书签到 ${usedCategoryPaths.size} 个分类`);
    }
  } catch (error) {
    console.error('Organize error:', error);
    if (tempFolderTitle && !resetCompleted) {
      showMessage(`${error.message}（已备份到 ${tempFolderTitle}）`, 'error');
    } else {
      showMessage(error.message, 'error');
    }
  } finally {
    hideLoading();
  }
});

// Check dead bookmarks via background script
checkDeadBtn.addEventListener('click', async () => {
  showLoading('正在检测失效书签...');
  deadBookmarkIds = [];
  deadBookmarksList.innerHTML = '';
  deadBookmarksSection.style.display = 'none';

  try {
    const shouldListDead = !autoDeleteCheckbox.checked;
    const { deadCount } = await detectDeadBookmarks({
      showProgress: true,
      listDead: shouldListDead,
      strictCheck: strictCheckCheckbox.checked
    });

    deadBookmarksEl.textContent = deadCount;

    if (deadCount > 0) {
      if (autoDeleteCheckbox.checked) {
        showLoading(`正在删除 ${deadCount} 个失效书签...`);
        const { deleted, failed } = await deleteDeadBookmarks({ confirmDelete: false });
        if (failed > 0) {
          showMessage(`已删除 ${deleted} 个，${failed} 个删除失败`, 'error');
        } else {
          showMessage(`✓ 已删除 ${deleted} 个失效书签`);
        }
      } else {
        deadBookmarksSection.style.display = 'block';
        showMessage(`发现 ${deadCount} 个失效书签`);
      }
    } else {
      deadBookmarksSection.style.display = 'none';
      showMessage('✓ 所有书签都正常');
    }
  } catch (error) {
    console.error('Check dead error:', error);
    showMessage(error.message, 'error');
  } finally {
    hideLoading();
  }
});

// Delete dead bookmarks
deleteDeadBtn.addEventListener('click', async () => {
  const { deleted, failed } = await deleteDeadBookmarks({ confirmDelete: true });
  if (deleted === 0 && failed === 0) return;
  if (failed > 0) {
    showMessage(`已删除 ${deleted} 个，${failed} 个删除失败`, 'error');
  } else {
    showMessage(`✓ 已删除 ${deleted} 个失效书签`);
  }
});

exportBtn.addEventListener('click', async () => {
  showLoading('正在导出书签...');
  try {
    await exportBookmarks();
    showMessage('✓ 已导出书签');
  } catch (error) {
    console.error('Export error:', error);
    showMessage(error.message || '导出失败', 'error');
  } finally {
    hideLoading();
  }
});

importBtn.addEventListener('click', () => {
  importFileInput.click();
});

importFileInput.addEventListener('change', async () => {
  const file = importFileInput.files?.[0];
  if (!file) return;

  showLoading('正在导入书签...');
  try {
    const content = await file.text();
    const payload = JSON.parse(content);
    const nodes = extractImportNodes(payload);
    if (!nodes) {
      throw new Error('导入文件格式不正确');
    }

    if (!confirm('将导入书签到书签栏下的新文件夹，是否继续？')) {
      return;
    }

    const timestamp = new Date().toLocaleString('zh-CN', { 
      month: 'numeric', 
      day: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    const parentId = '1';
    const folder = await chrome.bookmarks.create({
      parentId,
      title: `导入 ${timestamp}`
    });

    await importBookmarks(nodes, folder.id);
    await updateStats();
    showMessage('✓ 导入完成');
  } catch (error) {
    console.error('Import error:', error);
    showMessage(error.message || '导入失败', 'error');
  } finally {
    importFileInput.value = '';
    hideLoading();
  }
});

dedupeBtn.addEventListener('click', async () => {
  showLoading('正在查找重复书签...');
  try {
    const duplicates = await getDuplicateBookmarks();
    if (duplicates.length === 0) {
      showMessage('没有发现重复书签');
      return;
    }

    if (!confirm(`发现 ${duplicates.length} 个重复书签，是否删除？`)) {
      return;
    }

    let deleted = 0;
    for (const bookmark of duplicates) {
      try {
        await chrome.bookmarks.remove(bookmark.id);
        deleted++;
      } catch (error) {
        console.error('Failed to remove duplicate:', bookmark, error);
      }
    }

    await updateStats();
    showMessage(`✓ 已删除 ${deleted} 个重复书签`);
  } catch (error) {
    console.error('Dedupe error:', error);
    showMessage(error.message || '去重失败', 'error');
  } finally {
    hideLoading();
  }
});

// Initialize on load
init();
