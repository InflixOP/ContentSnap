from transformers import pipeline

summarizer = pipeline("summarization", model="facebook/bart-large-cnn", framework="pt")

def chunk_text(text, max_chunk_size=1000):
    """
    Split long text into chunks that the summarization model can handle.
    """
    chunks = []
    while len(text) > max_chunk_size:
        split_point = text.rfind('.', 0, max_chunk_size)
        if split_point == -1:
            split_point = max_chunk_size
        chunks.append(text[:split_point + 1].strip())
        text = text[split_point + 1:]
    if text.strip():
        chunks.append(text.strip())
    return chunks

def generate_summary(text, summary_type=None):
    """
    Summarize the given text, handling large input by chunking.
    """
    chunks = chunk_text(text)
    summary = ""
    for chunk in chunks:
        result = summarizer(chunk, max_length=200, min_length=50, do_sample=False)
        summary += result[0]['summary_text'] + " "
    return summary.strip()
