import { findCorners, findCurvedEdges, rectifyCurvedEdges, transformPerspective } from './geometry.js';
import { applyBrightnessWithLightMap, buildNormalizedLightMap, buildSheetMask } from './filters.js';
import { createUi, getMousePosition, initTabs, renderCornersOverlay, renderCurvedEdgesOverlay, renderMaskOverlay } from './ui.js';

let currentMat = null;
let corners = [];
let edgePoints = [];
let dragIdx = -1;
let sheetMask = null;
let lightMap = null;
let normalizedLightMap = null;
let maskPainting = false;
let maskPaintMode = 'add';
let lastMaskPoint = null;
let referencePointEditing = false;
let referencePoints = [];
let draggedReferencePointIndex = -1;
let originalFileName = 'image';
let outputImageDataUrl = '';

const state = {
    imageLoaded: false,
    cornersChecked: false,
    cornersFound: false,
    curvesReady: false,
    maskEditing: false,
    busy: false
};

const { elements, syncUi: syncUiElements } = createUi({
    onReferenceRadiusInput: () => {
        if (state.maskEditing) renderMaskEditView();
    }
});
const {
    canvas, opencvStatus, fileInput, findCornersBtn, cornersStatus, fixGeometryBtn,
    findCurvedEdgesBtn, curvedInfo, fixCurvedEdgesBtn, detectSheetMaskBtn,
    recalcLightMapBtn, normalizeBrightnessBtn, saveBtn, maskAddBtn, maskEraseBtn,
    maskBrushSize, addReferencePointBtn, referenceRadius, referenceStats,
    paperColorPicker, lightMapCanvas, inputFilename, processStatus, marginInput
} = elements;
const ctxInput = canvas.getContext('2d');

function syncUi() {
    syncUiElements(state, {
        hasSheetMask: Boolean(sheetMask),
        hasLightMap: Boolean(lightMap),
        canSave: Boolean(outputImageDataUrl)
    });
}

function resetGeometryState() {
    corners = [];
    edgePoints = [];
    dragIdx = -1;
    state.cornersChecked = false;
    state.cornersFound = false;
    state.curvesReady = false;
}

function setMaskPaintMode(mode) {
    maskPaintMode = mode === 'erase' ? 'erase' : 'add';
    maskAddBtn.classList.toggle('active', maskPaintMode === 'add');
    maskEraseBtn.classList.toggle('active', maskPaintMode === 'erase');
}

function setReferencePointEditing(enabled) {
    referencePointEditing = enabled;
    addReferencePointBtn.classList.toggle('reference-active', enabled);
    addReferencePointBtn.textContent = enabled ? 'Добавление точек: включено' : 'Добавить эталонную точку';
}

function clearMaskMat() {
    if (sheetMask) {
        sheetMask.delete();
        sheetMask = null;
    }
}

function clearLightMapMat() {
    if (lightMap) {
        lightMap.delete();
        lightMap = null;
    }
    if (normalizedLightMap) {
        normalizedLightMap.delete();
        normalizedLightMap = null;
    }
}

function clearLightMapView() {
    if (!lightMapCanvas) return;
    lightMapCanvas.width = 1;
    lightMapCanvas.height = 1;
    const ctx = lightMapCanvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, 1, 1);
}

function renderLightMapView() {
    if (!lightMapCanvas || !normalizedLightMap) {
        clearLightMapView();
        return;
    }

    lightMapCanvas.width = normalizedLightMap.cols;
    lightMapCanvas.height = normalizedLightMap.rows;
    cv.imshow(lightMapCanvas, normalizedLightMap);
}

function cancelBrightnessEditState() {
    clearMaskMat();
    clearLightMapMat();
    state.maskEditing = false;
    maskPainting = false;
    lastMaskPoint = null;
    setReferencePointEditing(false);
    referencePoints = [];
    draggedReferencePointIndex = -1;
    setMaskPaintMode('add');
    clearLightMapView();
}

function renderMaskEditView() {
    if (!currentMat) return;
    if (state.maskEditing && sheetMask) {
        renderMaskOverlay(canvas, ctxInput, currentMat, sheetMask, 0.5);
        renderReferencePoints();
        updateReferenceStats();
        renderLightMapView();
        return;
    }
    clearLightMapView();
    renderRawCanvas();
}

function getReferenceRadius() {
    const value = parseInt(referenceRadius.value, 10) || 50;
    return Math.max(1, value);
}

function formatRgb(rgb) {
    return `${rgb[0]}-${rgb[1]}-${rgb[2]}`;
}

function getBrightness(rgb) {
    return Math.round((rgb[0] + rgb[1] + rgb[2]) / 3);
}

function parseHexColor(hexColor) {
    return [
        parseInt(hexColor.slice(1, 3), 16),
        parseInt(hexColor.slice(3, 5), 16),
        parseInt(hexColor.slice(5, 7), 16)
    ];
}

function getPixelsInReferenceCircle(point, radius, visitPixel) {
    const radiusSquared = radius * radius;
    const left = Math.max(0, Math.ceil(point.x - radius));
    const right = Math.min(currentMat.cols - 1, Math.floor(point.x + radius));
    const top = Math.max(0, Math.ceil(point.y - radius));
    const bottom = Math.min(currentMat.rows - 1, Math.floor(point.y + radius));

    for (let y = top; y <= bottom; y++) {
        for (let x = left; x <= right; x++) {
            const dx = x - point.x;
            const dy = y - point.y;
            if (dx * dx + dy * dy <= radiusSquared) visitPixel(x, y);
        }
    }
}

function getNormalizedLightMapAverage(point, radius) {
    if (!normalizedLightMap) return null;

    const scaleX = normalizedLightMap.cols / currentMat.cols;
    const scaleY = normalizedLightMap.rows / currentMat.rows;
    const mapCenterX = point.x * scaleX;
    const mapCenterY = point.y * scaleY;
    const mapRadiusX = Math.max(1, radius * scaleX);
    const mapRadiusY = Math.max(1, radius * scaleY);
    const left = Math.max(0, Math.ceil(mapCenterX - mapRadiusX));
    const right = Math.min(normalizedLightMap.cols - 1, Math.floor(mapCenterX + mapRadiusX));
    const top = Math.max(0, Math.ceil(mapCenterY - mapRadiusY));
    const bottom = Math.min(normalizedLightMap.rows - 1, Math.floor(mapCenterY + mapRadiusY));
    let sum = 0;
    let pixelCount = 0;

    for (let y = top; y <= bottom; y++) {
        for (let x = left; x <= right; x++) {
            const dx = (x - mapCenterX) / mapRadiusX;
            const dy = (y - mapCenterY) / mapRadiusY;
            if (dx * dx + dy * dy > 1) continue;
            sum += normalizedLightMap.data[y * normalizedLightMap.cols + x];
            pixelCount++;
        }
    }

    return pixelCount > 0 ? Math.round(sum / pixelCount) : null;
}

function updateReferenceStats() {
    if (!referenceStats) return;
    if (!currentMat || referencePoints.length === 0) {
        referenceStats.innerHTML = '<div class="reference-stats-summary">Точек: 0; диапазон: -; среднее: -</div>';
        return;
    }

    const radius = getReferenceRadius();
    const minimum = [255, 255, 255];
    const maximum = [0, 0, 0];
    const sum = [0, 0, 0];
    let pixelCount = 0;

    const pointStats = referencePoints.map((point) => {
        const pointSum = [0, 0, 0];
        let pointPixelCount = 0;

        getPixelsInReferenceCircle(point, radius, (x, y) => {
            const pixelIndex = (y * currentMat.cols + x) * 4;
            for (let channel = 0; channel < 3; channel++) {
                const value = currentMat.data[pixelIndex + channel];
                minimum[channel] = Math.min(minimum[channel], value);
                maximum[channel] = Math.max(maximum[channel], value);
                sum[channel] += value;
                pointSum[channel] += value;
            }
            pixelCount++;
            pointPixelCount++;
        });

        return {
            rgb: pointSum.map((value) => Math.round(value / pointPixelCount)),
            lightMap: getNormalizedLightMapAverage(point, radius)
        };
    });

    const average = sum.map((value) => Math.round(value / pixelCount));
    const pointRows = pointStats.map((stats, index) => {
        const mapValue = stats.lightMap === null ? 'карта: -' : `карта: ${stats.lightMap}`;
        return `<li>яркость: ${getBrightness(stats.rgb)}; ${mapValue}</li>`;
    }).join('');
    referenceStats.innerHTML = `
        <div class="reference-stats-summary">Точек: ${referencePoints.length}; диапазон: от ${formatRgb(minimum)} до ${formatRgb(maximum)}; среднее: ${formatRgb(average)}</div>
        <ol class="reference-stats-points">${pointRows}</ol>
    `;
}

function renderReferencePoints() {
    const radius = getReferenceRadius();
    ctxInput.save();
    ctxInput.lineWidth = Math.max(2, canvas.width / 800);
    ctxInput.strokeStyle = '#2f76d2';
    ctxInput.fillStyle = '#2f76d2';

    referencePoints.forEach((point) => {
        ctxInput.beginPath();
        ctxInput.arc(point.x, point.y, radius, 0, 2 * Math.PI);
        ctxInput.stroke();
        ctxInput.beginPath();
        ctxInput.arc(point.x, point.y, Math.max(4, radius / 8), 0, 2 * Math.PI);
        ctxInput.fill();
    });

    ctxInput.restore();
}

function moveDraggedReferencePoint(event) {
    if (!currentMat || state.busy || draggedReferencePointIndex === -1) return;
    referencePoints[draggedReferencePointIndex] = getMousePosition(canvas, event);
    renderMaskEditView();
}

function getBrushRadius() {
    const value = parseInt(maskBrushSize.value, 10) || 14;
    return Math.max(1, value);
}

function paintMaskStroke(from, to) {
    if (!sheetMask) return;
    const radius = getBrushRadius();
    const maskValue = maskPaintMode === 'erase' ? 0 : 255;
    const color = new cv.Scalar(maskValue);

    cv.line(
        sheetMask,
        new cv.Point(Math.round(from.x), Math.round(from.y)),
        new cv.Point(Math.round(to.x), Math.round(to.y)),
        color,
        radius * 2,
        cv.LINE_AA,
        0
    );
    cv.circle(
        sheetMask,
        new cv.Point(Math.round(to.x), Math.round(to.y)),
        radius,
        color,
        -1,
        cv.LINE_AA,
        0
    );
}

function renderRawCanvas() {
    if (!currentMat) return;

    ctxInput.clearRect(0, 0, canvas.width, canvas.height);
    cv.imshow(canvas.id, currentMat);
}

function setCurrentMat(nextMat) {
    if (currentMat) currentMat.delete();
    currentMat = nextMat;
    canvas.width = currentMat.cols;
    canvas.height = currentMat.rows;
}

function updateSaveData() {
    if (!currentMat) {
        outputImageDataUrl = '';
        syncUi();
        return;
    }

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = currentMat.cols;
    exportCanvas.height = currentMat.rows;
    cv.imshow(exportCanvas, currentMat);
    outputImageDataUrl = exportCanvas.toDataURL('image/png');
    syncUi();
}

function runStep(statusText, action) {
    if (!currentMat) return;

    state.busy = true;
    processStatus.innerText = statusText;
    syncUi();

    setTimeout(() => {
        try {
            action();
            processStatus.innerText = 'Готово!';
        } catch (error) {
            processStatus.innerText = `Ошибка: ${error.message || error}`;
        } finally {
            state.busy = false;
            syncUi();
        }
    }, 50);
}

saveBtn.addEventListener('click', () => {
    if (!outputImageDataUrl) return;

    const fileStem = originalFileName.replace(/\.[^.]+$/, '') || 'image';
    const downloadAnchor = document.createElement('a');
    downloadAnchor.href = outputImageDataUrl;
    downloadAnchor.download = `${fileStem}.png`;
    downloadAnchor.click();
});

// Проверка готовности OpenCV
const checkOpenCv = setInterval(() => {
    if (typeof window.cv !== 'undefined' && window.cv.Mat) {
        clearInterval(checkOpenCv);
        if (opencvStatus) {
            opencvStatus.classList.add('ready');
            opencvStatus.title = 'OpenCV готов';
        }
        fileInput.disabled = false;
    }
}, 100);

// Загрузка файла
fileInput.addEventListener('change', (e) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !(files[0] instanceof Blob)) return;
    originalFileName = files[0].name || 'image';
    if (inputFilename) inputFilename.innerText = originalFileName;

    const reader = new FileReader();
    reader.onload = function(event) {
        const img = new Image();
        img.onload = function() {
            canvas.width = img.width;
            canvas.height = img.height;
            ctxInput.drawImage(img, 0, 0);

            const loadedMat = cv.imread(canvas);
            setCurrentMat(loadedMat);

            state.imageLoaded = true;
            resetGeometryState();
            cancelBrightnessEditState();
            renderRawCanvas();
            updateSaveData();
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(files[0]);
});

findCornersBtn.addEventListener('click', () => {
    if (!currentMat) return;
    cancelBrightnessEditState();

    runStep('Поиск углов...', () => {
        const result = findCorners(currentMat, currentMat.cols, currentMat.rows);
        corners = result.corners;
        edgePoints = [];
        state.cornersChecked = true;
        state.cornersFound = corners.length === 4;
        state.curvesReady = false;

        cornersStatus.innerText = (result.found ? 'Углы найдены автоматически' : 'Автопоиск не нашел углы, используется fallback') +
            '; Перетащите зеленые кружочки';

        renderRawCanvas();
        renderCornersOverlay(canvas, ctxInput, currentMat, corners);
    });
});

// Клик по кнопке "Выпрямить перспективу" с асинхронным статус-баром
fixGeometryBtn.addEventListener('click', () => {
    if (!currentMat || !state.cornersFound) return;
    cancelBrightnessEditState();

    runStep('Выпрямление геометрии...', () => {
        const margin = parseInt(marginInput.value, 10) || 0;
        const warpedMat = transformPerspective(currentMat, corners, margin);
        setCurrentMat(warpedMat);
        resetGeometryState();
        renderRawCanvas();
        updateSaveData();
    });
});

findCurvedEdgesBtn.addEventListener('click', () => {
    if (!currentMat) return;
    cancelBrightnessEditState();

    runStep('Поиск искривлений...', () => {
        const result = findCurvedEdges(currentMat, currentMat.cols, currentMat.rows);
        corners = result.corners;
        edgePoints = result.edgePoints;
        state.curvesReady = result.found && result.edgePoints.some(side => side.length > 0);
        curvedInfo.innerText = 'Отрезки означают смещения граней к ровной линии';

        renderRawCanvas();
        renderCurvedEdgesOverlay(canvas, ctxInput, currentMat, corners, edgePoints);
    });
});

fixCurvedEdgesBtn.addEventListener('click', () => {
    if (!currentMat || !state.curvesReady) return;
    cancelBrightnessEditState();

    runStep('Исправление кривых граней...', () => {
        const correctedMat = rectifyCurvedEdges(currentMat, corners, edgePoints);
        setCurrentMat(correctedMat);
        resetGeometryState();
        renderRawCanvas();
        updateSaveData();
    });
});

// Клик по кнопке "Определить маску фона"
detectSheetMaskBtn.addEventListener('click', () => {
    if (!currentMat) return;

    runStep('Определение маски фона...', () => {
        clearMaskMat();
        clearLightMapMat();
        sheetMask = buildSheetMask(currentMat);
        state.maskEditing = true;
        referencePoints = [];
        setReferencePointEditing(false);
        setMaskPaintMode('add');
        renderMaskEditView();
    });
});

recalcLightMapBtn.addEventListener('click', () => {
    if (!currentMat || !sheetMask) return;

    runStep('Пересчет карты освещенности...', () => {
        clearLightMapMat();
        const lightMaps = buildNormalizedLightMap(currentMat, sheetMask);
        lightMap = lightMaps.lightMap;
        normalizedLightMap = lightMaps.normalizedLightMap;
        updateReferenceStats();
        renderLightMapView();
    });
});

// Клик по кнопке "Нормализовать яркость"
normalizeBrightnessBtn.addEventListener('click', () => {
    if (!currentMat || !lightMap) return;

    runStep('Выравнивание яркости...', () => {
        const finalMat = applyBrightnessWithLightMap(
            currentMat,
            lightMap,
            referencePoints,
            getReferenceRadius(),
            parseHexColor(paperColorPicker.value)
        );
        setCurrentMat(finalMat);
        resetGeometryState();
        cancelBrightnessEditState();
        renderRawCanvas();
        updateSaveData();
    });
});

maskAddBtn.addEventListener('click', () => {
    if (!state.maskEditing) return;
    setMaskPaintMode('add');
});

maskEraseBtn.addEventListener('click', () => {
    if (!state.maskEditing) return;
    setMaskPaintMode('erase');
});

addReferencePointBtn.addEventListener('click', () => {
    if (!state.maskEditing) return;
    setReferencePointEditing(!referencePointEditing);
});

// Интерактивное управление маркерами
canvas.addEventListener('mousedown', (e) => {
    if (!currentMat || state.busy) return;

    if (state.maskEditing && sheetMask) {
        const pos = getMousePosition(canvas, e);
        if (referencePointEditing) {
            const hitRadius = getReferenceRadius();
            draggedReferencePointIndex = referencePoints.findIndex((point) => Math.hypot(point.x - pos.x, point.y - pos.y) <= hitRadius);
            if (draggedReferencePointIndex === -1) {
                referencePoints.push(pos);
                draggedReferencePointIndex = referencePoints.length - 1;
            }
            renderMaskEditView();
            return;
        }
        if (lightMap || normalizedLightMap) {
            clearLightMapMat();
            clearLightMapView();
            syncUi();
        }
        maskPainting = true;
        lastMaskPoint = pos;
        paintMaskStroke(pos, pos);
        renderMaskEditView();
        return;
    }

    if (!currentMat || !state.cornersFound || state.busy) return;
    const pos = getMousePosition(canvas, e);
    const clickRadius = Math.max(20, canvas.width / 40);
    dragIdx = corners.findIndex(p => Math.hypot(p.x - pos.x, p.y - pos.y) < clickRadius);
});

canvas.addEventListener('mousemove', (e) => {
    if (!currentMat || state.busy) return;

    if (state.maskEditing && referencePointEditing && draggedReferencePointIndex !== -1) {
        moveDraggedReferencePoint(e);
        return;
    }

    if (state.maskEditing && sheetMask && maskPainting) {
        const pos = getMousePosition(canvas, e);
        paintMaskStroke(lastMaskPoint || pos, pos);
        lastMaskPoint = pos;
        renderMaskEditView();
        return;
    }

    if (dragIdx === -1 || !currentMat || !state.cornersFound || state.busy) return;
    const pos = getMousePosition(canvas, e);
    corners[dragIdx].x = pos.x;
    corners[dragIdx].y = pos.y;
    state.curvesReady = false;
    renderRawCanvas();
    renderCornersOverlay(canvas, ctxInput, currentMat, corners);
    syncUi();
});

window.addEventListener('mousemove', (e) => {
    if (!state.maskEditing || !referencePointEditing || draggedReferencePointIndex === -1) return;
    moveDraggedReferencePoint(e);
});

window.addEventListener('mouseup', () => {
    if (draggedReferencePointIndex !== -1) {
        const point = referencePoints[draggedReferencePointIndex];
        if (point.x < 0 || point.x >= canvas.width || point.y < 0 || point.y >= canvas.height) {
            referencePoints.splice(draggedReferencePointIndex, 1);
            renderMaskEditView();
        }
    }
    dragIdx = -1;
    draggedReferencePointIndex = -1;
    maskPainting = false;
    lastMaskPoint = null;
});

syncUi();
initTabs();
