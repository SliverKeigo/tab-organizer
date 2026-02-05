const DEFAULT_BATCH_SIZE = 50;

export function chunkArray(items, size = DEFAULT_BATCH_SIZE) {
  const batchSize = Number.isFinite(size) && size > 0 ? Math.floor(size) : DEFAULT_BATCH_SIZE;
  const batches = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}

export function buildBookmarksInfo(bookmarks) {
  return bookmarks.map((bookmark, index) => {
    const title = bookmark.title || '无标题';
    if (bookmark.url) {
      try {
        const hostname = new URL(bookmark.url).hostname;
        return `${index}. ${title} (${hostname})`;
      } catch {
        return `${index}. ${title}`;
      }
    }
    return `${index}. ${title}`;
  }).join('\n');
}

export function buildPrompt(bookmarksInfo, options = {}) {
  const { categoryList = [], maxCategories, flatCategories = false } = options;
  const listText = categoryList.length ? `\n可用分类（严格使用这些名称）：${categoryList.join('、')}` : '';
  const limitText = Number.isFinite(maxCategories) && maxCategories > 0
    ? `\n分类数量不超过 ${Math.floor(maxCategories)} 个，超出的并入“其他”。`
    : '';
  const flatText = flatCategories ? '\n不要使用子分类或斜杠，只返回一级分类。' : '';

  return `你是一个书签分类助手。请将以下书签分类。${listText}${limitText}${flatText}

书签：
${bookmarksInfo}

请返回一个JSON对象，格式如下：
{"分类名1": [索引数组], "分类名2": [索引数组]}

例如：
{"技术": [0, 2, 5], "娱乐": [1, 3], "购物": [4]}

分类名用中文，如：技术、社交、娱乐、购物、新闻、工具、其他
只返回JSON，不要其他内容。`;
}

// Parse JSON from AI response (handles markdown code blocks and various formats)
export function parseJsonResponse(text) {
  let jsonStr = String(text ?? '').trim();

  // Remove markdown code blocks if present
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  const objStart = jsonStr.indexOf('{');
  const arrStart = jsonStr.indexOf('[');
  let startIndex = -1;
  let endIndex = -1;

  if (objStart !== -1 && (arrStart === -1 || objStart < arrStart)) {
    startIndex = objStart;
    endIndex = jsonStr.lastIndexOf('}');
  } else if (arrStart !== -1) {
    startIndex = arrStart;
    endIndex = jsonStr.lastIndexOf(']');
  }

  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    jsonStr = jsonStr.substring(startIndex, endIndex + 1);
  }

  const result = JSON.parse(jsonStr);
  return result;
}
