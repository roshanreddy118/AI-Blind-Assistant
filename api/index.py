"""
AI Blind Assistant — Vercel Serverless API
FastAPI server with AI scene analysis, obstacle detection, and multilingual TTS.
"""

import asyncio
import base64
import logging
import os
import sys

# Add parent dir so services can be imported
sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from services.vision_ai import VisionAI
from services.obstacle_detector import ObstacleDetector
from services.tts_service import TTSService

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="AI Blind Assistant", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize services
vision_ai = VisionAI()
obstacle_detector = ObstacleDetector()
tts_service = TTSService()


@app.get("/api/health")
async def health():
    return {
        "status": "healthy",
        "ai_providers": [p[0] for p in vision_ai.providers],
        "ai_ready": vision_ai.is_ready(),
        "languages": tts_service.get_supported_languages(),
    }


@app.post("/api/analyze")
async def analyze_scene(file: UploadFile = File(...), language: str = "en"):
    """Analyze a camera frame — AI scene description + danger detection."""
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Empty image")

    # AI does everything — scene description + obstacle/danger detection
    scene_description = await vision_ai.describe_scene(contents, language)
    narration = scene_description

    audio_base64 = await asyncio.to_thread(
        tts_service.synthesize, narration, language
    )

    return {
        "scene": scene_description,
        "obstacles": [],
        "narration": narration,
        "audio": audio_base64,
        "language": language,
    }


@app.post("/api/describe")
async def describe_only(file: UploadFile = File(...)):
    """Quick AI scene description without TTS."""
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Empty image")
    description = await vision_ai.describe_scene(contents)
    return {"scene": description}


@app.post("/api/obstacles")
async def detect_obstacles(file: UploadFile = File(...)):
    """Detect obstacles in frame."""
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Empty image")
    obstacles = await asyncio.to_thread(obstacle_detector.detect, contents)
    return {"obstacles": obstacles}


@app.post("/api/tts")
async def text_to_speech(data: dict):
    """Convert text to speech audio."""
    text = data.get("text", "")
    language = data.get("language", "en")
    if not text:
        raise HTTPException(status_code=400, detail="No text provided")
    audio_base64 = await asyncio.to_thread(tts_service.synthesize, text, language)
    return {"audio": audio_base64, "language": language}


@app.get("/api/languages")
async def list_languages():
    return {"languages": tts_service.get_supported_languages()}


@app.post("/api/read-text")
async def read_text(file: UploadFile = File(...), language: str = "en"):
    """OCR: Extract text from image via AI."""
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Empty image")
    extracted = await vision_ai.read_text(contents, language)
    audio_base64 = ""
    if extracted:
        audio_base64 = await asyncio.to_thread(
            tts_service.synthesize, extracted, language
        )
    return {"text": extracted, "audio": audio_base64, "language": language}


@app.post("/api/ask")
async def ask_about_scene(file: UploadFile = File(...), question: str = "What do you see?", language: str = "en"):
    """Ask a question about what the camera sees."""
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Empty image")
    answer = await vision_ai.answer_question(contents, question, language)
    return {"question": question, "answer": answer}
