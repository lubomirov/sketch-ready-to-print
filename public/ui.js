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
            const denom = dx * dx + dy * dy || 1;
            const rawT = ((p.x - a.x) * dx + (p.y - a.y) * dy) / denom;
            const t = Math.max(0, Math.min(1, rawT));
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

// Отрисовка редактируемой маски поверх исходного изображения полупрозрачным зеленым цветом.
export function renderMaskOverlay(canvas, ctx, srcMat, maskMat, alpha = 0.5) {
    if (!srcMat || !maskMat) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    cv.imshow(canvas.id, srcMat);

    const maskData = maskMat.data;
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = maskMat.cols;
    overlayCanvas.height = maskMat.rows;
    const overlayCtx = overlayCanvas.getContext('2d');
    const overlay = overlayCtx.createImageData(maskMat.cols, maskMat.rows);
    const rgba = overlay.data;
    const overlayAlpha = Math.max(0, Math.min(255, Math.round(alpha * 255)));

    for (let i = 0; i < maskData.length; i++) {
        if (maskData[i] === 0) continue;
        const j = i * 4;
        rgba[j] = 0;
        rgba[j + 1] = 255;
        rgba[j + 2] = 80;
        rgba[j + 3] = overlayAlpha;
    }

    overlayCtx.putImageData(overlay, 0, 0);
    ctx.drawImage(overlayCanvas, 0, 0);
}

export function initTabs() {
    const tabButtons = Array.from(document.querySelectorAll('.tab-btn'));
    const tabPanes = Array.from(document.querySelectorAll('.tab-pane'));
    if (tabButtons.length === 0 || tabPanes.length === 0) return;

    function activateTab(tabId) {
        tabButtons.forEach((btn) => {
            const isActive = btn.dataset.tab === tabId;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });

        tabPanes.forEach((pane) => {
            pane.classList.toggle('active', pane.id === tabId);
        });
    }

    tabButtons.forEach((btn) => {
        btn.addEventListener('click', () => activateTab(btn.dataset.tab));
    });
}
