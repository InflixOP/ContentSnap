// Content script to extract and highlight text
class ContentExtractor {
    constructor() {
        this.selectedText = '';
        this.fullPageText = '';
        this.isHighlighted = false;
    }
    
    extractSelectedText() {
        const selection = window.getSelection();
        return selection.toString().trim();
    }
    
    extractFullPageText() {
        // Remove script and style elements
        const scripts = document.querySelectorAll('script, style, nav, header, footer, aside');
        scripts.forEach(el => el.remove());
        
        // Extract main content areas
        const contentSelectors = [
            'article',
            '[role="main"]',
            '.content',
            '.post',
            '.article',
            '#content',
            '.entry-content',
            '.post-content'
        ];
        
        let content = '';
        
        for (const selector of contentSelectors) {
            const element = document.querySelector(selector);
            if (element) {
                content = element.innerText;
                break;
            }
        }
        
        // Fallback to body if no specific content area found
        if (!content) {
            content = document.body.innerText;
        }
        
        // Clean up the text
        return content
            .replace(/\s+/g, ' ')
            .replace(/\n\s*\n/g, '\n')
            .trim();
    }
    
    highlightText(text) {
        if (this.isHighlighted) {
            this.removeHighlight();
        }
        
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );
        
        const textNodes = [];
        let node;
        
        while (node = walker.nextNode()) {
            if (node.textContent.includes(text.substring(0, 50))) {
                textNodes.push(node);
            }
        }
        
        textNodes.forEach(node => {
            const parent = node.parentNode;
            if (parent && parent.tagName !== 'SCRIPT' && parent.tagName !== 'STYLE') {
                const highlightedText = node.textContent.replace(
                    new RegExp(text.substring(0, 50), 'gi'),
                    '<mark style="background-color: #ffeb3b; padding: 2px;">$&</mark>'
                );
                
                if (highlightedText !== node.textContent) {
                    const wrapper = document.createElement('span');
                    wrapper.innerHTML = highlightedText;
                    wrapper.className = 'contentsnap-highlight';
                    parent.replaceChild(wrapper, node);
                }
            }
        });
        
        this.isHighlighted = true;
    }
    
    removeHighlight() {
        const highlights = document.querySelectorAll('.contentsnap-highlight');
        highlights.forEach(highlight => {
            const parent = highlight.parentNode;
            parent.replaceChild(document.createTextNode(highlight.textContent), highlight);
        });
        this.isHighlighted = false;
    }
}

// Initialize content extractor
const contentExtractor = new ContentExtractor();

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getSelectedText') {
        const selectedText = contentExtractor.extractSelectedText();
        sendResponse({ text: selectedText });
    } else if (request.action === 'getFullPageText') {
        const fullText = contentExtractor.extractFullPageText();
        sendResponse({ text: fullText });
    } else if (request.action === 'highlightText') {
        contentExtractor.highlightText(request.text);
        sendResponse({ success: true });
    } else if (request.action === 'removeHighlight') {
        contentExtractor.removeHighlight();
        sendResponse({ success: true });
    }
});

// Auto-select main content when page loads
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        contentExtractor.fullPageText = contentExtractor.extractFullPageText();
    }, 1000);
});