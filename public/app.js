import { autoFindCorners, transformPerspective } from './geometry.js';
import { cleanBackground } from './filters.js';
import { drawGrid, getMousePosition } from './ui.js';

let srcMat = null;
let corners = [];
let dragIdx = -1;
let originalFileName = 'image';

const canvasInput = document.getElementById('canvasInput');
const ctxInput = canvasInput.getContext('2d');
const canvasOutput = document.getElementById('canvasOutput');
const fileInput = document.getElementById('fileInput');
const fixGeometryBtn = document.getElementById('fixGeometryBtn');
const normalizeBtn = document.getElementById('normalizeBtn');
const saveBtn = document.getElementById('saveBtn');
const opencvStatus = document.getElementById('opencv_status');
const processStatus = document.getElementById('processStatus');

const marginInput = document.getElementById('marginInput');
const marginValue = document.getElementById('marginValue');

// Константы выравнивания освещения (вместо UI-контролов)
const BRIGHTNESS_CONTRAST = 1.1;
const BRIGHTNESS_OFFSET = -10;
let outputImageDataUrl = '';

// Синхронизация ползунков полей
marginInput.addEventListener('input', (e) => marginValue.value = e.target.value);
marginValue.addEventListener('input', (e) => marginInput.value = e.target.value);

function updateSaveButton() {
    outputImageDataUrl = canvasOutput.toDataURL('image/png');
    saveBtn.disabled = false;
}

function renderOutput({ normalize = false } = {}) {
    if (!srcMat) return;

    const margin = parseInt(marginInput.value, 10) || 0;
    let warpedMat = transformPerspective(srcMat, corners, margin);

    if (normalize) {
        let finalMat = cleanBackground(warpedMat, BRIGHTNESS_CONTRAST, BRIGHTNESS_OFFSET);
        cv.imshow('canvasOutput', finalMat);
        warpedMat.delete();
        finalMat.delete();
    } else {
        cv.imshow('canvasOutput', warpedMat);
        warpedMat.delete();
    }

    updateSaveButton();
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
        opencvStatus.innerText = "OpenCV";
        opencvStatus.className = "ready";
        fileInput.disabled = false;
    }
}, 100);

// Загрузка файла
fileInput.addEventListener('change', (e) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !(files[0] instanceof Blob)) return;
    originalFileName = files[0].name || 'image';

    const reader = new FileReader();
    reader.onload = function(event) {
        const img = new Image();
        img.onload = function() {
            canvasInput.width = img.width;
            canvasInput.height = img.height;
            ctxInput.drawImage(img, 0, 0);
            
            if (srcMat) srcMat.delete();
            srcMat = cv.imread(canvasInput);
            
            corners = autoFindCorners(srcMat, canvasInput.width, canvasInput.height);
            drawGrid(canvasInput, ctxInput, srcMat, corners);
            fixGeometryBtn.disabled = false;
            normalizeBtn.disabled = false;
            saveBtn.disabled = true;
            outputImageDataUrl = '';
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(files[0]);
});

// Клик по кнопке "Выпрямить перспективу" с асинхронным статус-баром
fixGeometryBtn.addEventListener('click', () => {
    if (!srcMat) return;

    processStatus.innerText = "Выпрямление геометрии...";
    fixGeometryBtn.disabled = true;
    normalizeBtn.disabled = true;

    setTimeout(() => {
        renderOutput({ normalize: false });

        processStatus.innerText = "Готово!";
        fixGeometryBtn.disabled = false;
        normalizeBtn.disabled = false;

    }, 50);
});

// Клик по кнопке "Нормализовать яркость"
normalizeBtn.addEventListener('click', () => {
    if (!srcMat) return;

    processStatus.innerText = "Выравнивание яркости...";
    fixGeometryBtn.disabled = true;
    normalizeBtn.disabled = true;

    setTimeout(() => {
        renderOutput({ normalize: true });

        processStatus.innerText = "Готово!";
        fixGeometryBtn.disabled = false;
        normalizeBtn.disabled = false;

    }, 50);
});

// Интерактивное управление маркерами
canvasInput.addEventListener('mousedown', (e) => {
    if (!srcMat) return;
    const pos = getMousePosition(canvasInput, e);
    const clickRadius = Math.max(20, canvasInput.width / 40);
    dragIdx = corners.findIndex(p => Math.hypot(p.x - pos.x, p.y - pos.y) < clickRadius);
});

canvasInput.addEventListener('mousemove', (e) => {
    if (dragIdx === -1 || !srcMat) return;
    const pos = getMousePosition(canvasInput, e);
    corners[dragIdx].x = pos.x;
    corners[dragIdx].y = pos.y;
    drawGrid(canvasInput, ctxInput, srcMat, corners);
});

window.addEventListener('mouseup', () => dragIdx = -1);
