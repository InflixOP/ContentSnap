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

warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=UserWarning)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

summarizers = {}
executor = ThreadPoolExecutor(max_workers=4)

@asynccontextmanager
async def lifespan(app: FastAPI):
    await load_models()
    yield
    executor.shutdown(wait=True)

app = FastAPI(title="ContentSnap API", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SummarizeRequest(BaseModel):
    text: str
    format: str = "bullet_points"  
    max_length: Optional[int] = None  
    min_length: Optional[int] = None
    detail_level: str = "medium" 

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
        
        try:
            summarizers["bart"] = pipeline(
                "summarization",
                model="facebook/bart-large-cnn",
                tokenizer="facebook/bart-large-cnn",
                device=-1 
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
    text = re.sub(r'\s+', ' ', text)
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
    
    paragraphs = [p.strip() for p in text.split('\n\n') if p.strip()]
    
    if not paragraphs or len(paragraphs) < 3:
        sentences = [s.strip() for s in text.split('.') if s.strip() and len(s.strip()) > 20]
        if sentences:
            paragraphs = [s + '.' for s in sentences]
        else:
            paragraphs = [text[i:i+target_chunk_size] for i in range(0, len(text), target_chunk_size)]
    
    logger.info(f"Found {len(paragraphs)} paragraphs to process")
    
    chunks = []
    current_chunk = ""
    
    for i, paragraph in enumerate(paragraphs):
        potential_chunk = current_chunk + " " + paragraph if current_chunk else paragraph
        
        if len(potential_chunk) > target_chunk_size and current_chunk:
            chunks.append(current_chunk.strip())
            current_chunk = paragraph
        else:
            current_chunk = potential_chunk
        
        if len(current_chunk) > target_chunk_size * 1.5:
            chunks.append(current_chunk.strip())
            current_chunk = ""

    if current_chunk.strip():
        chunks.append(current_chunk.strip())
    
    if len(chunks) < max(2, target_chunks // 3) and total_length > 20000:
        logger.warning(f"Only got {len(chunks)} chunks, force splitting...")
        new_chunks = []
        for chunk in chunks:
            if len(chunk) > target_chunk_size * 2:
                mid_point = len(chunk) // 2

                sentences_in_chunk = chunk.split('.')
                if len(sentences_in_chunk) > 2:
                    mid_sentence = len(sentences_in_chunk) // 2
                    first_half = '.'.join(sentences_in_chunk[:mid_sentence]) + '.'
                    second_half = '.'.join(sentences_in_chunk[mid_sentence:])
                    new_chunks.extend([first_half.strip(), second_half.strip()])
                else:
                    new_chunks.extend([chunk[:mid_point].strip(), chunk[mid_point:].strip()])
            else:
                new_chunks.append(chunk)
        chunks = [c for c in new_chunks if c.strip()]
    
    logger.info(f"Final chunk count: {len(chunks)}, average size: {sum(len(c) for c in chunks) / len(chunks):.0f}")
    return chunks

def calculate_summary_params(text_length: int, detail_level: str, format_type: str):
    """Calculate appropriate summary parameters - ENHANCED for longer summaries"""
    
    if text_length < 2000:
        
        detail_ratios = {
            "low": 0.4,     
            "medium": 0.6,   
            "high": 0.8      
        }
        min_lengths = {"low": 100, "medium": 200, "high": 300}
        max_lengths = {"low": 500, "medium": 1000, "high": 1500}
    elif text_length < 20000:
        detail_ratios = {
            "low": 0.3,      
            "medium": 0.5,   
            "high": 0.7      
        }
        min_lengths = {"low": 1000, "medium": 2500, "high": 4000}
        max_lengths = {"low": 3000, "medium": 7000, "high": 12000}
    else:

        detail_ratios = {
            "low": 0.15,    
            "medium": 0.3,   
            "high": 0.5      
        }
        min_lengths = {"low": 2000, "medium": 5000, "high": 8000}
        max_lengths = {"low": 8000, "medium": 15000, "high": 25000}  
    
    ratio = detail_ratios.get(detail_level, 0.3)  
    target_length = int(text_length * ratio)
    
    # Apply bounds
    min_bound = min_lengths.get(detail_level, 2000)  
    max_bound = max_lengths.get(detail_level, 10000)  
    
    target_length = max(min_bound, min(target_length, max_bound))
    
    if text_length > 100000:  
        if detail_level == "high":
            target_length = max(target_length, 20000) 
        elif detail_level == "medium":
            target_length = max(target_length, 12000)  
        else:
            target_length = max(target_length, 8000)  
    
    elif text_length > 50000:
        if detail_level == "high":
            target_length = max(target_length, 15000) 
        elif detail_level == "medium":
            target_length = max(target_length, 8000)   
        else:
            target_length = max(target_length, 5000)   
    
    max_tokens = min(1024, target_length // 3) 
    min_tokens = max(50, max_tokens // 3)  
    
    if min_tokens >= max_tokens:
        max_tokens = min_tokens + 100  
    
    logger.info(f"Summary params: text_length={text_length}, target_length={target_length}, min_tokens={min_tokens}, max_tokens={max_tokens}")
    
    return min_tokens, max_tokens, target_length

def run_summarization(text: str, model_key: str, max_length: int, min_length: int, detail_level: str):
    """Run summarization in thread with enhanced processing for long texts"""
    try:
        summarizer = summarizers[model_key]
        text_length = len(text)
        
        if min_length >= max_length:
            min_length = max(1, max_length - 50)  
        
        logger.info(f"Summarization params: min_length={min_length}, max_length={max_length}, text_length={text_length}")
        
        if text_length > 8000: 
            chunk_count = min(30, max(15, text_length // 2500))  
            chunks = intelligent_chunk_text(text, target_chunks=chunk_count)
            
            if len(chunks) < 3 and text_length > 20000:
                logger.warning(f"Only got {len(chunks)} chunks for {text_length} chars, forcing split...")
               
                chunk_size = text_length // max(10, chunk_count // 2)
                chunks = [text[i:i+chunk_size] for i in range(0, len(text), chunk_size)]
                logger.info(f"Force-split into {len(chunks)} chunks")
            
            chunk_summaries = []
            logger.info(f"Processing {len(chunks)} chunks for detailed summarization")
            
            for i, chunk in enumerate(chunks):
                if len(chunk) > 100: 
                    try:
                        chunk_target = max(150, min(400, len(chunk) // 3))  
                        chunk_max_length = min(200, chunk_target // 4)  
                        chunk_min_length = max(20, chunk_max_length // 3)
                        
                        result = summarizer(
                            chunk,
                            max_length=chunk_max_length,
                            min_length=chunk_min_length,
                            do_sample=False,
                            truncation=True,
                            early_stopping=True
                        )
                        
                        chunk_summary = result[0]['summary_text'].strip()
                        if chunk_summary:
                            chunk_summaries.append(chunk_summary)
                        
                        logger.info(f"Processed chunk {i+1}/{len(chunks)} -> {len(chunk_summary)} chars")
                    except Exception as e:
                        logger.warning(f"Error processing chunk {i+1}: {e}")
                        continue
            
            if chunk_summaries:
                combined_summary = " ".join(chunk_summaries)
                logger.info(f"Combined summary length: {len(combined_summary)} characters")
                
                if len(combined_summary) > 8000 and detail_level != "high":
                    try:
                        final_target = max(5000, len(combined_summary) // 2)  
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
                        return combined_summary
                else:
                    return combined_summary
            else:
                truncated_text = text[:3000] 
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
            input_length = len(text.split())  
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

        cleaned_text = clean_text(request.text)
        text_length = len(cleaned_text)

        min_tokens, max_tokens, target_length = calculate_summary_params(
            text_length, request.detail_level, request.format
        )
        
        if request.max_length:
            max_tokens = min(request.max_length // 3, 1024)  
        if request.min_length:
            min_tokens = max(request.min_length // 6, 20)
        
        if min_tokens >= max_tokens:
            max_tokens = min_tokens + 50
        
        if text_length > 30000:  
            model_key = "long_text"
        elif request.format == "tldr":
            model_key = "bart"
        elif request.format == "simplified":
            model_key = "t5"
        else:  
            model_key = "bart"
        
        logger.info(f"Processing text of {text_length} chars, target summary: {target_length} chars")
        
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
        
        if request.format == "bullet_points":
            cleaned_summary = summary.strip()
            
            sentences = [s.strip() for s in cleaned_summary.split('.') if s.strip() and len(s.strip()) > 15]
            
            if len(sentences) < 3:
                import re
                parts = re.split(r'[;]\s*|[,]\s*(?:and|but|however|while|whereas|although|furthermore|moreover|additionally)\s+', cleaned_summary)
                sentences = [s.strip() for s in parts if s.strip() and len(s.strip()) > 20]
            
            max_bullets = min(15, max(5, len(sentences)))  
            bullet_points = []
            
            for sentence in sentences[:max_bullets]:
                sentence = sentence.strip()
                if sentence:
                    if not sentence[-1] in '.!?':
                        sentence += '.'
                    bullet_points.append(f"• {sentence}")
            
            formatted_summary = "\n".join(bullet_points)
            
        elif request.format == "tldr":
            formatted_summary = f"TL;DR: {summary.strip()}"
        else:  
            formatted_summary = summary.strip()
        
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