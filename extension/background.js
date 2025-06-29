class ContentSnapBackground {
    constructor() {
        this.storedText = '';
        this.isPopupOpen = false;
        this.tabStates = new Map();
        this.init();
    }

    init() {
        this.setupMessageHandlers();
        this.setupContextMenus();
        this.setupKeyboardShortcuts();
        this.checkApiHealth();
    }

    setupInstallHandler() {
        chrome.runtime.onInstalled.addListener((details) => {
            if (details.reason === 'install') {
                this.handleFirstInstall();
            } else if (details.reason === 'update') {
                this.handleUpdate(details.previousVersion);
            }
        });
    }

    setupActionHandler() {
        chrome.action.onClicked.addListener(async (tab) => {
            try {
                // Try to get selected text from the current tab
                const results = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    function: () => {
                        const selection = window.getSelection().toString().trim();
                        return {
                            selectedText: selection,
                            hasSelection: selection.length > 0,
                            url: window.location.href,
                            title: document.title
                        };
                    }
                });

                const pageInfo = results[0].result;
                
                // Store the selected text for the popup to access
                if (pageInfo.hasSelection) {
                    await chrome.storage.local.set({
                        'selectedText': pageInfo.selectedText,
                        'sourceUrl': pageInfo.url,
                        'sourceTitle': pageInfo.title,
                        'timestamp': Date.now()
                    });
                }

                // The popup will automatically open due to action.default_popup
                console.log('Extension activated on tab:', tab.url);
                
            } catch (error) {
                console.error('Error in action handler:', error);
                // Popup will still open, but without pre-selected text
            }
        });
    }

    setupMessageHandlers() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            switch (request.action) {
                case 'getSelectedText':
                    this.handleGetSelectedText(sender.tab.id)
                        .then(sendResponse)
                        .catch(error => sendResponse({ error: error.message }));
                    return true; // Will respond asynchronously

                case 'summarizeText':
                    this.handleSummarizeText(request.data)
                        .then(sendResponse)
                        .catch(error => sendResponse({ error: error.message }));
                    return true; // Will respond asynchronously

                case 'openPopupWithText':
                    this.handleOpenPopupWithText(request.text, sender.tab)
                        .then(sendResponse)
                        .catch(error => sendResponse({ error: error.message }));
                    return true; // Will respond asynchronously

                case 'checkApiHealth':
                    this.checkApiHealth()
                        .then(result => sendResponse({ healthy: result }))
                        .catch(error => sendResponse({ healthy: false, error: error.message }));
                    return true; // Will respond asynchronously

                case 'getStoredText':
                    this.getStoredText()
                        .then(sendResponse)
                        .catch(error => sendResponse({ error: error.message }));
                    return true; // Will respond asynchronously

                case 'clearStoredText':
                    this.storedText = '';
                    sendResponse({ success: true });
                    break;

                case 'openPopupWithText':
                    this.handleOpenPopupWithText(request.text, sender.tab);
                    sendResponse({ success: true });
                    break;

                case 'getTabContent':
                    this.handleGetTabContent(sender.tab.id, sendResponse);
                    return true; // Keep the message channel open for async response
                    
                case 'summarizeSelectedText':
                    this.handleSummarizeSelectedText(sender.tab, sendResponse);
                    return true; // Keep the message channel open for async response

                case 'updateTabState':
                    this.tabStates.set(sender.tab.id, request.state);
                    sendResponse({ success: true });
                    break;

                case 'getTabState':
                    const state = this.tabStates.get(request.tabId) || {};
                    sendResponse({ state });
                    break;

                case 'checkServerStatus':
                    this.checkServerStatus(sendResponse);
                    return true; // Keep the message channel open for async response

                default:
                    sendResponse({ error: 'Unknown action' });
            }
        });
    }

    setupContextMenus() {
        // Check if contextMenus API is available
        if (!chrome.contextMenus) {
            console.error('Context menus API not available. Check manifest permissions.');
            return;
        }

        chrome.runtime.onInstalled.addListener(() => {
            try {
                // Remove all existing context menus first
                chrome.contextMenus.removeAll(() => {
                    // Create context menu for selected text
                    chrome.contextMenus.create({
                        id: 'summarize-selection',
                        title: 'Summarize with ContentSnap',
                        contexts: ['selection'],
                        documentUrlPatterns: ['http://*/*', 'https://*/*']
                    });

                    // Create context menu for entire page
                    chrome.contextMenus.create({
                        id: 'summarize-page',
                        title: 'Summarize this page',
                        contexts: ['page'],
                        documentUrlPatterns: ['http://*/*', 'https://*/*']
                    });
                });
            } catch (error) {
                console.error('Error creating context menus:', error);
            }
        });

        // Add error checking for onClicked listener
        try {
            chrome.contextMenus.onClicked.addListener((info, tab) => {
                switch (info.menuItemId) {
                    case 'summarize-selection':
                        if (info.selectionText) {
                            this.handleOpenPopupWithText(info.selectionText, tab);
                        }
                        break;

                    case 'summarize-page':
                        this.handleSummarizePageContent(tab);
                        break;
                }
            });
        } catch (error) {
            console.error('Error setting up context menu listener:', error);
        }
    }

    setupKeyboardShortcuts() {
        // Check if commands API is available
        if (!chrome.commands) {
            console.log('Commands API not available. Keyboard shortcuts will not work.');
            return;
        }

        try {
            chrome.commands.onCommand.addListener((command) => {
                switch (command) {
                    case 'open-popup':
                        this.openPopup();
                        break;
                    case 'summarize-page':
                        this.getCurrentTab().then(tab => {
                            if (tab) {
                                this.handleSummarizePageContent(tab);
                            }
                        });
                        break;
                    default:
                        console.log('Unknown command:', command);
                }
            });
        } catch (error) {
            console.error('Error setting up keyboard shortcuts:', error);
        }
    }

    setupTabManagement() {
        chrome.tabs.onRemoved.addListener((tabId) => {
            this.tabStates.delete(tabId);
        });

        chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            if (changeInfo.status === 'complete' && tab.url) {
                // Reset tab state on navigation
                this.tabStates.delete(tabId);
            }
        });
    }

    async handleFirstInstall() {
        console.log('ContentSnap installed for the first time');
        
        // Set default settings
        await chrome.storage.sync.set({
            format: 'bullet_points',
            detailLevel: 'medium',
            autoOpen: true,
            showNotifications: true
        });

        // Open welcome page or show notification
        this.showWelcomeNotification();
    }

    async handleUpdate(previousVersion) {
        console.log(`ContentSnap updated from ${previousVersion} to ${chrome.runtime.getManifest().version}`);
        
        // Handle migration if needed
        await this.migrateSettings(previousVersion);
    }

    async migrateSettings(previousVersion) {
        // Add migration logic here if needed for future updates
        console.log('Settings migration completed');
    }

    async handleGetTabContent(tabId, sendResponse) {
        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId },
                function: () => {
                    const selection = window.getSelection().toString().trim();
                    if (selection) {
                        return {
                            text: selection,
                            length: selection.length,
                            type: 'selection'
                        };
                    }
                    
                    // Try to get main content
                    const selectors = ['article', '[role="main"]', 'main', '.content'];
                    for (const selector of selectors) {
                        const element = document.querySelector(selector);
                        if (element) {
                            const text = element.innerText.trim();
                            if (text.length > 100) {
                                return {
                                    text: text.length > 5000 ? text.substring(0, 5000) + '...' : text,
                                    length: text.length,
                                    type: 'content'
                                };
                            }
                        }
                    }
                    
                    return { text: '', length: 0, type: 'none' };
                }
            });

            sendResponse({
                success: true,
                data: results[0].result
            });
        } catch (error) {
            throw new Error('Could not access page content: ' + error.message);
        }
    }

    async handleSummarizeText(data) {
        try {
            const response = await fetch(`${this.apiUrl}/summarize`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data)
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.detail || `HTTP ${response.status}: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            if (error.name === 'TypeError' && error.message.includes('fetch')) {
                throw new Error('Could not connect to ContentSnap API. Please ensure the server is running.');
            }
            throw error;
        }
    }

    async handleOpenPopupWithText(text, tab) {
        try {
            // Store the text for the popup to access
            await chrome.storage.local.set({
                'selectedText': text,
                'sourceUrl': tab.url,
                'sourceTitle': tab.title,
                'timestamp': Date.now()
            });

            // Open the popup (this might not work in MV3, so we'll try different approaches)
            try {
                await chrome.action.openPopup();
            } catch (popupError) {
                // If popup can't be opened programmatically, we'll use the stored text
                // when user manually clicks the extension icon
                console.log('Popup stored text for manual access');
            }

            return { success: true };
        } catch (error) {
            throw new Error('Failed to prepare popup: ' + error.message);
        }
    }

    async handleContextMenuClick(info, tab) {
        try {
            let textToSummarize = '';
            let summaryOptions = { format: 'bullet_points', detail_level: 'medium' };

            if (info.menuItemId === 'summarizeSelection' || info.menuItemId === 'quickSummary' || info.menuItemId === 'detailedSummary') {
                textToSummarize = info.selectionText;
                
                if (info.menuItemId === 'quickSummary') {
                    summaryOptions = { format: 'tldr', detail_level: 'low' };
                } else if (info.menuItemId === 'detailedSummary') {
                    summaryOptions = { format: 'detailed', detail_level: 'high' };
                }
            } else if (info.menuItemId === 'summarizePage') {
                const pageText = await this.handleGetSelectedText(tab.id);
                textToSummarize = pageText.text;
            }

            if (!textToSummarize || textToSummarize.length < 50) {
                this.showNotification('Text too short to summarize', 'warning');
                return;
            }

            // Store text and options for popup
            await chrome.storage.local.set({
                'selectedText': textToSummarize,
                'sourceUrl': tab.url,
                'sourceTitle': tab.title,
                'summaryOptions': summaryOptions,
                'timestamp': Date.now()
            });

            // Try to open popup
            try {
                await chrome.action.openPopup();
            } catch (error) {
                this.showNotification('Right-click context prepared. Click the extension icon to summarize.', 'info');
            }
        } catch (error) {
            console.error('Error summarizing page content:', error);
        }
    }

    async openPopup() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (type === 'selection' || type === 'page') {
                const textData = await this.handleGetSelectedText(tab.id);
                
                if (!textData.text || textData.text.length < 50) {
                    this.showNotification('No text available to summarize', 'warning');
                    return;
                }

                await chrome.storage.local.set({
                    'selectedText': textData.text,
                    'sourceUrl': tab.url,
                    'sourceTitle': tab.title,
                    'timestamp': Date.now()
                });
            }

            // Try to open popup
            try {
                await chrome.action.openPopup();
            } catch (error) {
                this.showNotification('Press Ctrl+Shift+S again or click the extension icon', 'info');
            }

        } catch (error) {
            console.error('Keyboard shortcut error:', error);
        }
    }

    async getStoredText() {
        try {
            const result = await chrome.storage.local.get(['selectedText', 'sourceUrl', 'sourceTitle', 'summaryOptions', 'timestamp']);
            
            // Check if stored text is not too old (10 minutes)
            if (result.timestamp && (Date.now() - result.timestamp) > 10 * 60 * 1000) {
                await chrome.storage.local.remove(['selectedText', 'sourceUrl', 'sourceTitle', 'summaryOptions', 'timestamp']);
                return { text: '', expired: true };
            }

            return {
                text: result.selectedText || '',
                sourceUrl: result.sourceUrl || '',
                sourceTitle: result.sourceTitle || '',
                summaryOptions: result.summaryOptions || {},
                timestamp: result.timestamp || 0
            };
        } catch (error) {
            console.error('Error opening popup:', error);
            throw error;
        }
    }

    async checkServerStatus(sendResponse) {
        try {
            const response = await fetch('http://localhost:8000/health', {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });
            
            sendResponse({
                success: response.ok,
                status: response.status,
                online: response.ok
            });
        } catch (error) {
            sendResponse({
                success: false,
                online: false,
                error: error.message
            });
        }
    }

    handleFirstInstall() {
        // Set default settings
        chrome.storage.sync.set({
            format: 'bullet_points',
            detailLevel: 'medium',
            theme: 'light',
            contextMenu: true
        });

        // Open welcome page or show notification
        chrome.tabs.create({
            url: chrome.runtime.getURL('welcome.html')
        }).catch(() => {
            // If welcome.html doesn't exist, just show a notification
            console.log('ContentSnap installed successfully');
        });
    }

    handleUpdate(previousVersion) {
        console.log(`ContentSnap updated from ${previousVersion} to ${chrome.runtime.getManifest().version}`);
        
        // Handle any migration logic here if needed
        // For example, updating storage schema or settings
    }

    // Utility methods
    async getCurrentTab() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            return tab;
        } catch (error) {
            console.log('Could not show notification:', error);
        }
    }

    showWelcomeNotification() {
        this.showNotification('Welcome to ContentSnap! Select text and right-click to get started.', 'info');
    }

    // Utility method to inject content script if not already present
    async ensureContentScript(tabId) {
        try {
            await chrome.scripting.executeScript({
                target: { tabId },
                files: ['content.js']
            });
            return true;
        } catch (error) {
            // Content script not present, inject it
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    files: ['content.js']
                });
            } catch (injectError) {
                console.error('Failed to inject content script:', injectError);
            }
        }
    }
}

// Initialize background script
const contentSnapBackground = new ContentSnapBackground();

// Handle extension startup
chrome.runtime.onStartup.addListener(() => {
    console.log('ContentSnap service worker started');
});

// Handle external messages (if needed for future integrations)
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
    // Handle messages from external sources if needed
    console.log('External message received:', request);
    sendResponse({ received: true });
});

// Handle when extension context is invalidated
chrome.runtime.onSuspend.addListener(() => {
    console.log('ContentSnap service worker suspending');
    // Clean up any resources if needed 
});

// Export for potential use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ContentSnapBackground;
}