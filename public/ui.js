// Отрисовка найденных углов и рамки
export function renderCornersOverlay(canvas, ctx, srcMat, corners) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    cv.imshow(canvas.id, srcMat);

    ctx.lineWidth = Math.max(1, canvas.width / 1000);

    // Рисуем контурную рамку листа
    ctx.strokeStyle = "#00e676";
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.stroke();

    // Рисуем круглые маркеры для ручного перетаскивания
    corners.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(10, canvas.width / 100), 0, 2 * Math.PI);
        ctx.stroke();
    });
}

// Отрисовка векторов искривления граней
export function renderCurvedEdgesOverlay(canvas, ctx, srcMat, corners, edgePoints = []) {
    ctx.lineWidth = Math.max(1, canvas.width / 500);

    // Оранжевый круг = фактическая точка на контуре; синяя точка = идеальная позиция на прямой; стрелка = смещение
    edgePoints.forEach((side, s) => {
        const a = corners[s];
        const b = corners[(s + 1) % 4];

        side.forEach((p, k) => {
            // Проекция p на прямую a→b (ближайшая точка на ребре)
            const dx = b.x - a.x, dy = b.y - a.y;
            const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
            const ideal = { x: a.x + t * dx, y: a.y + t * dy };

            // Линия смещения от фактической к идеальной
            ctx.strokeStyle = "#00e676";
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(ideal.x, ideal.y);
            ctx.stroke();
        });
    });
}

// Пересчет координат мыши с учетом CSS масштабирования холста
export function getMousePosition(canvas, event) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
        x: (event.clientX - rect.left) * scaleX,
        y: (event.clientY - rect.top) * scaleY
    };
}

function toStem(fileName) {
    return (fileName || 'image').replace(/\.[^.]+$/, '') || 'image';
}

function downloadMatAsPng(mat, fileName) {
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = mat.cols;
    exportCanvas.height = mat.rows;
    cv.imshow(exportCanvas, mat);

    const anchor = document.createElement('a');
    anchor.href = exportCanvas.toDataURL('image/png');
    anchor.download = fileName;
    anchor.click();
}

// Отрисовка размытой карты яркости поверх текущего кадра
export function renderBrightnessOverlay(canvas, ctx, srcMat, sourceFileName = 'image') {
    if (!srcMat) return;

    const gray = new cv.Mat();
    const blurred = new cv.Mat();
    const normalized = new cv.Mat();
    const heatmap = new cv.Mat();
    const heatmapRgba = new cv.Mat();
    const blended = new cv.Mat();

    try {
        cv.cvtColor(srcMat, gray, cv.COLOR_RGBA2GRAY, 0);

        // Чем крупнее холст, тем сильнее сглаживаем карту освещения.
        const minSide = Math.min(srcMat.cols, srcMat.rows);
        const kernelBase = Math.max(31, Math.floor(minSide / 12));
        const kernelSize = kernelBase % 2 === 0 ? kernelBase + 1 : kernelBase;
        cv.GaussianBlur(gray, blurred, new cv.Size(kernelSize, kernelSize), 0);

        cv.normalize(blurred, normalized, 0, 255, cv.NORM_MINMAX);
        cv.applyColorMap(normalized, heatmap, cv.COLORMAP_TURBO);
        cv.cvtColor(heatmap, heatmapRgba, cv.COLOR_BGR2RGBA, 0);

        // Накладываем карту поверх кадра, чтобы видеть локальные зоны света/тени.
        cv.addWeighted(srcMat, 0.55, heatmapRgba, 0.45, 0, blended);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        cv.imshow(canvas.id, blended);

        const stem = toStem(sourceFileName);
        downloadMatAsPng(gray, `${stem}_brightness_01_gray.png`);
        downloadMatAsPng(blurred, `${stem}_brightness_02_blurred.png`);
        downloadMatAsPng(normalized, `${stem}_brightness_03_normalized.png`);
        downloadMatAsPng(heatmap, `${stem}_brightness_04_heatmap.png`);
        downloadMatAsPng(heatmapRgba, `${stem}_brightness_05_heatmap_rgba.png`);
        downloadMatAsPng(blended, `${stem}_brightness_06_blended_overlay.png`);
    } finally {
        gray.delete();
        blurred.delete();
        normalized.delete();
        heatmap.delete();
        heatmapRgba.delete();
        blended.delete();
    }
}
