class ContentSnapPopup {
    constructor() {
        this.apiUrl = 'http://localhost:8000';
        this.currentTheme = 'light';
        this.initializeElements();
        this.attachEventListeners();
        this.loadSettings();
        this.checkStoredText();
    }

    initializeElements() {
        this.summarizeSelectedBtn = document.getElementById('summarizeSelected');
        this.summarizeCustomBtn = document.getElementById('summarizeCustom');
        this.summarizeBtn = document.getElementById('summarizeBtn');
        this.copyBtn = document.getElementById('copyBtn');
        this.themeToggle = document.getElementById('themeToggle');
        this.menuBtn = document.getElementById('menuBtn');
        this.backBtn = document.getElementById('backBtn');
        this.formatSelect = document.getElementById('formatSelect');
        this.detailSelect = document.getElementById('detailSelect');
        this.customText = document.getElementById('customText');
        this.customTextContainer = document.getElementById('customTextContainer');
        this.loading = document.getElementById('loading');
        this.error = document.getElementById('error');
        this.result = document.getElementById('result');
        this.resultContent = document.getElementById('resultContent');
        this.resultStats = document.getElementById('resultStats');
        this.mainContent = document.getElementById('mainContent');
        this.navSection = document.getElementById('navSection');
        this.selectedTextBtn = document.getElementById('selectedTextBtn');
        this.optionsSection = document.querySelector('.options-section');
    }

    attachEventListeners() {
        this.summarizeSelectedBtn.addEventListener('click', () => this.handleSelectedText());
        this.summarizeCustomBtn.addEventListener('click', () => this.toggleCustomTextMode());
        this.summarizeBtn.addEventListener('click', () => this.handleCustomText());
        this.copyBtn.addEventListener('click', () => this.copyToClipboard());
        this.themeToggle.addEventListener('click', () => this.toggleTheme());
        this.menuBtn.addEventListener('click', () => this.showNavigation());
        this.backBtn.addEventListener('click', () => this.hideNavigation());
        this.formatSelect.addEventListener('change', () => this.saveSettings());
        this.detailSelect.addEventListener('change', () => this.saveSettings());
        this.customText.addEventListener('input', (e) => {
            e.target.style.height = 'auto';
            e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (this.navSection.classList.contains('show')) {
                    this.hideNavigation();
                } else if (this.customTextContainer.style.display !== 'none') {
                    this.toggleCustomTextMode();
                }
            }
        });
        this.selectedTextBtn.addEventListener('click', () => this.switchToSelectedTextMode());
    }

    async loadSettings() {
        try {
            const result = await chrome.storage.sync.get(['format', 'detailLevel', 'theme']);
            if (result.format) this.formatSelect.value = result.format;
            if (result.detailLevel) this.detailSelect.value = result.detailLevel;
            if (result.theme) {
                this.currentTheme = result.theme;
                this.applyTheme();
            }
        } catch (error) {
            console.log('Could not load settings:', error);
        }
    }

    async saveSettings() {
        try {
            await chrome.storage.sync.set({
                format: this.formatSelect.value,
                detailLevel: this.detailSelect.value,
                theme: this.currentTheme
            });
        } catch (error) {
            console.log('Could not save settings:', error);
        }
    }

    async checkStoredText() {
        try {
            const response = await chrome.runtime.sendMessage({ action: 'getStoredText' });
            if (response && response.text && response.text.length > 50) {
                this.customText.value = response.text;
                this.showNotification('Pre-loaded text from selection');
            }
        } catch (error) {
            console.log('No stored text found');
        }
    }

    toggleTheme() {
        this.currentTheme = this.currentTheme === 'light' ? 'dark' : 'light';
        this.applyTheme();
        this.saveSettings();
    }

    applyTheme() {
        document.body.setAttribute('data-theme', this.currentTheme);
        this.themeToggle.textContent = this.currentTheme === 'light' ? '🌙' : '☀️';
        this.themeToggle.title = `Switch to ${this.currentTheme === 'light' ? 'dark' : 'light'} theme`;
    }

    showNavigation() {
        this.navSection.classList.add('show');
    }

    hideNavigation() {
        this.navSection.classList.remove('show');
    }

    toggleCustomTextMode() {
        const isVisible = this.customTextContainer.style.display !== 'none';
        this.customTextContainer.style.display = isVisible ? 'none' : 'block';
        this.optionsSection.style.display = isVisible ? '' : 'none';
        this.summarizeSelectedBtn.style.display = isVisible ? '' : 'none';
        this.summarizeBtn.style.display = isVisible ? 'none' : '';
        this.summarizeCustomBtn.textContent = '✏️ Custom Text';
        if (!isVisible) {
            this.customText.focus();
            this.summarizeCustomBtn.classList.remove('btn-secondary');
            this.summarizeCustomBtn.classList.add('btn-primary');
            this.selectedTextBtn.classList.remove('btn-primary');
            this.selectedTextBtn.classList.add('btn-secondary');
        } else {
            this.summarizeCustomBtn.classList.remove('btn-primary');
            this.summarizeCustomBtn.classList.add('btn-secondary');
            this.selectedTextBtn.classList.remove('btn-secondary');
            this.selectedTextBtn.classList.add('btn-primary');
            this.hideResults();
        }
    }

    switchToSelectedTextMode() {
        this.customTextContainer.style.display = 'none';
        this.optionsSection.style.display = '';
        this.summarizeSelectedBtn.style.display = '';
        this.summarizeBtn.style.display = 'none';
        this.summarizeCustomBtn.textContent = '✏️ Custom Text';
        this.hideResults();
        this.summarizeCustomBtn.classList.remove('btn-primary');
        this.summarizeCustomBtn.classList.add('btn-secondary');
        this.selectedTextBtn.classList.remove('btn-secondary');
        this.selectedTextBtn.classList.add('btn-primary');
    }

    async handleSelectedText() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                function: () => {
                    const selection = window.getSelection().toString().trim();
                    if (selection) return selection;
                    
                    const selectors = ['article', '[role="main"]', 'main', '.content', '.post-content'];
                    for (const selector of selectors) {
                        const element = document.querySelector(selector);
                        if (element) {
                            const text = element.innerText.trim();
                            if (text.length > 100) {
                                return text.length > 5000 ? text.substring(0, 5000) + '...' : text;
                            }
                        }
                    }
                    
                    const bodyText = document.body.innerText.trim();
                    return bodyText.length > 5000 ? bodyText.substring(0, 5000) + '...' : bodyText;
                }
            });

            const selectedText = results[0].result;
            
            if (!selectedText || selectedText.length < 50) {
                this.showError('No text selected or text too short. Please select text on the page or use custom text mode.');
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

            const response = await fetch(`${this.apiUrl}/summarize`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.detail || `Server error: ${response.status}`);
            }

            const result = await response.json();
            this.showResult(result.summary, text.length);
            
        } catch (error) {
            console.error('Summarization error:', error);
            if (error.message.includes('fetch')) {
                this.showError('Could not connect to the summarization service. Please check if the server is running.');
            } else {
                this.showError(error.message);
            }
        } finally {
            this.hideLoading();
        }
    }

    showResult(summary, originalLength) {
        this.resultContent.textContent = summary;
        const wordCount = summary.split(/\s+/).length;
        const compressionRatio = Math.round((1 - summary.length / originalLength) * 100);
        
        this.resultStats.textContent = `${wordCount} words • ${compressionRatio}% shorter`;
        this.result.classList.add('show');
        
        this.result.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
            const originalText = this.copyBtn.textContent;
            this.copyBtn.textContent = '✅ Copied!';
            this.copyBtn.style.background = '#10b981';
            
            setTimeout(() => {
                this.copyBtn.textContent = originalText;
                this.copyBtn.style.background = '';
            }, 2000);
        } catch (error) {
            console.error('Failed to copy:', error);
            this.showError('Failed to copy to clipboard');
        }
    }

    showNotification(message) {
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: var(--primary);
            color: white;
            padding: 12px 16px;
            border-radius: 8px;
            font-size: 12px;
            z-index: 1000;
            animation: fadeInOut 3s ease-in-out;
        `;
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 3000);
    }
}

const style = document.createElement('style');
style.textContent = `
    @keyframes fadeInOut {
        0%, 100% { opacity: 0; transform: translateY(-10px); }
        10%, 90% { opacity: 1; transform: translateY(0); }
    }
`;
document.head.appendChild(style);

document.addEventListener('DOMContentLoaded', () => {
    new ContentSnapPopup();
});