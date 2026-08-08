const INPAINT_RADIUS = 25;
// Константы выравнивания освещения (вместо UI-контролов)
const BRIGHTNESS_CONTRAST = 1.1;
const BRIGHTNESS_OFFSET = -10;

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

    cv.cvtColor(srcMat, gray, cv.COLOR_RGBA2GRAY, 0);
    downloadMatAsPng(gray, `buildSheetMask_gray.png`);

    const minSide = Math.min(srcMat.cols, srcMat.rows);
    const blockSize = toOdd(Math.max(25, minSide / 18), 3);
    cv.adaptiveThreshold(gray, inkMask, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, blockSize, 7);
    downloadMatAsPng(inkMask, `buildSheetMask_inkMask.png`);

    // cv.morphologyEx(inkMaskRaw, inkMaskOpen, cv.MORPH_OPEN, kernel);
    // downloadMatAsPng(inkMaskOpen, `buildSheetMask_inkMaskOpen.png`);
    cv.dilate(inkMask, inkMask, kernel, new cv.Point(-1, -1), 1);
    downloadMatAsPng(inkMask, `buildSheetMask_inkMask2.png`);

    // Ищем лист как крупнейшую светлую область и добавляем в маску всё снаружи неё.
    cv.findContours(inkMask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

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
        cv.drawContours(sheetMask, contours, largestContourIndex, new cv.Scalar(255), -1, cv.LINE_8, hierarchy, 0);
        downloadMatAsPng(sheetMask, `buildSheetMask_sheetMask.png`);

        cv.bitwise_not(sheetMask, outsideSheetMask);
        downloadMatAsPng(outsideSheetMask, `buildSheetMask_outsideSheetMask.png`);
        cv.bitwise_or(inkMask, outsideSheetMask, inkMask);
        downloadMatAsPng(inkMask, `buildSheetMask_inkMask3.png`);
    }

    gray.delete(); inkMaskRaw.delete(); inkMaskOpen.delete(); sheetBinary.delete(); sheetMask.delete(); outsideSheetMask.delete();
    contours.delete(); hierarchy.delete(); kernel.delete();

    return inkMask;
}

export function normalizeBrightness(srcMat, sheetMask) {
    const inpaintMask = new cv.Mat();
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

    // const inpaintKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3));
    // sheetMask.copyTo(inpaintMask);
    // cv.dilate(inpaintMask, inpaintMask, inpaintKernel, new cv.Point(-1, -1), 1);
    // downloadMatAsPng(inpaintMask, `normalizeBrightness_inpaintMask.png`);
    //inpaintKernel.delete();

    downloadMatAsPng(sheetMask, `normalizeBrightness_sheetMask.png`);
    cv.cvtColor(srcMat, srcBgr, cv.COLOR_RGBA2BGR, 0);
    // cv.inpaint(srcBgr, inpaintMask, inpaintedBgr, INPAINT_RADIUS, cv.INPAINT_TELEA);
    cv.inpaint(srcBgr, sheetMask, inpaintedBgr, INPAINT_RADIUS, cv.INPAINT_TELEA);
    downloadMatAsPng(inpaintedBgr, `normalizeBrightness_inpaintedBgr.png`);
    cv.cvtColor(inpaintedBgr, inpainted, cv.COLOR_BGR2RGBA, 0);
    downloadMatAsPng(inpainted, `normalizeBrightness_inpainted.png`);
    cv.cvtColor(inpaintedBgr, inpaintedGray, cv.COLOR_BGR2GRAY, 0);
    downloadMatAsPng(inpaintedGray, `normalizeBrightness_inpaintedGray.png`);

    const minSide = Math.min(srcMat.cols, srcMat.rows);
    const blurKernel = toOdd(Math.max(41, minSide / 6), 3);
    cv.GaussianBlur(inpaintedGray, lightMap, new cv.Size(blurKernel, blurKernel), 0);
    downloadMatAsPng(lightMap, `normalizeBrightness_lightMap.png`);

    cv.normalize(lightMap, normalizedLightMap, 0, 255, cv.NORM_MINMAX);
    downloadMatAsPng(normalizedLightMap, `normalizeBrightness_normalizedLightMap.png`);
    cv.applyColorMap(normalizedLightMap, heatmap, cv.COLORMAP_TURBO);
    downloadMatAsPng(heatmap, `normalizeBrightness_heatmap.png`);

    cv.cvtColor(heatmap, heatmapRgba, cv.COLOR_BGR2RGBA, 0);
    cv.addWeighted(srcMat, 0.55, heatmapRgba, 0.45, 0, blended);

    minLight.setTo(new cv.Scalar(24));
    cv.max(lightMap, minLight, safeLightMap);
    cv.split(srcMat, channels);

    for (let i = 0; i < 3; i++) {
        const channel = channels.get(i);
        const divided = new cv.Mat();
        const finalChannel = new cv.Mat();

        cv.divide(channel, safeLightMap, divided, 255);
        cv.convertScaleAbs(divided, finalChannel, BRIGHTNESS_CONTRAST, BRIGHTNESS_OFFSET);
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
