export function initTabs() {
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
    }

    tabButtons.forEach((btn) => {
        btn.addEventListener('click', () => activateTab(btn.dataset.tab));
    });
}

export function createUi({ onReferenceRadiusInput }) {
    const elements = {
        canvasViewport: document.getElementById('canvasViewport'),
        canvas: document.getElementById('canvas'),
        overlayCanvas: document.getElementById('overlayCanvas'),
        cursorCanvas: document.getElementById('cursorCanvas'),
        fitZoomBtn: document.getElementById('fitZoomBtn'),
        actualZoomBtn: document.getElementById('actualZoomBtn'),
        opencvStatus: document.getElementById('opencvStatus'),
        fileInput: document.getElementById('fileInput'),
        findCornersBtn: document.getElementById('findCornersBtn'),
        cornersStatus: document.getElementById('cornersStatus'),
        fixGeometryBtn: document.getElementById('fixGeometryBtn'),
        geometryControls: document.getElementById('geometryControls'),
        findCurvedEdgesBtn: document.getElementById('findCurvedEdgesBtn'),
        curvedInfo: document.getElementById('curvedInfo'),
        fixCurvedEdgesBtn: document.getElementById('fixCurvedEdgesBtn'),
        detectSheetMaskBtn: document.getElementById('detectSheetMaskBtn'),
        recalcLightMapBtn: document.getElementById('recalcLightMapBtn'),
        normalizeBrightnessBtn: document.getElementById('normalizeBrightnessBtn'),
        saveBtn: document.getElementById('saveBtn'),
        editMask: document.getElementById('editMask'),
        maskAddBtn: document.getElementById('maskAddBtn'),
        maskEraseBtn: document.getElementById('maskEraseBtn'),
        maskBrushSize: document.getElementById('maskBrushSize'),
        maskBrushSizeValue: document.getElementById('maskBrushSizeValue'),
        paperModeWhiteBtn: document.getElementById('paperModeWhiteBtn'),
        paperModeColorBtn: document.getElementById('paperModeColorBtn'),
        coloredPaperControls: document.getElementById('coloredPaperControls'),
        addReferencePointBtn: document.getElementById('addReferencePointBtn'),
        addBlackReferencePointBtn: document.getElementById('addBlackReferencePointBtn'),
        addWhiteReferencePointBtn: document.getElementById('addWhiteReferencePointBtn'),
        referenceRadius: document.getElementById('referenceRadius'),
        referenceRadiusValue: document.getElementById('referenceRadiusValue'),
        referenceStats: document.getElementById('referenceStats'),
        blackColorPicker: document.getElementById('blackColorPicker'),
        paperColorPicker: document.getElementById('paperColorPicker'),
        whiteColorPicker: document.getElementById('whiteColorPicker'),
        lightMapZone: document.getElementById('lightMapZone'),
        lightMapCanvas: document.getElementById('lightMapCanvas'),
        inputFilename: document.getElementById('input_filename'),
        processStatus: document.getElementById('processStatus'),
        marginInput: document.getElementById('marginInput'),
        marginValue: document.getElementById('marginValue')
    };

    const {
        marginInput, marginValue, maskBrushSize, maskBrushSizeValue,
        referenceRadius, referenceRadiusValue
    } = elements;

    marginInput.addEventListener('input', (event) => marginValue.value = event.target.value);
    marginValue.addEventListener('input', (event) => marginInput.value = event.target.value);
    maskBrushSize.addEventListener('input', (event) => maskBrushSizeValue.value = event.target.value);
    maskBrushSizeValue.addEventListener('input', (event) => maskBrushSize.value = event.target.value);
    referenceRadius.addEventListener('input', (event) => referenceRadiusValue.value = event.target.value);
    referenceRadiusValue.addEventListener('input', (event) => referenceRadius.value = event.target.value);
    referenceRadius.addEventListener('input', onReferenceRadiusInput);
    referenceRadiusValue.addEventListener('input', onReferenceRadiusInput);

    function setInactive(element, inactive) {
        if (!element) return;
        element.classList.toggle('inactive', inactive);
        if (element.tagName === 'BUTTON') element.disabled = inactive;
    }

    function syncUi(state, { hasSheetMask, hasLightMap, paperMode = 'white', hasAllReferenceTypes, canSave }) {
        const {
            findCornersBtn, cornersStatus, fixGeometryBtn, geometryControls,
            findCurvedEdgesBtn, curvedInfo, fixCurvedEdgesBtn, detectSheetMaskBtn,
            recalcLightMapBtn, normalizeBrightnessBtn, editMask, lightMapZone,
            saveBtn, maskAddBtn, maskEraseBtn, maskBrushSize, maskBrushSizeValue,
            paperModeWhiteBtn, paperModeColorBtn, coloredPaperControls,
            addReferencePointBtn, addBlackReferencePointBtn, addWhiteReferencePointBtn,
            referenceRadius, referenceRadiusValue, blackColorPicker, paperColorPicker, whiteColorPicker
        } = elements;

        setInactive(findCornersBtn, !state.imageLoaded || state.busy);
        setInactive(cornersStatus, !state.cornersChecked);
        setInactive(fixGeometryBtn, !state.imageLoaded || !state.cornersFound || state.busy);
        setInactive(geometryControls, !state.cornersFound);
        setInactive(findCurvedEdgesBtn, !state.imageLoaded || state.busy);
        setInactive(curvedInfo, !state.curvesReady);
        setInactive(fixCurvedEdgesBtn, !state.imageLoaded || !state.curvesReady || state.busy);
        setInactive(detectSheetMaskBtn, !state.imageLoaded || state.busy);
        setInactive(recalcLightMapBtn, !state.imageLoaded || !hasSheetMask || !state.maskEditing || state.busy);

        const isWhiteMode = paperMode === 'white';
        const canNormalize = isWhiteMode
            ? (state.imageLoaded && hasLightMap && !state.busy)
            : (state.imageLoaded && hasLightMap && hasAllReferenceTypes && !state.busy);

        setInactive(normalizeBrightnessBtn, !canNormalize);
        setInactive(editMask, !state.maskEditing);
        setInactive(lightMapZone, !state.maskEditing);
        setInactive(coloredPaperControls, isWhiteMode || !state.maskEditing);
        setInactive(saveBtn, !state.imageLoaded || !canSave || state.busy);

        if (paperModeWhiteBtn) paperModeWhiteBtn.classList.toggle('active', isWhiteMode);
        if (paperModeColorBtn) paperModeColorBtn.classList.toggle('active', !isWhiteMode);

        const maskControlsDisabled = !state.maskEditing || state.busy;
        [maskAddBtn, maskEraseBtn, maskBrushSize, maskBrushSizeValue,
            paperModeWhiteBtn, paperModeColorBtn,
            addReferencePointBtn, addBlackReferencePointBtn, addWhiteReferencePointBtn,
            referenceRadius, referenceRadiusValue, blackColorPicker, paperColorPicker, whiteColorPicker]
            .forEach((element) => {
                if (element) element.disabled = maskControlsDisabled;
            });
    }

    return { elements, syncUi };
}
