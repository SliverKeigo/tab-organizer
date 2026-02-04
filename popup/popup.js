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
        maxOutputTokens: 2048,
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

// Category colors mapping
const CATEGORY_COLORS = {
  '工作': 'blue',
  '技术': 'cyan',
  '文档': 'purple',
  '社交': 'pink',
  '娱乐': 'yellow',
  '购物': 'orange',
  '新闻': 'green',
  '其他': 'grey'
};

function getCategoryColor(category) {
  for (const [key, color] of Object.entries(CATEGORY_COLORS)) {
    if (category.includes(key)) return color;
  }
  return 'grey';
}

// DOM elements
const apiKeyInput = document.getElementById('api-key');
const saveKeyBtn = document.getElementById('save-key');
const keyStatus = document.getElementById('key-status');
const totalTabsEl = document.getElementById('total-tabs');
const groupsCountEl = document.getElementById('groups-count');
const deadTabsEl = document.getElementById('dead-tabs');
const organizeBtn = document.getElementById('organize-btn');
const checkDeadBtn = document.getElementById('check-dead-btn');
const ungroupBtn = document.getElementById('ungroup-btn');
const deadTabsSection = document.getElementById('dead-tabs-section');
const deadTabsList = document.getElementById('dead-tabs-list');
const closeDeadBtn = document.getElementById('close-dead-btn');
const loadingEl = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');
const messageEl = document.getElementById('message');

let deadTabIds = [];

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
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const groups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
  
  totalTabsEl.textContent = tabs.length;
  groupsCountEl.textContent = groups.length;
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

// AI Organize tabs
organizeBtn.addEventListener('click', async () => {
  const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');
  if (!geminiApiKey) {
    showMessage('请先设置 API Key', 'error');
    return;
  }

  showLoading('正在分析标签...');

  try {
    // Get all tabs
    const tabs = await chrome.tabs.query({ currentWindow: true });
    
    // Filter out chrome:// and extension pages
    const validTabs = tabs.filter(tab => 
      tab.url && 
      !tab.url.startsWith('chrome://') && 
      !tab.url.startsWith('chrome-extension://')
    );

    if (validTabs.length === 0) {
      showMessage('没有可分组的标签', 'error');
      hideLoading();
      return;
    }

    // Prepare tabs info for AI
    const tabsInfo = validTabs.map((tab, index) => 
      `${index}. ${tab.title} (${new URL(tab.url).hostname})`
    ).join('\n');

    const prompt = `你是一个标签分类助手。请将以下浏览器标签分类到合适的组中。

标签列表：
${tabsInfo}

请返回 JSON 格式，key 是分类名称（简短的中文，如：工作、技术文档、社交、娱乐、购物、新闻、其他），value 是标签索引数组。
只返回 JSON，不要其他内容。

示例格式：
{"工作": [0, 3], "技术文档": [1, 2, 5], "娱乐": [4]}`;

    showLoading('AI 正在分类...');
    const result = await callGemini(geminiApiKey, prompt);
    
    // Parse JSON from response
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('无法解析 AI 返回结果');
    }

    const categories = JSON.parse(jsonMatch[0]);
    
    showLoading('正在创建分组...');

    // First, ungroup all tabs
    for (const tab of validTabs) {
      if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
        await chrome.tabs.ungroup(tab.id);
      }
    }

    // Create groups
    for (const [category, indices] of Object.entries(categories)) {
      if (!Array.isArray(indices) || indices.length === 0) continue;

      const tabIds = indices
        .filter(i => i >= 0 && i < validTabs.length)
        .map(i => validTabs[i].id);

      if (tabIds.length === 0) continue;

      const groupId = await chrome.tabs.group({ tabIds });
      await chrome.tabGroups.update(groupId, {
        title: category,
        color: getCategoryColor(category)
      });
    }

    await updateStats();
    showMessage(`✓ 已创建 ${Object.keys(categories).length} 个分组`);
  } catch (error) {
    console.error(error);
    showMessage(error.message, 'error');
  } finally {
    hideLoading();
  }
});

// Check dead tabs
checkDeadBtn.addEventListener('click', async () => {
  showLoading('正在检测失效标签...');
  deadTabIds = [];
  deadTabsList.innerHTML = '';

  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const validTabs = tabs.filter(tab => 
      tab.url && 
      tab.url.startsWith('http')
    );

    let checked = 0;
    const total = validTabs.length;

    for (const tab of validTabs) {
      checked++;
      showLoading(`检测中 (${checked}/${total})...`);

      // Check if tab has error status by looking at its properties
      // and try to detect common error patterns in title
      const errorPatterns = [
        /^404/i,
        /not found/i,
        /page not found/i,
        /无法访问/i,
        /无法找到/i,
        /err_/i,
        /找不到网页/i,
        /this site can't be reached/i,
        /unable to connect/i,
        /connection refused/i,
        /server not found/i,
        /dns_probe/i,
        /网页无法加载/i
      ];

      const titleLower = (tab.title || '').toLowerCase();
      const isErrorPage = errorPatterns.some(pattern => pattern.test(tab.title || ''));
      
      // Also check if title equals URL (often indicates failed load)
      const titleIsUrl = tab.title === tab.url;
      
      if (isErrorPage || titleIsUrl) {
        deadTabIds.push(tab.id);
        const li = document.createElement('li');
        li.textContent = tab.title || tab.url;
        li.title = tab.url;
        deadTabsList.appendChild(li);
      }
    }

    deadTabsEl.textContent = deadTabIds.length;

    if (deadTabIds.length > 0) {
      deadTabsSection.style.display = 'block';
      showMessage(`发现 ${deadTabIds.length} 个可能失效的标签`);
    } else {
      deadTabsSection.style.display = 'none';
      showMessage('✓ 未发现明显失效的标签');
    }
  } catch (error) {
    console.error(error);
    showMessage(error.message, 'error');
  } finally {
    hideLoading();
  }
});

// Close dead tabs
closeDeadBtn.addEventListener('click', async () => {
  if (deadTabIds.length === 0) return;

  await chrome.tabs.remove(deadTabIds);
  deadTabIds = [];
  deadTabsList.innerHTML = '';
  deadTabsSection.style.display = 'none';
  deadTabsEl.textContent = '0';
  await updateStats();
  showMessage('✓ 已关闭所有失效标签');
});

// Ungroup all tabs
ungroupBtn.addEventListener('click', async () => {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  
  for (const tab of tabs) {
    if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      await chrome.tabs.ungroup(tab.id);
    }
  }

  await updateStats();
  showMessage('✓ 已取消所有分组');
});

// Initialize on load
init();
