// Background script for handling extension lifecycle
chrome.runtime.onInstalled.addListener(() => {
    console.log('ContentSnap extension installed');
    
    // Set default settings
    chrome.storage.sync.set({
        summaryFormat: 'bullet_points',
        apiUrl: 'http://localhost:8000'
    });
});

// Handle extension icon click
chrome.action.onClicked.addListener((tab) => {
    // This will open the popup (handled by manifest.json)
});

// Monitor tab updates to refresh content extraction
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
        // Inject content script if needed
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js']
        }).catch(() => {
            // Ignore errors for pages where content scripts can't be injected
        });
    }
});