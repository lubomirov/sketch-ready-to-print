import { findCorners, findCurvedEdges, rectifyCurvedEdges, transformPerspective } from './geometry.js';
import { buildSheetMask, normalizeBrightness } from './filters.js';
import { getMousePosition, renderCornersOverlay, renderCurvedEdgesOverlay, renderMaskOverlay } from './ui.js';

let currentMat = null;
let corners = [];
let edgePoints = [];
let dragIdx = -1;
let sheetMask = null;
let maskPainting = false;
let maskPaintMode = 'add';
let lastMaskPoint = null;
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
const normalizeBrightnessBtn = document.getElementById('normalizeBrightnessBtn');
const saveBtn = document.getElementById('saveBtn');
const editMask = document.getElementById('editMask');
const maskAddBtn = document.getElementById('maskAddBtn');
const maskEraseBtn = document.getElementById('maskEraseBtn');
const maskBrushSize = document.getElementById('maskBrushSize');
const maskBrushSizeValue = document.getElementById('maskBrushSizeValue');
const inputFilename = document.getElementById('input_filename');
const processStatus = document.getElementById('processStatus');

const marginInput = document.getElementById('marginInput');
const marginValue = document.getElementById('marginValue');

// Синхронизация ползунков полей
marginInput.addEventListener('input', (e) => marginValue.value = e.target.value);
marginValue.addEventListener('input', (e) => marginInput.value = e.target.value);
maskBrushSize.addEventListener('input', (e) => maskBrushSizeValue.value = e.target.value);
maskBrushSizeValue.addEventListener('input', (e) => maskBrushSize.value = e.target.value);

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
    setInactive(normalizeBrightnessBtn, !state.imageLoaded || !sheetMask || state.busy);
    setInactive(editMask, !state.maskEditing);
    setInactive(saveBtn, !state.imageLoaded || !outputImageDataUrl || state.busy);

    const maskControlsDisabled = !state.maskEditing || state.busy;
    if (maskAddBtn) maskAddBtn.disabled = maskControlsDisabled;
    if (maskEraseBtn) maskEraseBtn.disabled = maskControlsDisabled;
    if (maskBrushSize) maskBrushSize.disabled = maskControlsDisabled;
    if (maskBrushSizeValue) maskBrushSizeValue.disabled = maskControlsDisabled;
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

function clearMaskMat() {
    if (sheetMask) {
        sheetMask.delete();
        sheetMask = null;
    }
}

function cancelBrightnessEditState() {
    clearMaskMat();
    state.maskEditing = false;
    maskPainting = false;
    lastMaskPoint = null;
    setMaskPaintMode('add');
}

function renderMaskEditView() {
    if (!currentMat) return;
    if (state.maskEditing && sheetMask) {
        renderMaskOverlay(canvas, ctxInput, currentMat, sheetMask, 0.5);
        return;
    }
    renderRawCanvas();
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
        sheetMask = buildSheetMask(currentMat);
        state.maskEditing = true;
        setMaskPaintMode('add');
        renderMaskEditView();
    });
});

// Клик по кнопке "Нормализовать яркость"
normalizeBrightnessBtn.addEventListener('click', () => {
    if (!currentMat || !sheetMask) return;

    runStep('Выравнивание яркости...', () => {
        const finalMat = normalizeBrightness(currentMat, sheetMask)
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

// Интерактивное управление маркерами
canvas.addEventListener('mousedown', (e) => {
    if (!currentMat || state.busy) return;

    if (state.maskEditing && sheetMask) {
        const pos = getMousePosition(canvas, e);
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

window.addEventListener('mouseup', () => {
    dragIdx = -1;
    maskPainting = false;
    lastMaskPoint = null;
});

syncUi();
