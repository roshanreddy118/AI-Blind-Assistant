/**
 * Camera Module — handles camera access, frame capture, and switching.
 * Designed for mobile rear camera (default) for blind users.
 */

class CameraManager {
    constructor() {
        this.video = document.getElementById('camera');
        this.canvas = document.getElementById('capture-canvas');
        this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
        this.stream = null;
        this.isRunning = false;
        this.facingMode = 'environment'; // rear camera by default for blind users
    }

    async start() {
        try {
            const constraints = {
                video: {
                    facingMode: this.facingMode,
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    frameRate: { ideal: 15 }, // lower FPS saves battery
                },
                audio: false,
            };

            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.video.srcObject = this.stream;

            await new Promise(resolve => {
                this.video.onloadedmetadata = () => {
                    this.canvas.width = this.video.videoWidth;
                    this.canvas.height = this.video.videoHeight;
                    resolve();
                };
            });

            await this.video.play();
            this.isRunning = true;

            const status = document.getElementById('camera-status');
            if (status) {
                status.textContent = 'Camera active';
                status.classList.add('active');
            }

            return true;
        } catch (err) {
            console.error('Camera error:', err);
            if (err.name === 'NotAllowedError') {
                throw new Error('Camera permission denied. Please allow camera access in your browser settings.');
            }
            if (err.name === 'NotFoundError') {
                throw new Error('No camera found on this device.');
            }
            throw err;
        }
    }

    stop() {
        this.isRunning = false;
        if (this.stream) {
            this.stream.getTracks().forEach(t => t.stop());
            this.stream = null;
        }
        if (this.video) this.video.srcObject = null;

        const status = document.getElementById('camera-status');
        if (status) {
            status.textContent = 'Camera off';
            status.classList.remove('active');
        }
    }

    /**
     * Capture current frame as JPEG blob.
     */
    captureBlob() {
        if (!this.isRunning || !this.video || this.video.readyState < 2) return null;

        this.ctx.drawImage(this.video, 0, 0);

        return new Promise(resolve => {
            this.canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.7);
        });
    }

    /**
     * Capture current frame as base64 data URL.
     */
    captureBase64() {
        if (!this.isRunning || !this.video || this.video.readyState < 2) return null;

        this.ctx.drawImage(this.video, 0, 0);
        return this.canvas.toDataURL('image/jpeg', 0.7);
    }

    switchCamera() {
        this.facingMode = this.facingMode === 'environment' ? 'user' : 'environment';
        if (this.isRunning) {
            this.stop();
            return this.start();
        }
    }
}
