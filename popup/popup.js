// Gemini API helper
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

async function callGemini(apiKey, prompt) {
  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 4096,
      }
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'API 调用失败');
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  
  if (!text) {
    throw new Error('API 返回为空');
  }

  return text;
}

// DOM elements
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
  // Load saved API key
  const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');
  if (geminiApiKey) {
    apiKeyInput.value = geminiApiKey;
    keyStatus.textContent = '✓ API Key 已保存';
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
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    keyStatus.textContent = '请输入 API Key';
    keyStatus.className = 'status error';
    return;
  }

  await chrome.storage.sync.set({ geminiApiKey: apiKey });
  keyStatus.textContent = '✓ API Key 已保存';
  keyStatus.className = 'status success';
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
  }, 3000);
}

// Find or create folder
async function findOrCreateFolder(name, parentId) {
  // Search for existing folder
  const results = await chrome.bookmarks.search({ title: name });
  const existingFolder = results.find(b => !b.url && b.parentId === parentId);
  
  if (existingFolder) {
    return existingFolder.id;
  }
  
  // Create new folder
  const newFolder = await chrome.bookmarks.create({
    parentId: parentId,
    title: name
  });
  
  return newFolder.id;
}

// AI Organize bookmarks
organizeBtn.addEventListener('click', async () => {
  const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');
  if (!geminiApiKey) {
    showMessage('请先设置 API Key', 'error');
    return;
  }

  showLoading('正在获取书签...');

  try {
    const { bookmarks } = await getAllBookmarks();
    
    if (bookmarks.length === 0) {
      showMessage('没有书签可以分类', 'error');
      hideLoading();
      return;
    }

    // Limit to first 100 bookmarks to avoid token limits
    const bookmarksToProcess = bookmarks.slice(0, 100);
    
    // Prepare bookmarks info for AI
    const bookmarksInfo = bookmarksToProcess.map((b, index) => 
      `${index}. ${b.title} (${new URL(b.url).hostname})`
    ).join('\n');

    const prompt = `你是一个书签分类助手。请将以下浏览器书签分类到合适的文件夹中。

书签列表：
${bookmarksInfo}

请返回 JSON 格式，key 是分类名称（简短的中文，如：工作、技术文档、社交媒体、娱乐、购物、新闻资讯、学习资源、工具网站、其他），value 是书签索引数组。
只返回 JSON，不要其他内容。

示例格式：
{"技术文档": [0, 3, 5], "社交媒体": [1, 2], "娱乐": [4]}`;

    showLoading('AI 正在分析...');
    const result = await callGemini(geminiApiKey, prompt);
    
    // Parse JSON from response
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('无法解析 AI 返回结果');
    }

    const categories = JSON.parse(jsonMatch[0]);
    
    showLoading('正在整理书签...');

    // Get the "Other Bookmarks" folder (id: "2" is usually "Other Bookmarks")
    const bookmarkBar = await chrome.bookmarks.get("1"); // Bookmark Bar
    const parentId = "1"; // Put AI folders in Bookmark Bar

    // Create an "AI 分类" parent folder
    const aiFolder = await chrome.bookmarks.create({
      parentId: parentId,
      title: '📁 AI 分类'
    });

    let movedCount = 0;

    // Create folders and move bookmarks
    for (const [category, indices] of Object.entries(categories)) {
      if (!Array.isArray(indices) || indices.length === 0) continue;

      // Create category folder
      const categoryFolder = await chrome.bookmarks.create({
        parentId: aiFolder.id,
        title: category
      });

      // Move bookmarks to this folder
      for (const index of indices) {
        if (index >= 0 && index < bookmarksToProcess.length) {
          try {
            await chrome.bookmarks.move(bookmarksToProcess[index].id, {
              parentId: categoryFolder.id
            });
            movedCount++;
          } catch (e) {
            console.error('Failed to move bookmark:', e);
          }
        }
      }
    }

    await updateStats();
    showMessage(`✓ 已整理 ${movedCount} 个书签到 ${Object.keys(categories).length} 个分类`);
  } catch (error) {
    console.error(error);
    showMessage(error.message, 'error');
  } finally {
    hideLoading();
  }
});

// Check dead bookmarks
checkDeadBtn.addEventListener('click', async () => {
  showLoading('正在检测失效书签...');
  deadBookmarkIds = [];
  deadBookmarksList.innerHTML = '';

  try {
    const { bookmarks } = await getAllBookmarks();
    const httpBookmarks = bookmarks.filter(b => b.url && b.url.startsWith('http'));

    let checked = 0;
    const total = httpBookmarks.length;

    for (const bookmark of httpBookmarks) {
      checked++;
      if (checked % 5 === 0) {
        showLoading(`检测中 (${checked}/${total})...`);
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        const response = await fetch(bookmark.url, {
          method: 'HEAD',
          mode: 'no-cors',
          signal: controller.signal
        });

        clearTimeout(timeoutId);
        
        // no-cors mode: if fetch succeeds, link is probably alive
        // only catch block means it's dead
      } catch (error) {
        // Bookmark is dead or unreachable
        deadBookmarkIds.push(bookmark.id);
        const li = document.createElement('li');
        li.innerHTML = `<span class="dead-title">${bookmark.title || '无标题'}</span><br><span class="dead-url">${bookmark.url}</span>`;
        li.title = bookmark.url;
        deadBookmarksList.appendChild(li);
      }
    }

    deadBookmarksEl.textContent = deadBookmarkIds.length;

    if (deadBookmarkIds.length > 0) {
      deadBookmarksSection.style.display = 'block';
      showMessage(`发现 ${deadBookmarkIds.length} 个失效书签`);
    } else {
      deadBookmarksSection.style.display = 'none';
      showMessage('✓ 所有书签都正常');
    }
  } catch (error) {
    console.error(error);
    showMessage(error.message, 'error');
  } finally {
    hideLoading();
  }
});

// Delete dead bookmarks
deleteDeadBtn.addEventListener('click', async () => {
  if (deadBookmarkIds.length === 0) return;

  if (!confirm(`确定要删除 ${deadBookmarkIds.length} 个失效书签吗？此操作不可撤销！`)) {
    return;
  }

  for (const id of deadBookmarkIds) {
    try {
      await chrome.bookmarks.remove(id);
    } catch (e) {
      console.error('Failed to remove bookmark:', e);
    }
  }

  deadBookmarkIds = [];
  deadBookmarksList.innerHTML = '';
  deadBookmarksSection.style.display = 'none';
  deadBookmarksEl.textContent = '0';
  await updateStats();
  showMessage('✓ 已删除所有失效书签');
});

// Initialize on load
init();
