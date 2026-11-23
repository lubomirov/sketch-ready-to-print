import { isFloatMat, prepareFor8BitCv } from './mat-utils.js';

const INPAINT_RADIUS = 25;
const LIGHTMAP_WORK_MIN_SIDE = 960;
const LIGHTMAP_MIN_VALUE = 24;
const PAPER_TEXTURE_PERCENTILE = 0.99;

function toOdd(value, min = 3) {
    const base = Math.max(min, Math.floor(value));
    return base % 2 === 0 ? base + 1 : base;
}

function samplePaperColor(source, cols, rows, point, radius) {
    const radiusSquared = radius * radius;
    const left = Math.max(0, Math.ceil(point.x - radius));
    const right = Math.min(cols - 1, Math.floor(point.x + radius));
    const top = Math.max(0, Math.ceil(point.y - radius));
    const bottom = Math.min(rows - 1, Math.floor(point.y + radius));
    const sum = [0, 0, 0];
    let pixelCount = 0;

    for (let y = top; y <= bottom; y++) {
        for (let x = left; x <= right; x++) {
            const dx = x - point.x;
            const dy = y - point.y;
            if (dx * dx + dy * dy > radiusSquared) continue;

            const offset = (y * cols + x) * 4;
            for (let channel = 0; channel < 3; channel++) {
                sum[channel] += source[offset + channel];
            }
            pixelCount++;
        }
    }

    if (pixelCount === 0) {
        throw new Error('Опорная точка бумаги находится за пределами изображения.');
    }
    return sum.map((value) => value / pixelCount);
}

export function estimatePaperTextureThreshold(srcMat, paperAnchors, radius) {
    if (paperAnchors.length === 0) {
        throw new Error('Сначала укажите хотя бы одну опорную точку бумаги.');
    }

    const sourceForMask = prepareFor8BitCv(srcMat);
    const source = sourceForMask.data;
    const distanceHistogram = new Uint32Array(256);
    let pixelCount = 0;

    try {
        paperAnchors.forEach((point) => {
            const mean = samplePaperColor(source, sourceForMask.cols, sourceForMask.rows, point, radius);
            const radiusSquared = radius * radius;
            const left = Math.max(0, Math.ceil(point.x - radius));
            const right = Math.min(sourceForMask.cols - 1, Math.floor(point.x + radius));
            const top = Math.max(0, Math.ceil(point.y - radius));
            const bottom = Math.min(sourceForMask.rows - 1, Math.floor(point.y + radius));

            for (let y = top; y <= bottom; y++) {
                for (let x = left; x <= right; x++) {
                    const dx = x - point.x;
                    const dy = y - point.y;
                    if (dx * dx + dy * dy > radiusSquared) continue;

                    const offset = (y * sourceForMask.cols + x) * 4;
                    let squaredDifference = 0;
                    for (let channel = 0; channel < 3; channel++) {
                        const difference = source[offset + channel] - mean[channel];
                        squaredDifference += difference * difference;
                    }
                    const distance = Math.min(255, Math.ceil(Math.sqrt(squaredDifference / 3)));
                    distanceHistogram[distance]++;
                    pixelCount++;
                }
            }
        });
    } finally {
        if (sourceForMask !== srcMat) sourceForMask.delete();
    }

    if (pixelCount === 0) {
        throw new Error('Не удалось получить пиксели из опорных областей бумаги.');
    }

    const percentileTarget = Math.ceil(pixelCount * PAPER_TEXTURE_PERCENTILE);
    let cumulativeCount = 0;
    let threshold = 255;
    for (let distance = 0; distance < distanceHistogram.length; distance++) {
        cumulativeCount += distanceHistogram[distance];
        if (cumulativeCount >= percentileTarget) {
            threshold = distance;
            break;
        }
    }
    return Math.max(5, threshold);
}

export function buildBlankPaperMask(srcMat, primaryPaperMap, threshold) {
    if (!Number.isFinite(threshold) || threshold < 1 || threshold > 255) {
        throw new Error('Порог отличия RGB должен быть от 1 до 255.');
    }

    if (!primaryPaperMap || primaryPaperMap.channels() !== 3) {
        throw new Error('Предварительная карта бумаги недоступна.');
    }

    const sourceForMask = prepareFor8BitCv(srcMat);
    const expectedPaper = new cv.Mat();
    try {
        cv.resize(primaryPaperMap, expectedPaper, new cv.Size(sourceForMask.cols, sourceForMask.rows), 0, 0, cv.INTER_LINEAR);
        const mask = cv.Mat.zeros(sourceForMask.rows, sourceForMask.cols, cv.CV_8UC1);
        const source = sourceForMask.data;
        const expected = expectedPaper.data;
        const thresholdSquared = 3 * threshold * threshold;
        for (let pixel = 0; pixel < sourceForMask.rows * sourceForMask.cols; pixel++) {
            const sourceOffset = pixel * 4;
            const expectedOffset = pixel * 3;
            let squaredDifference = 0;
            for (let channel = 0; channel < 3; channel++) {
                const difference = source[sourceOffset + channel] - expected[expectedOffset + channel];
                squaredDifference += difference * difference;
            }
            mask.data[pixel] = squaredDifference > thresholdSquared ? 255 : 0;
        }
        return mask;
    } finally {
        expectedPaper.delete();
        if (sourceForMask !== srcMat) sourceForMask.delete();
    }
}

export function buildPrimaryPaperMap(srcMat, paperAnchors, radius) {
    if (paperAnchors.length === 0) {
        throw new Error('Сначала укажите хотя бы одну опорную точку бумаги.');
    }

    const sourceForMap = prepareFor8BitCv(srcMat);
    const source = sourceForMap.data;
    const minSide = Math.min(sourceForMap.cols, sourceForMap.rows);
    const workScale = Math.min(1, LIGHTMAP_WORK_MIN_SIDE / minSide);
    const workWidth = Math.max(1, Math.round(sourceForMap.cols * workScale));
    const workHeight = Math.max(1, Math.round(sourceForMap.rows * workScale));
    const scaleX = sourceForMap.cols > 1 ? (workWidth - 1) / (sourceForMap.cols - 1) : 1;
    const scaleY = sourceForMap.rows > 1 ? (workHeight - 1) / (sourceForMap.rows - 1) : 1;
    const samples = paperAnchors.map((point) => ({
        x: point.x * scaleX,
        y: point.y * scaleY,
        color: samplePaperColor(source, sourceForMap.cols, sourceForMap.rows, point, radius)
    }));
    const paperMap = new cv.Mat(workHeight, workWidth, cv.CV_8UC3);

    for (let y = 0; y < workHeight; y++) {
        for (let x = 0; x < workWidth; x++) {
            const weights = [0, 0, 0];
            let totalWeight = 0;
            let exactSample = null;

            samples.forEach((sample) => {
                const dx = x - sample.x;
                const dy = y - sample.y;
                const distanceSquared = dx * dx + dy * dy;
                if (distanceSquared < 1e-6) {
                    exactSample = sample.color;
                    return;
                }

                const weight = 1 / distanceSquared;
                totalWeight += weight;
                for (let channel = 0; channel < 3; channel++) {
                    weights[channel] += sample.color[channel] * weight;
                }
            });

            const color = exactSample || weights.map((value) => value / totalWeight);
            const offset = (y * workWidth + x) * 3;
            paperMap.data[offset] = Math.round(color[0]);
            paperMap.data[offset + 1] = Math.round(color[1]);
            paperMap.data[offset + 2] = Math.round(color[2]);
        }
    }

    if (sourceForMap !== srcMat) sourceForMap.delete();
    return paperMap;
}

export function buildRefinedLightMap(srcMat, primaryPaperMap, sheetMask) {
    if (!primaryPaperMap || primaryPaperMap.channels() !== 3) {
        throw new Error('Предварительная карта бумаги недоступна.');
    }
    if (!sheetMask || sheetMask.channels() !== 1) {
        throw new Error('Маска не-бумажных пикселей недоступна.');
    }

    const sourceForLightMap = prepareFor8BitCv(srcMat);
    const sourceRgb = new cv.Mat();
    const workSource = new cv.Mat();
    const workPrimaryPaper = new cv.Mat();
    const workMask = new cv.Mat();
    const residual = new cv.Mat();
    const filledResidual = new cv.Mat();
    const smoothedResidual = new cv.Mat();
    const refinedWorkMap = new cv.Mat();
    const refinedPaperMap = new cv.Mat();
    const lightMap = new cv.Mat();
    const minSide = Math.min(sourceForLightMap.cols, sourceForLightMap.rows);
    const workScale = Math.min(1, LIGHTMAP_WORK_MIN_SIDE / minSide);
    const workSize = new cv.Size(Math.max(1, Math.round(sourceForLightMap.cols * workScale)), Math.max(1, Math.round(sourceForLightMap.rows * workScale)));
    let succeeded = false;

    try {
        cv.cvtColor(sourceForLightMap, sourceRgb, cv.COLOR_RGBA2RGB);
        cv.resize(sourceRgb, workSource, workSize, 0, 0, cv.INTER_AREA);
        cv.resize(primaryPaperMap, workPrimaryPaper, workSize, 0, 0, cv.INTER_LINEAR);
        cv.resize(sheetMask, workMask, workSize, 0, 0, cv.INTER_NEAREST);

        const source = workSource.data;
        const primary = workPrimaryPaper.data;
        const mask = workMask.data;
        residual.create(workSize.height, workSize.width, cv.CV_8UC3);
        // Encode signed residuals around 128 because OpenCV inpaint operates on 8-bit channels.
        let paperPixelCount = 0;
        let maskedPixelCount = 0;

        for (let pixel = 0; pixel < workSize.width * workSize.height; pixel++) {
            const offset = pixel * 3;
            if (mask[pixel] !== 0) {
                maskedPixelCount++;
                residual.data[offset] = 128;
                residual.data[offset + 1] = 128;
                residual.data[offset + 2] = 128;
                continue;
            }

            paperPixelCount++;
            for (let channel = 0; channel < 3; channel++) {
                const difference = source[offset + channel] - primary[offset + channel];
                residual.data[offset + channel] = Math.max(0, Math.min(255, Math.round(128 + difference * 127 / 255)));
            }
        }

        if (paperPixelCount === 0) {
            throw new Error('Маска полностью закрывает изображение. Оставьте чистую бумагу вне маски.');
        }
        if (maskedPixelCount > 0) {
            cv.inpaint(
                residual,
                workMask,
                filledResidual,
                Math.max(3, Math.round(INPAINT_RADIUS * workScale)),
                cv.INPAINT_TELEA
            );
        } else {
            residual.copyTo(filledResidual);
        }

        const workMinSide = Math.min(workSize.width, workSize.height);
        const blurSize = toOdd(Math.max(41, workMinSide / 6), 3);
        cv.GaussianBlur(
            filledResidual,
            smoothedResidual,
            new cv.Size(blurSize, blurSize),
            0
        );

        const smoothed = smoothedResidual.data;
        refinedWorkMap.create(workSize.height, workSize.width, cv.CV_8UC3);
        for (let pixel = 0; pixel < workSize.width * workSize.height; pixel++) {
            const offset = pixel * 3;
            for (let channel = 0; channel < 3; channel++) {
                const residualValue = (smoothed[offset + channel] - 128) * 255 / 127;
                refinedWorkMap.data[offset + channel] = Math.max(
                    0,
                    Math.min(255, Math.round(primary[offset + channel] + residualValue))
                );
            }
        }

        cv.resize(
            refinedWorkMap,
            refinedPaperMap,
            new cv.Size(sourceForLightMap.cols, sourceForLightMap.rows),
            0,
            0,
            cv.INTER_CUBIC
        );
        cv.cvtColor(refinedPaperMap, lightMap, cv.COLOR_RGB2BGR);
        succeeded = true;
        return { lightMap, previewMap: refinedPaperMap };
    } finally {
        sourceRgb.delete();
        workSource.delete();
        workPrimaryPaper.delete();
        workMask.delete();
        residual.delete();
        filledResidual.delete();
        smoothedResidual.delete();
        refinedWorkMap.delete();
        if (!succeeded) {
            refinedPaperMap.delete();
            lightMap.delete();
        }
        if (sourceForLightMap !== srcMat) sourceForLightMap.delete();
    }
}

export function applyBrightnessWithLightMap(srcMat, lightMap, targetPaperColor = [255, 255, 255]) {
    const resized = new cv.Mat();
    cv.resize(lightMap, resized, new cv.Size(srcMat.cols, srcMat.rows), 0, 0, cv.INTER_CUBIC);
    const sourceScale = isFloatMat(srcMat) ? 255 : 1;
    const source = isFloatMat(srcMat) ? srcMat.data32F : srcMat.data;
    const result = new cv.Mat(srcMat.rows, srcMat.cols, srcMat.type());
    const target = isFloatMat(srcMat) ? result.data32F : result.data;

    for (let pixel = 0; pixel < srcMat.rows * srcMat.cols; pixel++) {
        const sourceOffset = pixel * 4;
        const mapOffset = pixel * 3;
        for (let channel = 0; channel < 3; channel++) {
            const localLight = Math.max(LIGHTMAP_MIN_VALUE, resized.data[mapOffset + (2 - channel)]);
            const corrected = source[sourceOffset + channel] * sourceScale / localLight * targetPaperColor[channel];
            target[sourceOffset + channel] = Math.max(0, Math.min(255, corrected)) / sourceScale;
        }
        target[sourceOffset + 3] = source[sourceOffset + 3];
    }
    resized.delete();
    return result;
}
