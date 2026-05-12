"""
Text-to-Speech Service — Multilingual voice output.
Uses gTTS (Google Text-to-Speech) for high-quality multilingual audio.
Falls back to Web Speech API on the client side.
"""

import base64
import io
import logging

logger = logging.getLogger(__name__)

SUPPORTED_LANGUAGES = {
    "en": {"name": "English", "code": "en", "tld": "co.in"},
    "hi": {"name": "Hindi", "code": "hi", "tld": "co.in"},
    "ta": {"name": "Tamil", "code": "ta", "tld": "co.in"},
    "te": {"name": "Telugu", "code": "te", "tld": "co.in"},
    "kn": {"name": "Kannada", "code": "kn", "tld": "co.in"},
    "ml": {"name": "Malayalam", "code": "ml", "tld": "co.in"},
    "bn": {"name": "Bengali", "code": "bn", "tld": "co.in"},
    "mr": {"name": "Marathi", "code": "mr", "tld": "co.in"},
    "gu": {"name": "Gujarati", "code": "gu", "tld": "co.in"},
    "pa": {"name": "Punjabi", "code": "pa", "tld": "co.in"},
    "ur": {"name": "Urdu", "code": "ur", "tld": "co.in"},
    "es": {"name": "Spanish", "code": "es", "tld": "com"},
    "fr": {"name": "French", "code": "fr", "tld": "com"},
    "ar": {"name": "Arabic", "code": "ar", "tld": "com"},
    "zh": {"name": "Chinese", "code": "zh-CN", "tld": "com"},
    "ja": {"name": "Japanese", "code": "ja", "tld": "co.jp"},
}


class TTSService:
    """Multilingual text-to-speech with gTTS."""

    def __init__(self):
        self.gtts_available = False
        try:
            from gtts import gTTS
            self.gtts_available = True
            logger.info("gTTS initialized — multilingual TTS ready")
        except ImportError:
            logger.warning("gTTS not installed — client-side TTS will be used")

    def synthesize(self, text: str, language: str = "en") -> str:
        """
        Convert text to speech audio, return base64-encoded MP3.
        Falls back to empty string (client uses Web Speech API).
        """
        if not text or not self.gtts_available:
            return ""

        lang_config = SUPPORTED_LANGUAGES.get(language, SUPPORTED_LANGUAGES["en"])

        try:
            from gtts import gTTS

            tts = gTTS(
                text=text,
                lang=lang_config["code"],
                tld=lang_config["tld"],
                slow=False,
            )

            audio_buffer = io.BytesIO()
            tts.write_to_fp(audio_buffer)
            audio_buffer.seek(0)

            return base64.b64encode(audio_buffer.read()).decode("utf-8")

        except Exception as e:
            logger.error(f"TTS synthesis error: {e}")
            return ""

    def get_supported_languages(self) -> list:
        """Return list of supported languages."""
        return [
            {"code": code, "name": info["name"]}
            for code, info in SUPPORTED_LANGUAGES.items()
        ]
