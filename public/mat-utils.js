// Общие проверки глубины cv.Mat и конвертация в 8-битный формат для OpenCV-функций,
// которые не поддерживают float (findContours, threshold, adaptiveThreshold, inpaint).

export function isFloatMat(mat) {
    return mat.depth() === cv.CV_32F || mat.depth() === cv.CV_64F;
}

export function prepareFor8BitCv(srcMat) {
    if (!srcMat || srcMat.isDeleted()) return srcMat;
    if (srcMat.depth() === cv.CV_8U) return srcMat;

    const targetType = srcMat.channels() === 1
        ? cv.CV_8UC1
        : srcMat.channels() === 3
            ? cv.CV_8UC3
            : cv.CV_8UC4;

    const converted = new cv.Mat();
    srcMat.convertTo(converted, targetType, 255);
    return converted;
}
