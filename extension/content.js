// ContentSnap Content Script
class ContentSnapContent {
    constructor() {
        this.selectedText = '';
        this.highlightElement = null;
        this.init();
    }

    init() {
        this.addTextSelectionListeners();
        this.addKeyboardShortcuts();
        this.listenForMessages();
    }

    addTextSelectionListeners() {
        document.addEventListener('mouseup', (e) => {
            setTimeout(() => {
                const selection = window.getSelection();
                const selectedText = selection.toString().trim();
                
                if (selectedText && selectedText.length > 20) {
                    this.selectedText = selectedText;
                    this.showSelectionIndicator(e);
                } else {
                    this.hideSelectionIndicator();
                }
            }, 10);
        });

        // Hide indicator when clicking elsewhere
        document.addEventListener('mousedown', (e) => {
            if (!e.target.closest('.contentsnap-selection-indicator')) {
                this.hideSelectionIndicator();
            }
        });

        // Handle text selection changes
        document.addEventListener('selectionchange', () => {
            const selection = window.getSelection();
            if (selection.rangeCount === 0 || selection.toString().trim().length === 0) {
                this.hideSelectionIndicator();
            }
        });
    }

    addKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl+Shift+S or Cmd+Shift+S to summarize selected text
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') {
                e.preventDefault();
                this.handleQuickSummarize();
            }
            
            // Escape to hide selection indicator
            if (e.key === 'Escape') {
                this.hideSelectionIndicator();
            }
        });
    }

    listenForMessages() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            switch (request.action) {
                case 'getSelectedText':
                    sendResponse({
                        text: this.getSelectedOrPageText(),
                        url: window.location.href,
                        title: document.title
                    });
                    break;
                
                case 'getPageContent':
                    sendResponse({
                        content: this.extractMainContent(),
                        url: window.location.href,
                        title: document.title
                    });
                    break;
                
                case 'highlightText':
                    this.highlightText(request.text);
                    sendResponse({ success: true });
                    break;
                
                case 'clearHighlights':
                    this.clearHighlights();
                    sendResponse({ success: true });
                    break;
                
                default:
                    sendResponse({ error: 'Unknown action' });
            }
        });
    }

    getSelectedOrPageText() {
        const selection = window.getSelection().toString().trim();
        
        if (selection && selection.length > 50) {
            return selection;
        }
        
        // Try to get main content if no selection
        return this.extractMainContent();
    }

    extractMainContent() {
        // Priority order for content extraction
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
                const text = this.cleanText(element.innerText);
                if (text.length > 100) {
                    return text.length > 5000 ? text.substring(0, 5000) + '...' : text;
                }
            }
        }

        // Fallback to body content, excluding navigation and ads
        const bodyClone = document.body.cloneNode(true);
        
        // Remove unwanted elements
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

        const text = this.cleanText(bodyClone.innerText);
        return text.length > 5000 ? text.substring(0, 5000) + '...' : text;
    }

    cleanText(text) {
        return text
            .replace(/\s+/g, ' ')  // Replace multiple whitespace with single space
            .replace(/\n\s*\n/g, '\n\n')  // Clean up line breaks
            .trim();
    }

    showSelectionIndicator(event) {
        this.hideSelectionIndicator();

        const indicator = document.createElement('div');
        indicator.className = 'contentsnap-selection-indicator';
        indicator.innerHTML = `
            <div class="contentsnap-tooltip">
                <button class="contentsnap-btn" id="contentsnap-summarize">
                    ✨ Summarize
                </button>
                <div class="contentsnap-text-count">${this.selectedText.length} chars</div>
            </div>
        `;

        // Position the indicator
        const x = event.pageX;
        const y = event.pageY;
        
        indicator.style.cssText = `
            position: absolute;
            left: ${x}px;
            top: ${y - 60}px;
            z-index: 10000;
            pointer-events: auto;
        `;

        document.body.appendChild(indicator);
        this.highlightElement = indicator;

        // Add click handler for summarize button
        const summarizeBtn = indicator.querySelector('#contentsnap-summarize');
        summarizeBtn.addEventListener('click', () => {
            this.handleQuickSummarize();
        });

        // Auto-hide after 5 seconds
        setTimeout(() => {
            this.hideSelectionIndicator();
        }, 5000);
    }

    hideSelectionIndicator() {
        if (this.highlightElement) {
            this.highlightElement.remove();
            this.highlightElement = null;
        }
    }

    async handleQuickSummarize() {
        const selection = window.getSelection().toString().trim();
        
        if (!selection || selection.length < 50) {
            this.showNotification('Please select at least 50 characters of text to summarize.', 'warning');
            return;
        }

        try {
            // Send message to background script to open popup with selected text
            chrome.runtime.sendMessage({
                action: 'openPopupWithText',
                text: selection
            });
            
            this.hideSelectionIndicator();
            this.showNotification('Opening ContentSnap...', 'success');
            
        } catch (error) {
            console.error('Error in quick summarize:', error);
            this.showNotification('Error opening ContentSnap. Please try again.', 'error');
        }
    }

    highlightText(searchText) {
        this.clearHighlights();
        
        if (!searchText || searchText.length < 3) return;

        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );

        const textNodes = [];
        let node;
        
        while (node = walker.nextNode()) {
            if (node.parentElement.tagName !== 'SCRIPT' && 
                node.parentElement.tagName !== 'STYLE' &&
                node.textContent.toLowerCase().includes(searchText.toLowerCase())) {
                textNodes.push(node);
            }
        }

        textNodes.forEach(textNode => {
            const parent = textNode.parentNode;
            const text = textNode.textContent;
            const regex = new RegExp(`(${searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
            
            if (regex.test(text)) {
                const highlightedHTML = text.replace(regex, '<mark class="contentsnap-highlight">$1</mark>');
                const wrapper = document.createElement('span');
                wrapper.innerHTML = highlightedHTML;
                parent.replaceChild(wrapper, textNode);
            }
        });
    }

    clearHighlights() {
        const highlights = document.querySelectorAll('.contentsnap-highlight');
        highlights.forEach(highlight => {
            const parent = highlight.parentNode;
            parent.replaceChild(document.createTextNode(highlight.textContent), highlight);
            parent.normalize();
        });
    }

    showNotification(message, type = 'info') {
        // Remove existing notifications
        const existing = document.querySelector('.contentsnap-notification');
        if (existing) existing.remove();

        const notification = document.createElement('div');
        notification.className = `contentsnap-notification contentsnap-${type}`;
        notification.textContent = message;
        
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #333;
            color: white;
            padding: 12px 16px;
            border-radius: 8px;
            font-size: 14px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            z-index: 10001;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            max-width: 300px;
            animation: slideInRight 0.3s ease-out;
        `;

        // Color based on type
        if (type === 'success') {
            notification.style.background = '#10b981';
        } else if (type === 'warning') {
            notification.style.background = '#f59e0b';
        } else if (type === 'error') {
            notification.style.background = '#ef4444';
        }

        document.body.appendChild(notification);

        // Auto-remove after 3 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.style.animation = 'slideOutRight 0.3s ease-in';
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.remove();
                    }
                }, 300);
            }
        }, 3000);
    }

    // Utility method to check if element is visible
    isElementVisible(element) {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && 
               rect.top >= 0 && rect.left >= 0 &&
               rect.bottom <= window.innerHeight && 
               rect.right <= window.innerWidth;
    }

    // Get reading time estimate
    getReadingTime(text) {
        const wordsPerMinute = 200;
        const words = text.trim().split(/\s+/).length;
        const minutes = Math.ceil(words / wordsPerMinute);
        return minutes;
    }
}

// Initialize content script
let contentSnapContent;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        contentSnapContent = new ContentSnapContent();
    });
} else {
    contentSnapContent = new ContentSnapContent();
}

// Add CSS animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideInRight {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOutRight {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }

    .contentsnap-selection-indicator {
        pointer-events: none;
    }

    .contentsnap-tooltip {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 8px 12px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        gap: 8px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 12px;
        pointer-events: auto;
    }

    .contentsnap-btn {
        background: rgba(255,255,255,0.2);
        border: none;
        color: white;
        padding: 4px 8px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 11px;
        font-weight: 500;
        transition: background 0.2s ease;
    }

    .contentsnap-btn:hover {
        background: rgba(255,255,255,0.3);
    }

    .contentsnap-text-count {
        opacity: 0.8;
        font-size: 10px;
    }

    .contentsnap-highlight {
        background: #fef08a !important;
        color: #713f12 !important;
        padding: 1px 2px;
        border-radius: 2px;
    }
`;

document.head.appendChild(style);