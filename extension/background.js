class ContentSnapBackground {
    constructor() {
        this.apiUrl = 'http://localhost:8000';
        this.init();
    }

    init() {
        this.setupInstallHandler();
        this.setupActionHandler();
        this.setupMessageHandler();
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
                
                if (pageInfo.hasSelection) {
                    await chrome.storage.local.set({
                        'selectedText': pageInfo.selectedText,
                        'sourceUrl': pageInfo.url,
                        'sourceTitle': pageInfo.title,
                        'timestamp': Date.now()
                    });
                }

                console.log('Extension activated on tab:', tab.url);
                
            } catch (error) {
                console.error('Error in action handler:', error);
            }
        });
    }

    setupMessageHandler() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            switch (request.action) {
                case 'getSelectedText':
                    this.handleGetSelectedText(sender.tab.id)
                        .then(sendResponse)
                        .catch(error => sendResponse({ error: error.message }));
                    return true;

                case 'summarizeText':
                    this.handleSummarizeText(request.data)
                        .then(sendResponse)
                        .catch(error => sendResponse({ error: error.message }));
                    return true;

                case 'openPopupWithText':
                    this.handleOpenPopupWithText(request.text, sender.tab)
                        .then(sendResponse)
                        .catch(error => sendResponse({ error: error.message }));
                    return true;

                case 'checkApiHealth':
                    this.checkApiHealth()
                        .then(result => sendResponse({ healthy: result }))
                        .catch(error => sendResponse({ healthy: false, error: error.message }));
                    return true;

                case 'getStoredText':
                    this.getStoredText()
                        .then(sendResponse)
                        .catch(error => sendResponse({ error: error.message }));
                    return true;

                case 'clearStoredText':
                    chrome.storage.local.remove(['selectedText', 'sourceUrl', 'sourceTitle', 'timestamp']);
                    sendResponse({ success: true });
                    break;

                default:
                    sendResponse({ error: 'Unknown action: ' + request.action });
            }
        });
    }

    setupContextMenus() {
        chrome.contextMenus.removeAll(() => {
            chrome.contextMenus.create({
                id: 'summarizeSelection',
                title: 'Summarize with ContentSnap',
                contexts: ['selection']
            });

            chrome.contextMenus.create({
                id: 'summarizePage',
                title: '📄 Summarize this page',
                contexts: ['page']
            });

            chrome.contextMenus.create({
                id: 'separator1',
                type: 'separator',
                contexts: ['selection', 'page']
            });

            chrome.contextMenus.create({
                id: 'quickSummary',
                title: '⚡ Quick summary',
                contexts: ['selection']
            });

            chrome.contextMenus.create({
                id: 'detailedSummary',
                title: '📖 Detailed summary',
                contexts: ['selection']
            });
        });

        chrome.contextMenus.onClicked.addListener((info, tab) => {
            this.handleContextMenuClick(info, tab);
        });
    }

    setupKeyboardShortcuts() {
        chrome.commands.onCommand.addListener((command) => {
            switch (command) {
                case 'summarize-selection':
                    this.handleKeyboardShortcut('selection');
                    break;
                case 'summarize-page':
                    this.handleKeyboardShortcut('page');
                    break;
                case 'open-popup':
                    this.handleKeyboardShortcut('popup');
                    break;
            }
        });
    }

    async handleFirstInstall() {
        console.log('ContentSnap installed for the first time');
        
        await chrome.storage.sync.set({
            format: 'bullet_points',
            detailLevel: 'medium',
            autoOpen: true,
            showNotifications: true
        });

        this.showWelcomeNotification();
    }

    async handleUpdate(previousVersion) {
        console.log(`ContentSnap updated from ${previousVersion} to ${chrome.runtime.getManifest().version}`);
        
        await this.migrateSettings(previousVersion);
    }

    async migrateSettings(previousVersion) {
        console.log('Settings migration completed');
    }

    async handleGetSelectedText(tabId) {
        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId: tabId },
                function: () => {
                    const selection = window.getSelection().toString().trim();
                    if (selection) {
                        return {
                            text: selection,
                            length: selection.length,
                            type: 'selection'
                        };
                    }
                    
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

            return results[0].result;
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
            await chrome.storage.local.set({
                'selectedText': text,
                'sourceUrl': tab.url,
                'sourceTitle': tab.title,
                'timestamp': Date.now()
            });

            try {
                await chrome.action.openPopup();
            } catch (popupError) {
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

            await chrome.storage.local.set({
                'selectedText': textToSummarize,
                'sourceUrl': tab.url,
                'sourceTitle': tab.title,
                'summaryOptions': summaryOptions,
                'timestamp': Date.now()
            });

            try {
                await chrome.action.openPopup();
            } catch (error) {
                this.showNotification('Right-click context prepared. Click the extension icon to summarize.', 'info');
            }

        } catch (error) {
            console.error('Context menu error:', error);
            this.showNotification('Error processing request', 'error');
        }
    }

    async handleKeyboardShortcut(type) {
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
            return { text: '', error: error.message };
        }
    }

    async checkApiHealth() {
        try {
            const response = await fetch(`${this.apiUrl}/health`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });
            return response.ok;
        } catch (error) {
            console.log('API health check failed:', error.message);
            return false;
        }
    }

    async showNotification(message, type = 'info') {
        try {
            const settings = await chrome.storage.sync.get(['showNotifications']);
            if (settings.showNotifications === false) return;

            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icon48.png',
                title: 'ContentSnap',
                message: message
            });
        } catch (error) {
            console.log('Could not show notification:', error);
        }
    }

    showWelcomeNotification() {
        this.showNotification('Welcome to ContentSnap! Select text and right-click to get started.', 'info');
    }

    async ensureContentScript(tabId) {
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tabId },
                function: () => {
                    return typeof contentSnapContent !== 'undefined';
                }
            });
        } catch (error) {
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

const contentSnapBackground = new ContentSnapBackground();

chrome.runtime.onStartup.addListener(() => {
    console.log('ContentSnap extension started');
    contentSnapBackground.checkApiHealth();
});

chrome.runtime.onSuspend.addListener(() => {
    console.log('ContentSnap extension suspended');
});

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ContentSnapBackground;
}
