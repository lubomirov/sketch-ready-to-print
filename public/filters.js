const INPAINT_RADIUS = 25;
const LIGHTMAP_WORK_MIN_SIDE = 960;
const LIGHTMAP_MIN_VALUE = 24;

// Константы выравнивания освещения (вместо UI-контролов)
const BRIGHTNESS_CONTRAST = 1.0; // 1.1
const BRIGHTNESS_OFFSET = 0;     // -10

function toOdd(value, min = 3) {
    const base = Math.max(min, Math.floor(value));
    return base % 2 === 0 ? base + 1 : base;
}

// Ищет фон листа и возвращает маску: не ноль в маске это штрихи/линии/надписи/края за пределами листа.
export function buildSheetMask(srcMat) {
    const gray = new cv.Mat();
    const inkMask = new cv.Mat();
    const sheetMask = new cv.Mat.zeros(srcMat.rows, srcMat.cols, cv.CV_8UC1);
    const outsideSheetMask = new cv.Mat();
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3));

    // Переводим исходник в grayscale.
    cv.cvtColor(srcMat, gray, cv.COLOR_RGBA2GRAY, 0);

    // Вычисляем штрихи и края через локальный порог.
    const minSide = Math.min(srcMat.cols, srcMat.rows);
    const blockSize = toOdd(Math.max(25, minSide / 18), 3);
    cv.adaptiveThreshold(gray, inkMask, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, blockSize, 7);

    // Ищем внешний контур-кандидат листа.
    cv.findContours(inkMask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    // Выбираем самый большой контур по площади.
    let largestContourIndex = -1;
    let largestArea = 0;
    for (let i = 0; i < contours.size(); i++) {
        const area = cv.contourArea(contours.get(i), false);
        if (area > largestArea) {
            largestArea = area;
            largestContourIndex = i;
        }
    }

    if (largestContourIndex >= 0) {
        const contour = contours.get(largestContourIndex);
        const simplified = new cv.Mat();
        const simplifiedContours = new cv.MatVector();
        cv.approxPolyDP(contour, simplified, 20, true);
        simplifiedContours.push_back(simplified);

        // Заполняем внутреннюю область листа.
        cv.drawContours(sheetMask, simplifiedContours, 0, new cv.Scalar(255), -1, cv.LINE_8, hierarchy, 0);

        // Отодвигаем границу листа внутрь.
        const insetKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(21, 21));
        cv.erode(sheetMask, sheetMask, insetKernel, new cv.Point(-1, -1), 1);

        insetKernel.delete(); simplifiedContours.delete(); simplified.delete(); contour.delete();
    }

    // Инвертируем лист, чтобы получить маску всего, что снаружи листа.
    cv.bitwise_not(sheetMask, outsideSheetMask);

    // Объединяем внутреннюю маску штрихов и внешнюю маску фона.
    cv.bitwise_or(inkMask, outsideSheetMask, inkMask);

    // Слегка расширяем маску, чтобы закрыть тонкие разрывы штрихов.
    cv.dilate(inkMask, inkMask, kernel, new cv.Point(-1, -1), 1);

    gray.delete(); sheetMask.delete(); outsideSheetMask.delete();
    contours.delete(); hierarchy.delete(); kernel.delete();

    return inkMask;
}

// Строит цветную карту бумаги и ее серую нормализованную версию для предпросмотра.
export function buildNormalizedLightMap(srcMat, sheetMask) {
    const srcBgr = new cv.Mat();
    const workBgr = new cv.Mat();
    const workMask = new cv.Mat();
    const inpaintedBgr = new cv.Mat();
    const lightMap = new cv.Mat();
    const lightMapGray = new cv.Mat();
    const normalizedLightMap = new cv.Mat();

    const minSide = Math.min(srcMat.cols, srcMat.rows);
    const workScale = Math.min(1, LIGHTMAP_WORK_MIN_SIDE / minSide);
    const workCols = Math.max(1, Math.round(srcMat.cols * workScale));
    const workRows = Math.max(1, Math.round(srcMat.rows * workScale));
    const workSize = new cv.Size(workCols, workRows);

    cv.cvtColor(srcMat, srcBgr, cv.COLOR_RGBA2BGR, 0);
    cv.resize(srcBgr, workBgr, workSize, 0, 0, cv.INTER_AREA);
    cv.resize(sheetMask, workMask, workSize, 0, 0, cv.INTER_NEAREST);

    const scaledRadius = Math.max(3, Math.round(INPAINT_RADIUS * workScale));
    cv.inpaint(workBgr, workMask, inpaintedBgr, scaledRadius, cv.INPAINT_TELEA);

    const workMinSide = Math.min(workCols, workRows);
    const workBlurKernel = toOdd(Math.max(41, workMinSide / 6), 3);
    cv.GaussianBlur(inpaintedBgr, lightMap, new cv.Size(workBlurKernel, workBlurKernel), 0);
    cv.cvtColor(lightMap, lightMapGray, cv.COLOR_BGR2GRAY, 0);
    cv.normalize(lightMapGray, normalizedLightMap, 0, 255, cv.NORM_MINMAX);

    srcBgr.delete(); workBgr.delete(); workMask.delete(); inpaintedBgr.delete(); lightMapGray.delete();

    return {
        lightMap,
        normalizedLightMap,
        workScale
    };
}

function fitReferenceScales(srcMat, lightMap, points, radius) {
    const colorLightProducts = [0, 0, 0];
    const lightSquares = [0, 0, 0];
    const radiusSquared = radius * radius;

    points.forEach((point) => {
        const left = Math.max(0, Math.ceil(point.x - radius));
        const right = Math.min(srcMat.cols - 1, Math.floor(point.x + radius));
        const top = Math.max(0, Math.ceil(point.y - radius));
        const bottom = Math.min(srcMat.rows - 1, Math.floor(point.y + radius));
        for (let y = top; y <= bottom; y++) {
            for (let x = left; x <= right; x++) {
                const dx = x - point.x;
                const dy = y - point.y;
                if (dx * dx + dy * dy > radiusSquared) continue;
                const sourceIndex = (y * srcMat.cols + x) * 4;
                const mapIndex = (y * lightMap.cols + x) * 3;
                for (let channel = 0; channel < 3; channel++) {
                    const light = lightMap.data[mapIndex + (2 - channel)];
                    colorLightProducts[channel] += srcMat.data[sourceIndex + channel] * light;
                    lightSquares[channel] += light * light;
                }
            }
        }
    });

    return colorLightProducts.map((value, channel) => value / lightSquares[channel]);
}

function cubicHermite(value, startX, startY, endX, endY, startSlope, endSlope) {
    const span = endX - startX;
    const t = Math.max(0, Math.min(1, (value - startX) / span));
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * startY + (t3 - 2 * t2 + t) * span * startSlope +
        (-2 * t3 + 3 * t2) * endY + (t3 - t2) * span * endSlope;
}

// Приводит каждый канал к нормализованному виду:
// - для белой бумаги: деление на карту освещённости к белому фону (255, 255, 255)
// - для цветной бумаги: гладкая кубическая кривая между целями чёрного, бумаги и светлого эталона
export function applyBrightnessWithLightMap(srcMat, lightMap, optionsOrPoints = {}, referenceRadius = 0, targetColors = {}) {
    let mode = 'white';
    let referencePoints = [];
    let radius = referenceRadius;
    let targets = targetColors;

    if (Array.isArray(optionsOrPoints)) {
        referencePoints = optionsOrPoints;
        mode = referencePoints.length > 0 ? 'colored' : 'white';
    } else if (typeof optionsOrPoints === 'object' && optionsOrPoints !== null) {
        mode = optionsOrPoints.mode || (optionsOrPoints.referencePoints?.length ? 'colored' : 'white');
        referencePoints = optionsOrPoints.referencePoints || [];
        radius = optionsOrPoints.referenceRadius || referenceRadius;
        targets = optionsOrPoints.targetColors || targetColors;
    }

    const resizedLightMap = new cv.Mat();
    cv.resize(lightMap, resizedLightMap, new cv.Size(srcMat.cols, srcMat.rows), 0, 0, cv.INTER_CUBIC);

    if (mode === 'white') {
        const resultMat = new cv.Mat(srcMat.rows, srcMat.cols, srcMat.type());
        const totalPixels = srcMat.rows * srcMat.cols;
        for (let pixelIndex = 0; pixelIndex < totalPixels; pixelIndex++) {
            const srcOffset = pixelIndex * 4;
            const mapOffset = pixelIndex * 3;
            for (let channel = 0; channel < 3; channel++) {
                const sourceValue = srcMat.data[srcOffset + channel];
                const localLight = Math.max(LIGHTMAP_MIN_VALUE, resizedLightMap.data[mapOffset + (2 - channel)]);
                const corrected = (sourceValue / localLight) * 255 * BRIGHTNESS_CONTRAST + BRIGHTNESS_OFFSET;
                resultMat.data[srcOffset + channel] = Math.max(0, Math.min(255, Math.round(corrected)));
            }
            resultMat.data[srcOffset + 3] = srcMat.data[srcOffset + 3];
        }
        resizedLightMap.delete();
        return resultMat;
    }

    const pointsByType = {
        paper: referencePoints.filter((point) => point.type === 'paper'),
        black: referencePoints.filter((point) => point.type === 'black'),
        white: referencePoints.filter((point) => point.type === 'white')
    };
    if (!radius || Object.values(pointsByType).some((points) => points.length === 0)) {
        resizedLightMap.delete();
        throw new Error('Добавьте эталон бумаги, чёрного и белого.');
    }

    const blackScale = fitReferenceScales(srcMat, resizedLightMap, pointsByType.black, radius);
    const paperScale = fitReferenceScales(srcMat, resizedLightMap, pointsByType.paper, radius);
    const whiteScale = fitReferenceScales(srcMat, resizedLightMap, pointsByType.white, radius);
    const blackTarget = targets.black || [0, 0, 0];
    const paperTarget = targets.paper || [255, 255, 255];
    const whiteTarget = targets.white || [255, 255, 255];

    const resultMat = new cv.Mat(srcMat.rows, srcMat.cols, srcMat.type());
    for (let pixelIndex = 0; pixelIndex < srcMat.rows * srcMat.cols; pixelIndex++) {
        for (let channel = 0; channel < 3; channel++) {
            const sourceValue = srcMat.data[pixelIndex * 4 + channel];
            const localLight = resizedLightMap.data[pixelIndex * 3 + (2 - channel)];
            const blackValue = blackScale[channel] * localLight;
            const estimatedPaper = paperScale[channel] * localLight;
            const whiteValue = whiteScale[channel] * localLight;
            if (estimatedPaper <= blackValue + 1 || estimatedPaper >= whiteValue - 1) {
                resizedLightMap.delete(); resultMat.delete();
                throw new Error('Эталоны должны удовлетворять: чёрный < бумага < белый.');
            }
            const lowerSlope = (paperTarget[channel] - blackTarget[channel]) / (estimatedPaper - blackValue);
            const upperSlope = (whiteTarget[channel] - paperTarget[channel]) / (whiteValue - estimatedPaper);
            const paperSlope = 2 * lowerSlope * upperSlope / (lowerSlope + upperSlope);
            let corrected;
            if (sourceValue <= estimatedPaper) {
                corrected = cubicHermite(sourceValue, blackValue, blackTarget[channel], estimatedPaper, paperTarget[channel], lowerSlope, paperSlope);
            } else {
                corrected = cubicHermite(sourceValue, estimatedPaper, paperTarget[channel], whiteValue, whiteTarget[channel], paperSlope, upperSlope);
            }
            resultMat.data[pixelIndex * 4 + channel] = Math.max(0, Math.min(255, Math.round(corrected)));
        }
        resultMat.data[pixelIndex * 4 + 3] = srcMat.data[pixelIndex * 4 + 3];
    }

    resizedLightMap.delete();
    return resultMat;
}

// Совместимость со старым API: считает карту и сразу применяет ее.
export function normalizeBrightness(srcMat, sheetMask) {
    const maps = buildNormalizedLightMap(srcMat, sheetMask);
    const result = applyBrightnessWithLightMap(srcMat, maps.lightMap);
    maps.lightMap.delete();
    maps.normalizedLightMap.delete();
    return result;
}
