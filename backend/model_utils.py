from transformers import pipeline

# Choose model: BART / Pegasus / T5
summarizer = pipeline("summarization", model="facebook/bart-large-cnn")

def generate_summary(text, summary_type="bullet"):
    if len(text.split()) > 1024:
        text = " ".join(text.split()[:1024])
    
    summary = summarizer(text, max_length=200, min_length=50, do_sample=False)[0]['summary_text']
    
    if summary_type == "tldr":
        return "TL;DR: " + summary
    elif summary_type == "simple":
        return summary  # Optionally simplify using additional NLP models
    else:
        return "• " + summary.replace(". ", ".\n• ")
