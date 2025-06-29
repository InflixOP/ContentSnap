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
        this.setupTabManagement();
        this.setupInstallationHandlers();
    }

    setupMessageHandlers() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            switch (request.action) {
                case 'getStoredText':
                    sendResponse({ text: this.storedText });
                    break;

                case 'storeText':
                    this.storedText = request.text;
                    sendResponse({ success: true });
                    break;

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
        chrome.runtime.onInstalled.addListener(() => {
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

    setupInstallationHandlers() {
        chrome.runtime.onInstalled.addListener((details) => {
            if (details.reason === 'install') {
                this.handleFirstInstall();
            } else if (details.reason === 'update') {
                this.handleUpdate(details.previousVersion);
            }
        });
    }

    async handleOpenPopupWithText(text, tab) {
        try {
            // Store the text
            this.storedText = text;
            
            // Try to open the popup
            await this.openPopup();
            
            // Send notification to content script
            if (tab && tab.id) {
                chrome.tabs.sendMessage(tab.id, {
                    action: 'textStored',
                    text: text
                }).catch(() => {
                    // Ignore errors if content script isn't available
                });
            }
        } catch (error) {
            console.error('Error opening popup with text:', error);
        }
    }

    async handleGetTabContent(tabId, sendResponse) {
        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId },
                function: () => {
                    // This function runs in the page context
                    const getMainContent = () => {
                        const selectors = [
                            'article',
                            '[role="main"]',
                            'main',
                            '.content',
                            '.post-content',
                            '.entry-content',
                            '.article-content',
                            '#content',
                            '.main-content'
                        ];

                        for (const selector of selectors) {
                            const element = document.querySelector(selector);
                            if (element) {
                                const text = element.innerText.trim();
                                if (text.length > 100) {
                                    return text.length > 5000 ? text.substring(0, 5000) + '...' : text;
                                }
                            }
                        }

                        // Fallback to body content with cleanup
                        const bodyClone = document.body.cloneNode(true);
                        const unwantedSelectors = [
                            'nav', 'header', 'footer', 'aside',
                            '.advertisement', '.ads', '.sidebar',
                            '.navigation', '.menu', '.comments',
                            'script', 'style', 'noscript'
                        ];
                        
                        unwantedSelectors.forEach(selector => {
                            const elements = bodyClone.querySelectorAll(selector);
                            elements.forEach(el => el.remove());
                        });

                        const text = bodyClone.innerText.replace(/\s+/g, ' ').trim();
                        return text.length > 5000 ? text.substring(0, 5000) + '...' : text;
                    };

                    return {
                        content: getMainContent(),
                        title: document.title,
                        url: window.location.href,
                        selection: window.getSelection().toString().trim()
                    };
                }
            });

            sendResponse({
                success: true,
                data: results[0].result
            });
        } catch (error) {
            console.error('Error getting tab content:', error);
            sendResponse({
                success: false,
                error: error.message
            });
        }
    }

    async handleSummarizeSelectedText(tab, sendResponse) {
        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                function: () => window.getSelection().toString().trim()
            });

            const selectedText = results[0].result;
            
            if (!selectedText || selectedText.length < 50) {
                sendResponse({
                    success: false,
                    error: 'No text selected or text too short'
                });
                return;
            }

            // Store the text and open popup
            this.storedText = selectedText;
            await this.openPopup();
            
            sendResponse({
                success: true,
                text: selectedText
            });
        } catch (error) {
            console.error('Error summarizing selected text:', error);
            sendResponse({
                success: false,
                error: error.message
            });
        }
    }

    async handleSummarizePageContent(tab) {
        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                function: () => {
                    // Get main content from the page
                    const selectors = ['article', '[role="main"]', 'main', '.content'];
                    for (const selector of selectors) {
                        const element = document.querySelector(selector);
                        if (element && element.innerText.trim().length > 100) {
                            return element.innerText.trim();
                        }
                    }
                    return document.body.innerText.trim();
                }
            });

            const pageContent = results[0].result;
            if (pageContent && pageContent.length > 50) {
                await this.handleOpenPopupWithText(pageContent, tab);
            }
        } catch (error) {
            console.error('Error summarizing page content:', error);
        }
    }

    async openPopup() {
        try {
            // For MV3, we need to open the popup programmatically
            // This creates a new window with the popup
            const popup = await chrome.windows.create({
                url: chrome.runtime.getURL('popup.html'),
                type: 'popup',
                width: 420,
                height: 600,
                focused: true
            });
            
            this.isPopupOpen = true;
            
            // Track when popup is closed
            chrome.windows.onRemoved.addListener((windowId) => {
                if (windowId === popup.id) {
                    this.isPopupOpen = false;
                }
            });
            
            return popup;
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
            console.error('Error getting current tab:', error);
            return null;
        }
    }

    async injectContentScript(tabId) {
        try {
            await chrome.scripting.executeScript({
                target: { tabId },
                files: ['content.js']
            });
            return true;
        } catch (error) {
            console.error('Error injecting content script:', error);
            return false;
        }
    }

    isValidUrl(url) {
        return url && (url.startsWith('http://') || url.startsWith('https://'));
    }

    sanitizeText(text) {
        return text
            .replace(/\s+/g, ' ')
            .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
            .trim();
    }
}

// Initialize the background script
const contentSnapBackground = new ContentSnapBackground();

// Keep service worker alive
chrome.runtime.onStartup.addListener(() => {
    console.log('ContentSnap service worker started');
});

// Handle external messages (if needed for future integrations)
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
    // Handle messages from external sources if needed
    console.log('External message received:', request);
    sendResponse({ received: true });
});

// Error handling for unhandled promise rejections
self.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection in ContentSnap background:', event.reason);
});

// Clean up on shutdown
chrome.runtime.onSuspend.addListener(() => {
    console.log('ContentSnap service worker suspending');
    // Clean up any resources if needed
}); 