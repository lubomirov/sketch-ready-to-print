// Безопасная сортировка 4 углов: верх-лево, верх-право, низ-право, низ-лево
export function sortPoints(pts) {
    if (pts.length !== 4) return pts;
    
    pts.sort((a, b) => a.x - b.x);
    let leftPts = [pts[0], pts[1]];
    let rightPts = [pts[2], pts[3]];
    
    leftPts.sort((a, b) => a.y - b.y);
    rightPts.sort((a, b) => a.y - b.y);
    
    return [
        leftPts[0],  // верх-лево
        rightPts[0], // верх-право
        rightPts[1], // низ-право
        leftPts[1]   // низ-лево
    ];
}

// Автоматический поиск углов с использованием адаптивного порога Оцу
export function autoFindCorners(src, imgWidth, imgHeight) {
    let gray = new cv.Mat();
    let thresh = new cv.Mat();
    let someContours = new cv.MatVector();
    let hierarchy = new cv.Mat();
    let corners = [];

    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
    
    // Порог Оцу идеально отделяет белый лист от черного/темного фона
    cv.threshold(gray, thresh, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    cv.findContours(thresh, someContours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    let maxArea = 0;
    let maxContourIdx = -1;
    for (let i = 0; i < someContours.size(); ++i) {
        let area = cv.contourArea(someContours.get(i));
        if (area > maxArea) {
            maxArea = area;
            maxContourIdx = i;
        }
    }

    if (maxContourIdx !== -1) {
        let contour = someContours.get(maxContourIdx);
        let peri = cv.arcLength(contour, true);
        let approx = new cv.Mat();
        
        cv.approxPolyDP(contour, approx, 0.02 * peri, true);

        if (approx.rows === 4) {
            let pts = [];
            for (let i = 0; i < 4; i++) {
                pts.push({ x: approx.data32S[i * 2], y: approx.data32S[i * 2 + 1] });
            }
            corners = sortPoints(pts);
        }
        approx.delete();
    }

    // Если автоматика не сработала — строим рамку по умолчанию с отступами
    if (corners.length !== 4) {
        corners = [
            {x: imgWidth * 0.1, y: imgHeight * 0.1}, 
            {x: imgWidth * 0.9, y: imgHeight * 0.1}, 
            {x: imgWidth * 0.9, y: imgHeight * 0.9}, 
            {x: imgWidth * 0.1, y: imgHeight * 0.9}  
        ];
    }

    gray.delete(); thresh.delete(); someContours.delete(); hierarchy.delete();
    return corners;
}

// Высокоточная бикубическая трансформация перспективы с добавлением оригинальных полей
export function transformPerspective(src, corners, margin = 0) {
    let widthA = Math.hypot(corners[0].x - corners[1].x, corners[0].y - corners[1].y);
    let widthB = Math.hypot(corners[3].x - corners[2].x, corners[3].y - corners[2].y);
    let maxWidth = Math.max(widthA, widthB);

    let heightA = Math.hypot(corners[0].x - corners[3].x, corners[0].y - corners[3].y);
    let heightB = Math.hypot(corners[1].x - corners[2].x, corners[1].y - corners[2].y);
    let maxHeight = Math.max(heightA, heightB);

    // Увеличиваем размер результирующего холста на величину полей
    let finalWidth = maxWidth + (margin * 2);
    let finalHeight = maxHeight + (margin * 2);

    let dst = new cv.Mat();
    let dsize = new cv.Size(finalWidth, finalHeight);

    let srcCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [
        corners[0].x, corners[0].y,
        corners[1].x, corners[1].y,
        corners[2].x, corners[2].y,
        corners[3].x, corners[3].y
    ]);

    // Сдвигаем целевые точки внутрь нового холста на величину margin
    let dstCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [
        margin, margin,
        maxWidth + margin - 1, margin,
        maxWidth + margin - 1, maxHeight + margin - 1,
        margin, maxHeight + margin - 1
    ]);

    let M = cv.getPerspectiveTransform(srcCoords, dstCoords);
    
    // Используем BORDER_REPLICATE — он копирует и продлевает родную текстуру фона фотографии
    cv.warpPerspective(src, dst, M, dsize, cv.INTER_CUBIC, cv.BORDER_REPLICATE, new cv.Scalar());

    srcCoords.delete(); dstCoords.delete(); M.delete();
    return dst; 
}
