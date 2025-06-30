# 📄 ContentSnap – Smart Article Summarizer Extension

**ContentSnap** is a powerful NLP-driven browser extension that lets you summarize long articles, blog posts, or research papers into digestible formats — instantly. Whether you're short on time or just want the TL;DR, ContentSnap helps you **read smarter, not harder**.

---

## ✨ Features

- 🔹 **One-click summarization** of any webpage text
- 🔹 **Multiple summary formats**: 
  - Bullet Points
  - TL;DR (Too Long; Didn't Read)
  - Simplified Explanation
  - Key Insights
- 🔹 **Real-time article parsing** and intelligent content extraction
- 🔹 **Cross-browser support**: Chrome, Firefox, and Edge
- 🔹 **Offline capable** with local NLP processing
- 🔹 **Privacy-focused**: No data sent to external servers
- 🔹 **Customizable summary length** (Short, Medium, Detailed)

---

## 🚀 Installation

### Method 1: Install from GitHub Releases (Recommended)

1. **Download the latest release:**
   - Go to [Releases](https://github.com/InflixOP/ContentSnap/releases)
   - Download `ContentSnap-v[version]-extension.zip`
   - Extract the ZIP file

2. **Install in Chrome/Edge:**
   - Open `chrome://extensions/` (or `edge://extensions/`)
   - Enable "Developer mode" (toggle in top-right)
   - Click "Load unpacked"
   - Select the extracted ContentSnap folder
   - Pin the extension to your toolbar

3. **Install in Firefox:**
   - Open `about:debugging`
   - Click "This Firefox"
   - Click "Load Temporary Add-on"
   - Select `manifest.json` from the extracted folder

### Method 2: Build from Source

```bash
# Clone the repository
git clone https://github.com/InflixOP/ContentSnap.git
cd ContentSnap

# Install dependencies (if any)
npm install

# Build the extension (if build process exists)
npm run build

# Follow installation steps above with the built folder
```

---

## 🧰 Tech Stack

| Component       | Technology              |
|----------------|--------------------------|
| **Frontend**   | HTML5, CSS3, Vanilla JavaScript |
| **Extension API** | Chrome Extensions API v3 |
| **NLP Processing** | TensorFlow.js, Web Workers |
| **Models**     | DistilBART, TinyBERT (optimized for browser) |
| **Storage**    | Chrome Storage API |
| **Permissions** | activeTab, storage |

---

## 📖 How to Use

1. **Navigate** to any article, blog post, or text-heavy webpage
2. **Click** the ContentSnap icon in your browser toolbar
3. **Choose** your preferred summary format:
   - 📝 **Bullet Points** - Key points in list format
   - ⚡ **TL;DR** - Ultra-quick summary
   - 🧠 **Simplified** - Easy-to-understand explanation
4. **Adjust** summary length if needed
5. **Copy** or **Save** your summary

---

## 🔧 Configuration

Access settings by clicking the gear icon in the extension popup:

- **Summary Length**: Short (2-3 sentences) | Medium (1 paragraph) | Detailed (2-3 paragraphs)
- **Auto-detect Language**: Enable multilingual support
- **Dark Mode**: Toggle dark/light theme
- **Keyboard Shortcuts**: Customize hotkeys

---

## 🌟 Screenshots

| Feature | Preview |
|---------|---------|
| **Main Interface** | ![Main UI](screenshots/main-interface.png) |
| **Summary Types** | ![Summary Options](screenshots/summary-types.png) |
| **Custom Text** | ![Settings](screenshots/custom.png) |

---

## 🤝 Contributing

We welcome contributions! Here's how you can help improve ContentSnap:

### 🐛 Report Issues
- Found a bug? [Open an issue](https://github.com/InflixOP/ContentSnap/issues/new?template=bug_report.md)
- Have a feature request? [Suggest it here](https://github.com/InflixOP/ContentSnap/issues/new?template=feature_request.md)

### 💻 Development Setup

1. **Fork the repository**
```bash
git clone https://github.com/InflixOP/ContentSnap.git
cd ContentSnap
```

2. **Create a feature branch**
```bash
git checkout -b feature/amazing-feature
```

3. **Make your changes and test**
   - Test the extension in different browsers
   - Ensure summary quality remains high
   - Check for performance issues

4. **Submit a Pull Request**
   - Provide clear description of changes
   - Include screenshots if UI changes
   - Reference any related issues


---

## 📄 License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

---


*If ContentSnap saves you time, consider giving it a ⭐ star!*
