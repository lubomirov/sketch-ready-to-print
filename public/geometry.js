const EDGE_SAMPLES = 12;
const CURVE_GRID_COLS = 10;
const CURVE_GRID_ROWS = 15;

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

// Семплирование N точек вдоль каждого ребра из полного контура.
// Устойчиво к неоднозначному порядку углов и индексов в contour.
function sampleEdgePoints(contourPts, corners, n) {
    const sideDefs = corners.map((start, sideIdx) => {
        const end = corners[(sideIdx + 1) % 4];
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const edgeLen = Math.hypot(dx, dy) || 1;
        const denom = dx * dx + dy * dy || 1;
        return { start, end, dx, dy, edgeLen, denom };
    });

    const sideBins = [[], [], [], []];

    contourPts.forEach((point) => {
        let bestSideIdx = 0;
        let bestEntry = null;
        let bestScore = Infinity;

        sideDefs.forEach((side, sideIdx) => {
            const rawT = ((point.x - side.start.x) * side.dx + (point.y - side.start.y) * side.dy) / side.denom;
            const clampedT = Math.max(0, Math.min(1, rawT));
            const projX = side.start.x + clampedT * side.dx;
            const projY = side.start.y + clampedT * side.dy;
            const perpDist = Math.hypot(point.x - projX, point.y - projY);

            const outPenalty = rawT < 0
                ? -rawT * side.edgeLen
                : rawT > 1
                    ? (rawT - 1) * side.edgeLen
                    : 0;
            const score = perpDist + outPenalty * 2;

            if (score < bestScore) {
                bestScore = score;
                bestSideIdx = sideIdx;
                bestEntry = { point, rawT, clampedT, perpDist };
            }
        });

        sideBins[bestSideIdx].push(bestEntry);
    });

    return sideDefs.map((side, sideIdx) => {
        const candidates = sideBins[sideIdx]
            .filter((entry) => entry.rawT >= -0.15 && entry.rawT <= 1.15)
            .sort((a, b) => a.clampedT - b.clampedT);

        const pool = candidates.length > 0 ? candidates : sideBins[sideIdx];
        const used = new Set();
        const pts = [];

        for (let k = 1; k <= n; k++) {
            const targetT = k / (n + 1);
            let bestIdx = -1;
            let bestScore = Infinity;

            pool.forEach((entry, idx) => {
                if (used.has(idx)) return;
                const alongDist = Math.abs(entry.clampedT - targetT) * side.edgeLen;
                const score = alongDist * 1.3 + entry.perpDist;
                if (score < bestScore) {
                    bestScore = score;
                    bestIdx = idx;
                }
            });

            if (bestIdx >= 0) {
                used.add(bestIdx);
                pts.push(pool[bestIdx].point);
            } else {
                pts.push({
                    x: side.start.x + targetT * side.dx,
                    y: side.start.y + targetT * side.dy
                });
            }
        }

        return pts;
    });
}

// Внутренний детектор геометрии листа: возвращает углы и точки кривизны
function detectSheetGeometry(src, imgWidth, imgHeight) {
    let gray = new cv.Mat();
    let thresh = new cv.Mat();
    let someContours = new cv.MatVector();
    let hierarchy = new cv.Mat();
    let corners = [];
    let edgePoints = [[], [], [], []];
    let found = false;

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
            found = true;

            const contourPts = [];
            for (let i = 0; i < contour.rows; i++)
                contourPts.push({ x: contour.data32S[i * 2], y: contour.data32S[i * 2 + 1] });
            edgePoints = sampleEdgePoints(contourPts, corners, EDGE_SAMPLES);
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
    return { corners, edgePoints, found };
}

// Поиск только углов для шага геометрии
export function findCorners(src, imgWidth, imgHeight) {
    const result = detectSheetGeometry(src, imgWidth, imgHeight);
    return { corners: result.corners, found: result.found };
}

// Поиск углов и точек кривизны для шага искривлений
export function findCurvedEdges(src, imgWidth, imgHeight) {
    const result = detectSheetGeometry(src, imgWidth, imgHeight);
    return { corners: result.corners, edgePoints: result.edgePoints, found: result.found };
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

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

// Находит ближайшую точку на отрезке start->end для заданной point.
function projectPointToSegment(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const denom = dx * dx + dy * dy || 1;
    const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / denom, 0, 1);
    return { x: start.x + t * dx, y: start.y + t * dy };
}

// Формирует пары управляющих точек: реальная кривая грань -> идеальная прямая грань.
function buildCurveControlPairs(corners, edgePoints) {
    const pairs = [];

    corners.forEach((corner) => {
        pairs.push({ actual: corner, ideal: corner });
    });

    edgePoints.forEach((side, sideIdx) => {
        const start = corners[sideIdx];
        const end = corners[(sideIdx + 1) % 4];

        side.forEach((point) => {
            pairs.push({
                actual: point,
                ideal: projectPointToSegment(point, start, end)
            });
        });
    });

    return pairs;
}

// Строит узлы сетки деформации: для каждой вершины сетки вычисляет смещение
// к исходной координате по взвешенному влиянию управляющих пар.
function buildWarpNodes(width, height, controlPairs, cols, rows) {
    const nodes = [];

    for (let row = 0; row <= rows; row++) {
        const nodeRow = [];
        const y = rows === 0 ? 0 : (row / rows) * (height - 1);

        for (let col = 0; col <= cols; col++) {
            const x = cols === 0 ? 0 : (col / cols) * (width - 1);
            let weightedDx = 0;
            let weightedDy = 0;
            let totalWeight = 0;
            let snapPoint = null;

            controlPairs.forEach(({ actual, ideal }) => {
                const dx = actual.x - ideal.x;
                const dy = actual.y - ideal.y;
                const distSq = (x - ideal.x) * (x - ideal.x) + (y - ideal.y) * (y - ideal.y);

                if (distSq < 1) {
                    snapPoint = { x: actual.x, y: actual.y };
                    return;
                }

                const weight = 1 / distSq;
                weightedDx += dx * weight;
                weightedDy += dy * weight;
                totalWeight += weight;
            });

            if (snapPoint) {
                nodeRow.push(snapPoint);
            } else if (totalWeight > 0) {
                nodeRow.push({ x: x + weightedDx / totalWeight, y: y + weightedDy / totalWeight });
            } else {
                nodeRow.push({ x, y });
            }
        }

        nodes.push(nodeRow);
    }

    return nodes;
}

// Применяет выпрямление кривых граней через обратный remap по узлам сетки.
export function rectifyCurvedEdges(src, corners, edgePoints, cols = CURVE_GRID_COLS, rows = CURVE_GRID_ROWS) {
    const controlPairs = buildCurveControlPairs(corners, edgePoints);
    if (controlPairs.length === 0) return src.clone();

    const inverseNodes = buildWarpNodes(src.cols, src.rows, controlPairs, cols, rows);
    const mapX = new cv.Mat(src.rows, src.cols, cv.CV_32FC1);
    const mapY = new cv.Mat(src.rows, src.cols, cv.CV_32FC1);

    for (let y = 0; y < src.rows; y++) {
        const cellY = rows === 0 ? 0 : clamp((y / Math.max(src.rows - 1, 1)) * rows, 0, rows);
        const row0 = Math.min(Math.floor(cellY), rows - 1);
        const row1 = Math.min(row0 + 1, rows);
        const ty = row1 === row0 ? 0 : cellY - row0;

        for (let x = 0; x < src.cols; x++) {
            const cellX = cols === 0 ? 0 : clamp((x / Math.max(src.cols - 1, 1)) * cols, 0, cols);
            const col0 = Math.min(Math.floor(cellX), cols - 1);
            const col1 = Math.min(col0 + 1, cols);
            const tx = col1 === col0 ? 0 : cellX - col0;

            const n00 = inverseNodes[row0][col0];
            const n10 = inverseNodes[row0][col1];
            const n01 = inverseNodes[row1][col0];
            const n11 = inverseNodes[row1][col1];

            const sourceX =
                n00.x * (1 - tx) * (1 - ty) +
                n10.x * tx * (1 - ty) +
                n01.x * (1 - tx) * ty +
                n11.x * tx * ty;
            const sourceY =
                n00.y * (1 - tx) * (1 - ty) +
                n10.y * tx * (1 - ty) +
                n01.y * (1 - tx) * ty +
                n11.y * tx * ty;

            mapX.floatPtr(y, x)[0] = clamp(sourceX, 0, src.cols - 1);
            mapY.floatPtr(y, x)[0] = clamp(sourceY, 0, src.rows - 1);
        }
    }

    const dst = new cv.Mat();
    cv.remap(src, dst, mapX, mapY, cv.INTER_CUBIC, cv.BORDER_REPLICATE, new cv.Scalar());

    mapX.delete();
    mapY.delete();
    return dst;
}
