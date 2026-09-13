// Рисование только поверхностных слоёв. Данные и события находятся вне этого модуля.

export function renderCornersOverlay(canvas, ctx, corners) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = Math.max(1, canvas.width / 1000);
    ctx.strokeStyle = '#00e676';
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let index = 1; index < 4; index++) ctx.lineTo(corners[index].x, corners[index].y);
    ctx.closePath();
    ctx.stroke();

    corners.forEach((point) => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, Math.max(10, canvas.width / 100), 0, 2 * Math.PI);
        ctx.stroke();
    });
}

export function renderCurvedEdgesOverlay(canvas, ctx, corners, edgePoints = []) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = Math.max(1, canvas.width / 500);
    ctx.strokeStyle = '#00e676';

    edgePoints.forEach((side, sideIndex) => {
        const start = corners[sideIndex];
        const end = corners[(sideIndex + 1) % corners.length];
        side.forEach((point) => {
            const dx = end.x - start.x;
            const dy = end.y - start.y;
            const denominator = dx * dx + dy * dy || 1;
            const rawT = ((point.x - start.x) * dx + (point.y - start.y) * dy) / denominator;
            const t = Math.max(0, Math.min(1, rawT));
            const ideal = { x: start.x + t * dx, y: start.y + t * dy };
            ctx.beginPath();
            ctx.moveTo(point.x, point.y);
            ctx.lineTo(ideal.x, ideal.y);
            ctx.stroke();
        });
    });
}

export function renderMaskOverlay(canvas, ctx, maskMat, alpha = 0.5) {
    if (!maskMat) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = maskMat.cols;
    overlayCanvas.height = maskMat.rows;
    const overlayContext = overlayCanvas.getContext('2d');
    const imageData = overlayContext.createImageData(maskMat.cols, maskMat.rows);
    const maskData = maskMat.data;
    const rgba = imageData.data;
    const overlayAlpha = Math.max(0, Math.min(255, Math.round(alpha * 255)));

    for (let index = 0; index < maskData.length; index++) {
        if (maskData[index] === 0) continue;
        const offset = index * 4;
        rgba[offset] = 0;
        rgba[offset + 1] = 255;
        rgba[offset + 2] = 80;
        rgba[offset + 3] = overlayAlpha;
    }

    overlayContext.putImageData(imageData, 0, 0);
    ctx.drawImage(overlayCanvas, 0, 0);
}

export function renderReferencePoints(canvas, ctx, referencePoints, radius) {
    const colors = {
        paper: { stroke: '#2f76d2', fill: '#2f76d2' },
        black: { stroke: '#ffffff', fill: '#111111' },
        white: { stroke: '#222222', fill: '#ffffff' }
    };
    ctx.save();
    ctx.lineWidth = Math.max(2, canvas.width / 800);
    referencePoints.forEach((point) => {
        const color = colors[point.type];
        ctx.strokeStyle = color.stroke;
        ctx.fillStyle = color.fill;
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(point.x, point.y, Math.max(4, radius / 8), 0, 2 * Math.PI);
        ctx.fill();
    });
    ctx.restore();
}
