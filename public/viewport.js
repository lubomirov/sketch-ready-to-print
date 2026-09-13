export class CanvasViewport {
    constructor(container, imageCanvas, overlayCanvas, cursorCanvas) {
        this.container = container;
        this.imageCanvas = imageCanvas;
        this.overlayCanvas = overlayCanvas;
        this.cursorCanvas = cursorCanvas;
        this.mode = 'fit';
        this.scale = 1;
        this.offsetX = 0;
        this.offsetY = 0;
        this.imageWidth = 0;
        this.imageHeight = 0;
        this.panState = null;
        this.resizeObserver = new ResizeObserver(() => {
            if (this.mode === 'fit' && this.imageWidth && this.imageHeight) {
                this.setZoomMode('fit');
            }
        });
        this.resizeObserver.observe(container);
    }

    setImageMat(mat) {
        this.imageWidth = mat.cols;
        this.imageHeight = mat.rows;
        [this.imageCanvas, this.overlayCanvas, this.cursorCanvas].forEach((canvas) => {
            canvas.width = mat.cols;
            canvas.height = mat.rows;
        });
        this.renderImage(mat);
        this.clearOverlay();
        this.clearCursor();
        this.setZoomMode(this.mode);
        requestAnimationFrame(() => {
            if (this.mode === 'fit') this.setZoomMode('fit');
        });
    }

    setZoomMode(mode) {
        this.mode = mode === 'actual' ? 'actual' : 'fit';
        this.scale = this.mode === 'actual' ? 1 : this.getFitScale();
        this.centerImage();
        this.applyTransform();
    }

    getFitScale() {
        if (!this.imageWidth || !this.imageHeight) return 1;
        const availableWidth = Math.max(1, this.container.clientWidth);
        const availableHeight = Math.max(1, this.container.clientHeight);
        return Math.min(1, availableWidth / this.imageWidth, availableHeight / this.imageHeight);
    }

    centerImage() {
        const displayWidth = this.imageWidth * this.scale;
        const displayHeight = this.imageHeight * this.scale;
        this.offsetX = Math.max(0, (this.container.clientWidth - displayWidth) / 2);
        this.offsetY = Math.max(0, (this.container.clientHeight - displayHeight) / 2);
    }

    applyTransform() {
        const width = `${this.imageWidth * this.scale}px`;
        const height = `${this.imageHeight * this.scale}px`;
        [this.imageCanvas, this.overlayCanvas, this.cursorCanvas].forEach((canvas) => {
            canvas.style.width = width;
            canvas.style.height = height;
            canvas.style.left = `${this.offsetX}px`;
            canvas.style.top = `${this.offsetY}px`;
        });
    }

    renderImage(mat) {
        cv.imshow(this.imageCanvas.id, mat);
        this.clearOverlay();
        this.clearCursor();
    }

    getOverlayContext() {
        return this.overlayCanvas.getContext('2d');
    }

    imagePointFromEvent(event) {
        const rect = this.container.getBoundingClientRect();
        return {
            x: (event.clientX - rect.left - this.offsetX) / this.scale,
            y: (event.clientY - rect.top - this.offsetY) / this.scale
        };
    }

    isInsideImage(point) {
        return point.x >= 0 && point.x < this.imageWidth &&
            point.y >= 0 && point.y < this.imageHeight;
    }

    panBy(deltaX, deltaY) {
        this.offsetX += deltaX;
        this.offsetY += deltaY;
        this.applyTransform();
    }

    clearOverlay() {
        const context = this.overlayCanvas.getContext('2d');
        context.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
    }

    clearCursor() {
        const context = this.cursorCanvas.getContext('2d');
        context.clearRect(0, 0, this.cursorCanvas.width, this.cursorCanvas.height);
    }

    renderCursorCircle(point, radius, color = '#2f76d2') {
        const context = this.cursorCanvas.getContext('2d');
        context.clearRect(0, 0, this.cursorCanvas.width, this.cursorCanvas.height);
        if (!this.isInsideImage(point)) return;
        context.save();
        context.strokeStyle = color;
        context.lineWidth = Math.max(1, this.imageWidth / 1000);
        context.beginPath();
        context.arc(point.x, point.y, radius, 0, 2 * Math.PI);
        context.stroke();
        context.restore();
    }

    bindPointerHandlers({ onDown, onMove, onUp, onCancel }) {
        this.container.addEventListener('pointerdown', (event) => {
            if (event.button === 1 || event.altKey) return;
            this.container.setPointerCapture(event.pointerId);
            onDown(event);
        });
        this.container.addEventListener('pointermove', (event) => {
            if (this.panState) return;
            onMove(event);
        });
        this.container.addEventListener('pointerleave', () => this.clearCursor());
        this.container.addEventListener('pointerup', onUp);
        this.container.addEventListener('pointercancel', onCancel);
    }

    attachPan() {
        const setPanReady = (ready) => {
            this.container.classList.toggle('pan-ready', ready);
        };

        window.addEventListener('keydown', (event) => {
            if (event.key === 'Alt') setPanReady(true);
        });
        window.addEventListener('keyup', (event) => {
            if (event.key === 'Alt' && !this.panState) setPanReady(false);
        });
        window.addEventListener('blur', () => {
            if (!this.panState) setPanReady(false);
        });

        this.container.addEventListener('pointerdown', (event) => {
            if (event.button !== 1 && !event.altKey) return;
            this.panState = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
            this.container.classList.remove('pan-ready');
            this.container.classList.add('pan-active');
            this.container.setPointerCapture(event.pointerId);
        });
        this.container.addEventListener('pointermove', (event) => {
            if (!this.panState) return;
            this.panBy(event.clientX - this.panState.x, event.clientY - this.panState.y);
            this.panState.x = event.clientX;
            this.panState.y = event.clientY;
        });
        this.container.addEventListener('pointerup', (event) => {
            this.panState = null;
            this.container.classList.remove('pan-active');
            setPanReady(event.altKey);
        });
        this.container.addEventListener('pointercancel', () => {
            this.panState = null;
            this.container.classList.remove('pan-active');
            setPanReady(false);
        });
    }
}
