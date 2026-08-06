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
