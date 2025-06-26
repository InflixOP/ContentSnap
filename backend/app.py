import asyncio
import logging
import re
import warnings
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from transformers import pipeline

# Suppress specific warnings
warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=UserWarning)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global models - loaded once at startup
summarizers = {}
executor = ThreadPoolExecutor(max_workers=4)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await load_models()
    yield
    # Shutdown
    executor.shutdown(wait=True)

app = FastAPI(title="ContentSnap API", version="2.0.0", lifespan=lifespan)

# CORS middleware for browser extension
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SummarizeRequest(BaseModel):
    text: str
    format: str = "bullet_points"  # bullet_points, tldr, simplified, detailed
    max_length: Optional[int] = None  # Will be auto-calculated based on input length
    min_length: Optional[int] = None
    detail_level: str = "medium"  # low, medium, high

class SummarizeResponse(BaseModel):
    summary: str
    format: str
    original_length: int
    summary_length: int
    chunks_processed: int
    detail_level: str

async def load_models():
    """Load NLP models on startup"""
    try:
        logger.info("Loading summarization models...")
        
        # Load different models for different formats with better error handling
        try:
            summarizers["bart"] = pipeline(
                "summarization",
                model="facebook/bart-large-cnn",
                tokenizer="facebook/bart-large-cnn",
                device=-1  # Use CPU, change to 0 for GPU
            )
            logger.info("BART model loaded successfully")
        except Exception as e:
            logger.error(f"Failed to load BART model: {e}")
        
        try:
            summarizers["t5"] = pipeline(
                "summarization",
                model="t5-base",
                tokenizer="t5-base",
                device=-1
            )
            logger.info("T5 model loaded successfully")
        except Exception as e:
            logger.error(f"Failed to load T5 model: {e}")
        
        # For very long texts, use the same BART model but with different settings
        if "bart" in summarizers:
            summarizers["long_text"] = summarizers["bart"]
            logger.info("Long text model configured")
        
        if not summarizers:
            raise Exception("No models could be loaded")
            
        logger.info(f"Models loaded successfully! Available models: {list(summarizers.keys())}")
    except Exception as e:
        logger.error(f"Critical error loading models: {e}")
        raise

def clean_text(text: str) -> str:
    """Clean and preprocess text"""
    # Remove extra whitespace and newlines
    text = re.sub(r'\s+', ' ', text)
    # Remove special characters but keep punctuation
    text = re.sub(r'[^\w\s.,!?;:\-()"]', '', text)
    return text.strip()

def intelligent_chunk_text(text: str, target_chunks: int = 15) -> List[str]:
    """
    Intelligently split text into chunks based on paragraphs and sentences
    for better contextual summaries - FIXED chunking logic
    """
    total_length = len(text)
    target_chunk_size = max(total_length // target_chunks, 1000)
    
    logger.info(f"Chunking: total_length={total_length}, target_chunks={target_chunks}, target_chunk_size={target_chunk_size}")
    
    # First try to split by paragraphs
    paragraphs = [p.strip() for p in text.split('\n\n') if p.strip()]
    
    if not paragraphs or len(paragraphs) < 3:
        # Fallback to sentence splitting
        sentences = [s.strip() for s in text.split('.') if s.strip() and len(s.strip()) > 20]
        if sentences:
            paragraphs = [s + '.' for s in sentences]
        else:
            # Ultimate fallback: split by fixed size
            paragraphs = [text[i:i+target_chunk_size] for i in range(0, len(text), target_chunk_size)]
    
    logger.info(f"Found {len(paragraphs)} paragraphs to process")
    
    chunks = []
    current_chunk = ""
    
    for i, paragraph in enumerate(paragraphs):
        # Check if adding this paragraph would exceed target size
        potential_chunk = current_chunk + " " + paragraph if current_chunk else paragraph
        
        if len(potential_chunk) > target_chunk_size and current_chunk:
            # Current chunk is full, save it and start new one
            chunks.append(current_chunk.strip())
            current_chunk = paragraph
        else:
            # Add paragraph to current chunk
            current_chunk = potential_chunk
        
        # Force chunk creation if we're getting too big (safety valve)
        if len(current_chunk) > target_chunk_size * 1.5:
            chunks.append(current_chunk.strip())
            current_chunk = ""
    
    # Add the last chunk if it has content
    if current_chunk.strip():
        chunks.append(current_chunk.strip())
    
    # SAFETY: If we still have too few chunks for large text, force split
    if len(chunks) < max(2, target_chunks // 3) and total_length > 20000:
        logger.warning(f"Only got {len(chunks)} chunks, force splitting...")
        # Force split the largest chunks
        new_chunks = []
        for chunk in chunks:
            if len(chunk) > target_chunk_size * 2:
                # Split this chunk in half
                mid_point = len(chunk) // 2
                # Try to split at a sentence boundary near the midpoint
                sentences_in_chunk = chunk.split('.')
                if len(sentences_in_chunk) > 2:
                    mid_sentence = len(sentences_in_chunk) // 2
                    first_half = '.'.join(sentences_in_chunk[:mid_sentence]) + '.'
                    second_half = '.'.join(sentences_in_chunk[mid_sentence:])
                    new_chunks.extend([first_half.strip(), second_half.strip()])
                else:
                    # Just split at midpoint
                    new_chunks.extend([chunk[:mid_point].strip(), chunk[mid_point:].strip()])
            else:
                new_chunks.append(chunk)
        chunks = [c for c in new_chunks if c.strip()]
    
    logger.info(f"Final chunk count: {len(chunks)}, average size: {sum(len(c) for c in chunks) / len(chunks):.0f}")
    return chunks

def calculate_summary_params(text_length: int, detail_level: str, format_type: str):
    """Calculate appropriate summary parameters - ENHANCED for longer summaries"""
    
    # NEW: Much more generous ratios for longer, detailed summaries
    if text_length < 2000:
        # For shorter texts, use moderate ratios
        detail_ratios = {
            "low": 0.4,      # 40% of original for short texts
            "medium": 0.6,   # 60% of original
            "high": 0.8      # 80% of original
        }
        min_lengths = {"low": 100, "medium": 200, "high": 300}
        max_lengths = {"low": 500, "medium": 1000, "high": 1500}
    elif text_length < 20000:
        # For medium texts (like typical web articles)
        detail_ratios = {
            "low": 0.3,      # 30% of original
            "medium": 0.5,   # 50% of original  
            "high": 0.7      # 70% of original
        }
        min_lengths = {"low": 1000, "medium": 2500, "high": 4000}
        max_lengths = {"low": 3000, "medium": 7000, "high": 12000}
    else:
        # For long texts (Wikipedia articles, etc.) - MUCH MORE GENEROUS
        detail_ratios = {
            "low": 0.15,     # 15% of original (was 5%)
            "medium": 0.3,   # 30% of original (was 15%)
            "high": 0.5      # 50% of original (was 25%)
        }
        min_lengths = {"low": 2000, "medium": 5000, "high": 8000}
        max_lengths = {"low": 8000, "medium": 15000, "high": 25000}  # Much higher limits
    
    ratio = detail_ratios.get(detail_level, 0.3)  # Default to higher ratio
    target_length = int(text_length * ratio)
    
    # Apply bounds
    min_bound = min_lengths.get(detail_level, 2000)  # Higher minimum
    max_bound = max_lengths.get(detail_level, 10000)  # Higher maximum
    
    target_length = max(min_bound, min(target_length, max_bound))
    
    # For very long texts (lakhs of characters), ensure SUBSTANTIAL summaries
    if text_length > 100000:  # 1 lakh characters
        if detail_level == "high":
            target_length = max(target_length, 20000)  # At least 20k chars
        elif detail_level == "medium":
            target_length = max(target_length, 12000)  # At least 12k chars
        else:
            target_length = max(target_length, 8000)   # At least 8k chars
    
    # For Wikipedia-sized articles (50k+ chars), ensure good summaries
    elif text_length > 50000:
        if detail_level == "high":
            target_length = max(target_length, 15000)  # At least 15k chars
        elif detail_level == "medium":
            target_length = max(target_length, 8000)   # At least 8k chars
        else:
            target_length = max(target_length, 5000)   # At least 5k chars
    
    # Convert to token estimates (roughly 4 chars per token) with higher limits
    max_tokens = min(1024, target_length // 3)  # More generous token conversion
    min_tokens = max(50, max_tokens // 3)  # Higher minimum tokens
    
    # Additional safety check
    if min_tokens >= max_tokens:
        max_tokens = min_tokens + 100  # Larger buffer
    
    logger.info(f"Summary params: text_length={text_length}, target_length={target_length}, min_tokens={min_tokens}, max_tokens={max_tokens}")
    
    return min_tokens, max_tokens, target_length

def run_summarization(text: str, model_key: str, max_length: int, min_length: int, detail_level: str):
    """Run summarization in thread with enhanced processing for long texts"""
    try:
        summarizer = summarizers[model_key]
        text_length = len(text)
        
        # Ensure min_length is always less than max_length
        if min_length >= max_length:
            min_length = max(1, max_length - 50)  # Larger buffer
        
        logger.info(f"Summarization params: min_length={min_length}, max_length={max_length}, text_length={text_length}")
        
        # For long texts, use hierarchical summarization with MORE CHUNKS for detail
        if text_length > 8000:  # Lower threshold for chunking
            # Create more chunks for better detail retention
            chunk_count = min(30, max(15, text_length // 2500))  # More aggressive chunking
            chunks = intelligent_chunk_text(text, target_chunks=chunk_count)
            
            # CRITICAL: Ensure we actually got multiple chunks
            if len(chunks) < 3 and text_length > 20000:
                logger.warning(f"Only got {len(chunks)} chunks for {text_length} chars, forcing split...")
                # Force split into more chunks
                chunk_size = text_length // max(10, chunk_count // 2)
                chunks = [text[i:i+chunk_size] for i in range(0, len(text), chunk_size)]
                logger.info(f"Force-split into {len(chunks)} chunks")
            
            chunk_summaries = []
            logger.info(f"Processing {len(chunks)} chunks for detailed summarization")
            
            # Summarize each chunk with MUCH higher detail
            for i, chunk in enumerate(chunks):
                if len(chunk) > 100:  # Only process substantial chunks
                    try:
                        # Calculate per-chunk summary length - MORE GENEROUS
                        chunk_target = max(150, min(400, len(chunk) // 3))  # Target 1/3 of chunk length
                        chunk_max_length = min(200, chunk_target // 4)  # Convert to tokens
                        chunk_min_length = max(20, chunk_max_length // 3)
                        
                        result = summarizer(
                            chunk,
                            max_length=chunk_max_length,
                            min_length=chunk_min_length,
                            do_sample=False,
                            truncation=True,
                            early_stopping=True
                        )
                        
                        # Clean up the summary text
                        chunk_summary = result[0]['summary_text'].strip()
                        if chunk_summary:
                            chunk_summaries.append(chunk_summary)
                        
                        logger.info(f"Processed chunk {i+1}/{len(chunks)} -> {len(chunk_summary)} chars")
                    except Exception as e:
                        logger.warning(f"Error processing chunk {i+1}: {e}")
                        continue
            
            # Combine all chunk summaries
            if chunk_summaries:
                combined_summary = " ".join(chunk_summaries)
                logger.info(f"Combined summary length: {len(combined_summary)} characters")
                
                # If combined summary is still very long, do a GENTLE final summarization
                if len(combined_summary) > 8000 and detail_level != "high":
                    try:
                        # Much more conservative final summarization
                        final_target = max(5000, len(combined_summary) // 2)  # Keep at least half
                        final_max_length = min(400, final_target // 4)
                        final_min_length = max(100, final_max_length // 2)
                        
                        logger.info(f"Final summarization: {len(combined_summary)} -> target {final_target}")
                        
                        final_result = summarizer(
                            combined_summary,
                            max_length=final_max_length,
                            min_length=final_min_length,
                            do_sample=False,
                            truncation=True,
                            early_stopping=True
                        )
                        final_summary = final_result[0]['summary_text'].strip()
                        logger.info(f"Final summary length: {len(final_summary)} characters")
                        return final_summary
                    except Exception as e:
                        logger.warning(f"Final summarization failed: {e}")
                        # Return the combined summaries if final step fails
                        return combined_summary
                else:
                    # For high detail level or reasonable length, return combined summary
                    return combined_summary
            else:
                # Fallback: truncate and summarize the beginning
                truncated_text = text[:3000]  # Larger chunk
                result = summarizer(
                    truncated_text,
                    max_length=min(max_length, 200),
                    min_length=min(min_length, 50),
                    do_sample=False,
                    truncation=True,
                    early_stopping=True
                )
                return result[0]['summary_text'].strip()
        else:
            # For shorter texts, use direct summarization with generous limits
            input_length = len(text.split())  # Rough word count
            safe_max_length = min(max_length, max(50, input_length // 2))
            safe_min_length = max(10, min(safe_max_length - 20, min_length))
            
            logger.info(f"Direct summarization: input_words≈{input_length}, safe_max={safe_max_length}, safe_min={safe_min_length}")
            
            result = summarizer(
                text,
                max_length=safe_max_length,
                min_length=safe_min_length,
                do_sample=False,
                truncation=True,
                early_stopping=True
            )
            return result[0]['summary_text'].strip()
            
    except Exception as e:
        logger.error(f"Summarization error: {e}")
        return None

@app.post("/summarize", response_model=SummarizeResponse)
async def summarize_text(request: SummarizeRequest):
    """Enhanced summarize text endpoint with support for detailed long-text summaries"""
    try:
        if not request.text or len(request.text.strip()) < 50:
            raise HTTPException(
                status_code=400,
                detail="Text too short. Minimum 50 characters required."
            )
        
        # Clean the input text
        cleaned_text = clean_text(request.text)
        text_length = len(cleaned_text)
        
        # Calculate appropriate summary parameters
        min_tokens, max_tokens, target_length = calculate_summary_params(
            text_length, request.detail_level, request.format
        )
        
        # Override with user-provided values if specified
        if request.max_length:
            max_tokens = min(request.max_length // 3, 1024)  # More generous conversion
        if request.min_length:
            min_tokens = max(request.min_length // 6, 20)
        
        # Final safety check for token limits
        if min_tokens >= max_tokens:
            max_tokens = min_tokens + 50
        
        # Choose model based on format and text length
        if text_length > 30000:  # For very long texts
            model_key = "long_text"
        elif request.format == "tldr":
            model_key = "bart"
        elif request.format == "simplified":
            model_key = "t5"
        else:  # bullet_points, detailed
            model_key = "bart"
        
        logger.info(f"Processing text of {text_length} chars, target summary: {target_length} chars")
        
        # Run summarization in thread to avoid blocking
        loop = asyncio.get_event_loop()
        summary = await loop.run_in_executor(
            executor,
            run_summarization,
            cleaned_text,
            model_key,
            max_tokens,
            min_tokens,
            request.detail_level
        )
        
        if not summary:
            raise HTTPException(
                status_code=500,
                detail="Failed to generate summary"
            )
        
        # Format the summary based on request
        if request.format == "bullet_points":
            # Convert to bullet points with better formatting for longer summaries
            cleaned_summary = summary.strip()
            
            # For longer summaries, create more bullet points
            # Split by sentences first
            sentences = [s.strip() for s in cleaned_summary.split('.') if s.strip() and len(s.strip()) > 15]
            
            # If we don't have enough sentences, try other splitting methods
            if len(sentences) < 3:
                # Try splitting by semicolons and conjunctions
                import re
                parts = re.split(r'[;]\s*|[,]\s*(?:and|but|however|while|whereas|although|furthermore|moreover|additionally)\s+', cleaned_summary)
                sentences = [s.strip() for s in parts if s.strip() and len(s.strip()) > 20]
            
            # Create more bullet points for longer summaries
            max_bullets = min(15, max(5, len(sentences)))  # Between 5-15 bullets
            bullet_points = []
            
            for sentence in sentences[:max_bullets]:
                sentence = sentence.strip()
                if sentence:
                    # Ensure it ends with proper punctuation
                    if not sentence[-1] in '.!?':
                        sentence += '.'
                    bullet_points.append(f"• {sentence}")
            
            formatted_summary = "\n".join(bullet_points)
            
        elif request.format == "tldr":
            formatted_summary = f"TL;DR: {summary.strip()}"
        else:  # simplified, detailed
            formatted_summary = summary.strip()
        
        # Calculate chunks processed (estimate)
        chunks_processed = max(1, text_length // 3000)
        
        return SummarizeResponse(
            summary=formatted_summary,
            format=request.format,
            original_length=text_length,
            summary_length=len(formatted_summary),
            chunks_processed=chunks_processed,
            detail_level=request.detail_level
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
        "available_formats": ["bullet_points", "tldr", "simplified", "detailed"],
        "detail_levels": ["low", "medium", "high"],
        "max_supported_length": "unlimited (with enhanced chunking)",
        "summary_targets": {
            "medium_articles": "5000-8000 chars",
            "long_articles": "8000-15000 chars", 
            "very_long": "15000+ chars"
        }
    }

@app.get("/")
async def root():
    """Root endpoint with API information"""
    return {
        "message": "ContentSnap API v2.0 - Enhanced Text Summarization with Longer Summaries",
        "features": [
            "Much longer detailed summaries (5000+ characters)",
            "Enhanced chunking for better context retention",
            "Hierarchical summarization for very long texts",
            "Optimized for Wikipedia-length articles"
        ],
        "endpoints": {
            "/summarize": "POST - Summarize text with enhanced detail options",
            "/health": "GET - Health check",
            "/docs": "GET - API documentation"
        },
        "tip": "Use detail_level='high' for maximum summary length"
    }

if __name__ == "__main__":
    import uvicorn
    print("🚀 Starting ContentSnap API Server...")
    print("📄 API Documentation: http://localhost:8000/docs")
    print("💡 Health check: http://localhost:8000/health")
    print("⚡ Press Ctrl+C to stop")
    print("🔥 Enhanced for LONGER summaries (5000+ chars)")
    print("-" * 50)
    
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)