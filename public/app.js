import { findCorners, findCurvedEdges, rectifyCurvedEdges, transformPerspective } from './geometry.js';
import { applyBrightnessWithLightMap, buildNormalizedLightMap, buildSheetMask } from './filters.js';
import { getMousePosition, initTabs, renderCornersOverlay, renderCurvedEdgesOverlay, renderMaskOverlay } from './ui.js';

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

const canvas = document.getElementById('canvas');
const ctxInput = canvas.getContext('2d');
const opencvStatus = document.getElementById('opencvStatus');
const fileInput = document.getElementById('fileInput');
const findCornersBtn = document.getElementById('findCornersBtn');
const cornersStatus = document.getElementById('cornersStatus');
const fixGeometryBtn = document.getElementById('fixGeometryBtn');
const geometryControls = document.getElementById('geometryControls');
const findCurvedEdgesBtn = document.getElementById('findCurvedEdgesBtn');
const curvedInfo = document.getElementById('curvedInfo');
const fixCurvedEdgesBtn = document.getElementById('fixCurvedEdgesBtn');
const detectSheetMaskBtn = document.getElementById('detectSheetMaskBtn');
const recalcLightMapBtn = document.getElementById('recalcLightMapBtn');
const normalizeBrightnessBtn = document.getElementById('normalizeBrightnessBtn');
const saveBtn = document.getElementById('saveBtn');
const editMask = document.getElementById('editMask');
const maskAddBtn = document.getElementById('maskAddBtn');
const maskEraseBtn = document.getElementById('maskEraseBtn');
const maskBrushSize = document.getElementById('maskBrushSize');
const maskBrushSizeValue = document.getElementById('maskBrushSizeValue');
const addReferencePointBtn = document.getElementById('addReferencePointBtn');
const referenceRadius = document.getElementById('referenceRadius');
const referenceRadiusValue = document.getElementById('referenceRadiusValue');
const referenceStats = document.getElementById('referenceStats');
const paperColorPicker = document.getElementById('paperColorPicker');
const lightMapZone = document.getElementById('lightMapZone');
const lightMapCanvas = document.getElementById('lightMapCanvas');
const inputFilename = document.getElementById('input_filename');
const processStatus = document.getElementById('processStatus');

const marginInput = document.getElementById('marginInput');
const marginValue = document.getElementById('marginValue');

// Синхронизация ползунков полей
marginInput.addEventListener('input', (e) => marginValue.value = e.target.value);
marginValue.addEventListener('input', (e) => marginInput.value = e.target.value);
maskBrushSize.addEventListener('input', (e) => maskBrushSizeValue.value = e.target.value);
maskBrushSizeValue.addEventListener('input', (e) => maskBrushSize.value = e.target.value);
referenceRadius.addEventListener('input', (e) => referenceRadiusValue.value = e.target.value);
referenceRadiusValue.addEventListener('input', (e) => referenceRadius.value = e.target.value);
referenceRadius.addEventListener('input', () => {
    if (state.maskEditing) renderMaskEditView();
});
referenceRadiusValue.addEventListener('input', () => {
    if (state.maskEditing) renderMaskEditView();
});

function setInactive(element, inactive) {
    if (!element) return;
    element.classList.toggle('inactive', inactive);
    if (element.tagName === 'BUTTON') element.disabled = inactive;
}

function syncUi() {
    setInactive(findCornersBtn, !state.imageLoaded || state.busy);
    setInactive(cornersStatus, !state.cornersChecked);
    setInactive(fixGeometryBtn, !state.imageLoaded || !state.cornersFound || state.busy);
    setInactive(geometryControls, !state.cornersFound);

    setInactive(findCurvedEdgesBtn, !state.imageLoaded || state.busy);
    setInactive(curvedInfo, !state.curvesReady);
    setInactive(fixCurvedEdgesBtn, !state.imageLoaded || !state.curvesReady || state.busy);

    setInactive(detectSheetMaskBtn, !state.imageLoaded || state.busy);
    setInactive(recalcLightMapBtn, !state.imageLoaded || !sheetMask || !state.maskEditing || state.busy);
    setInactive(normalizeBrightnessBtn, !state.imageLoaded || !lightMap || state.busy);
    setInactive(editMask, !state.maskEditing);
    setInactive(lightMapZone, !state.maskEditing);
    setInactive(saveBtn, !state.imageLoaded || !outputImageDataUrl || state.busy);

    const maskControlsDisabled = !state.maskEditing || state.busy;
    if (maskAddBtn) maskAddBtn.disabled = maskControlsDisabled;
    if (maskEraseBtn) maskEraseBtn.disabled = maskControlsDisabled;
    if (maskBrushSize) maskBrushSize.disabled = maskControlsDisabled;
    if (maskBrushSizeValue) maskBrushSizeValue.disabled = maskControlsDisabled;
    if (addReferencePointBtn) addReferencePointBtn.disabled = maskControlsDisabled;
    if (referenceRadius) referenceRadius.disabled = maskControlsDisabled;
    if (referenceRadiusValue) referenceRadiusValue.disabled = maskControlsDisabled;
    if (paperColorPicker) paperColorPicker.disabled = maskControlsDisabled;
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

function updateReferenceStats() {
    if (!referenceStats) return;
    if (!currentMat || referencePoints.length === 0) {
        referenceStats.textContent = 'Точек: 0; диапазон: -; среднее: -';
        return;
    }

    const radius = getReferenceRadius();
    const radiusSquared = radius * radius;
    const minimum = [255, 255, 255];
    const maximum = [0, 0, 0];
    const sum = [0, 0, 0];
    let pixelCount = 0;

    referencePoints.forEach((point) => {
        const left = Math.max(0, Math.ceil(point.x - radius));
        const right = Math.min(currentMat.cols - 1, Math.floor(point.x + radius));
        const top = Math.max(0, Math.ceil(point.y - radius));
        const bottom = Math.min(currentMat.rows - 1, Math.floor(point.y + radius));

        for (let y = top; y <= bottom; y++) {
            for (let x = left; x <= right; x++) {
                const dx = x - point.x;
                const dy = y - point.y;
                if (dx * dx + dy * dy > radiusSquared) continue;

                const pixelIndex = (y * currentMat.cols + x) * 4;
                for (let channel = 0; channel < 3; channel++) {
                    const value = currentMat.data[pixelIndex + channel];
                    minimum[channel] = Math.min(minimum[channel], value);
                    maximum[channel] = Math.max(maximum[channel], value);
                    sum[channel] += value;
                }
                pixelCount++;
            }
        }
    });

    const average = sum.map((value) => Math.round(value / pixelCount));
    referenceStats.textContent = `Точек: ${referencePoints.length}; диапазон: от ${formatRgb(minimum)} до ${formatRgb(maximum)}; среднее: ${formatRgb(average)}`;
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
        opencvStatus.innerText = 'OpenCV';
        opencvStatus.className = 'ready';
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
        renderLightMapView();
    });
});

// Клик по кнопке "Нормализовать яркость"
normalizeBrightnessBtn.addEventListener('click', () => {
    if (!currentMat || !lightMap) return;

    runStep('Выравнивание яркости...', () => {
        const finalMat = applyBrightnessWithLightMap(currentMat, lightMap);
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
