document.getElementById("summarizeBtn").addEventListener("click", async () => {
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: getPageContent,
    }, async (results) => {
      const pageText = results[0].result;
      const summaryType = document.getElementById("summaryType").value;
  
      const res = await fetch("http://127.0.0.1:8000/summarize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ text: pageText, summary_type: summaryType })
      });
  
      const data = await res.json();
      document.getElementById("output").innerText = data.summary;
    });
  });
  
  function getPageContent() {
    return document.body.innerText;
  }
  