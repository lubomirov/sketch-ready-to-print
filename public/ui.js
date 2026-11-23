export function initTabs({ onChange } = {}) {
    const tabButtons = Array.from(document.querySelectorAll('.tab-btn'));
    const tabPanes = Array.from(document.querySelectorAll('.tab-pane'));
    if (tabButtons.length === 0 || tabPanes.length === 0) return;

    function activateTab(tabId) {
        tabButtons.forEach((btn) => {
            const isActive = btn.dataset.tab === tabId;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });

        tabPanes.forEach((pane) => {
            pane.classList.toggle('active', pane.id === tabId);
        });
        if (onChange) onChange(tabId);
    }

    tabButtons.forEach((btn) => {
        btn.addEventListener('click', () => activateTab(btn.dataset.tab));
    });
}

export function createUi({ onPaperAnchorRadiusInput, onPaperThresholdChange }) {
    const elements = {
        canvasViewport: document.getElementById('canvasViewport'),
        canvas: document.getElementById('canvas'),
        overlayCanvas: document.getElementById('overlayCanvas'),
        cursorCanvas: document.getElementById('cursorCanvas'),
        fitZoomBtn: document.getElementById('fitZoomBtn'),
        actualZoomBtn: document.getElementById('actualZoomBtn'),
        histogramCanvas: document.getElementById('histogramCanvas'),
        histogramStats: document.getElementById('histogramStats'),
        opencvStatus: document.getElementById('opencvStatus'),
        fileInput: document.getElementById('fileInput'),
        rotateLeftBtn: document.getElementById('rotateLeftBtn'),
        rotateRightBtn: document.getElementById('rotateRightBtn'),
        cornersStatus: document.getElementById('cornersStatus'),
        fixGeometryBtn: document.getElementById('fixGeometryBtn'),
        geometryControls: document.getElementById('geometryControls'),
        curvedInfo: document.getElementById('curvedInfo'),
        fixCurvedEdgesBtn: document.getElementById('fixCurvedEdgesBtn'),
        detectSheetMaskBtn: document.getElementById('detectSheetMaskBtn'),
        recalcLightMapBtn: document.getElementById('recalcLightMapBtn'),
        applyLightMapBtn: document.getElementById('applyLightMapBtn'),
        blackPointInput: document.getElementById('blackPointInput'),
        whitePointInput: document.getElementById('whitePointInput'),
        blackPointHint: document.getElementById('blackPointHint'),
        whitePointHint: document.getElementById('whitePointHint'),
        stretchBrightnessBtn: document.getElementById('stretchBrightnessBtn'),
        saveBtn: document.getElementById('saveBtn'),
        editMask: document.getElementById('editMask'),
        maskAddBtn: document.getElementById('maskAddBtn'),
        maskEraseBtn: document.getElementById('maskEraseBtn'),
        maskBrushSize: document.getElementById('maskBrushSize'),
        maskBrushSizeValue: document.getElementById('maskBrushSizeValue'),
        paperAnchorControls: document.getElementById('paperAnchorControls'),
        addPaperAnchorBtn: document.getElementById('addPaperAnchorBtn'),
        paperAnchorRadius: document.getElementById('paperAnchorRadius'),
        paperAnchorRadiusValue: document.getElementById('paperAnchorRadiusValue'),
        paperAnchorStats: document.getElementById('paperAnchorStats'),
        targetPaperColor: document.getElementById('targetPaperColor'),
        primaryPaperMapZone: document.getElementById('primaryPaperMapZone'),
        primaryPaperMapCanvas: document.getElementById('primaryPaperMapCanvas'),
        paperDifferenceControls: document.getElementById('paperDifferenceControls'),
        paperDifferenceThreshold: document.getElementById('paperDifferenceThreshold'),
        paperDifferenceThresholdValue: document.getElementById('paperDifferenceThresholdValue'),
        lightMapZone: document.getElementById('lightMapZone'),
        lightMapCanvas: document.getElementById('lightMapCanvas'),
        inputFilename: document.getElementById('input_filename'),
        processStatus: document.getElementById('processStatus'),
        marginInput: document.getElementById('marginInput'),
        marginValue: document.getElementById('marginValue')
    };

    const {
        marginInput, marginValue, maskBrushSize, maskBrushSizeValue,
        paperAnchorRadius, paperAnchorRadiusValue,
        paperDifferenceThreshold, paperDifferenceThresholdValue
    } = elements;

    if (marginInput && marginValue) {
        marginInput.addEventListener('input', (event) => marginValue.value = event.target.value);
        marginValue.addEventListener('input', (event) => marginInput.value = event.target.value);
    }
    if (maskBrushSize && maskBrushSizeValue) {
        maskBrushSize.addEventListener('input', (event) => maskBrushSizeValue.value = event.target.value);
        maskBrushSizeValue.addEventListener('input', (event) => maskBrushSize.value = event.target.value);
    }
    if (paperAnchorRadius && paperAnchorRadiusValue) {
        paperAnchorRadius.addEventListener('input', (event) => paperAnchorRadiusValue.value = event.target.value);
        paperAnchorRadiusValue.addEventListener('input', (event) => paperAnchorRadius.value = event.target.value);
        paperAnchorRadius.addEventListener('input', onPaperAnchorRadiusInput);
        paperAnchorRadiusValue.addEventListener('input', onPaperAnchorRadiusInput);
    }
    if (paperDifferenceThreshold && paperDifferenceThresholdValue) {
        paperDifferenceThreshold.addEventListener('input', (event) => {
            paperDifferenceThresholdValue.value = event.target.value;
        });
        paperDifferenceThresholdValue.addEventListener('input', (event) => {
            paperDifferenceThreshold.value = event.target.value;
        });
        paperDifferenceThreshold.addEventListener('change', onPaperThresholdChange);
        paperDifferenceThresholdValue.addEventListener('change', onPaperThresholdChange);
    }

    function setInactive(element, inactive) {
        if (!element) return;
        element.classList.toggle('inactive', inactive);
        if (element.tagName === 'BUTTON') element.disabled = inactive;
    }

    function syncUi(state, { hasSheetMask, hasPrimaryPaperMap, hasLightMap, canSave }) {
        const {
            cornersStatus, fixGeometryBtn, geometryControls,
            curvedInfo, fixCurvedEdgesBtn, detectSheetMaskBtn,
            recalcLightMapBtn, applyLightMapBtn, stretchBrightnessBtn, editMask, lightMapZone,
            saveBtn, maskAddBtn, maskEraseBtn, maskBrushSize, maskBrushSizeValue,
            paperAnchorControls, addPaperAnchorBtn, paperAnchorRadius, paperAnchorRadiusValue, targetPaperColor,
            primaryPaperMapZone, paperDifferenceControls, paperDifferenceThreshold, paperDifferenceThresholdValue,
            rotateLeftBtn, rotateRightBtn
        } = elements;

        setInactive(rotateLeftBtn, !state.imageLoaded || state.busy);
        setInactive(rotateRightBtn, !state.imageLoaded || state.busy);
        setInactive(cornersStatus, !state.cornersChecked);
        setInactive(fixGeometryBtn, !state.imageLoaded || !state.cornersFound || state.busy);
        setInactive(geometryControls, !state.cornersFound);
        setInactive(curvedInfo, !state.curvesReady);
        setInactive(fixCurvedEdgesBtn, !state.imageLoaded || !state.curvesReady || state.busy);
        setInactive(detectSheetMaskBtn, !state.imageLoaded || !hasPrimaryPaperMap || state.busy);
        setInactive(recalcLightMapBtn, !state.imageLoaded || !hasSheetMask || !state.maskEditing || state.busy);
        setInactive(applyLightMapBtn, !state.imageLoaded || !hasLightMap || state.busy);

        setInactive(stretchBrightnessBtn, !state.imageLoaded || state.busy);
        setInactive(editMask, !state.maskEditing);
        setInactive(lightMapZone, !state.maskEditing);
        setInactive(paperAnchorControls, !state.imageLoaded || state.busy);
        setInactive(primaryPaperMapZone, !hasPrimaryPaperMap);
        setInactive(paperDifferenceControls, !hasPrimaryPaperMap);
        setInactive(saveBtn, !state.imageLoaded || !canSave || state.busy);

        const maskControlsDisabled = !state.maskEditing || state.busy;
        [maskAddBtn, maskEraseBtn, maskBrushSize, maskBrushSizeValue]
            .forEach((element) => {
                if (element) element.disabled = maskControlsDisabled;
            });

        const paperControlsDisabled = !state.imageLoaded || state.busy;
        [addPaperAnchorBtn, paperAnchorRadius, paperAnchorRadiusValue, targetPaperColor]
            .forEach((element) => {
                if (element) element.disabled = paperControlsDisabled;
            });

        const thresholdControlsDisabled = !hasPrimaryPaperMap || state.busy;
        [paperDifferenceThreshold, paperDifferenceThresholdValue]
            .forEach((element) => {
                if (element) element.disabled = thresholdControlsDisabled;
            });
    }

    return { elements, syncUi };
}
