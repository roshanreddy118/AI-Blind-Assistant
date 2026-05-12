# 👁️‍🗨️ AI Blind Assistant

Real-time AI-powered assistant for blind and visually impaired users.  
Uses your phone camera + AI vision to narrate scenes, detect obstacles, read text, and answer questions — in 14+ languages.

---

## ✨ What It Does

| Feature | How It Works |
|---------|-------------|
| **Live Scene Narration** | Camera captures frames → Gemini/GPT-4 Vision AI describes what's visible → spoken aloud |
| **Obstacle Detection** | OpenCV analyzes frames locally for edges, large objects, stairs → instant audio + vibration alerts |
| **Text Reading (OCR)** | AI reads signs, labels, documents, screens visible to the camera |
| **Ask Questions** | "Is there a door nearby?" — voice or text, AI answers from camera view |
| **14+ Languages** | English, Hindi, Tamil, Telugu, Kannada, Malayalam, Bengali, Marathi, Gujarati, Punjabi, Urdu, Spanish, French, Arabic |
| **Voice-First Design** | Every interaction is spoken aloud — fully usable without seeing the screen |

---

## 📁 Project Structure

```
Sign_lang/
├── backend/
│   ├── app.py                          # FastAPI server + WebSocket
│   ├── requirements.txt                # Python dependencies
│   └── services/
│       ├── vision_ai.py                # Gemini / GPT-4 Vision integration
│       ├── obstacle_detector.py        # OpenCV obstacle detection (local)
│       └── tts_service.py              # gTTS multilingual speech
│
├── frontend/
│   ├── index.html                      # Mobile-first, voice-driven UI
│   ├── css/style.css                   # High-contrast dark theme
│   └── js/
│       ├── app.js                      # Main controller + scan loop
│       ├── camera.js                   # Camera capture (rear default)
│       └── audio.js                    # TTS, STT, alerts, haptics
│
├── .env.example                        # API key configuration template
└── README.md
```

---

## 🚀 Setup

### 1. Get a FREE Gemini API Key

Go to **https://aistudio.google.com/apikey** → Create a key → Copy it.

### 2. Configure

```bash
cd Sign_lang
cp .env.example .env
# Edit .env and paste your Gemini API key
```

### 3. Install & Run Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python3 app.py
# Server runs at http://localhost:8000
```

### 4. Open the App

Open **http://localhost:8000/static/index.html** on your phone or browser.

Or serve frontend separately:
```bash
cd frontend
python3 -m http.server 8080
# Open http://localhost:8080
```

---

## 📱 How to Use

1. **Tap the big blue button** to start
2. **Point your phone camera** at your surroundings
3. **AI narrates** what it sees every 3 seconds (configurable)
4. **Obstacle warnings** appear with audio beeps + vibration
5. Tap **"What's here?"** for an immediate scene description
6. Tap **"Read text"** to read signs, labels, or documents
7. Tap **"Ask AI"** to ask anything about the scene
8. Tap **"Repeat Last"** to hear the last narration again

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| `Space` | Start / Stop assistant |
| `Esc` | Close modals |

---

## 🔧 Tech Stack

| Component | Technology |
|-----------|-----------|
| **AI Vision** | Google Gemini 1.5 Flash (free) or OpenAI GPT-4o-mini |
| **Obstacle Detection** | OpenCV (local, no API needed) |
| **Text-to-Speech** | gTTS (server) + Web Speech API (client fallback) |
| **Speech-to-Text** | Web Speech Recognition API |
| **Backend** | FastAPI + WebSocket |
| **Frontend** | Vanilla JS, HTML5, CSS3 |
| **Haptics** | Vibration API |

---

## ♿ Accessibility

- **100% voice-driven** — every action speaks its result
- **52px minimum touch targets** — easy to tap without seeing
- **ARIA live regions** for screen readers
- **High-contrast black theme** for low vision
- **Haptic/vibration** alerts on obstacles
- **Audio tones** distinguish urgent vs. normal alerts
- **Rear camera default** — user holds phone pointing forward
- **Keyboard navigable** with visible focus rings

---

## 🌍 Supported Languages

English, Hindi, Tamil, Telugu, Kannada, Malayalam, Bengali, Marathi, Gujarati, Punjabi, Urdu, Spanish, French, Arabic, Chinese, Japanese

---

## 🏥 Use Cases

| Scenario | How It Helps |
|----------|-------------|
| **Walking outdoors** | Narrates streets, crossings, obstacles, traffic |
| **Hospitals** | Reads signs, room numbers, directions |
| **Shopping** | Identifies products, reads labels and prices |
| **Public transport** | Reads bus numbers, platform signs |
| **Documents** | Reads forms, prescriptions, letters |
| **Home** | Identifies objects, reads appliance displays |

---

## 📄 License

MIT — free for personal and commercial use.
