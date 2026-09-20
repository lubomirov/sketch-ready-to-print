import { isFloatMat, prepareFor8BitCv } from './mat-utils.js';

const INPAINT_RADIUS = 25;
const LIGHTMAP_WORK_MIN_SIDE = 960;
const LIGHTMAP_MIN_VALUE = 24;

function toOdd(value, min = 3) {
    const base = Math.max(min, Math.floor(value));
    return base % 2 === 0 ? base + 1 : base;
}

export function buildSheetMask(srcMat) {
    const sourceForMask = prepareFor8BitCv(srcMat);
    const gray = new cv.Mat();
    const inkMask = new cv.Mat();
    const sheetMask = new cv.Mat.zeros(sourceForMask.rows, sourceForMask.cols, cv.CV_8UC1);
    const outsideSheetMask = new cv.Mat();
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3));

    cv.cvtColor(sourceForMask, gray, cv.COLOR_RGBA2GRAY, 0);
    const minSide = Math.min(srcMat.cols, srcMat.rows);
    const blockSize = toOdd(Math.max(25, minSide / 18), 3);
    cv.adaptiveThreshold(gray, inkMask, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, blockSize, 7);
    cv.findContours(inkMask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    let largestContourIndex = -1;
    let largestArea = 0;
    for (let index = 0; index < contours.size(); index++) {
        // MatVector.get() создаёт новый cv.Mat на каждый вызов — его нужно удалять вручную.
        const candidate = contours.get(index);
        const area = cv.contourArea(candidate, false);
        candidate.delete();
        if (area > largestArea) {
            largestArea = area;
            largestContourIndex = index;
        }
    }

    if (largestContourIndex >= 0) {
        const contour = contours.get(largestContourIndex);
        const simplified = new cv.Mat();
        const simplifiedContours = new cv.MatVector();
        cv.approxPolyDP(contour, simplified, 20, true);
        simplifiedContours.push_back(simplified);
        cv.drawContours(sheetMask, simplifiedContours, 0, new cv.Scalar(255), -1, cv.LINE_8, hierarchy, 0);
        const insetKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(21, 21));
        cv.erode(sheetMask, sheetMask, insetKernel, new cv.Point(-1, -1), 1);
        insetKernel.delete();
        simplifiedContours.delete();
        simplified.delete();
        contour.delete();
    }

    cv.bitwise_not(sheetMask, outsideSheetMask);
    cv.bitwise_or(inkMask, outsideSheetMask, inkMask);
    cv.dilate(inkMask, inkMask, kernel, new cv.Point(-1, -1), 1);
    gray.delete();
    sheetMask.delete();
    outsideSheetMask.delete();
    contours.delete();
    hierarchy.delete();
    kernel.delete();
    if (sourceForMask !== srcMat) sourceForMask.delete();
    return inkMask;
}

export function buildNormalizedLightMap(srcMat, sheetMask) {
    const sourceForLightMap = prepareFor8BitCv(srcMat);
    const srcBgr = new cv.Mat();
    const workBgr = new cv.Mat();
    const workMask = new cv.Mat();
    const inpaintedBgr = new cv.Mat();
    const lightMap = new cv.Mat();
    const lightMapGray = new cv.Mat();
    const normalizedLightMap = new cv.Mat();
    const minSide = Math.min(sourceForLightMap.cols, sourceForLightMap.rows);
    const workScale = Math.min(1, LIGHTMAP_WORK_MIN_SIDE / minSide);
    const workSize = new cv.Size(Math.max(1, Math.round(sourceForLightMap.cols * workScale)), Math.max(1, Math.round(sourceForLightMap.rows * workScale)));

    cv.cvtColor(sourceForLightMap, srcBgr, cv.COLOR_RGBA2BGR, 0);
    cv.resize(srcBgr, workBgr, workSize, 0, 0, cv.INTER_AREA);
    cv.resize(sheetMask, workMask, workSize, 0, 0, cv.INTER_NEAREST);
    cv.inpaint(workBgr, workMask, inpaintedBgr, Math.max(3, Math.round(INPAINT_RADIUS * workScale)), cv.INPAINT_TELEA);
    const workMinSide = Math.min(workSize.width, workSize.height);
    cv.GaussianBlur(inpaintedBgr, lightMap, new cv.Size(toOdd(Math.max(41, workMinSide / 6), 3), toOdd(Math.max(41, workMinSide / 6), 3)), 0);
    cv.cvtColor(lightMap, lightMapGray, cv.COLOR_BGR2GRAY, 0);
    cv.normalize(lightMapGray, normalizedLightMap, 0, 255, cv.NORM_MINMAX);

    srcBgr.delete();
    workBgr.delete();
    workMask.delete();
    inpaintedBgr.delete();
    lightMapGray.delete();
    if (sourceForLightMap !== srcMat) sourceForLightMap.delete();
    return { lightMap, normalizedLightMap };
}

function fitReferenceScales(srcMat, lightMap, points, radius, sourceScale) {
    const products = [0, 0, 0];
    const squares = [0, 0, 0];
    const source = isFloatMat(srcMat) ? srcMat.data32F : srcMat.data;
    const radiusSquared = radius * radius;
    points.forEach((point) => {
        for (let y = Math.max(0, Math.ceil(point.y - radius)); y <= Math.min(srcMat.rows - 1, Math.floor(point.y + radius)); y++) {
            for (let x = Math.max(0, Math.ceil(point.x - radius)); x <= Math.min(srcMat.cols - 1, Math.floor(point.x + radius)); x++) {
                const dx = x - point.x;
                const dy = y - point.y;
                if (dx * dx + dy * dy > radiusSquared) continue;
                const sourceIndex = (y * srcMat.cols + x) * 4;
                const mapIndex = (y * lightMap.cols + x) * 3;
                for (let channel = 0; channel < 3; channel++) {
                    const light = lightMap.data[mapIndex + (2 - channel)];
                    products[channel] += source[sourceIndex + channel] * sourceScale * light;
                    squares[channel] += light * light;
                }
            }
        }
    });
    return products.map((value, channel) => value / squares[channel]);
}

function cubicHermite(value, startX, startY, endX, endY, startSlope, endSlope) {
    const span = endX - startX;
    const t = Math.max(0, Math.min(1, (value - startX) / span));
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * startY + (t3 - 2 * t2 + t) * span * startSlope +
        (-2 * t3 + 3 * t2) * endY + (t3 - t2) * span * endSlope;
}

export function applyBrightnessWithLightMap(srcMat, lightMap, options = {}) {
    const mode = options.mode || 'white';
    const points = options.referencePoints || [];
    const radius = options.referenceRadius || 0;
    const targets = options.targetColors || {};
    const resized = new cv.Mat();
    cv.resize(lightMap, resized, new cv.Size(srcMat.cols, srcMat.rows), 0, 0, cv.INTER_CUBIC);
    const sourceScale = isFloatMat(srcMat) ? 255 : 1;
    const source = isFloatMat(srcMat) ? srcMat.data32F : srcMat.data;
    const result = new cv.Mat(srcMat.rows, srcMat.cols, srcMat.type());
    const target = isFloatMat(srcMat) ? result.data32F : result.data;

    if (mode === 'white') {
        for (let pixel = 0; pixel < srcMat.rows * srcMat.cols; pixel++) {
            const sourceOffset = pixel * 4;
            const mapOffset = pixel * 3;
            for (let channel = 0; channel < 3; channel++) {
                const localLight = Math.max(LIGHTMAP_MIN_VALUE, resized.data[mapOffset + (2 - channel)]);
                target[sourceOffset + channel] = Math.max(0, Math.min(255, source[sourceOffset + channel] * sourceScale / localLight * 255)) / sourceScale;
            }
            target[sourceOffset + 3] = source[sourceOffset + 3];
        }
        resized.delete();
        return result;
    }

    const byType = { black: points.filter((point) => point.type === 'black'), paper: points.filter((point) => point.type === 'paper'), white: points.filter((point) => point.type === 'white') };
    if (!radius || Object.values(byType).some((items) => items.length === 0)) {
        resized.delete();
        result.delete();
        throw new Error('Добавьте эталон бумаги, чёрного и белого.');
    }
    const blackScale = fitReferenceScales(srcMat, resized, byType.black, radius, sourceScale);
    const paperScale = fitReferenceScales(srcMat, resized, byType.paper, radius, sourceScale);
    const whiteScale = fitReferenceScales(srcMat, resized, byType.white, radius, sourceScale);
    const blackTarget = targets.black || [0, 0, 0];
    const paperTarget = targets.paper || [255, 255, 255];
    const whiteTarget = targets.white || [255, 255, 255];

    for (let channel = 0; channel < 3; channel++) {
        if (!(blackScale[channel] < paperScale[channel] && paperScale[channel] < whiteScale[channel])) {
            resized.delete();
            result.delete();
            throw new Error('Эталоны должны удовлетворять: чёрный < бумага < белый.');
        }
    }

    for (let pixel = 0; pixel < srcMat.rows * srcMat.cols; pixel++) {
        for (let channel = 0; channel < 3; channel++) {
            const localLight = resized.data[pixel * 3 + (2 - channel)];
            const black = blackScale[channel] * localLight;
            const paper = paperScale[channel] * localLight;
            const white = whiteScale[channel] * localLight;
            const value = source[pixel * 4 + channel] * sourceScale;
            const lowerSlope = (paperTarget[channel] - blackTarget[channel]) / (paper - black);
            const upperSlope = (whiteTarget[channel] - paperTarget[channel]) / (white - paper);
            const paperSlope = 2 * lowerSlope * upperSlope / (lowerSlope + upperSlope);
            const corrected = value <= paper
                ? cubicHermite(value, black, blackTarget[channel], paper, paperTarget[channel], lowerSlope, paperSlope)
                : cubicHermite(value, paper, paperTarget[channel], white, whiteTarget[channel], paperSlope, upperSlope);
            target[pixel * 4 + channel] = Math.max(0, Math.min(255, corrected)) / sourceScale;
        }
        target[pixel * 4 + 3] = source[pixel * 4 + 3];
    }
    resized.delete();
    return result;
}
