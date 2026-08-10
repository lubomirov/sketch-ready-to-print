const INPAINT_RADIUS = 25;
const LIGHTMAP_WORK_MIN_SIDE = 1400;
// Константы выравнивания освещения (вместо UI-контролов)
const BRIGHTNESS_CONTRAST = 1.0; // 1.1
const BRIGHTNESS_OFFSET = 0;     // -10

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

function toOdd(value, min = 3) {
    const base = Math.max(min, Math.floor(value));
    return base % 2 === 0 ? base + 1 : base;
}

// Строит маску: что фон листа, а что нет (штрихи/линии/надписи/края за пределами листа).
export function buildSheetMask(srcMat, options = {}) {
    const gray = new cv.Mat();
    const inkMaskRaw = new cv.Mat();
    const inkMaskOpen = new cv.Mat();
    const inkMask = new cv.Mat();
    const sheetBinary = new cv.Mat();
    const sheetMask = new cv.Mat.zeros(srcMat.rows, srcMat.cols, cv.CV_8UC1);
    const outsideSheetMask = new cv.Mat();
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3));

    // переводим исходник в grayscale.
    cv.cvtColor(srcMat, gray, cv.COLOR_RGBA2GRAY, 0);
    downloadMatAsPng(gray, `buildSheetMask_gray.png`);

    // строим черновую маску чернил через локальный adaptive threshold с размером матрицы анализа в blockSize.
    const minSide = Math.min(srcMat.cols, srcMat.rows);
    const blockSize = toOdd(Math.max(25, minSide / 18), 3);
    cv.adaptiveThreshold(gray, inkMask, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, blockSize, 7);
    downloadMatAsPng(inkMask, `buildSheetMask_inkMask.png`);

    // ищем внешний контур-кандидат листа на черновой маске.
    cv.findContours(inkMask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    // выбираем самый большой контур по площади.
    let largestContourIndex = -1;
    let largestArea = 0;
    for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);
        const area = cv.contourArea(contour, false);
        contour.delete();

        if (area > largestArea) {
            largestArea = area;
            largestContourIndex = i;
        }
    }

    if (largestContourIndex >= 0) {
        // закрашиваем самый большую площадь как сплошную внутреннюю область.
        cv.drawContours(sheetMask, contours, largestContourIndex, new cv.Scalar(255), -1, cv.LINE_8, hierarchy, 0);
        downloadMatAsPng(sheetMask, `buildSheetMask_sheetMask.png`);

        // инвертируем лист, чтобы получить маску всего, что снаружи листа.
        cv.bitwise_not(sheetMask, outsideSheetMask);
        downloadMatAsPng(outsideSheetMask, `buildSheetMask_outsideSheetMask.png`);

        // объединяем внутреннюю маску штрихов и внешнюю маску фона.
        cv.bitwise_or(inkMask, outsideSheetMask, inkMask);

        // Зашиваем 1-2px дырки на шве между внешней и внутренней частями маски.
        const seamKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3));
        cv.morphologyEx(inkMask, inkMask, cv.MORPH_CLOSE, seamKernel, new cv.Point(-1, -1), 1);
        seamKernel.delete();

        downloadMatAsPng(inkMask, `buildSheetMask_inkMask3.png`);
    }

    // слегка расширяем маску, чтобы закрыть тонкие разрывы штрихов.
    cv.dilate(inkMask, inkMask, kernel, new cv.Point(-1, -1), 1);
    downloadMatAsPng(inkMask, `buildSheetMask_inkMask2.png`);

    gray.delete(); inkMaskRaw.delete(); inkMaskOpen.delete(); sheetBinary.delete(); sheetMask.delete(); outsideSheetMask.delete();
    contours.delete(); hierarchy.delete(); kernel.delete();

    return inkMask;
}

export function normalizeBrightness(srcMat, sheetMask) {
    const srcBgr = new cv.Mat();
    const inpaintedBgr = new cv.Mat();
    const inpainted = new cv.Mat();
    const inpaintedGray = new cv.Mat();
    const lightMap = new cv.Mat();
    const normalizedLightMap = new cv.Mat();
    const heatmap = new cv.Mat();
    const heatmapRgba = new cv.Mat();
    const blended = new cv.Mat();
    const channels = new cv.MatVector();
    const normalizedChannels = new cv.MatVector();
    const minLight = new cv.Mat(srcMat.rows, srcMat.cols, cv.CV_8UC1);
    const safeLightMap = new cv.Mat();
    let resultMat = null;


    const minSide = Math.min(srcMat.cols, srcMat.rows);
    const workScale = Math.min(1, LIGHTMAP_WORK_MIN_SIDE / minSide);
    const useDownscaledPath = workScale < 0.999;

    downloadMatAsPng(sheetMask, `normalizeBrightness_sheetMask.png`);
    cv.cvtColor(srcMat, srcBgr, cv.COLOR_RGBA2BGR, 0);

    if (useDownscaledPath) {
        const workBgr = new cv.Mat();
        const workMask = new cv.Mat();
        const workInpaintedBgr = new cv.Mat();
        const workInpaintedGray = new cv.Mat();
        const workLightMap = new cv.Mat();

        const workCols = Math.max(1, Math.round(srcMat.cols * workScale));
        const workRows = Math.max(1, Math.round(srcMat.rows * workScale));
        const workSize = new cv.Size(workCols, workRows);

        cv.resize(srcBgr, workBgr, workSize, 0, 0, cv.INTER_AREA);
        cv.resize(sheetMask, workMask, workSize, 0, 0, cv.INTER_NEAREST);

        const scaledRadius = Math.max(3, Math.round(INPAINT_RADIUS * workScale));
        cv.inpaint(workBgr, workMask, workInpaintedBgr, scaledRadius, cv.INPAINT_TELEA);
        cv.resize(workInpaintedBgr, inpaintedBgr, new cv.Size(srcMat.cols, srcMat.rows), 0, 0, cv.INTER_LINEAR);

        cv.cvtColor(workInpaintedBgr, workInpaintedGray, cv.COLOR_BGR2GRAY, 0);
        const workMinSide = Math.min(workCols, workRows);
        const workBlurKernel = toOdd(Math.max(41, workMinSide / 6), 3);
        cv.GaussianBlur(workInpaintedGray, workLightMap, new cv.Size(workBlurKernel, workBlurKernel), 0);
        cv.resize(workLightMap, lightMap, new cv.Size(srcMat.cols, srcMat.rows), 0, 0, cv.INTER_CUBIC);

        workBgr.delete();
        workMask.delete();
        workInpaintedBgr.delete();
        workInpaintedGray.delete();
        workLightMap.delete();
    } else {
        cv.inpaint(srcBgr, sheetMask, inpaintedBgr, INPAINT_RADIUS, cv.INPAINT_TELEA);
        cv.cvtColor(inpaintedBgr, inpaintedGray, cv.COLOR_BGR2GRAY, 0);
        const blurKernel = toOdd(Math.max(41, minSide / 6), 3);
        cv.GaussianBlur(inpaintedGray, lightMap, new cv.Size(blurKernel, blurKernel), 0);
    }

    downloadMatAsPng(inpaintedBgr, `normalizeBrightness_inpaintedBgr.png`);
    cv.cvtColor(inpaintedBgr, inpainted, cv.COLOR_BGR2RGBA, 0);
    downloadMatAsPng(inpainted, `normalizeBrightness_inpainted.png`);
    cv.cvtColor(inpaintedBgr, inpaintedGray, cv.COLOR_BGR2GRAY, 0);
    downloadMatAsPng(inpaintedGray, `normalizeBrightness_inpaintedGray.png`);

    downloadMatAsPng(lightMap, `normalizeBrightness_lightMap.png`);

    cv.normalize(lightMap, normalizedLightMap, 0, 255, cv.NORM_MINMAX);
    downloadMatAsPng(normalizedLightMap, `normalizeBrightness_normalizedLightMap.png`);
    cv.applyColorMap(normalizedLightMap, heatmap, cv.COLORMAP_TURBO);
    downloadMatAsPng(heatmap, `normalizeBrightness_heatmap.png`);

    cv.cvtColor(heatmap, heatmapRgba, cv.COLOR_BGR2RGBA, 0);
    downloadMatAsPng(heatmapRgba, `normalizeBrightness_heatmapRgba.png`);
    cv.addWeighted(srcMat, 0.55, heatmapRgba, 0.45, 0, blended);

    minLight.setTo(new cv.Scalar(24));
    downloadMatAsPng(minLight, `normalizeBrightness_minLight.png`);
    cv.max(lightMap, minLight, safeLightMap);
    downloadMatAsPng(safeLightMap, `normalizeBrightness_safeLightMap.png`);
    cv.split(srcMat, channels);

    for (let i = 0; i < 3; i++) {
        const channel = channels.get(i);
        downloadMatAsPng(channel, `normalizeBrightness_channel${i}.png`);
        const divided = new cv.Mat();
        const finalChannel = new cv.Mat();

        cv.divide(channel, safeLightMap, divided, 255);
        cv.convertScaleAbs(divided, finalChannel, BRIGHTNESS_CONTRAST, BRIGHTNESS_OFFSET);
        downloadMatAsPng(divided, `normalizeBrightness_divided_channel${i}.png`);
        normalizedChannels.push_back(finalChannel);

        channel.delete();
        divided.delete();
        finalChannel.delete();
    }

    if (channels.size() > 3) {
        const alpha = channels.get(3);
        normalizedChannels.push_back(alpha);
        alpha.delete();
    }

    resultMat = new cv.Mat();
    cv.merge(normalizedChannels, resultMat);

    channels.delete();
    normalizedChannels.delete();
    minLight.delete();
    safeLightMap.delete();
    srcBgr.delete();
    inpaintedBgr.delete();
    inpaintedGray.delete();

    return resultMat;

}
