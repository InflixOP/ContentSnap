// ContentSnap Extension Popup Script
class ContentSnapPopup {
    constructor() {
        this.apiUrl = 'http://localhost:8000'; // Change this to your API URL
        this.initializeElements();
        this.attachEventListeners();
        this.loadSettings();
    }

    initializeElements() {
        // Buttons
        this.summarizeSelectedBtn = document.getElementById('summarizeSelected');
        this.summarizeCustomBtn = document.getElementById('summarizeCustom');
        this.summarizeBtn = document.getElementById('summarizeBtn');
        this.copyBtn = document.getElementById('copyBtn');

        // Form elements
        this.formatSelect = document.getElementById('formatSelect');
        this.detailSelect = document.getElementById('detailSelect');
        this.customText = document.getElementById('customText');
        this.customTextContainer = document.getElementById('customTextContainer');

        // Display elements
        this.loading = document.getElementById('loading');
        this.error = document.getElementById('error');
        this.result = document.getElementById('result');
        this.resultContent = document.getElementById('resultContent');
        this.resultStats = document.getElementById('resultStats');
    }

    attachEventListeners() {
        this.summarizeSelectedBtn.addEventListener('click', () => this.handleSelectedText());
        this.summarizeCustomBtn.addEventListener('click', () => this.toggleCustomTextMode());
        this.summarizeBtn.addEventListener('click', () => this.handleCustomText());
        this.copyBtn.addEventListener('click', () => this.copyToClipboard());

        // Save settings when changed
        this.formatSelect.addEventListener('change', () => this.saveSettings());
        this.detailSelect.addEventListener('change', () => this.saveSettings());

        // Auto-resize textarea
        this.customText.addEventListener('input', (e) => {
            e.target.style.height = 'auto';
            e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
        });
    }

    async loadSettings() {
        try {
            const result = await chrome.storage.sync.get(['format', 'detailLevel']);
            if (result.format) {
                this.formatSelect.value = result.format;
            }
            if (result.detailLevel) {
                this.detailSelect.value = result.detailLevel;
            }
        } catch (error) {
            console.log('Could not load settings:', error);
        }
    }

    async saveSettings() {
        try {
            await chrome.storage.sync.set({
                format: this.formatSelect.value,
                detailLevel: this.detailSelect.value
            });
        } catch (error) {
            console.log('Could not save settings:', error);
        }
    }

    toggleCustomTextMode() {
        const isVisible = this.customTextContainer.style.display !== 'none';
        this.customTextContainer.style.display = isVisible ? 'none' : 'block';
        
        if (!isVisible) {
            this.customText.focus();
            // Update button text
            this.summarizeCustomBtn.textContent = '❌ Cancel';
        } else {
            this.summarizeCustomBtn.textContent = '✏️ Custom Text';
            this.hideResults();
        }
    }

    async handleSelectedText() {
        try {
            // Get selected text from active tab
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                function: () => {
                    const selection = window.getSelection().toString().trim();
                    if (selection) {
                        return selection;
                    }
                    
                    // If no selection, try to get main content
                    const article = document.querySelector('article');
                    if (article) {
                        return article.innerText.trim();
                    }
                    
                    // Fallback to body text (first 5000 chars)
                    const bodyText = document.body.innerText.trim();
                    return bodyText.length > 5000 ? bodyText.substring(0, 5000) + '...' : bodyText;
                }
            });

            const selectedText = results[0].result;
            
            if (!selectedText || selectedText.length < 50) {
                this.showError('No text selected or text too short. Please select some text on the page or use custom text mode.');
                return;
            }

            await this.summarizeText(selectedText);
        } catch (error) {
            console.error('Error getting selected text:', error);
            this.showError('Could not access page content. Please try selecting text manually or use custom text mode.');
        }
    }

    async handleCustomText() {
        const text = this.customText.value.trim();
        
        if (!text) {
            this.showError('Please enter some text to summarize.');
            return;
        }

        if (text.length < 50) {
            this.showError('Text too short. Please enter at least 50 characters.');
            return;
        }

        await this.summarizeText(text);
    }

    async summarizeText(text) {
        this.showLoading();
        this.hideError();

        try {
            const requestBody = {
                text: text,
                format: this.formatSelect.value,
                detail_level: this.detailSelect.value
            };

            console.log('Sending request to:', `${this.apiUrl}/summarize`);
            console.log('Request body:', requestBody);

            const response = await fetch(`${this.apiUrl}/summarize`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.detail || `HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            this.displayResult(data);
            
        } catch (error) {
            console.error('Summarization error:', error);
            
            if (error.name === 'TypeError' && error.message.includes('fetch')) {
                this.showError('Could not connect to ContentSnap API. Please make sure the server is running on ' + this.apiUrl);
            } else {
                this.showError(`Error: ${error.message}`);
            }
        } finally {
            this.hideLoading();
        }
    }

    displayResult(data) {
        // Update stats
        const compressionRatio = ((data.original_length - data.summary_length) / data.original_length * 100).toFixed(1);
        this.resultStats.textContent = `${data.summary_length} chars (${compressionRatio}% reduction)`;
        
        // Display summary
        this.resultContent.textContent = data.summary;
        
        // Show result section with animation
        this.result.classList.add('show');
        
        // Scroll to result
        this.result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    showLoading() {
        this.loading.classList.add('show');
        this.hideResults();
    }

    hideLoading() {
        this.loading.classList.remove('show');
    }

    showError(message) {
        this.error.textContent = message;
        this.error.classList.add('show');
        setTimeout(() => {
            this.error.classList.remove('show');
        }, 5000);
    }

    hideError() {
        this.error.classList.remove('show');
    }

    hideResults() {
        this.result.classList.remove('show');
    }

    async copyToClipboard() {
        try {
            await navigator.clipboard.writeText(this.resultContent.textContent);
            
            // Visual feedback
            const originalText = this.copyBtn.textContent;
            this.copyBtn.textContent = '✅ Copied!';
            this.copyBtn.style.background = 'rgba(72, 187, 120, 0.2)';
            this.copyBtn.style.color = '#38a169';
            
            setTimeout(() => {
                this.copyBtn.textContent = originalText;
                this.copyBtn.style.background = 'rgba(102, 126, 234, 0.1)';
                this.copyBtn.style.color = '#667eea';
            }, 2000);
            
        } catch (error) {
            console.error('Could not copy text:', error);
            this.showError('Could not copy to clipboard');
        }
    }

    // Utility method to check API health
    async checkApiHealth() {
        try {
            const response = await fetch(`${this.apiUrl}/health`);
            return response.ok;
        } catch (error) {
            return false;
        }
    }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.contentSnapPopup = new ContentSnapPopup();
});

// Handle extension icon click
chrome.runtime.onMessage?.addListener((request, sender, sendResponse) => {
    if (request.action === 'openPopup') {
        // Popup is already open, no additional action needed
        sendResponse({ success: true });
    }
});