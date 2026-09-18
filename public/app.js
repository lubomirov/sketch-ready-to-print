import { findCorners, findCurvedEdges, rectifyCurvedEdges, transformPerspective } from './geometry.js';
import { applyBrightnessWithLightMap, buildNormalizedLightMap, buildSheetMask } from './lightmap.js';
import { createUi, initTabs } from './ui.js';
import { renderCornersOverlay, renderCurvedEdgesOverlay, renderMaskOverlay, renderReferencePoints } from './renderers.js';
import { loadImageFromFile, saveImageToFile, saveLightmapToFile, loadLightmapFromFile, normalizeToFloatWorkingMat, toDisplayUint8Mat } from './file-io.js';
import { CanvasViewport } from './viewport.js';
import { GeometryTool, MaskTool, ReferenceTool } from './tools.js';
import { computeHistogram, renderHistogram, stretchBrightness } from './brightness.js';

let currentMat = null;
let corners = [];
let edgePoints = [];
let sheetMask = null;
let lightMap = null;
let normalizedLightMap = null;
let maskPaintMode = 'add';
let referencePointEditing = false;
let referencePoints = [];
let referencePointType = 'paper';
let paperMode = 'white';
let originalFileName = 'image';
let outputImageDataUrl = '';
let brightnessHistogram = null;
let maskRenderFrame = 0;

const state = {
    imageLoaded: false,
    cornersChecked: false,
    cornersFound: false,
    curvesReady: false,
    maskEditing: false,
    busy: false
};

const { elements, syncUi: syncUiControls } = createUi({
    onReferenceRadiusInput: () => {
        if (state.maskEditing) scheduleMaskEditView();
    }
});
const {
    canvasViewport, overlayCanvas, cursorCanvas, fitZoomBtn, actualZoomBtn,
    histogramCanvas, histogramStats, blackPointInput, whitePointInput, blackPointHint, whitePointHint,
    stretchBrightnessBtn,
    canvas, opencvStatus, fileInput, findCornersBtn, cornersStatus, fixGeometryBtn,
    geometryControls, findCurvedEdgesBtn, curvedInfo, fixCurvedEdgesBtn, detectSheetMaskBtn,
    recalcLightMapBtn, applyLightMapBtn, saveBtn, editMask, maskAddBtn, maskEraseBtn,
    maskBrushSize, maskBrushSizeValue, paperModeWhiteBtn, paperModeColorBtn,
    addReferencePointBtn, addBlackReferencePointBtn, addWhiteReferencePointBtn,
    referenceRadius, referenceRadiusValue, referenceStats,
    blackColorPicker, paperColorPicker, whiteColorPicker, lightMapZone, lightMapCanvas,
    inputFilename, processStatus, marginInput, marginValue
} = elements;
const viewport = new CanvasViewport(canvasViewport, canvas, overlayCanvas, cursorCanvas);
viewport.attachPan();
const overlayContext = viewport.getOverlayContext();
const maskTool = new MaskTool({
    getPosition: (event) => viewport.imagePointFromEvent(event),
    getRadius: () => getBrushRadius(),
    paint: (from, to) => paintMaskStroke(from, to),
    onChange: scheduleMaskEditView
});
const referenceTool = new ReferenceTool({
    getPosition: (event) => viewport.imagePointFromEvent(event),
    getRadius: () => getReferenceRadius(),
    points: referencePoints,
    getType: () => referencePointType,
    onChange: () => {
        scheduleMaskEditView();
        syncUi();
    }
});
const geometryTool = new GeometryTool({
    getPosition: (event) => viewport.imagePointFromEvent(event),
    getHitRadius: () => Math.max(20, viewport.imageWidth / 40),
    getPoints: () => corners,
    isEnabled: () => state.cornersFound && !state.maskEditing,
    onChange: () => {
        state.curvesReady = false;
        renderCornersOverlay(overlayCanvas, overlayContext, corners);
        syncUi();
    }
});

function setZoomMode(mode) {
    viewport.setZoomMode(mode);
    fitZoomBtn.classList.toggle('active', mode === 'fit');
    actualZoomBtn.classList.toggle('active', mode === 'actual');
}

fitZoomBtn.addEventListener('click', () => setZoomMode('fit'));
actualZoomBtn.addEventListener('click', () => setZoomMode('actual'));

window.addEventListener('resize', () => {
    if (viewport.mode === 'fit') setZoomMode('fit');
    if (currentMat) updateHistogramView();
});

// Синхронизация ползунков полей
marginInput.addEventListener('input', (e) => marginValue.value = e.target.value);
marginValue.addEventListener('input', (e) => marginInput.value = e.target.value);
maskBrushSize.addEventListener('input', (e) => maskBrushSizeValue.value = e.target.value);
maskBrushSizeValue.addEventListener('input', (e) => maskBrushSize.value = e.target.value);
function syncUi() {
    const hasAllReferenceTypes = ['paper', 'black', 'white'].every((type) => referencePoints.some((point) => point.type === type));
    syncUiControls(state, {
        hasSheetMask: Boolean(sheetMask),
        hasLightMap: Boolean(lightMap),
        paperMode,
        hasAllReferenceTypes,
        canSave: Boolean(outputImageDataUrl)
    });
}

function resetGeometryState() {
    corners = [];
    edgePoints = [];
    state.cornersChecked = false;
    state.cornersFound = false;
    state.curvesReady = false;
}

function setMaskPaintMode(mode) {
    maskPaintMode = mode === 'erase' ? 'erase' : 'add';
    maskAddBtn.classList.toggle('active', maskPaintMode === 'add');
    maskEraseBtn.classList.toggle('active', maskPaintMode === 'erase');
}

function setReferencePointEditing(enabled, type = referencePointType) {
    referencePointEditing = enabled;
    referencePointType = type;
    const buttons = [
        [addReferencePointBtn, 'paper'],
        [addBlackReferencePointBtn, 'black'],
        [addWhiteReferencePointBtn, 'white']
    ];
    buttons.forEach(([button, buttonType]) => {
        button.classList.toggle('reference-active', enabled && buttonType === type);
    });
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
    setReferencePointEditing(false);
    referencePoints.length = 0;
    setMaskPaintMode('add');
    clearLightMapView();
}

function renderActiveOverlay() {
    viewport.clearOverlay();
    if (!state.maskEditing || !sheetMask) return;

    renderMaskOverlay(overlayCanvas, overlayContext, sheetMask, 0.5);
    if (paperMode === 'colored') {
        renderReferencePoints(overlayCanvas, overlayContext, referencePoints, getReferenceRadius());
        updateReferenceStats();
    }
}

function renderMaskEditView() {
    if (!currentMat) return;
    renderActiveOverlay();
    syncUi();
}

function scheduleMaskEditView() {
    if (maskRenderFrame) return;
    maskRenderFrame = requestAnimationFrame(() => {
        maskRenderFrame = 0;
        renderMaskEditView();
    });
}

function updateHistogramView() {
    if (!currentMat || !histogramCanvas || !document.getElementById('tab-4')?.classList.contains('active')) return;
    brightnessHistogram = computeHistogram(currentMat);
    renderHistogram(histogramCanvas, brightnessHistogram);
    blackPointInput.value = brightnessHistogram.min;
    whitePointInput.value = brightnessHistogram.max;
    blackPointHint.textContent = `Хвост: ${brightnessHistogram.lowCut}`;
    whitePointHint.textContent = `Хвост: ${brightnessHistogram.highCut}`;

    histogramStats.innerHTML = brightnessHistogram.stats.map((stats, index) => {
        const label = brightnessHistogram.channelNames[index];
        return `
            <div class="histogram-stat">
                <strong>${label}</strong><br>
                min ${stats.min}<br>
                max ${stats.max}<br>
                mean ${Math.round(stats.mean)}<br>
                tail ${stats.lowCut}..${stats.highCut}
            </div>
        `;
    }).join('');
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
    const currentData = currentMat.depth() === cv.CV_32F || currentMat.depth() === cv.CV_64F
        ? currentMat.data32F
        : currentMat.data;

    const pointStats = referencePoints.map((point) => {
        const pointSum = [0, 0, 0];
        let pointPixelCount = 0;

        getPixelsInReferenceCircle(point, radius, (x, y) => {
            const pixelIndex = (y * currentMat.cols + x) * 4;
            for (let channel = 0; channel < 3; channel++) {
                const value = currentData[pixelIndex + channel] * (currentMat.depth() === cv.CV_32F || currentMat.depth() === cv.CV_64F ? 255 : 1);
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
        const typeLabels = { paper: 'бумага', black: 'чёрный', white: 'белый' };
        return `<li>${typeLabels[referencePoints[index].type]}: яркость ${getBrightness(stats.rgb)}; ${mapValue}</li>`;
    }).join('');
    referenceStats.innerHTML = `
        <div class="reference-stats-summary">Точек: ${referencePoints.length}; диапазон: от ${formatRgb(minimum)} до ${formatRgb(maximum)}; среднее: ${formatRgb(average)}</div>
        <ol class="reference-stats-points">${pointRows}</ol>
    `;
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

    const displayMat = toDisplayUint8Mat(currentMat);
    viewport.setImageMat(displayMat);
    if (displayMat !== currentMat) displayMat.delete();
}

function setCurrentMat(nextMat) {
    if (currentMat && currentMat !== nextMat) currentMat.delete();
    if (!nextMat) {
        currentMat = null;
        return;
    }
    const floatMat = normalizeToFloatWorkingMat(nextMat);
    if (floatMat !== nextMat) nextMat.delete();
    currentMat = floatMat;
    updateHistogramView();
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
    const displayMat = toDisplayUint8Mat(currentMat);
    cv.imshow(exportCanvas, displayMat);
    if (displayMat !== currentMat) displayMat.delete();
    outputImageDataUrl = exportCanvas.toDataURL('image/png');
    syncUi();
}

// Исключения OpenCV прилетают из wasm как числовой указатель — разворачиваем в текст.
function describeError(error) {
    if (typeof error === 'number' && typeof cv.exceptionFromPtr === 'function') {
        try {
            return cv.exceptionFromPtr(error).msg;
        } catch {
            return `OpenCV exception ${error}`;
        }
    }
    return error && error.message ? error.message : String(error);
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
            console.error(error);
            processStatus.innerText = `Ошибка: ${describeError(error)}`;
        } finally {
            state.busy = false;
            syncUi();
        }
    }, 50);
}

saveBtn.addEventListener('click', () => {
    if (!currentMat) return;

    const fileStem = originalFileName.replace(/\.[^.]+$/, '') || 'image';
    saveImageToFile(currentMat, `${fileStem}.png`);
});

// Проверка готовности OpenCV
const checkOpenCv = setInterval(() => {
    if (typeof window.cv !== 'undefined' && window.cv.Mat) {
        clearInterval(checkOpenCv);
        opencvStatus.classList.add('ready');
        opencvStatus.title = 'OpenCV загружен';
        fileInput.disabled = false;
    }
}, 100);

// Загрузка файла
fileInput.addEventListener('change', async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !(files[0] instanceof Blob)) return;
    originalFileName = files[0].name || 'image';
    if (inputFilename) inputFilename.innerText = originalFileName;

    try {
        const { mat: loadedMat } = await loadImageFromFile(files[0]);
        setCurrentMat(loadedMat);

        state.imageLoaded = true;
        resetGeometryState();
        cancelBrightnessEditState();
        renderRawCanvas();
        updateSaveData();
    } catch (err) {
        processStatus.innerText = `Ошибка загрузки: ${err.message || err}`;
    }
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
        renderCornersOverlay(overlayCanvas, overlayContext, corners);
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
        renderCurvedEdgesOverlay(overlayCanvas, overlayContext, corners, edgePoints);
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
        referencePoints.length = 0;
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

applyLightMapBtn.addEventListener('click', () => {
    if (!currentMat || !lightMap) return;

    runStep('Коррекция по карте освещенности...', () => {
        const correctedMat = applyBrightnessWithLightMap(
            currentMat,
            lightMap,
            {
                mode: paperMode,
                referencePoints,
                referenceRadius: getReferenceRadius(),
                targetColors: {
                    black: parseHexColor(blackColorPicker.value),
                    paper: parseHexColor(paperColorPicker.value),
                    white: parseHexColor(whiteColorPicker.value)
                }
            }
        );
        setCurrentMat(correctedMat);
        resetGeometryState();
        cancelBrightnessEditState();
        renderRawCanvas();
        updateSaveData();
    });
});

// Клик по кнопке "Нормализовать яркость"
stretchBrightnessBtn.addEventListener('click', () => {
    if (!currentMat) return;
    runStep('Коррекция яркости...', () => {
        const correctedMat = stretchBrightness(currentMat, blackPointInput.value, whitePointInput.value);
        setCurrentMat(correctedMat);
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

paperModeWhiteBtn.addEventListener('click', () => {
    if (!state.maskEditing) return;
    paperMode = 'white';
    setReferencePointEditing(false);
    syncUi();
    renderMaskEditView();
});

paperModeColorBtn.addEventListener('click', () => {
    if (!state.maskEditing) return;
    paperMode = 'colored';
    syncUi();
    renderMaskEditView();
});

function toggleReferencePointEditing(type) {
    if (!state.maskEditing || paperMode !== 'colored') return;
    setReferencePointEditing(!(referencePointEditing && referencePointType === type), type);
}

addReferencePointBtn.addEventListener('click', () => toggleReferencePointEditing('paper'));
addBlackReferencePointBtn.addEventListener('click', () => toggleReferencePointEditing('black'));
addWhiteReferencePointBtn.addEventListener('click', () => toggleReferencePointEditing('white'));

function updateCursor(event) {
    if (!state.maskEditing || !sheetMask || !currentMat) {
        viewport.clearCursor();
        return;
    }
    const point = viewport.imagePointFromEvent(event);
    const radius = paperMode === 'colored' && referencePointEditing ? getReferenceRadius() : getBrushRadius();
    const color = paperMode === 'colored' && referencePointEditing ? '#2f76d2' : '#00ff50';
    viewport.renderCursorCircle(point, radius, color);
}

function handlePointerDown(event) {
    if (!currentMat || state.busy) return;

    if (state.maskEditing && sheetMask) {
        if (paperMode === 'colored' && referencePointEditing) {
            referenceTool.pointerDown(event);
            return;
        }
        if (lightMap || normalizedLightMap) {
            clearLightMapMat();
            clearLightMapView();
            syncUi();
        }
        maskTool.pointerDown(event);
        return;
    }

    if (!state.cornersFound) return;
    geometryTool.pointerDown(event);
}

function handlePointerMove(event) {
    if (!currentMat || state.busy) return;
    updateCursor(event);

    if (state.maskEditing && referencePointEditing) {
        referenceTool.pointerMove(event);
        return;
    }

    if (state.maskEditing && sheetMask && maskTool.active) {
        maskTool.pointerMove(event);
        return;
    }

    geometryTool.pointerMove(event);
}

function finishPointerInteraction() {
    referenceTool.pointerUp((point) => viewport.isInsideImage(point));
    maskTool.pointerUp();
    geometryTool.pointerUp();
}

viewport.bindPointerHandlers({
    onDown: handlePointerDown,
    onMove: handlePointerMove,
    onUp: finishPointerInteraction,
    onCancel: finishPointerInteraction
});

syncUi();
initTabs({
    onChange: (tabId) => {
        if (tabId === 'tab-4') updateHistogramView();
    }
});
