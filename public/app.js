import { findCorners, findCurvedEdges, rectifyCurvedEdges, transformPerspective } from './geometry.js';
import {
    applyBrightnessWithLightMap,
    buildBlankPaperMask,
    buildRefinedLightMap,
    buildPrimaryPaperMap,
    estimatePaperTextureThreshold
} from './lightmap.js';
import { createUi, initTabs } from './ui.js';
import { renderCornersOverlay, renderCurvedEdgesOverlay, renderMaskOverlay, renderPaperAnchors } from './renderers.js';
import { loadImageFromFile, saveImageToFile, normalizeToFloatWorkingMat, toDisplayUint8Mat } from './file-io.js';
import { CanvasViewport } from './viewport.js';
import { GeometryTool, MaskTool, PaperAnchorTool } from './tools.js';
import { computeHistogram, renderHistogram, stretchBrightness } from './brightness.js';
import { isFloatMat } from './mat-utils.js';
import { rotateMat } from './rotate.js';

let currentMat = null;
let corners = [];
let edgePoints = [];
let sheetMask = null;
let primaryPaperMap = null;
let lightMap = null;
let lightMapPreview = null;
let maskPaintMode = 'add';
let paperAnchorEditing = false;
let paperAnchors = [];
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
    onPaperAnchorRadiusInput: handlePaperAnchorRadiusInput,
    onPaperThresholdChange: handlePaperThresholdChange
});
const {
    canvasViewport, overlayCanvas, cursorCanvas, fitZoomBtn, actualZoomBtn,
    histogramCanvas, histogramStats, blackPointInput, whitePointInput, blackPointHint, whitePointHint,
    stretchBrightnessBtn,
    canvas, opencvStatus, fileInput, rotateLeftBtn, rotateRightBtn, cornersStatus, fixGeometryBtn,
    geometryControls, curvedInfo, fixCurvedEdgesBtn, detectSheetMaskBtn,
    recalcLightMapBtn, applyLightMapBtn, saveBtn, editMask, maskAddBtn, maskEraseBtn,
    maskBrushSize, maskBrushSizeValue, addPaperAnchorBtn,
    paperAnchorRadius, paperAnchorRadiusValue, paperAnchorStats, targetPaperColor,
    primaryPaperMapZone, primaryPaperMapCanvas, lightMapZone, lightMapCanvas,
    paperDifferenceThreshold, paperDifferenceThresholdValue,
    inputFilename, processStatus, marginInput, marginValue
} = elements;
const viewport = new CanvasViewport(canvasViewport, canvas, overlayCanvas, cursorCanvas);
viewport.attachPan();
const overlayContext = overlayCanvas.getContext('2d');
const maskTool = new MaskTool({
    getPosition: (event) => viewport.imagePointFromEvent(event),
    getRadius: () => getBrushRadius(),
    paint: (from, to) => paintMaskStroke(from, to),
    onChange: scheduleMaskEditView
});
const paperAnchorTool = new PaperAnchorTool({
    getPosition: (event) => viewport.imagePointFromEvent(event),
    getHitRadius: () => Math.min(getPaperAnchorRadius(), Math.max(8, viewport.imageWidth / 100)),
    points: paperAnchors,
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
    syncUiControls(state, {
        hasSheetMask: Boolean(sheetMask),
        hasPrimaryPaperMap: Boolean(primaryPaperMap),
        hasLightMap: Boolean(lightMap),
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

function setPaperAnchorEditing(enabled) {
    paperAnchorEditing = enabled;
    addPaperAnchorBtn.classList.toggle('reference-active', enabled);
    addPaperAnchorBtn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
}

function clearMaskMat() {
    if (sheetMask) {
        sheetMask.delete();
        sheetMask = null;
    }
}

function clearPrimaryPaperMap() {
    if (primaryPaperMap) {
        primaryPaperMap.delete();
        primaryPaperMap = null;
    }
    if (primaryPaperMapCanvas) {
        primaryPaperMapCanvas.width = 1;
        primaryPaperMapCanvas.height = 1;
        const ctx = primaryPaperMapCanvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, 1, 1);
    }
}

function renderPrimaryPaperMapView() {
    if (!primaryPaperMap || !primaryPaperMapCanvas) return;
    primaryPaperMapCanvas.width = primaryPaperMap.cols;
    primaryPaperMapCanvas.height = primaryPaperMap.rows;
    cv.imshow(primaryPaperMapCanvas, primaryPaperMap);
}

function clearLightMapMat() {
    if (lightMap) {
        lightMap.delete();
        lightMap = null;
    }
    if (lightMapPreview) {
        lightMapPreview.delete();
        lightMapPreview = null;
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
    if (!lightMapCanvas || !lightMapPreview) {
        clearLightMapView();
        return;
    }

    lightMapCanvas.width = lightMapPreview.cols;
    lightMapCanvas.height = lightMapPreview.rows;
    cv.imshow(lightMapCanvas, lightMapPreview);
}

function cancelBrightnessEditState() {
    clearMaskMat();
    clearPrimaryPaperMap();
    clearLightMapMat();
    state.maskEditing = false;
    setPaperAnchorEditing(false);
    paperAnchors.length = 0;
    setMaskPaintMode('add');
    clearLightMapView();
}

function invalidatePaperAnalysis() {
    clearMaskMat();
    clearPrimaryPaperMap();
    clearLightMapMat();
    state.maskEditing = false;
    setMaskPaintMode('add');
    clearLightMapView();
}

function renderActiveOverlay() {
    viewport.clearOverlay();
    if (state.maskEditing && sheetMask) {
        renderMaskOverlay(overlayCanvas, overlayContext, sheetMask, 0.5);
    }
    if (currentMat) {
        renderPaperAnchors(overlayCanvas, overlayContext, paperAnchors, getPaperAnchorRadius());
        updatePaperAnchorStats();
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
    if (!currentMat || !histogramCanvas || !document.getElementById('tab-5')?.classList.contains('active')) return;
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

function getPaperAnchorRadius() {
    const value = parseInt(paperAnchorRadius.value, 10) || 50;
    return Math.max(1, value);
}

function handlePaperAnchorRadiusInput() {
    if (!state.imageLoaded) return;
    if (primaryPaperMap || sheetMask || lightMap) {
        invalidatePaperAnalysis();
        processStatus.innerText = 'Радиус изменен. Войдите и выйдите из режима Point Blank Paper, чтобы построить карту заново.';
    }
    scheduleMaskEditView();
}

function getPaperDifferenceThreshold() {
    const threshold = Number(paperDifferenceThreshold.value);
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 255) {
        throw new Error('Порог отличия RGB должен быть целым числом от 1 до 255.');
    }
    return threshold;
}

function handlePaperThresholdChange() {
    if (!state.maskEditing || !primaryPaperMap || state.busy) return;

    runStep('Обновление маски чистой бумаги...', () => {
        const updatedMask = buildBlankPaperMask(currentMat, primaryPaperMap, getPaperDifferenceThreshold());
        clearMaskMat();
        clearLightMapMat();
        clearLightMapView();
        sheetMask = updatedMask;
        renderMaskEditView();
    });
}

function formatRgb(rgb) {
    return rgb.map((value) => Math.round(value)).join('-');
}

function parseHexColor(hexColor) {
    return [
        parseInt(hexColor.slice(1, 3), 16),
        parseInt(hexColor.slice(3, 5), 16),
        parseInt(hexColor.slice(5, 7), 16)
    ];
}

function forEachPixelInPaperAnchorArea(point, radius, visitPixel) {
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

function updatePaperAnchorStats() {
    if (!paperAnchorStats) return;
    if (!currentMat || paperAnchors.length === 0) {
        paperAnchorStats.innerHTML = `
            <div class="reference-stats-summary">
                <div>Опорных точек: 0</div>
                <div>Диапазон от - до -</div>
                <div>Среднее значение -</div>
            </div>
        `;
        return;
    }

    const radius = getPaperAnchorRadius();
    const minimum = [255, 255, 255];
    const maximum = [0, 0, 0];
    const sum = [0, 0, 0];
    let pixelCount = 0;
    const usesFloatData = isFloatMat(currentMat);
    const valueScale = usesFloatData ? 255 : 1;
    const currentData = usesFloatData ? currentMat.data32F : currentMat.data;

    paperAnchors.forEach((point) => {
        forEachPixelInPaperAnchorArea(point, radius, (x, y) => {
            const pixelIndex = (y * currentMat.cols + x) * 4;
            for (let channel = 0; channel < 3; channel++) {
                const value = currentData[pixelIndex + channel] * valueScale;
                minimum[channel] = Math.min(minimum[channel], value);
                maximum[channel] = Math.max(maximum[channel], value);
                sum[channel] += value;
            }
            pixelCount++;
        });
    });

    if (pixelCount === 0) {
        paperAnchorStats.innerHTML = `
            <div class="reference-stats-summary">
                <div>Опорных точек: ${paperAnchors.length}</div>
                <div>Диапазон от - до -</div>
                <div>Среднее значение -</div>
            </div>
        `;
        return;
    }

    const average = sum.map((value) => Math.round(value / pixelCount));
    paperAnchorStats.innerHTML = `
        <div class="reference-stats-summary">
            <div>Опорных точек: ${paperAnchors.length}</div>
            <div>Диапазон от ${formatRgb(minimum)} до ${formatRgb(maximum)}</div>
            <div>Среднее значение ${formatRgb(average)}</div>
        </div>
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

function rotateCurrentMat(direction) {
    if (!currentMat) return;
    cancelBrightnessEditState();

    runStep('Поворот изображения...', () => {
        const rotatedMat = rotateMat(currentMat, direction);
        setCurrentMat(rotatedMat);
        resetGeometryState();
        renderRawCanvas();
        updateSaveData();
    });
}

rotateLeftBtn.addEventListener('click', () => rotateCurrentMat('left'));
rotateRightBtn.addEventListener('click', () => rotateCurrentMat('right'));

function runFindCorners() {
    if (!currentMat || state.busy) return;
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
}

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

function runFindCurvedEdges() {
    if (!currentMat || state.busy) return;
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
}

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

// Клик по кнопке "Detect Blank Paper"
detectSheetMaskBtn.addEventListener('click', () => {
    if (!currentMat || !primaryPaperMap) return;

    runStep('Определение не-бумажных пикселей...', () => {
        const detectedMask = buildBlankPaperMask(currentMat, primaryPaperMap, getPaperDifferenceThreshold());
        clearMaskMat();
        clearLightMapMat();
        clearLightMapView();
        sheetMask = detectedMask;
        state.maskEditing = true;
        setPaperAnchorEditing(false);
        setMaskPaintMode('add');
        renderMaskEditView();
    });
});

recalcLightMapBtn.addEventListener('click', () => {
    if (!currentMat || !primaryPaperMap || !sheetMask) return;

    runStep('Пересчет карты освещенности...', () => {
        clearLightMapMat();
        const lightMaps = buildRefinedLightMap(currentMat, primaryPaperMap, sheetMask);
        lightMap = lightMaps.lightMap;
        lightMapPreview = lightMaps.previewMap;
        updatePaperAnchorStats();
        renderLightMapView();
    });
});

applyLightMapBtn.addEventListener('click', () => {
    if (!currentMat || !lightMap) return;

    runStep('Коррекция по карте освещенности...', () => {
        const correctedMat = applyBrightnessWithLightMap(
            currentMat,
            lightMap,
            parseHexColor(targetPaperColor.value)
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
        invalidatePaperAnalysis();
        setPaperAnchorEditing(false);
        renderRawCanvas();
        renderMaskEditView();
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

function togglePaperAnchorEditing() {
    if (!state.imageLoaded || state.busy) return;

    if (paperAnchorEditing) {
        setPaperAnchorEditing(false);
        runStep('Построение предварительной карты бумаги...', () => {
            const threshold = estimatePaperTextureThreshold(currentMat, paperAnchors, getPaperAnchorRadius());
            const nextPaperMap = buildPrimaryPaperMap(currentMat, paperAnchors, getPaperAnchorRadius());
            clearPrimaryPaperMap();
            primaryPaperMap = nextPaperMap;
            paperDifferenceThreshold.value = threshold;
            paperDifferenceThresholdValue.value = threshold;
            renderPrimaryPaperMapView();
            syncUi();
        });
        return;
    }

    invalidatePaperAnalysis();
    setPaperAnchorEditing(true);
    processStatus.innerText = '';
    renderMaskEditView();
}

addPaperAnchorBtn.addEventListener('click', togglePaperAnchorEditing);

function updateCursor(event) {
    if (!currentMat || (!paperAnchorEditing && !(state.maskEditing && sheetMask))) {
        viewport.clearCursor();
        return;
    }
    const point = viewport.imagePointFromEvent(event);
    const radius = paperAnchorEditing ? getPaperAnchorRadius() : getBrushRadius();
    const color = paperAnchorEditing ? '#2f76d2' : '#00ff50';
    viewport.renderCursorCircle(point, radius, color);
}

function handlePointerDown(event) {
    if (!currentMat || state.busy) return;

    if (paperAnchorEditing) {
        paperAnchorTool.pointerDown(event);
        return;
    }

    if (state.maskEditing && sheetMask) {
        if (lightMap || lightMapPreview) {
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

    if (paperAnchorEditing) {
        paperAnchorTool.pointerMove(event);
        return;
    }

    if (state.maskEditing && sheetMask && maskTool.active) {
        maskTool.pointerMove(event);
        return;
    }

    geometryTool.pointerMove(event);
}

function finishPointerInteraction() {
    paperAnchorTool.pointerUp((point) => viewport.isInsideImage(point));
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
        if (tabId === 'tab-3') runFindCorners();
        if (tabId === 'tab-4') runFindCurvedEdges();
        if (tabId === 'tab-5') updateHistogramView();
    }
});
