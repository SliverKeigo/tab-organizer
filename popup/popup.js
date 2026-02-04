// Gemini API helper
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

async function callGemini(apiKey, prompt) {
  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
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
    const error = await response.json();
    throw new Error(error.error?.message || 'API 调用失败');
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

// Parse JSON from AI response (handles markdown code blocks and various formats)
function parseJsonResponse(text) {
  console.log('Parsing response:', text);
  
  let jsonStr = text.trim();
  
  // Remove markdown code blocks if present
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }
  
  // Try to find JSON object - handle nested braces properly
  const startIndex = jsonStr.indexOf('{');
  const endIndex = jsonStr.lastIndexOf('}');
  
  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    jsonStr = jsonStr.substring(startIndex, endIndex + 1);
  }
  
  try {
    const result = JSON.parse(jsonStr);
    console.log('Parsed result:', result);
    return result;
  } catch (e) {
    console.error('JSON parse error:', e);
    console.error('Failed to parse:', jsonStr);
    throw new Error(`无法解析 AI 返回结果: ${e.message}`);
  }
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
  }, 5000);
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

    // Limit to first 50 bookmarks to avoid token limits
    const bookmarksToProcess = bookmarks.slice(0, 50);
    
    // Prepare bookmarks info for AI
    const bookmarksInfo = bookmarksToProcess.map((b, index) => {
      try {
        const hostname = new URL(b.url).hostname;
        return `${index}. ${b.title || '无标题'} (${hostname})`;
      } catch {
        return `${index}. ${b.title || '无标题'}`;
      }
    }).join('\n');

    const prompt = `你是一个书签分类助手。请将以下书签分类。

书签：
${bookmarksInfo}

请返回一个JSON对象，格式如下：
{"分类名1": [索引数组], "分类名2": [索引数组]}

例如：
{"技术": [0, 2, 5], "娱乐": [1, 3], "购物": [4]}

分类名用中文，如：技术、社交、娱乐、购物、新闻、工具、其他
只返回JSON，不要其他内容。`;

    showLoading('AI 正在分析...');
    const result = await callGemini(geminiApiKey, prompt);
    
    // Parse JSON from response
    const categories = parseJsonResponse(result);
    
    if (!categories || typeof categories !== 'object' || Object.keys(categories).length === 0) {
      throw new Error('AI 返回格式不正确，请重试');
    }
    
    showLoading('正在整理书签...');

    // Put AI folders in Bookmark Bar (id: "1")
    const parentId = "1";

    // Create an "AI 分类" parent folder with timestamp
    const timestamp = new Date().toLocaleString('zh-CN', { 
      month: 'numeric', 
      day: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    const aiFolder = await chrome.bookmarks.create({
      parentId: parentId,
      title: `📁 AI分类 ${timestamp}`
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
        if (typeof index === 'number' && index >= 0 && index < bookmarksToProcess.length) {
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
    console.error('Organize error:', error);
    showMessage(error.message, 'error');
  } finally {
    hideLoading();
  }
});

// Check dead bookmarks via background script
checkDeadBtn.addEventListener('click', async () => {
  showLoading('正在检测失效书签...');
  deadBookmarkIds = [];
  deadBookmarksList.innerHTML = '';

  try {
    const { bookmarks } = await getAllBookmarks();
    const httpBookmarks = bookmarks.filter(b => b.url && b.url.startsWith('http'));

    let checked = 0;
    const total = httpBookmarks.length;
    let deadCount = 0;

    for (const bookmark of httpBookmarks) {
      checked++;
      if (checked % 3 === 0 || checked === total) {
        showLoading(`检测中 (${checked}/${total})...`);
      }

      try {
        // Send message to background script to check URL
        const result = await chrome.runtime.sendMessage({
          action: 'checkUrl',
          url: bookmark.url
        });

        if (!result.alive) {
          deadBookmarkIds.push(bookmark.id);
          const li = document.createElement('li');
          li.innerHTML = `
            <span class="dead-title">${bookmark.title || '无标题'}</span>
            <span class="dead-status">${result.status || result.error || '无法访问'}</span>
            <br><span class="dead-url">${bookmark.url}</span>
          `;
          li.title = bookmark.url;
          deadBookmarksList.appendChild(li);
          deadCount++;
        }
      } catch (error) {
        console.error('Check error for', bookmark.url, error);
      }
    }

    deadBookmarksEl.textContent = deadCount;

    if (deadCount > 0) {
      deadBookmarksSection.style.display = 'block';
      showMessage(`发现 ${deadCount} 个失效书签`);
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
  if (deadBookmarkIds.length === 0) return;

  if (!confirm(`确定要删除 ${deadBookmarkIds.length} 个失效书签吗？此操作不可撤销！`)) {
    return;
  }

  let deleted = 0;
  for (const id of deadBookmarkIds) {
    try {
      await chrome.bookmarks.remove(id);
      deleted++;
    } catch (e) {
      console.error('Failed to remove bookmark:', e);
    }
  }

  deadBookmarkIds = [];
  deadBookmarksList.innerHTML = '';
  deadBookmarksSection.style.display = 'none';
  deadBookmarksEl.textContent = '0';
  await updateStats();
  showMessage(`✓ 已删除 ${deleted} 个失效书签`);
});

// Initialize on load
init();
