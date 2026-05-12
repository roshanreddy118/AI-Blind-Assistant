"""
AI Blind Assistant - Backend Server
FastAPI server with real-time AI scene analysis, obstacle detection, and multilingual TTS.
"""

import asyncio
import base64
import io
import json
import logging
import os
import time
from pathlib import Path

import numpy as np
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

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

# Mount frontend
frontend_path = Path(__file__).parent.parent / "frontend"
if frontend_path.exists():
    app.mount("/static", StaticFiles(directory=str(frontend_path)), name="static")

# Initialize services
vision_ai = VisionAI()
obstacle_detector = ObstacleDetector()
tts_service = TTSService()


@app.get("/")
async def root():
    return {"status": "running", "service": "AI Blind Assistant"}


@app.get("/api/health")
async def health():
    return {
        "status": "healthy",
        "ai_provider": vision_ai.provider,
        "ai_ready": vision_ai.is_ready(),
        "languages": tts_service.get_supported_languages(),
    }


@app.post("/api/analyze")
async def analyze_scene(file: UploadFile = File(...), language: str = "en"):
    """Analyze a single camera frame — returns AI scene description + danger detection."""
    contents = await file.read()

    if not contents:
        raise HTTPException(status_code=400, detail="Empty image")

    # AI does everything — scene description + obstacle/danger detection
    scene_description = await vision_ai.describe_scene(contents, language)

    # Build narration (AI already includes dangers)
    narration = scene_description

    # Generate TTS audio for the narration
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
    """Detect obstacles/objects in frame."""
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Empty image")

    obstacles = await asyncio.to_thread(obstacle_detector.detect, contents)
    return {"obstacles": obstacles}


@app.post("/api/tts")
async def text_to_speech(data: dict):
    """Convert text to speech audio in specified language."""
    text = data.get("text", "")
    language = data.get("language", "en")

    if not text:
        raise HTTPException(status_code=400, detail="No text provided")

    audio_base64 = await asyncio.to_thread(tts_service.synthesize, text, language)
    return {"audio": audio_base64, "language": language}


@app.get("/api/languages")
async def list_languages():
    """List all supported TTS languages."""
    return {"languages": tts_service.get_supported_languages()}


@app.post("/api/read-text")
async def read_text(file: UploadFile = File(...), language: str = "en"):
    """OCR: Extract and read text from image (signs, labels, documents)."""
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
    """Ask a specific question about what the camera sees."""
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Empty image")

    answer = await vision_ai.answer_question(contents, question, language)
    return {"question": question, "answer": answer}


# ---- WebSocket for continuous live mode ----

@app.websocket("/ws/live")
async def websocket_live(websocket: WebSocket):
    """Real-time continuous scene analysis via WebSocket."""
    await websocket.accept()
    logger.info("Live assistant WebSocket connected")

    last_analysis_time = 0
    analysis_interval = float(os.getenv("SCENE_INTERVAL_MS", "3000")) / 1000
    last_narration = ""

    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)

            if msg.get("type") == "frame":
                now = time.time()

                # Throttle analysis to avoid overwhelming the AI API
                if now - last_analysis_time < analysis_interval:
                    continue

                last_analysis_time = now
                frame_data = msg["data"]
                language = msg.get("language", "en")

                # Decode frame
                if "," in frame_data:
                    frame_data = frame_data.split(",")[1]
                img_bytes = base64.b64decode(frame_data)

                # Run obstacle detection (fast, every frame)
                obstacles = await asyncio.to_thread(
                    obstacle_detector.detect, img_bytes
                )

                # Send obstacle alerts immediately
                urgent = [o for o in obstacles if o.get("urgency") == "high"]
                if urgent:
                    alert = _build_obstacle_alert(urgent)
                    await websocket.send_json({
                        "type": "obstacle_alert",
                        "alert": alert,
                        "obstacles": urgent,
                    })

                # Run AI scene description
                try:
                    scene = await vision_ai.describe_scene(img_bytes)
                    narration = _build_narration(scene, obstacles)

                    # Only send if narration changed meaningfully
                    if narration != last_narration:
                        last_narration = narration
                        audio = await asyncio.to_thread(
                            tts_service.synthesize, narration, language
                        )
                        await websocket.send_json({
                            "type": "scene_update",
                            "scene": scene,
                            "obstacles": obstacles,
                            "narration": narration,
                            "audio": audio,
                        })
                except Exception as e:
                    logger.error(f"Scene analysis error: {e}")
                    await websocket.send_json({
                        "type": "error",
                        "message": str(e),
                    })

            elif msg.get("type") == "set_interval":
                analysis_interval = max(1, msg.get("interval", 3000)) / 1000

            elif msg.get("type") == "set_language":
                # Language change handled per-frame

                pass

    except WebSocketDisconnect:
        logger.info("Live assistant WebSocket disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")


def _build_narration(scene: str, obstacles: list) -> str:
    """Build a concise spoken narration from scene + obstacles."""
    parts = []

    if obstacles:
        urgent = [o for o in obstacles if o.get("urgency") == "high"]
        if urgent:
            names = ", ".join(o["label"] for o in urgent[:3])
            parts.append(f"Warning! {names} nearby.")

    if scene:
        parts.append(scene)

    if obstacles:
        non_urgent = [o for o in obstacles if o.get("urgency") != "high"]
        if non_urgent:
            names = ", ".join(o["label"] for o in non_urgent[:5])
            parts.append(f"I also see: {names}.")

    return " ".join(parts) if parts else "I'm looking around, but can't identify anything clearly."


def _build_obstacle_alert(obstacles: list) -> str:
    """Build urgent obstacle alert text."""
    if len(obstacles) == 1:
        o = obstacles[0]
        return f"Careful! {o['label']} {o.get('position', 'ahead')}!"
    names = " and ".join(o["label"] for o in obstacles[:3])
    return f"Watch out! {names} nearby!"


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("APP_PORT", "8000"))
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=True)
