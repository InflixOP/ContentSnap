import asyncio
import logging
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from transformers import pipeline

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="ContentSnap API", version="1.0.0")

# CORS middleware for browser extension
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global models - loaded once at startup
summarizers = {}
executor = ThreadPoolExecutor(max_workers=3)

class SummarizeRequest(BaseModel):
    text: str
    format: str = "bullet_points"  # bullet_points, tldr, simplified
    max_length: Optional[int] = 150
    min_length: Optional[int] = 50

class SummarizeResponse(BaseModel):
    summary: str
    format: str
    original_length: int
    summary_length: int

@app.on_event("startup")
async def load_models():
    """Load NLP models on startup"""
    try:
        logger.info("Loading summarization models...")
        
        # Load different models for different formats
        summarizers["bart"] = pipeline(
            "summarization",
            model="facebook/bart-large-cnn",
            tokenizer="facebook/bart-large-cnn"
        )
        
        summarizers["t5"] = pipeline(
            "summarization",
            model="t5-base",
            tokenizer="t5-base"
        )
        
        logger.info("Models loaded successfully!")
    except Exception as e:
        logger.error(f"Error loading models: {e}")

def clean_text(text: str) -> str:
    """Clean and preprocess text"""
    # Remove extra whitespace and newlines
    text = re.sub(r'\s+', ' ', text)
    # Remove special characters but keep punctuation
    text = re.sub(r'[^\w\s.,!?;:-]', '', text)
    return text.strip()

def chunk_text(text: str, max_chunk_size: int = 1000) -> list:
    """Split long text into smaller chunks"""
    sentences = text.split('. ')
    chunks = []
    current_chunk = ""
    
    for sentence in sentences:
        if len(current_chunk + sentence) < max_chunk_size:
            current_chunk += sentence + ". "
        else:
            if current_chunk:
                chunks.append(current_chunk.strip())
            current_chunk = sentence + ". "
    
    if current_chunk:
        chunks.append(current_chunk.strip())
    
    return chunks

def run_summarization(text: str, model_key: str, max_length: int, min_length: int):
    """Run summarization in thread"""
    try:
        summarizer = summarizers[model_key]
        
        # Handle long text by chunking
        if len(text) > 1000:
            chunks = chunk_text(text)
            summaries = []
            
            for chunk in chunks[:3]:  # Limit to first 3 chunks
                if len(chunk) > 50:  # Only summarize substantial chunks
                    result = summarizer(
                        chunk,
                        max_length=max_length//len(chunks[:3]),
                        min_length=min_length//len(chunks[:3]),
                        do_sample=False
                    )
                    summaries.append(result[0]['summary_text'])
            
            return " ".join(summaries)
        else:
            result = summarizer(
                text,
                max_length=max_length,
                min_length=min_length,
                do_sample=False
            )
            return result[0]['summary_text']
            
    except Exception as e:
        logger.error(f"Summarization error: {e}")
        return None

@app.post("/summarize", response_model=SummarizeResponse)
async def summarize_text(request: SummarizeRequest):
    """Summarize text endpoint"""
    try:
        if not request.text or len(request.text.strip()) < 50:
            raise HTTPException(
                status_code=400,
                detail="Text too short. Minimum 50 characters required."
            )
        
        # Clean the input text
        cleaned_text = clean_text(request.text)
        
        # Choose model based on format
        if request.format == "tldr":
            model_key = "bart"
            max_len = min(request.max_length, 100)
            min_len = min(request.min_length, 30)
        elif request.format == "simplified":
            model_key = "t5"
            max_len = min(request.max_length, 200)
            min_len = min(request.min_length, 50)
        else:  # bullet_points
            model_key = "bart"
            max_len = request.max_length
            min_len = request.min_length
        
        # Run summarization in thread to avoid blocking
        loop = asyncio.get_event_loop()
        summary = await loop.run_in_executor(
            executor,
            run_summarization,
            cleaned_text,
            model_key,
            max_len,
            min_len
        )
        
        if not summary:
            raise HTTPException(
                status_code=500,
                detail="Failed to generate summary"
            )
        
        # Format the summary based on request
        if request.format == "bullet_points":
            # Convert to bullet points
            sentences = summary.split('. ')
            formatted_summary = "\n".join([f"• {s.strip()}." for s in sentences if s.strip()])
        elif request.format == "tldr":
            formatted_summary = f"TL;DR: {summary}"
        else:  # simplified
            formatted_summary = summary
        
        return SummarizeResponse(
            summary=formatted_summary,
            format=request.format,
            original_length=len(request.text),
            summary_length=len(formatted_summary)
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "models_loaded": len(summarizers) > 0,
        "available_formats": ["bullet_points", "tldr", "simplified"]
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)