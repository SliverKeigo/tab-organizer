// Background service worker
// Currently minimal - can be extended for periodic checks, etc.

chrome.runtime.onInstalled.addListener(() => {
  console.log('Tab Organizer installed!');
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getTabCount') {
    chrome.tabs.query({ currentWindow: true }, (tabs) => {
      sendResponse({ count: tabs.length });
    });
    return true; // Keep message channel open for async response
  }
});
