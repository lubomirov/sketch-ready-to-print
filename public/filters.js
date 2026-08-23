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

// Строит уменьшенную карту освещенности и ее нормализованную версию для предпросмотра.
export function buildNormalizedLightMap(srcMat, sheetMask) {
    const srcBgr = new cv.Mat();
    const workBgr = new cv.Mat();
    const workMask = new cv.Mat();
    const inpaintedBgr = new cv.Mat();
    const inpaintedGray = new cv.Mat();
    const lightMap = new cv.Mat();
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
    cv.cvtColor(inpaintedBgr, inpaintedGray, cv.COLOR_BGR2GRAY, 0);

    const workMinSide = Math.min(workCols, workRows);
    const workBlurKernel = toOdd(Math.max(41, workMinSide / 6), 3);
    cv.GaussianBlur(inpaintedGray, lightMap, new cv.Size(workBlurKernel, workBlurKernel), 0);
    cv.normalize(lightMap, normalizedLightMap, 0, 255, cv.NORM_MINMAX);

    srcBgr.delete(); workBgr.delete(); workMask.delete(); inpaintedBgr.delete(); inpaintedGray.delete();

    return {
        lightMap,
        normalizedLightMap,
        workScale
    };
}

// Применяет ранее рассчитанную карту освещенности к исходному изображению без повторного inpaint+blur.
export function applyBrightnessWithLightMap(srcMat, lightMap) {
    const resizedLightMap = new cv.Mat();
    const minLight = new cv.Mat(srcMat.rows, srcMat.cols, cv.CV_8UC1);
    const safeLightMap = new cv.Mat();
    const channels = new cv.MatVector();
    const normalizedChannels = new cv.MatVector();
    let resultMat = null;

    cv.resize(lightMap, resizedLightMap, new cv.Size(srcMat.cols, srcMat.rows), 0, 0, cv.INTER_CUBIC);
    minLight.setTo(new cv.Scalar(LIGHTMAP_MIN_VALUE));
    cv.max(resizedLightMap, minLight, safeLightMap);
    cv.split(srcMat, channels);

    for (let i = 0; i < 3; i++) {
        const channel = channels.get(i);
        const divided = new cv.Mat();
        const finalChannel = new cv.Mat();
        cv.divide(channel, safeLightMap, divided, 255);
        cv.convertScaleAbs(divided, finalChannel, BRIGHTNESS_CONTRAST, BRIGHTNESS_OFFSET);
        normalizedChannels.push_back(finalChannel);
        channel.delete(); divided.delete(); finalChannel.delete();
    }

    if (channels.size() > 3) {
        const alpha = channels.get(3);
        normalizedChannels.push_back(alpha);
        alpha.delete();
    }

    resultMat = new cv.Mat();
    cv.merge(normalizedChannels, resultMat);

    channels.delete(); normalizedChannels.delete();
    minLight.delete(); safeLightMap.delete(); resizedLightMap.delete();

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
