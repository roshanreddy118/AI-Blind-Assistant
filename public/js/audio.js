/**
 * Audio Engine — TTS, speech recognition, audio playback.
 * Core module for blind user interaction.
 */

class AudioEngine {
    constructor() {
        // TTS
        this.synth = window.speechSynthesis || null;
        this.voice = null;
        this.rate = 1.0;
        this.volume = 1.0;
        this.language = 'en';
        this.isSpeaking = false;
        this.queue = [];

        // STT
        this.recognition = null;
        this.isListening = false;
        this.onSpeechResult = null;

        // Continuous voice command mode
        this._continuousMode = false;
        this._onVoiceCommand = null;
        this._restartTimer = null;
        this._gestureReceived = false;

        // Audio playback (for server-generated audio)
        this.audioContext = null;
        this._currentAudio = null;

        // Haptic
        this.hapticEnabled = true;

        // Speak counter for stale callback detection
        this._speakCounter = 0;

        this._initVoices();
        this._initRecognition();
    }

    // ---- Text-to-Speech ----

    _initVoices() {
        if (!this.synth) return;

        const load = () => {
            const voices = this.synth.getVoices();
            // Prefer Indian English
            this.voice = voices.find(v => v.lang === 'en-IN') ||
                         voices.find(v => v.lang.startsWith('en')) ||
                         voices[0];
        };

        load();
        if (this.synth.onvoiceschanged !== undefined) {
            this.synth.onvoiceschanged = load;
        }
    }

    /**
     * Speak text. For non-English, uses server gTTS audio if provided.
     * For English, uses Web Speech API.
     * Strictly one voice at a time — kills everything before starting.
     */
    speak(text, serverAudio = '') {
        // Kill absolutely everything first
        this._stopAll();
        // Pause recognition while speaking
        this._pauseRecognition();

        // For non-English languages, prefer server gTTS audio (has real Kannada/Telugu/Hindi voices)
        if (serverAudio && this.language !== 'en') {
            this._playBase64Audio(serverAudio);
            return;
        }

        if (!this.synth || !text) return;

        // Unique ID to detect stale callbacks
        const speakId = ++this._speakCounter;

        const utterance = new SpeechSynthesisUtterance(text);
        const langCode = this._getLangCode();
        utterance.lang = langCode;
        utterance.rate = this.rate;
        utterance.volume = this.volume;

        // Try to find a voice matching the language
        const voices = this.synth.getVoices();
        const matchVoice = voices.find(v => v.lang === langCode) ||
                           voices.find(v => v.lang.startsWith(this.language)) ||
                           this.voice;
        if (matchVoice) utterance.voice = matchVoice;

        utterance.onstart = () => {
            if (speakId !== this._speakCounter) return;
            this.isSpeaking = true;
        };
        utterance.onend = () => {
            if (speakId !== this._speakCounter) return;
            this.isSpeaking = false;
            this._resumeRecognition();
        };
        utterance.onerror = () => {
            if (speakId !== this._speakCounter) return;
            this.isSpeaking = false;
            this._resumeRecognition();
        };

        this.synth.speak(utterance);
    }

    /**
     * Speak immediately, interrupting anything playing.
     */
    speakUrgent(text) {
        this.stop();
        this.speak(text);
    }

    stop() {
        this._stopAll();
    }

    _stopAll() {
        // Increment counter to invalidate any in-flight speech callbacks
        this._speakCounter++;
        // Stop Web Speech API
        if (this.synth) {
            this.synth.cancel();
        }
        // Stop any playing HTML5 audio
        if (this._currentAudio) {
            this._currentAudio.pause();
            this._currentAudio.src = '';
            this._currentAudio = null;
        }
        this.queue = [];
        this.isSpeaking = false;
    }

    _playBase64Audio(base64Data) {
        try {
            const audio = new Audio(`data:audio/mp3;base64,${base64Data}`);
            this._currentAudio = audio;
            audio.volume = this.volume;
            audio.playbackRate = this.rate;
            audio.onplay = () => { this.isSpeaking = true; };
            audio.onended = () => { this.isSpeaking = false; this._currentAudio = null; this._resumeRecognition(); };
            audio.onerror = () => { this.isSpeaking = false; this._currentAudio = null; this._resumeRecognition(); };
            audio.play().catch(() => {
                this.isSpeaking = false;
                this._currentAudio = null;
                this._resumeRecognition();
            });
        } catch {
            this.isSpeaking = false;
            this._resumeRecognition();
        }
    }

    setLanguage(lang) {
        this.language = lang;
        // Update voice to match language
        if (!this.synth) return;
        const voices = this.synth.getVoices();
        const langCode = this._getLangCode();
        this.voice = voices.find(v => v.lang === langCode) ||
                     voices.find(v => v.lang.startsWith(lang)) ||
                     this.voice;
    }

    _getLangCode() {
        const map = {
            en: 'en-IN', hi: 'hi-IN', ta: 'ta-IN', te: 'te-IN',
            kn: 'kn-IN', ml: 'ml-IN', bn: 'bn-IN', mr: 'mr-IN',
            gu: 'gu-IN', pa: 'pa-IN', ur: 'ur-IN',
            es: 'es-ES', fr: 'fr-FR', ar: 'ar-SA',
        };
        return map[this.language] || 'en-IN';
    }

    // ---- Speech Recognition ----

    _initRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) return;

        this.recognition = new SpeechRecognition();
        this.recognition.continuous = false;
        this.recognition.interimResults = false;
        this.recognition.lang = 'en-US'; // Always English for voice commands
        this.recognition.maxAlternatives = 1;

        this.recognition.onresult = (e) => {
            const transcript = e.results[0][0].transcript;
            // One-shot callback (Ask question modal)
            if (this.onSpeechResult) {
                this.onSpeechResult(transcript);
                this.onSpeechResult = null;
            }
            // Continuous voice command callback
            if (this._continuousMode && this._onVoiceCommand) {
                this._onVoiceCommand(transcript);
            }
            this.isListening = false;
        };

        this.recognition.onerror = (e) => {
            this.isListening = false;
            // Restart continuous listening on non-fatal errors
            if (this._continuousMode && e.error !== 'not-allowed' && e.error !== 'service-not-allowed') {
                this._restartTimer = setTimeout(() => this._startContinuous(), 1000);
            }
        };

        this.recognition.onend = () => {
            this.isListening = false;
            // Auto-restart for continuous mode
            if (this._continuousMode) {
                this._restartTimer = setTimeout(() => this._startContinuous(), 300);
            }
        };
    }

    listen() {
        if (!this.recognition) return false;
        // Pause continuous mode so one-shot takes priority
        const wasContinuous = this._continuousMode;
        if (wasContinuous) {
            this._pauseRecognition();
        }
        try {
            this.recognition.lang = this._getLangCode();
            this.recognition.start();
            this.isListening = true;
            return true;
        } catch {
            if (wasContinuous) this._resumeRecognition();
            return false;
        }
    }

    stopListening() {
        if (this.recognition && this.isListening) {
            this.recognition.stop();
            this.isListening = false;
        }
    }

    // ---- Continuous Voice Commands ----

    startContinuousListening(callback) {
        if (!this.recognition) {
            // iOS Safari has no SpeechRecognition — log and fail gracefully
            console.log('Voice commands: SpeechRecognition not supported on this browser');
            return false;
        }
        this._continuousMode = true;
        this._onVoiceCommand = callback;

        // SpeechRecognition.start() requires a user gesture in most browsers.
        // If we haven't had one yet, defer until the first tap/click.
        if (!this._gestureReceived) {
            const activate = () => {
                this._gestureReceived = true;
                document.removeEventListener('click', activate, true);
                document.removeEventListener('touchstart', activate, true);
                document.removeEventListener('touchend', activate, true);
                console.log('Voice commands: gesture received, activating mic');
                // Small delay to let the tap's own action complete first
                setTimeout(() => {
                    this._startContinuous();
                    // Announce voice is ready (after current speech finishes)
                    setTimeout(() => {
                        if (!this.isSpeaking) {
                            this.speak('Voice commands ready. Say Assistant followed by a command. For example, Assistant start, Assistant stop, or Assistant Telugu.');
                        }
                    }, 500);
                }, 300);
            };
            document.addEventListener('click', activate, true);
            document.addEventListener('touchstart', activate, true);
            document.addEventListener('touchend', activate, true);
            console.log('Voice commands: waiting for first tap to enable mic');
            return true;
        }

        this._startContinuous();
        return true;
    }

    stopContinuousListening() {
        this._continuousMode = false;
        this._onVoiceCommand = null;
        clearTimeout(this._restartTimer);
        this._restartTimer = null;
        if (this.recognition && this.isListening) {
            try { this.recognition.stop(); } catch {}
            this.isListening = false;
        }
    }

    _pauseRecognition() {
        if (this.recognition && this.isListening) {
            try { this.recognition.stop(); } catch {}
            this.isListening = false;
        }
        clearTimeout(this._restartTimer);
    }

    _resumeRecognition() {
        if (this._continuousMode) {
            // Small delay to let audio hardware release the mic
            this._restartTimer = setTimeout(() => this._startContinuous(), 400);
        }
    }

    _startContinuous() {
        if (!this._continuousMode || !this.recognition) return;
        // Don't listen while speaking — wait and retry
        if (this.isSpeaking) {
            this._restartTimer = setTimeout(() => this._startContinuous(), 500);
            return;
        }
        // Don't start if already running
        if (this.isListening) return;
        try {
            // Voice commands always in English regardless of TTS language
            this.recognition.lang = 'en-US';
            this.recognition.start();
            this.isListening = true;
        } catch (e) {
            // Already running or error — retry soon
            console.log('Recognition start error:', e.message);
            this._restartTimer = setTimeout(() => this._startContinuous(), 1000);
        }
    }

    // ---- Alert Sound ----

    playAlertTone(urgency = 'high') {
        try {
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }

            const osc = this.audioContext.createOscillator();
            const gain = this.audioContext.createGain();
            osc.connect(gain);
            gain.connect(this.audioContext.destination);

            if (urgency === 'high') {
                // Urgent double beep
                osc.frequency.value = 880;
                osc.type = 'square';
                gain.gain.value = 0.15;
                gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.4);
                osc.start();
                osc.stop(this.audioContext.currentTime + 0.4);
            } else {
                // Soft single tone
                osc.frequency.value = 440;
                osc.type = 'sine';
                gain.gain.value = 0.08;
                gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.2);
                osc.start();
                osc.stop(this.audioContext.currentTime + 0.2);
            }
        } catch {
            // Audio context not available
        }
    }

    // ---- Haptic ----

    vibrate(pattern = 'short') {
        if (!this.hapticEnabled || !navigator.vibrate) return;

        switch (pattern) {
            case 'short': navigator.vibrate(50); break;
            case 'medium': navigator.vibrate(150); break;
            case 'long': navigator.vibrate(300); break;
            case 'alert': navigator.vibrate([100, 50, 100, 50, 200]); break;
            case 'danger': navigator.vibrate([200, 100, 200, 100, 400]); break;
        }
    }

    // ---- Screen Reader ----

    announce(text, priority = 'assertive') {
        const id = priority === 'assertive' ? 'sr-alert' : 'sr-status';
        const el = document.getElementById(id);
        if (el) {
            el.textContent = '';
            requestAnimationFrame(() => { el.textContent = text; });
        }
    }
}
