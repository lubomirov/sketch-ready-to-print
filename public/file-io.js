/**
 * Модуль чтения и записи файлов (изображения, lightmap, экспорт).
 */

/**
 * Загружает исходное изображение из File/Blob и возвращает готовую RGBA матрицу cv.Mat.
 * @param {File|Blob} file
 * @returns {Promise<{ mat: cv.Mat, fileName: string, width: number, height: number }>}
 */
export function normalizeToFloatWorkingMat(mat) {
    if (!mat || mat.isDeleted()) {
        throw new Error('Matrix is empty or deleted');
    }

    if (mat.depth() === cv.CV_32F || mat.depth() === cv.CV_64F) {
        return mat;
    }

    const floatMat = new cv.Mat();
    mat.convertTo(floatMat, cv.CV_32F, 1 / 255);
    return floatMat;
}

export function toDisplayUint8Mat(mat) {
    if (!mat || mat.isDeleted()) {
        throw new Error('Matrix is empty or deleted');
    }

    if (mat.depth() === cv.CV_8U) {
        return mat;
    }

    const displayMat = new cv.Mat();
    const targetType = mat.channels() === 1
        ? cv.CV_8UC1
        : mat.channels() === 3
            ? cv.CV_8UC3
            : cv.CV_8UC4;

    mat.convertTo(displayMat, targetType, 255);
    return displayMat;
}

export async function loadImageFromFile(file) {
    if (!file || !(file instanceof Blob)) {
        throw new Error('Incorrect file for loading');
    }

    const fileName = file.name || 'image.png';

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const offscreenCanvas = document.createElement('canvas');
                offscreenCanvas.width = img.width;
                offscreenCanvas.height = img.height;
                const ctx = offscreenCanvas.getContext('2d');
                ctx.drawImage(img, 0, 0);

                const mat = cv.imread(offscreenCanvas);
                const workingMat = normalizeToFloatWorkingMat(mat);
                if (workingMat !== mat) mat.delete();
                resolve({
                    mat: workingMat,
                    fileName,
                    width: img.width,
                    height: img.height
                });
            };
            img.onerror = (err) => reject(new Error('Failed to decode image: ' + err));
            img.src = event.target.result;
        };
        reader.onerror = (err) => reject(new Error('Failed to read file: ' + err));
        reader.readAsDataURL(file);
    });
}

function triggerDownload(dataUrl, fileName) {
    const anchor = document.createElement('a');
    anchor.href = dataUrl;
    anchor.download = fileName || 'download';
    anchor.click();
}

/**
 * Сохраняет cv.Mat как PNG файл.
 * @param {cv.Mat} mat
 * @param {string} fileName
 */
export function saveImageToFile(mat, fileName = 'result.png') {
    if (!mat || mat.isDeleted()) {
        throw new Error('Matrix is empty or deleted');
    }

    const exportMat = toDisplayUint8Mat(mat);

    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = exportMat.cols;
    offscreenCanvas.height = exportMat.rows;
    cv.imshow(offscreenCanvas, exportMat);

    const dataUrl = offscreenCanvas.toDataURL('image/png');
    triggerDownload(dataUrl, fileName);

    if (exportMat !== mat) exportMat.delete();
}

/**
 * Экспортирует карту освещенности (LightMap) и маску источника в RGBA PNG.
 * R, G, B — каналы освещенности бумаги,
 * A — происхождение данных (255 = измеренный фон страницы, 0 = область штрихов / inpaint).
 * @param {cv.Mat} lightMapMat   BGR карта освещенности (CV_8UC3)
 * @param {cv.Mat} [sheetMaskMat] Маска штрихов (CV_8UC1, 255 = штрих/inpaint, 0 = фон)
 * @param {string} fileName
 */
export function saveLightmapToFile(lightMapMat, sheetMaskMat, fileName = 'lightmap.png') {
    if (!lightMapMat || lightMapMat.isDeleted()) {
        throw new Error('LightMap matrix is empty or deleted');
    }

    const width = lightMapMat.cols;
    const height = lightMapMat.rows;

    const rgbMat = new cv.Mat();
    if (lightMapMat.channels() === 3) {
        cv.cvtColor(lightMapMat, rgbMat, cv.COLOR_BGR2RGB);
    } else if (lightMapMat.channels() === 1) {
        cv.cvtColor(lightMapMat, rgbMat, cv.COLOR_GRAY2RGB);
    } else {
        lightMapMat.copyTo(rgbMat);
    }

    const channels = new cv.MatVector();
    cv.split(rgbMat, channels);

    // Подготовка альфа-канала
    const alphaMat = new cv.Mat(height, width, cv.CV_8UC1);
    if (sheetMaskMat && !sheetMaskMat.isDeleted()) {
        const resizedMask = new cv.Mat();
        cv.resize(sheetMaskMat, resizedMask, new cv.Size(width, height), 0, 0, cv.INTER_NEAREST);
        // Инвертируем: 0 в маске (фон) становится 255 (валидный фон), 255 (штрихи) становится 0
        cv.bitwise_not(resizedMask, alphaMat);
        resizedMask.delete();
    } else {
        alphaMat.setTo(new cv.Scalar(255));
    }

    channels.push_back(alphaMat);

    const rgbaMat = new cv.Mat();
    cv.merge(channels, rgbaMat);

    saveImageToFile(rgbaMat, fileName);

    rgbMat.delete();
    alphaMat.delete();
    channels.delete();
    rgbaMat.delete();
}

/**
 * Загружает карту освещенности из файла (RGBA PNG).
 * Распаковывает R, G, B в BGR lightMap, а Alpha в валидную маску фона.
 * @param {File|Blob} file
 * @param {{ width: number, height: number }} [targetSize] Опциональный размер для масштабирования
 * @returns {Promise<{ lightMap: cv.Mat, validMask: cv.Mat, width: number, height: number }>}
 */
export async function loadLightmapFromFile(file, targetSize) {
    const { mat: floatMat, width, height } = await loadImageFromFile(file);
    const rgbaMat = toDisplayUint8Mat(floatMat);
    if (rgbaMat !== floatMat) floatMat.delete();

    const finalWidth = targetSize ? targetSize.width : width;
    const finalHeight = targetSize ? targetSize.height : height;

    const workRgba = new cv.Mat();
    if (targetSize && (width !== targetSize.width || height !== targetSize.height)) {
        cv.resize(rgbaMat, workRgba, new cv.Size(finalWidth, finalHeight), 0, 0, cv.INTER_CUBIC);
    } else {
        rgbaMat.copyTo(workRgba);
    }

    const lightMap = new cv.Mat();
    cv.cvtColor(workRgba, lightMap, cv.COLOR_RGBA2BGR);

    // Извлекаем альфа-канал как валидную маску фона (255 = фон, 0 = inpaint)
    const validMask = new cv.Mat();
    const channels = new cv.MatVector();
    cv.split(workRgba, channels);
    if (channels.size() >= 4) {
        channels.get(3).copyTo(validMask);
    } else {
        validMask.create(finalHeight, finalWidth, cv.CV_8UC1);
        validMask.setTo(new cv.Scalar(255));
    }

    rgbaMat.delete();
    workRgba.delete();
    channels.delete();

    return {
        lightMap,
        validMask,
        width: finalWidth,
        height: finalHeight
    };
}
