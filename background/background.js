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

// Check if a URL is alive
async function checkUrl(url) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow'
    });

    clearTimeout(timeoutId);

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
