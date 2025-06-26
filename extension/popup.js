class ContentSnapPopup {
    constructor() {
        this.apiBaseUrl = 'http://localhost:8000'; // Change for production
        this.currentSummary = null;
        this.originalText = '';
        
        this.initializeElements();
        this.attachEventListeners();
        this.loadSettings();
    }
    
    initializeElements() {
        this.elements = {
            summarizeBtn: document.getElementById('summarize'),
            clearBtn: document.getElementById('clear'),
            formatSelect: document.getElementById('format'),
            loading: document.getElementById('loading'),
            summaryContainer: document.getElementById('summary-container'),
            summaryText: document.getElementById('summary-text'),
            error: document.getElementById('error'),
            stats: document.getElementById('stats'),
            originalLength: document.getElementById('original-length'),
            summaryLength: document.getElementById('summary-length')
        };
    }
    
    attachEventListeners() {
        this.elements.summarizeBtn.addEventListener('click', () => this.handleSummarize());
        this.elements.clearBtn.addEventListener('click', () => this.handleClear());
        this.elements.formatSelect.addEventListener('change', () => this.saveSettings());
    }
    
    async loadSettings() {
        try {
            const result = await chrome.storage.sync.get(['summaryFormat']);
            if (result.summaryFormat) {
                this.elements.formatSelect.value = result.summaryFormat;
            }
        } catch (error) {
            console.log('No saved settings found');
        }
    }
    
    async saveSettings() {
        try {
            await chrome.storage.sync.set({
                summaryFormat: this.elements.formatSelect.value
            });
        } catch (error) {
            console.error('Failed to save settings:', error);
        }
    }
    
    async handleSummarize() {
        try {
            this.showLoading(true);
            this.hideError();
            
            // Get text from current tab
            const text = await this.getTextFromPage();
            
            if (!text || text.length < 50) {
                throw new Error('Please select text or ensure the page has enough content to summarize.');
            }
            
            this.originalText = text;
            
            // Call summarization API
            const summary = await this.summarizeText(text);
            
            // Display results
            this.displaySummary(summary);
            
        } catch (error) {
            this.showError(error.message);
        } finally {
            this.showLoading(false);
        }
    }
    
    async getTextFromPage() {
        return new Promise((resolve) => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                chrome.tabs.sendMessage(tabs[0].id, { action: 'getSelectedText' }, (response) => {
                    if (response && response.text && response.text.length > 50) {
                        resolve(response.text);
                    } else {
                        // Fallback to full page text
                        chrome.tabs.sendMessage(tabs[0].id, { action: 'getFullPageText' }, (fullResponse) => {
                            resolve(fullResponse ? fullResponse.text : '');
                        });
                    }
                });
            });
        });
    }
    
    async summarizeText(text) {
        const requestBody = {
            text: text,
            format: this.elements.formatSelect.value,
            max_length: this.getMaxLength(),
            min_length: this.getMinLength()
        };
        
        const response = await fetch(`${this.apiBaseUrl}/summarize`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Failed to generate summary');
        }
        
        return await response.json();
    }
    
    getMaxLength() {
        const format = this.elements.formatSelect.value;
        switch (format) {
            case 'tldr': return 100;
            case 'bullet_points': return 200;
            case 'simplified': return 250;
            default: return 150;
        }
    }
    
    getMinLength() {
        const format = this.elements.formatSelect.value;
        switch (format) {
            case 'tldr': return 30;
            case 'bullet_points': return 50;
            case 'simplified': return 40;
            default: return 40;
        }
    }
    
    displaySummary(summaryData) {
        this.currentSummary = summaryData;
        
        // Format summary text
        let formattedSummary = summaryData.summary;
        if (summaryData.format === 'bullet_points' && !formattedSummary.includes('•')) {
            const sentences = formattedSummary.split('. ');
            formattedSummary = sentences
                .filter(s => s.trim().length > 0)
                .map(s => `• ${s.trim()}${s.endsWith('.') ? '' : '.'}`)
                .join('\n');
        }
        
        this.elements.summaryText.innerHTML = this.formatText(formattedSummary);
        
        // Update stats
        this.elements.originalLength.textContent = `Original: ${summaryData.original_length} chars`;
        this.elements.summaryLength.textContent = `Summary: ${summaryData.summary_length} chars`;
        
        // Show summary container
        this.elements.summaryContainer.style.display = 'block';
        
        // Highlight original text in page
        this.highlightOriginalText();
    }
    
    formatText(text) {
        return text
            .replace(/\n/g, '<br>')
            .replace(/•/g, '<span style="color: #4CAF50; font-weight: bold;">•</span>')
            .replace(/TL;DR:/g, '<strong style="color: #FF9800;">TL;DR:</strong>');
    }
    
    async highlightOriginalText() {
        if (this.originalText) {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                chrome.tabs.sendMessage(tabs[0].id, {
                    action: 'highlightText',
                    text: this.originalText.substring(0, 100)
                });
            });
        }
    }
    
    handleClear() {
        this.elements.summaryContainer.style.display = 'none';
        this.elements.error.style.display = 'none';
        this.currentSummary = null;
        this.originalText = '';
        
        // Remove highlights from page
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            chrome.tabs.sendMessage(tabs[0].id, { action: 'removeHighlight' });
        });
    }
    
    showLoading(show) {
        this.elements.loading.style.display = show ? 'block' : 'none';
        this.elements.summarizeBtn.disabled = show;
        this.elements.clearBtn.disabled = show;
    }
    
    showError(message) {
        this.elements.error.textContent = message;
        this.elements.error.style.display = 'block';
        this.elements.summaryContainer.style.display = 'none';
    }
    
    hideError() {
        this.elements.error.style.display = 'none';
    }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new ContentSnapPopup();
});