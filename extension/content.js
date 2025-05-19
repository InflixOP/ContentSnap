// Extract visible text from the page
function getVisibleText() {
    let elements = document.body.getElementsByTagName("*");
    let visibleText = "";

    for (let i = 0; i < elements.length; i++) {
        let el = elements[i];
        let style = window.getComputedStyle(el);

        // Skip hidden or script/style elements
        if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            el.tagName === "SCRIPT" ||
            el.tagName === "STYLE" ||
            el.tagName === "NOSCRIPT"
        ) {
            continue;
        }

        // Collect text content
        if (el.innerText) {
            visibleText += el.innerText.trim() + " ";
        }
    }

    return visibleText;
}

// Listen for messages from popup.js or background.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "extractText") {
        const pageText = getVisibleText();
        sendResponse({ text: pageText });
    }
});
