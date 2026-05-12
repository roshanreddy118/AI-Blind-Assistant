"""
Vision AI Service — Scene understanding with multi-provider fallback.
Supports: Google Gemini, OpenRouter, Groq, OpenAI.
If primary fails, falls back to the next available provider.
"""

import base64
import logging
import os

logger = logging.getLogger(__name__)


class VisionAI:
    """Handles AI-powered scene description with automatic fallback."""

    def __init__(self):
        self.providers = []  # ordered list of (name, analyze_fn)
        self.gemini_model = None

        # Initialize ALL available providers in priority order
        gemini_key = os.getenv("GEMINI_API_KEY", "")
        openrouter_key = os.getenv("OPENROUTER_API_KEY", "")
        groq_key = os.getenv("GROQ_API_KEY", "")
        openai_key = os.getenv("OPENAI_API_KEY", "")

        if gemini_key and gemini_key != "your_gemini_api_key_here":
            self._init_gemini(gemini_key)

        if openrouter_key:
            self._init_openrouter(openrouter_key)

        if groq_key:
            self._init_groq(groq_key)

        if openai_key and openai_key != "your_openai_api_key_here":
            self._init_openai(openai_key)

        if not self.providers:
            logger.warning(
                "No AI API key configured! Set GEMINI_API_KEY, OPENROUTER_API_KEY, GROQ_API_KEY, or OPENAI_API_KEY in .env"
            )
        else:
            names = [p[0] for p in self.providers]
            logger.info(f"AI providers ready (fallback order): {' → '.join(names)}")

    def _init_gemini(self, api_key: str):
        try:
            import google.generativeai as genai

            genai.configure(api_key=api_key)
            self.gemini_model = genai.GenerativeModel("gemini-2.0-flash")
            self.providers.append(("gemini", self._gemini_analyze))
            logger.info("✓ Gemini initialized")
        except Exception as e:
            logger.error(f"Gemini init failed: {e}")

    def _init_openrouter(self, api_key: str):
        try:
            from openai import OpenAI

            client = OpenAI(
                api_key=api_key,
                base_url="https://openrouter.ai/api/v1",
            )
            self.providers.append(("openrouter", lambda img, prompt: self._openai_analyze(img, prompt, client, "google/gemini-2.5-flash")))
            logger.info("✓ OpenRouter initialized (google/gemini-2.5-flash)")
        except Exception as e:
            logger.error(f"OpenRouter init failed: {e}")

    def _init_groq(self, api_key: str):
        try:
            from openai import OpenAI

            client = OpenAI(
                api_key=api_key,
                base_url="https://api.groq.com/openai/v1",
            )
            self.providers.append(("groq", lambda img, prompt: self._openai_analyze(img, prompt, client, "meta-llama/llama-4-scout-17b-16e-instruct")))
            logger.info("✓ Groq initialized (llama-4-scout-17b-16e-instruct)")
        except Exception as e:
            logger.error(f"Groq init failed: {e}")

    def _init_openai(self, api_key: str):
        try:
            from openai import OpenAI

            client = OpenAI(api_key=api_key)
            self.providers.append(("openai", lambda img, prompt: self._openai_analyze(img, prompt, client, "gpt-4o-mini")))
            logger.info("✓ OpenAI initialized (gpt-4o-mini)")
        except Exception as e:
            logger.error(f"OpenAI init failed: {e}")

    def is_ready(self) -> bool:
        return len(self.providers) > 0

    LANG_NAMES = {
        'en': 'English', 'hi': 'Hindi', 'ta': 'Tamil', 'te': 'Telugu',
        'kn': 'Kannada', 'ml': 'Malayalam', 'bn': 'Bengali', 'mr': 'Marathi',
        'gu': 'Gujarati', 'pa': 'Punjabi', 'ur': 'Urdu',
        'es': 'Spanish', 'fr': 'French', 'ar': 'Arabic',
    }

    async def describe_scene(self, image_bytes: bytes, language: str = 'en') -> str:
        """Describe what's visible in the image for a blind person."""
        lang_name = self.LANG_NAMES.get(language, 'English')
        lang_instruction = f'Respond ENTIRELY in {lang_name}.' if language != 'en' else ''
        prompt = (
            "You are an AI assistant helping a blind person navigate the real world. "
            "Describe what you see in this camera image in 1-2 short sentences. "
            "Focus on: people, obstacles, objects, text/signs, and spatial layout. "
            "Be concise and practical — this will be read aloud. "
            "If there are dangers (stairs, traffic, edges), mention them FIRST. "
            f"{lang_instruction}"
        )
        return await self._analyze(image_bytes, prompt)

    async def read_text(self, image_bytes: bytes, language: str = 'en') -> str:
        """Extract and read any visible text (signs, labels, documents)."""
        lang_name = self.LANG_NAMES.get(language, 'English')
        lang_instruction = f'Respond ENTIRELY in {lang_name}.' if language != 'en' else ''
        prompt = (
            "You are helping a blind person read text. "
            "Extract ALL visible text from this image — signs, labels, screens, documents, etc. "
            "Return the text exactly as written. If no text is visible, say 'No text visible.' "
            f"{lang_instruction}"
        )
        return await self._analyze(image_bytes, prompt)

    async def answer_question(self, image_bytes: bytes, question: str, language: str = 'en') -> str:
        """Answer a specific question about what's in the image."""
        lang_name = self.LANG_NAMES.get(language, 'English')
        lang_instruction = f'Respond ENTIRELY in {lang_name}.' if language != 'en' else ''
        prompt = (
            f"You are an AI assistant helping a blind person. "
            f"They are asking about what their phone camera sees. "
            f"Their question: '{question}'. "
            f"Answer in 1-2 short sentences, spoken aloud to them. "
            f"{lang_instruction}"
        )
        return await self._analyze(image_bytes, prompt)

    async def _analyze(self, image_bytes: bytes, prompt: str) -> str:
        """Try each provider in order until one succeeds."""
        if not self.providers:
            return "AI service not configured. Please add your API key to the .env file."

        last_error = None
        for name, analyze_fn in self.providers:
            try:
                result = await analyze_fn(image_bytes, prompt)
                if result and not result.startswith("Sorry"):
                    return result
            except Exception as e:
                logger.warning(f"{name} failed, trying next provider: {e}")
                last_error = e

        logger.error(f"All AI providers failed. Last error: {last_error}")
        return "Sorry, I couldn't analyze the image right now. All AI providers are unavailable."

    async def _gemini_analyze(self, image_bytes: bytes, prompt: str) -> str:
        import asyncio
        from PIL import Image
        import io

        try:
            image = Image.open(io.BytesIO(image_bytes))
            response = await asyncio.to_thread(
                self.gemini_model.generate_content, [prompt, image]
            )
            return response.text.strip()
        except Exception as e:
            logger.error(f"Gemini API error: {e}")
            raise

    async def _openai_analyze(self, image_bytes: bytes, prompt: str, client=None, model=None) -> str:
        import asyncio

        try:
            b64_image = base64.b64encode(image_bytes).decode("utf-8")
            response = await asyncio.to_thread(
                client.chat.completions.create,
                model=model,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/jpeg;base64,{b64_image}",
                                    "detail": "low",
                                },
                            },
                        ],
                    }
                ],
                max_tokens=200,
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            logger.error(f"API error ({model}): {e}")
            raise
