from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from model_utils import generate_summary
from pydantic import BaseModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict to your extension domain in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SummarizeRequest(BaseModel):
    text: str
    summary_type: str = "bullet"

@app.post("/summarize")
async def summarize(request: SummarizeRequest):
    summary = generate_summary(request.text, request.summary_type)
    return {"summary": summary}
