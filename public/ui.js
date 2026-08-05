// Отрисовка интерактивной сетки и маркеров углов
export function drawGrid(canvas, ctx, srcMat, corners) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    cv.imshow(canvas.id, srcMat);

    // Рисуем контурную рамку листа
    ctx.strokeStyle = "#00e676";
    ctx.lineWidth = Math.max(4, canvas.width / 300);
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.stroke();

    // Рисуем круглые маркеры для ручного перетаскивания
    corners.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(10, canvas.width / 80), 0, 2 * Math.PI);
        ctx.stroke();
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
