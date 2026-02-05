// Background service worker for Bookmark Organizer

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'checkUrl') {
    checkUrl(request.url)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ alive: false, error: error.message }));
    return true; // Keep the message channel open for async response
  }
});

const REQUEST_TIMEOUT_MS = 10000;

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      ...options,
      signal: controller.signal
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Check if a URL is alive
async function checkUrl(url) {
  try {
    let response = await fetchWithTimeout(url, { method: 'HEAD' });

    if (response.status === 405 || response.status === 403) {
      response = await fetchWithTimeout(url, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' }
      });
    }

    // Check status code
    if (response.status >= 400) {
      return { alive: false, status: response.status };
    }

    return { alive: true, status: response.status };
  } catch (error) {
    // Network error, timeout, or other issues
    if (error.name === 'AbortError') {
      return { alive: false, error: '超时' };
    }
    return { alive: false, error: error.message };
  }
}
