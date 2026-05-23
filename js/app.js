// ─────────────────────────────────────────────────────────────────
// 1. STATE & GLOBALS
// ─────────────────────────────────────────────────────────────────
let activeTool = 'select';
let boardX = 0, boardY = 0;
const connections = [];

// DOM refs
const viewport = document.getElementById('viewport');
const board = document.getElementById('board');
const htmlLayer = document.getElementById('html-layer');
const svgCanvas = document.getElementById('svg-canvas');
const pathsGroup = document.getElementById('paths');
const drawingsGroup = document.getElementById('drawings');
const sidebar = document.getElementById('sidebar');

// Miro 16-colour palette
const miroColors = [
    '#fff59d', '#ffe082',
    '#ffb74d', '#ff8a80',
    '#f8bbd0', '#f48fb1',
    '#ce93d8', '#b39ddb',
    '#81d4fa', '#90caf9',
    '#80cbc4', '#a5d6a7',
    '#c5e1a5', '#e6ee9c',
    '#eeeeee', '#212121'
];
let currentStickyColor = miroColors[0];

const stickyColorPanel = document.getElementById('sticky-color-panel');
const colorGridContainer = document.getElementById('color-grid-container');

// ─────────────────────────────────────────────────────────────────
// 2. SCREEN READER HELPERS
// ─────────────────────────────────────────────────────────────────
const srLive = document.getElementById('sr-live');
const srPolite = document.getElementById('sr-polite');

/** Immediately interrupts — for critical state changes */
function announceAssertive(msg) {
    srLive.textContent = '';
    requestAnimationFrame(() => { srLive.textContent = msg; });
}

/** Polite — waits for current speech to finish */
function announcePolite(msg) {
    srPolite.textContent = '';
    requestAnimationFrame(() => { srPolite.textContent = msg; });
}

// Keep old name working for any existing callers
function announceToScreenReader(msg) { announceAssertive(msg); }

// Announce a modal step transition (polite — won't interrupt user typing)
const STEP_ANNOUNCEMENTS = {
    'step-1': "Step 1 of 2: Customize your toolbar.",
    'step-custom-name': "Name your custom toolbar.",
    'step-customize-creation': "Customize creation toolbar. Tab through tools and press Enter or Space to toggle, Up or Down to reorder.",
    'step-2': "Step 2 of 2: Settings we've changed based on your setup.",
};
function announceStep(stepId) {
    if (STEP_ANNOUNCEMENTS[stepId]) announcePolite(STEP_ANNOUNCEMENTS[stepId]);
}

// Keep the rest of the page inert while the onboarding overlay is open
const ONBOARDING_INERT_SELECTORS = ['#viewport-wrap', '.toolbar.top-left', '#sidebar', '#shortcuts-toggle-btn'];
function setOnboardingBackgroundInert(inert) {
    ONBOARDING_INERT_SELECTORS.forEach(sel => {
        const el = document.querySelector(sel);
        if (!el) return;
        if (inert) el.setAttribute('inert', '');
        else el.removeAttribute('inert');
    });
}

/** Lightweight visual toast for sighted users (mirrors SR announcement) */
function showToast(msg, durationMs = 2200) {
    const existing = document.querySelector('.a11y-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'a11y-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 420);
    }, durationMs);
}

// ─────────────────────────────────────────────────────────────────
// 3. TOOLBAR SELECTION
// ─────────────────────────────────────────────────────────────────
function getToolBtns() { return document.querySelectorAll('.tool-btn'); }

function activateToolBtn(btn) {
    getToolBtns().forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-checked', 'false');
    });
    btn.classList.add('active');
    btn.setAttribute('aria-checked', 'true');
    activeTool = btn.dataset.tool;
    viewport.style.cursor = activeTool === 'select' ? 'grab' : 'crosshair';
}

sidebar.addEventListener('click', (e) => {
    const btn = e.target.closest('.tool-btn');
    if (btn) activateToolBtn(btn);
});

function selectToolById(id) {
    const btn = sidebar.querySelector(`[data-tool="${id}"]`);
    if (btn) activateToolBtn(btn);
}

// ─────────────────────────────────────────────────────────────────
// 4. COORDINATE HELPERS
// ─────────────────────────────────────────────────────────────────
function getBoardCoords(clientX, clientY) {
    return { x: clientX - boardX, y: clientY - boardY };
}

// ─────────────────────────────────────────────────────────────────
// 5. ALL BOARD OBJECTS — for Tab navigation
// ─────────────────────────────────────────────────────────────────
/** Returns all focusable board containers / objects in DOM order */
function getAllBoardObjects() {
    // Stickies live inside .sticky-container; all others are direct .board-object children
    const containers = Array.from(htmlLayer.querySelectorAll('.sticky-container'));
    const others = Array.from(htmlLayer.querySelectorAll('.board-object:not(.sticky-note)'));
    // Merge in DOM order by their top-level position in htmlLayer
    const all = Array.from(htmlLayer.children).flatMap(el => {
        if (el.classList.contains('sticky-container')) return [el];
        if (el.classList.contains('board-object') && !el.classList.contains('sticky-note')) return [el];
        return [];
    });
    return all;
}

let tabFocusIndex = -1; // current position in Tab cycle

function focusBoardObject(obj) {
    // Clear all selection states
    document.querySelectorAll('.sticky-container').forEach(c => c.classList.remove('active-container'));
    document.querySelectorAll('.board-object').forEach(o => o.classList.remove('active-obj'));

    if (obj.classList.contains('sticky-container')) {
        obj.classList.add('active-container');
        const sticky = obj.querySelector('.sticky-note');
        if (sticky) sticky.focus();
        describeObject(obj);
    } else {
        obj.classList.add('active-obj');
        obj.focus();
        describeObject(obj);
    }
}

// ─────────────────────────────────────────────────────────────────
// 6. DESCRIBE OBJECTS (Ctrl+I / Ctrl+D)
// ─────────────────────────────────────────────────────────────────
function getObjectDescription(obj) {
    const isContainer = obj.classList.contains('sticky-container');
    const sticky = isContainer ? obj.querySelector('.sticky-note') : null;
    const isFrame = obj.classList.contains('frame-box');
    const isShape = obj.classList.contains('shape-rect');
    const isText = obj.classList.contains('text-box');
    const isDraw = obj.classList.contains('drawing-box');

    let type = 'Object';
    if (sticky || isContainer) type = 'Sticky note';
    else if (isFrame) type = 'Frame';
    else if (isShape) type = 'Shape';
    else if (isText) type = 'Text box';
    else if (isDraw) type = 'Drawing';

    const el = sticky || obj;
    const textarea = el.querySelector('textarea');
    const content = textarea ? textarea.value.trim() : '';
    const colorEl = sticky || (isContainer ? obj.querySelector('.sticky-note') : obj);
    const color = colorEl ? colorEl.style.backgroundColor : '';

    let desc = type;
    if (color) desc += `, colour ${color}`;
    if (content) desc += `. Content: "${content}"`;
    else desc += '. Empty — press Enter to add text.';

    const xPos = Math.round(parseFloat(obj.style.left) || 0);
    const yPos = Math.round(parseFloat(obj.style.top) || 0);
    desc += `. Position: ${xPos} right, ${yPos} down.`;

    return desc;
}

function describeObject(obj) {
    announceAssertive(getObjectDescription(obj));
}

function describeBoardOverview() {
    const all = getAllBoardObjects();
    if (all.length === 0) {
        announceAssertive('Board is empty. Use the toolbar to create sticky notes, shapes, and more.');
        return;
    }
    const counts = {};
    all.forEach(obj => {
        const isContainer = obj.classList.contains('sticky-container');
        let type = 'object';
        if (isContainer || obj.classList.contains('sticky-note')) type = 'sticky note';
        else if (obj.classList.contains('frame-box')) type = 'frame';
        else if (obj.classList.contains('shape-rect')) type = 'shape';
        else if (obj.classList.contains('text-box')) type = 'text box';
        else if (obj.classList.contains('drawing-box')) type = 'drawing';
        counts[type] = (counts[type] || 0) + 1;
    });
    const summary = Object.entries(counts)
        .map(([t, n]) => `${n} ${t}${n > 1 ? 's' : ''}`)
        .join(', ');
    announceAssertive(`Board overview: ${all.length} total objects — ${summary}. ${connections.length} connector${connections.length !== 1 ? 's' : ''}.`);
}

// ─────────────────────────────────────────────────────────────────
// 7. VIEWPORT INTERACTIONS (pan + pen draw)
// ─────────────────────────────────────────────────────────────────
let isPanning = false, isDrawing = false;
let startPanX = 0, startPanY = 0;
let currentDrawingPath = null;

viewport.addEventListener('mousedown', (e) => {
    if (e.target.closest('.toolbar, .board-object, #sticky-color-panel, .sticky-container, .sticky-format-bar')) return;

    // Deselect everything on blank-canvas click
    document.querySelectorAll('.sticky-container').forEach(c => c.classList.remove('active-container'));
    document.querySelectorAll('.board-object').forEach(o => o.classList.remove('active-obj'));
    tabFocusIndex = -1;

    const coords = getBoardCoords(e.clientX, e.clientY);

    if (activeTool === 'select') {
        isPanning = true;
        startPanX = e.clientX - boardX;
        startPanY = e.clientY - boardY;
        viewport.style.cursor = 'grabbing';

    } else if (activeTool === 'pen') {
        isDrawing = true;
        currentDrawingPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        currentDrawingPath.setAttribute('stroke', '#050038');
        currentDrawingPath.setAttribute('stroke-width', '4');
        currentDrawingPath.setAttribute('fill', 'none');
        currentDrawingPath.setAttribute('stroke-linecap', 'round');
        currentDrawingPath.setAttribute('stroke-linejoin', 'round');
        currentDrawingPath.setAttribute('d', `M ${coords.x} ${coords.y}`);
        drawingsGroup.appendChild(currentDrawingPath);

    } else {
        spawnObject(activeTool, coords.x, coords.y);
        selectToolById('select');
    }
});

window.addEventListener('mousemove', (e) => {
    if (isPanning) {
        boardX = e.clientX - startPanX;
        boardY = e.clientY - startPanY;
        board.style.transform = `translate(${boardX}px, ${boardY}px)`;
        viewport.style.backgroundPosition = `${boardX}px ${boardY}px`;
    }
    if (isDrawing && currentDrawingPath) {
        const coords = getBoardCoords(e.clientX, e.clientY);
        const d = currentDrawingPath.getAttribute('d');
        currentDrawingPath.setAttribute('d', `${d} L ${coords.x} ${coords.y}`);
    }
});

window.addEventListener('mouseup', () => {
    if (isPanning) {
        isPanning = false;
        viewport.style.cursor = 'grab';
    }
    if (isDrawing && currentDrawingPath) {
        isDrawing = false;
        const bbox = currentDrawingPath.getBBox();
        if (bbox.width < 4 && bbox.height < 4) {
            currentDrawingPath.remove();
        } else {
            currentDrawingPath.remove();
            spawnDrawingObject(bbox, currentDrawingPath.getAttribute('d'));
        }
        currentDrawingPath = null;
    }
});

// ─────────────────────────────────────────────────────────────────
// 8. FONT FITTING
// ─────────────────────────────────────────────────────────────────
/** Scale font DOWN to fit the 200px sticky square. Never grows the box. */
function fitStickyFont(el) {
    const textarea = el.querySelector('textarea');
    if (!textarea) return;
    const maxH = 168, maxW = 168; // 200 - 32px padding
    let size = 22;
    textarea.style.fontSize = size + 'px';
    void textarea.scrollHeight;
    while (size > 9 && (textarea.scrollHeight > maxH || textarea.scrollWidth > maxW)) {
        size -= 0.5;
        textarea.style.fontSize = size + 'px';
    }
}

function fitTextToContainer(el) {
    const textarea = el.querySelector('textarea');
    if (!textarea) return;
    let fontSize = parseInt(el.style.height || el.offsetHeight) * 0.35;
    fontSize = Math.max(12, Math.min(fontSize, 48));
    textarea.style.fontSize = `${fontSize}px`;
    while ((textarea.scrollHeight > el.clientHeight || textarea.scrollWidth > el.clientWidth) && fontSize > 10) {
        fontSize--;
        textarea.style.fontSize = `${fontSize}px`;
    }
}

// ─────────────────────────────────────────────────────────────────
// 9. TEXT EDITING — enter/exit
//    The FORMAT BAR visibility is driven entirely by
//    .editing-container on the container, which is added
//    on textarea focus and removed on textarea blur.
// ─────────────────────────────────────────────────────────────────

/**
 * Enter edit mode: show format bar + enable textarea pointer events.
 * @param {HTMLElement} stickyEl   — the .sticky-note div
 * @param {HTMLElement} container  — the parent .sticky-container
 * @param {HTMLTextAreaElement} textarea
 */
function enterEditMode(stickyEl, container, textarea) {
    container.classList.add('editing-container');
    textarea.classList.add('editing-textarea'); // pointer-events: auto
    textarea.style.pointerEvents = 'auto';
    textarea.style.cursor = 'text';
    announceAssertive('Editing sticky note. Type your text. Press Escape to stop editing.');
}

/**
 * Exit edit mode: hide format bar + disable textarea pointer events.
 */
function exitEditMode(stickyEl, container, textarea) {
    container.classList.remove('editing-container');
    textarea.classList.remove('editing-textarea');
    textarea.style.pointerEvents = 'none';
    textarea.style.cursor = 'default';
    const content = textarea.value.trim();
    if (content) {
        announcePolite(`Stopped editing. Note says: "${content}"`);
    } else {
        announcePolite('Stopped editing. Note is empty.');
    }
}

// For non-sticky objects (shape, text-box etc.)
function setupTextEditing(el, textarea) {
    el.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        el.classList.add('editing');
        textarea.style.pointerEvents = 'auto';
        textarea.focus();
    });
    textarea.addEventListener('blur', () => {
        el.classList.remove('editing');
        textarea.style.pointerEvents = 'none';
    });
}

// ─────────────────────────────────────────────────────────────────
// 10. FORMAT BAR — sticky notes only
// ─────────────────────────────────────────────────────────────────
function buildStickyFormatBar(stickyEl, textarea, container) {
    const bar = document.createElement('div');
    bar.className = 'sticky-format-bar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Text formatting for sticky note');

    // ── Bold ──────────────────────────────────────────────────────
    const boldBtn = makeFmtBtn('B', 'Bold (Ctrl+B)', () => {
        const isBold = textarea.style.fontWeight === '700' || textarea.style.fontWeight === 'bold';
        textarea.style.fontWeight = isBold ? '400' : '700';
        boldBtn.classList.toggle('fmt-active', !isBold);
        boldBtn.setAttribute('aria-pressed', String(!isBold));
        fitStickyFont(stickyEl);
        announceAssertive(isBold ? 'Bold off' : 'Bold on');
    });
    boldBtn.style.fontWeight = '700';
    boldBtn.setAttribute('aria-pressed', 'false');

    // ── Italic ────────────────────────────────────────────────────
    const italicBtn = makeFmtBtn('I', 'Italic (Ctrl+Alt+I)', () => {
        const isItalic = textarea.style.fontStyle === 'italic';
        textarea.style.fontStyle = isItalic ? 'normal' : 'italic';
        italicBtn.classList.toggle('fmt-active', !isItalic);
        italicBtn.setAttribute('aria-pressed', String(!isItalic));
        italicBtn.style.fontStyle = isItalic ? 'normal' : 'italic';
        announceAssertive(isItalic ? 'Italic off' : 'Italic on');
    });
    italicBtn.style.fontStyle = 'italic';
    italicBtn.setAttribute('aria-pressed', 'false');

    // ── Align toggle ──────────────────────────────────────────────
    const alignments = ['center', 'left', 'right'];
    const alignIcons = ['≡', '«', '»'];
    const alignLabels = ['Centre aligned', 'Left aligned', 'Right aligned'];
    let alignIdx = 0;
    const alignBtn = makeFmtBtn(alignIcons[0], 'Text alignment', () => {
        alignIdx = (alignIdx + 1) % alignments.length;
        textarea.style.textAlign = alignments[alignIdx];
        alignBtn.textContent = alignIcons[alignIdx];
        alignBtn.title = alignLabels[alignIdx];
        announceAssertive(alignLabels[alignIdx]);
    });

    const div1 = document.createElement('div');
    div1.className = 'fmt-divider';
    div1.setAttribute('aria-hidden', 'true');

    // ── Font size ─────────────────────────────────────────────────
    const sizeDownBtn = makeFmtBtn('−', 'Decrease font size (Ctrl+[)', () => {
        const cur = parseFloat(textarea.style.fontSize) || 18;
        const next = Math.max(9, cur - 2);
        textarea.style.fontSize = next + 'px';
        announceAssertive(`Font size ${next}px`);
    });
    const sizeUpBtn = makeFmtBtn('+', 'Increase font size (Ctrl+])', () => {
        const cur = parseFloat(textarea.style.fontSize) || 18;
        const next = cur + 2;
        textarea.style.fontSize = next + 'px';
        // Roll back if overflow
        if (textarea.scrollHeight > stickyEl.clientHeight - 32 || textarea.scrollWidth > stickyEl.clientWidth - 32) {
            textarea.style.fontSize = cur + 'px';
            announceAssertive('Font size at maximum for this note.');
        } else {
            announceAssertive(`Font size ${next}px`);
        }
    });

    const div2 = document.createElement('div');
    div2.className = 'fmt-divider';
    div2.setAttribute('aria-hidden', 'true');

    // ── Colour dot ────────────────────────────────────────────────
    const miniPalette = ['#fff59d', '#ffb74d', '#f8bbd0', '#b39ddb', '#81d4fa', '#a5d6a7', '#eeeeee', '#212121'];
    const colorNames = ['Yellow', 'Orange', 'Pink', 'Lavender', 'Blue', 'Green', 'White', 'Dark'];
    let colorIdx = 0;
    const colorDot = document.createElement('div');
    colorDot.className = 'fmt-color-dot';
    colorDot.style.backgroundColor = stickyEl.style.backgroundColor || currentStickyColor;
    colorDot.setAttribute('role', 'button');
    colorDot.setAttribute('tabindex', '0');
    colorDot.setAttribute('aria-label', 'Change sticky note colour');
    colorDot.title = 'Change colour (cycles through palette)';

    function cycleStickyColor() {
        colorIdx = (colorIdx + 1) % miniPalette.length;
        const newColor = miniPalette[colorIdx];
        stickyEl.style.backgroundColor = newColor;
        colorDot.style.backgroundColor = newColor;
        announceAssertive(`Colour changed to ${colorNames[colorIdx]}`);
        showToast(`Colour: ${colorNames[colorIdx]}`);
    }
    colorDot.addEventListener('mousedown', (e) => { e.stopPropagation(); cycleStickyColor(); });
    colorDot.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cycleStickyColor(); }
    });

    // Expose the format-bar buttons to the in-textarea keyboard shortcuts
    stickyEl._fmtBoldBtn = boldBtn;
    stickyEl._fmtItalicBtn = italicBtn;
    stickyEl._fmtSizeDown = sizeDownBtn;
    stickyEl._fmtSizeUp = sizeUpBtn;
    stickyEl._fmtColorCycle = cycleStickyColor;

    bar.append(boldBtn, italicBtn, alignBtn, div1, sizeDownBtn, sizeUpBtn, div2, colorDot);

    // Prevent bar clicks from bubbling to the board
    bar.addEventListener('mousedown', e => e.stopPropagation());

    return bar;
}

function makeFmtBtn(label, title, onClick) {
    const btn = document.createElement('button');
    btn.className = 'fmt-btn';
    btn.textContent = label;
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.setAttribute('type', 'button');
    btn.addEventListener('mousedown', (e) => { e.stopPropagation(); e.preventDefault(); onClick(); });
    return btn;
}

// ─────────────────────────────────────────────────────────────────
// 11. OBJECT CREATION
// ─────────────────────────────────────────────────────────────────
function spawnDrawingObject(bbox, pathData) {
    const el = document.createElement('div');
    el.className = 'board-object drawing-box';
    el.style.left = `${bbox.x}px`;
    el.style.top = `${bbox.y}px`;
    el.style.width = `${bbox.width}px`;
    el.style.height = `${bbox.height}px`;
    el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', 'Freehand drawing');

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `${bbox.x} ${bbox.y} ${bbox.width} ${bbox.height}`);
    svg.style.width = '100%';
    svg.style.height = '100%';

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathData);
    path.setAttribute('stroke', '#050038');
    path.setAttribute('stroke-width', '4');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-linecap', 'round');
    svg.appendChild(path);
    el.appendChild(svg);

    const textarea = document.createElement('textarea');
    textarea.placeholder = 'Add label...';
    textarea.setAttribute('aria-label', 'Drawing label');
    el.appendChild(textarea);

    htmlLayer.appendChild(el);
    makeDraggable(el);
    setupTextEditing(el, textarea);
}

function addColorPicker(el) {
    const palette = document.createElement('div');
    palette.className = 'color-palette';
    const shapeColors = ['#ffeb3b', '#ff9800', '#ff5722', '#e91e63', '#9c27b0', '#2196f3', '#4caf50'];
    shapeColors.forEach(color => {
        const dot = document.createElement('div');
        dot.className = 'color-dot';
        dot.style.backgroundColor = color;
        dot.addEventListener('click', (e) => { e.stopPropagation(); el.style.backgroundColor = color; });
        palette.appendChild(dot);
    });
    el.appendChild(palette);
}

function addHandles(el) {
    ['top', 'right', 'bottom', 'left'].forEach(pos => {
        const handle = document.createElement('div');
        handle.className = `conn-handle ${pos}`;
        handle.setAttribute('aria-label', `Connect from ${pos}`);
        handle.setAttribute('title', `Draw connector from ${pos}`);
        handle.onmousedown = (e) => beginConnectionDraw(e, el);
        el.appendChild(handle);
    });
}

/**
 * Main factory for all object types.
 * Returns the top-level element appended to htmlLayer
 * (for sticky: the .sticky-container; for others: the .board-object).
 */
function spawnObject(type, x, y, opts = {}) {
    const el = document.createElement('div');
    el.className = 'board-object';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;

    const wrapper = document.createElement('div');
    wrapper.className = 'text-container-wrapper';
    const textarea = document.createElement('textarea');
    textarea.placeholder = 'Type...';
    wrapper.appendChild(textarea);

    // ── STICKY ──────────────────────────────────────────────────
    if (type === 'sticky') {
        const container = document.createElement('div');
        container.className = 'sticky-container';
        container.style.position = 'absolute';
        container.style.left = `${x}px`;
        container.style.top = `${y}px`;

        el.classList.add('sticky-note');
        el.style.left = '0';
        el.style.top = '0';
        el.style.position = 'relative';
        el.style.backgroundColor = opts.color || currentStickyColor;
        el.setAttribute('tabindex', '0');
        el.setAttribute('role', 'note');

        // Give initial ARIA label; updated on content change
        el.setAttribute('aria-label', 'Empty sticky note. Double-click or press Enter to edit.');

        textarea.setAttribute('aria-label', 'Sticky note text');
        textarea.setAttribute('aria-multiline', 'true');
        el.appendChild(wrapper);
        addHandles(el);

        // Build format bar and prepend it to the container
        const formatBar = buildStickyFormatBar(el, textarea, container);
        container.appendChild(formatBar);   // order: -1 puts it above
        container.appendChild(el);

        // ── Edit mode: enter on dblclick OR mousedown on sticky when already active ──
        el.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            enterEditMode(el, container, textarea);
            textarea.focus();
        });

        // ── Edit mode: exit on textarea blur ──
        textarea.addEventListener('blur', (e) => {
            // Don't exit if focus moved to the format bar
            const relatedTarget = e.relatedTarget;
            if (relatedTarget && container.contains(relatedTarget)) return;
            exitEditMode(el, container, textarea);
            // Update ARIA label with current content
            const content = textarea.value.trim();
            el.setAttribute('aria-label', content
                ? `Sticky note: "${content}". Press Enter to edit.`
                : 'Empty sticky note. Press Enter to edit.');
        });

        // Live ARIA label update + font fitting while typing
        textarea.addEventListener('input', () => {
            fitStickyFont(el);
            updateConnections();
            const content = textarea.value.trim();
            el.setAttribute('aria-label', content
                ? `Sticky note: "${content}". Press Escape to stop editing.`
                : 'Sticky note, empty. Press Escape to stop editing.');
        });

        // ── In-textarea keyboard shortcuts ─────────────────────
        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                textarea.blur();
                el.focus();
                return;
            }
            if (e.ctrlKey || e.metaKey) {
                if (e.key === 'b' || e.key === 'B') {
                    e.preventDefault();
                    el._fmtBoldBtn && el._fmtBoldBtn.dispatchEvent(new MouseEvent('mousedown'));
                    return;
                }
                if (e.altKey && (e.key === 'i' || e.key === 'I')) {
                    e.preventDefault();
                    el._fmtItalicBtn && el._fmtItalicBtn.dispatchEvent(new MouseEvent('mousedown'));
                    return;
                }
                if (e.key === ']') {
                    e.preventDefault();
                    el._fmtSizeUp && el._fmtSizeUp.dispatchEvent(new MouseEvent('mousedown'));
                    return;
                }
                if (e.key === '[') {
                    e.preventDefault();
                    el._fmtSizeDown && el._fmtSizeDown.dispatchEvent(new MouseEvent('mousedown'));
                    return;
                }
            }
        });

        // ── Mouse selection ────────────────────────────────────
        el.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('conn-handle')) return;
            document.querySelectorAll('.sticky-container').forEach(c => c.classList.remove('active-container'));
            document.querySelectorAll('.board-object').forEach(o => o.classList.remove('active-obj'));
            container.classList.add('active-container');
        });

        setTimeout(() => fitStickyFont(el), 10);
        htmlLayer.appendChild(container);
        makeDraggableContainer(container, el);
        container.classList.add('active-container');

        announcePolite('Sticky note created. Double-click or press Enter to add text.');
        return container;

        // ── SHAPE ───────────────────────────────────────────────────
    } else if (type === 'shape') {
        el.classList.add('shape-rect');
        el.setAttribute('tabindex', '0');
        el.setAttribute('role', 'img');
        el.setAttribute('aria-label', 'Shape, empty. Double-click to add text.');
        el.appendChild(wrapper);
        addHandles(el);
        addColorPicker(el);
        setupTextEditing(el, textarea);
        textarea.addEventListener('input', () => {
            fitTextToContainer(el);
            const content = textarea.value.trim();
            el.setAttribute('aria-label', content ? `Shape: "${content}"` : 'Shape, empty. Double-click to add text.');
        });
        setTimeout(() => fitTextToContainer(el), 10);
        announcePolite('Shape created.');

        // ── TEXT BOX ────────────────────────────────────────────────
    } else if (type === 'text') {
        el.classList.add('text-box');
        textarea.placeholder = 'Add text...';
        el.setAttribute('tabindex', '0');
        el.setAttribute('role', 'textbox');
        el.setAttribute('aria-label', 'Text box, empty. Double-click to edit.');
        textarea.addEventListener('input', () => {
            const content = textarea.value.trim();
            el.setAttribute('aria-label', content ? `Text box: "${content}"` : 'Text box, empty. Double-click to edit.');
        });
        el.appendChild(wrapper);
        setupTextEditing(el, textarea);
        announcePolite('Text box created.');

        // ── FRAME ───────────────────────────────────────────────────
    } else if (type === 'frame') {
        el.classList.add('frame-box');
        el.setAttribute('tabindex', '0');
        el.setAttribute('role', 'group');
        const title = document.createElement('div');
        title.className = 'frame-title';
        title.innerText = 'New Frame';
        title.setAttribute('aria-hidden', 'true');
        el.appendChild(title);
        el.setAttribute('aria-label', `Frame: "${title.innerText}"`);
        // Keep aria-label in sync if title changes via contentEditable / future editing
        const updateFrameLabel = () => {
            const txt = title.textContent.trim();
            el.setAttribute('aria-label', txt ? `Frame: "${txt}"` : 'Frame, untitled');
        };
        const titleObserver = new MutationObserver(updateFrameLabel);
        titleObserver.observe(title, { characterData: true, childList: true, subtree: true });
        announcePolite('Frame created.');
    }

    htmlLayer.appendChild(el);
    makeDraggable(el);
    el.classList.add('active-obj');
    return el;
}

// ─────────────────────────────────────────────────────────────────
// 12. DRAGGING
// ─────────────────────────────────────────────────────────────────
function makeDraggable(el) {
    el.onmousedown = function (e) {
        if (activeTool !== 'select') return;
        if (e.target.classList.contains('conn-handle') || e.target.classList.contains('color-dot') || e.target.closest('.color-palette')) return;
        if (el.classList.contains('editing')) return;

        document.querySelectorAll('.board-object').forEach(obj => obj.classList.remove('active-obj'));
        el.classList.add('active-obj');

        let shiftX = e.clientX - el.getBoundingClientRect().left;
        let shiftY = e.clientY - el.getBoundingClientRect().top;

        let attached = [];
        if (el.classList.contains('frame-box')) {
            const frameRect = el.getBoundingClientRect();
            document.querySelectorAll('.board-object:not(.frame-box)').forEach(obj => {
                const r = obj.getBoundingClientRect();
                if (r.left >= frameRect.left && r.right <= frameRect.right &&
                    r.top >= frameRect.top && r.bottom <= frameRect.bottom) {
                    attached.push({ element: obj, offsetX: obj.offsetLeft - el.offsetLeft, offsetY: obj.offsetTop - el.offsetTop });
                }
            });
        }

        function moveAt(px, py) {
            const c = getBoardCoords(px, py);
            el.style.left = `${c.x - shiftX}px`;
            el.style.top = `${c.y - shiftY}px`;
            attached.forEach(item => {
                item.element.style.left = `${parseFloat(el.style.left) + item.offsetX}px`;
                item.element.style.top = `${parseFloat(el.style.top) + item.offsetY}px`;
            });
            updateConnections();
        }

        const onMove = (ev) => moveAt(ev.clientX, ev.clientY);
        document.addEventListener('mousemove', onMove);
        el.onmouseup = () => { document.removeEventListener('mousemove', onMove); el.onmouseup = null; };
    };
    el.ondragstart = () => false;
}

/** Draggable for .sticky-container — moves the whole container (bar + note) */
function makeDraggableContainer(container, stickyEl) {
    stickyEl.onmousedown = function (e) {
        if (activeTool !== 'select') return;
        if (e.target.classList.contains('conn-handle')) return;
        // If already in edit mode, don't start a drag
        if (container.classList.contains('editing-container')) return;

        document.querySelectorAll('.sticky-container').forEach(c => c.classList.remove('active-container'));
        document.querySelectorAll('.board-object').forEach(o => o.classList.remove('active-obj'));
        container.classList.add('active-container');

        const shiftX = e.clientX - parseFloat(container.style.left || 0) - boardX;
        const shiftY = e.clientY - parseFloat(container.style.top || 0) - boardY;

        function moveAt(px, py) {
            container.style.left = `${px - boardX - shiftX}px`;
            container.style.top = `${py - boardY - shiftY}px`;
            updateConnections();
        }

        const onMove = (ev) => moveAt(ev.clientX, ev.clientY);
        document.addEventListener('mousemove', onMove);
        stickyEl.onmouseup = () => { document.removeEventListener('mousemove', onMove); stickyEl.onmouseup = null; };
    };
    stickyEl.ondragstart = () => false;
}

// ─────────────────────────────────────────────────────────────────
// 13. CONNECTIONS
// ─────────────────────────────────────────────────────────────────
let isDrawingConnection = false;
let tempPath = null;
let currentSourceObj = null;

function beginConnectionDraw(e, sourceObj) {
    e.stopPropagation();
    isDrawingConnection = true;
    currentSourceObj = sourceObj;
    tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    // FIX 1: was '#9b99af' (grey), now dark and visible
    tempPath.setAttribute('stroke', '#050038');
    tempPath.setAttribute('stroke-width', '2.5');
    tempPath.setAttribute('fill', 'none');
    tempPath.setAttribute('stroke-linecap', 'round');
    tempPath.setAttribute('marker-end', 'url(#arrowhead)');
    pathsGroup.appendChild(tempPath);
    announceAssertive('Drawing connector. Release on another object to connect.');
}

function calcCurve(sx, sy, tx, ty) {
    const dx = Math.abs(tx - sx);
    const ctrl = Math.min(dx * 0.5, 120);
    return `M ${sx} ${sy} C ${sx + ctrl} ${sy}, ${tx - ctrl} ${ty}, ${tx} ${ty}`;
}

window.addEventListener('mousemove', (e) => {
    if (isDrawingConnection && tempPath) {
        const r = getObjRect(currentSourceObj);
        const sx = r.left + r.width / 2, sy = r.top + r.height / 2;
        const coords = getBoardCoords(e.clientX, e.clientY);
        tempPath.setAttribute('d', calcCurve(sx, sy, coords.x, coords.y));
    }
});

window.addEventListener('mouseup', (e) => {
    if (!isDrawingConnection) return;
    isDrawingConnection = false;
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const targetObj = hit?.closest('.board-object');
    if (targetObj && targetObj !== currentSourceObj) {
        const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        // FIX 2: was '#9b99af' (grey), now dark and visible
        pathEl.setAttribute('stroke', '#050038');
        pathEl.setAttribute('stroke-width', '2.5');
        pathEl.setAttribute('fill', 'none');
        pathEl.setAttribute('stroke-linecap', 'round');
        pathEl.setAttribute('marker-end', 'url(#arrowhead)');
        pathsGroup.appendChild(pathEl);
        connections.push({ source: currentSourceObj, target: targetObj, path: pathEl });
        updateConnections();
        announcePolite('Connector created.');
    }
    if (tempPath) tempPath.remove();
    tempPath = null;
    currentSourceObj = null;
    selectToolById('select');
});

function getObjRect(el) {
    const container = el.closest('.sticky-container');
    if (container) {
        return {
            left: parseFloat(container.style.left) || 0,
            top: parseFloat(container.style.top) || 0,
            width: el.offsetWidth,
            height: el.offsetHeight
        };
    }
    return { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight };
}

function updateConnections() {
    connections.forEach(conn => {
        const sR = getObjRect(conn.source);
        const tR = getObjRect(conn.target);
        const sx = sR.left + sR.width / 2, sy = sR.top + sR.height / 2;
        const tx = tR.left + tR.width / 2, ty = tR.top + tR.height / 2;
        const dx = tx - sx, dy = ty - sy;
        const start = getIntersection(sR, dx, dy, false);
        const end = getIntersection(tR, -dx, -dy, true);
        conn.path.setAttribute('d', calcCurve(start.x, start.y, end.x, end.y));
    });
}

function getIntersection(rect, dx, dy, isTarget) {
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const hw = rect.width / 2, hh = rect.height / 2;
    // Guard: if dx and dy are both zero there's no direction to intersect along
    if (dx === 0 && dy === 0) return { x: cx, y: cy };
    const scaleX = dx === 0 ? Infinity : hw / Math.abs(dx);
    const scaleY = dy === 0 ? Infinity : hh / Math.abs(dy);
    // scale brings us exactly to the box edge
    const scale = Math.min(scaleX, scaleY);
    // For the target end, pull back a fixed 8px so the arrowhead sits on the edge
    const edgeX = cx + dx * scale;
    const edgeY = cy + dy * scale;
    if (!isTarget) return { x: edgeX, y: edgeY };
    // Pull back 8px from the edge along the incoming direction
    const len = Math.sqrt(dx * dx + dy * dy);
    const pullback = 8 / len;
    return {
        x: edgeX - dx * pullback,
        y: edgeY - dy * pullback
    };
}

// ─────────────────────────────────────────────────────────────────
// 14. GLOBAL KEYBOARD HANDLING
// ─────────────────────────────────────────────────────────────────
let isWaitingForDirection = false;
let directionTimeout = null;

document.addEventListener('keydown', (e) => {
    const inTextarea = document.activeElement?.tagName === 'TEXTAREA';
    const inInput = document.activeElement?.tagName === 'INPUT';
    const modalOpen = onboardingOverlay && !onboardingOverlay.classList.contains('hidden');
    const panelOpen = shortcutsPanel && !shortcutsPanel.classList.contains('hidden');

    // ── Inside textarea: handle Escape, Ctrl+B, Ctrl+Alt+I, Ctrl+[, Ctrl+] ──
    // (these are wired directly on the textarea in spawnObject; nothing extra here)

    // ── While a modal/panel is open — let it handle its own keys ──
    if (modalOpen && !inTextarea) return;
    if (panelOpen && e.key === 'Escape') {
        closeShortcutsPanel();
        return;
    }

    // ── Shortcuts that work outside textareas/inputs ──────────────
    if (inTextarea || inInput) return;

    // Open shortcuts panel
    if (e.key === '?') {
        openShortcutsPanel();
        return;
    }

    // Tool shortcuts
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const toolMap = { v: 'select', t: 'text', n: 'sticky', s: 'shape', p: 'pen', f: 'frame' };
        if (e.key.toLowerCase() in toolMap && !isWaitingForDirection) {
            if (e.key.toLowerCase() !== 'n') { // N is hijacked for spatial creation below
                selectToolById(toolMap[e.key.toLowerCase()]);
                return;
            }
        }
    }

    // Describe selected (Ctrl+I)
    if ((e.ctrlKey || e.metaKey) && e.key === 'i' && !e.altKey) {
        e.preventDefault();
        const activeContainer = document.querySelector('.sticky-container.active-container');
        const activeObj = document.querySelector('.board-object.active-obj');
        if (activeContainer) describeObject(activeContainer);
        else if (activeObj) describeObject(activeObj);
        else announceAssertive('No object selected. Tab to an object, then press Ctrl+I to describe it.');
        return;
    }

    // Board overview (Ctrl+D)
    if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault();
        describeBoardOverview();
        return;
    }

    // Delete selected object (Del / Backspace)
    if (e.key === 'Delete' || e.key === 'Backspace') {
        const activeContainer = document.querySelector('.sticky-container.active-container');
        const activeObj = document.querySelector('.board-object.active-obj');

        // FIX 3: helper to remove all connections attached to a given sticky/object element
        function removeAttachedConnections(stickyOrObj) {
            for (let i = connections.length - 1; i >= 0; i--) {
                if (connections[i].source === stickyOrObj || connections[i].target === stickyOrObj) {
                    connections[i].path.remove();
                    connections.splice(i, 1);
                }
            }
        }

        if (activeContainer) {
            const stickyEl = activeContainer.querySelector('.sticky-note');
            if (stickyEl) removeAttachedConnections(stickyEl);
            announceAssertive('Deleted sticky note.');
            activeContainer.remove();
            tabFocusIndex = -1;
        } else if (activeObj) {
            removeAttachedConnections(activeObj);
            const type = activeObj.classList.contains('frame-box') ? 'frame'
                : activeObj.classList.contains('shape-rect') ? 'shape'
                    : activeObj.classList.contains('text-box') ? 'text box'
                        : 'object';
            announceAssertive(`Deleted ${type}.`);
            activeObj.remove();
            tabFocusIndex = -1;
        }
        return;
    }

    // ── Enter: edit selected sticky ────────────────────────────
    if (e.key === 'Enter') {
        const activeContainer = document.querySelector('.sticky-container.active-container');
        if (activeContainer) {
            const stickyEl = activeContainer.querySelector('.sticky-note');
            const textarea = stickyEl?.querySelector('textarea');
            if (stickyEl && textarea) {
                e.preventDefault();
                enterEditMode(stickyEl, activeContainer, textarea);
                textarea.focus();
            }
        }
        return;
    }

    // ── Tab: navigate board objects ────────────────────────────
    if (e.key === 'Tab') {
        const all = getAllBoardObjects();
        if (all.length === 0) {
            announceAssertive('Board is empty. Use toolbar buttons or keyboard shortcuts to create objects.');
            return;
        }
        e.preventDefault();
        if (e.shiftKey) {
            tabFocusIndex = (tabFocusIndex - 1 + all.length) % all.length;
        } else {
            tabFocusIndex = (tabFocusIndex + 1) % all.length;
        }
        focusBoardObject(all[tabFocusIndex]);
        return;
    }

    // ── Escape: deselect all ───────────────────────────────────
    if (e.key === 'Escape') {
        document.querySelectorAll('.sticky-container').forEach(c => c.classList.remove('active-container'));
        document.querySelectorAll('.board-object').forEach(o => o.classList.remove('active-obj'));
        tabFocusIndex = -1;
        announcePolite('Selection cleared.');
        return;
    }

    // ── N: spatial creation mode (waits for arrow) ─────────────
    if ((e.key === 'n' || e.key === 'N') && !isWaitingForDirection && !e.ctrlKey && !e.metaKey) {
        const activeContainer = document.querySelector('.sticky-container.active-container');
        const activeObj = document.querySelector('.board-object.active-obj');
        const selected = activeContainer || activeObj;
        if (!selected) {
            // Create new sticky at a default position when nothing is selected
            const cx = Math.round(window.innerWidth / 2) - boardX;
            const cy = Math.round(window.innerHeight / 2) - boardY;
            spawnObject('sticky', cx, cy);
            selectToolById('select');
            announceAssertive('Sticky note created at centre. Tab to navigate to it. Press Enter to edit.');
            return;
        }
        isWaitingForDirection = true;
        e.preventDefault();
        announceAssertive('Spatial create mode. Press Right Arrow to add note to the right, or Shift+Down to add below and link.');
        clearTimeout(directionTimeout);
        directionTimeout = setTimeout(() => {
            if (isWaitingForDirection) {
                isWaitingForDirection = false;
                announcePolite('Spatial create mode timed out.');
            }
        }, 5000);
        return;
    }

    // ── Arrow keys in spatial creation mode ───────────────────
    if (isWaitingForDirection) {
        const activeContainer = document.querySelector('.sticky-container.active-container');
        const activeObj = document.querySelector('.board-object.active-obj');
        const selected = activeContainer || activeObj;
        if (!selected) { isWaitingForDirection = false; return; }

        const refEl = activeContainer || activeObj;
        const currentX = parseFloat(refEl.style.left) || 0;
        const currentY = parseFloat(refEl.style.top) || 0;
        const currentW = (activeContainer
            ? activeContainer.querySelector('.sticky-note')?.offsetWidth
            : activeObj?.offsetWidth) || 200;
        const currentH = (activeContainer
            ? activeContainer.querySelector('.sticky-note')?.offsetHeight
            : activeObj?.offsetHeight) || 200;
        const gap = 60;

        // Right Arrow → clone to the right
        if (e.key === 'ArrowRight' && !e.shiftKey) {
            e.preventDefault();
            isWaitingForDirection = false;
            clearTimeout(directionTimeout);
            const newContainer = spawnObject('sticky', currentX + currentW + gap, currentY);
            selectToolById('select');
            if (newContainer) focusBoardObject(newContainer);
            announceAssertive('Sticky note created to the right. Tab to it, then press Enter to edit.');
        }

        // Shift+Down → clone below AND draw a connector
        if (e.key === 'ArrowDown' && e.shiftKey) {
            e.preventDefault();
            isWaitingForDirection = false;
            clearTimeout(directionTimeout);
            const newContainer = spawnObject('sticky', currentX, currentY + currentH + gap);
            selectToolById('select');

            // Draw connector from the source sticky to the new one
            if (newContainer) {
                const sourceSticky = activeContainer
                    ? activeContainer.querySelector('.sticky-note')
                    : activeObj;
                const targetSticky = newContainer.querySelector('.sticky-note');
                if (sourceSticky && targetSticky) {
                    const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    // FIX 4: was '#9b99af' (grey), now dark and visible
                    pathEl.setAttribute('stroke', '#050038');
                    pathEl.setAttribute('stroke-width', '2.5');
                    pathEl.setAttribute('fill', 'none');
                    pathEl.setAttribute('stroke-linecap', 'round');
                    pathEl.setAttribute('marker-end', 'url(#arrowhead)');
                    pathsGroup.appendChild(pathEl);
                    connections.push({ source: sourceSticky, target: targetSticky, path: pathEl });
                    updateConnections();
                }
                focusBoardObject(newContainer);
            }
            announceAssertive('Sticky note created below and linked with a connector. Press Enter to edit it.');
        }
    }
});

// ─────────────────────────────────────────────────────────────────
// 15. ONBOARDING LOGIC
// ─────────────────────────────────────────────────────────────────
const onboardingOverlay = document.getElementById('onboarding-overlay');
const step1 = document.getElementById('step-1');
const step2 = document.getElementById('step-2');
const stepCustomName = document.getElementById('step-custom-name');
const modalHeader = document.querySelector('.modal-header');
const selectBtns = document.querySelectorAll('.select-tool-btn');
const continueBtn = document.getElementById('continue-btn');
const doneBtn = document.getElementById('done-btn');
let selectedConfig = null;

const toolConfigs = {
    simple: [
        { id: 'select', iconSrc: 'img/icons/arrow.svg', title: 'Select (V)' },
        { id: 'frame', iconSrc: 'img/icons/frame.svg', title: 'Frame (F)' },
        { id: 'sticky', iconSrc: 'img/icons/sticky.svg', title: 'Sticky Note (N)' },
        { id: 'shape', iconSrc: 'img/icons/shapes.svg', title: 'Shape (S)' },
        { id: 'format', iconSrc: 'img/icons/format.svg', title: 'Formats and Flow' },
        { id: 'diagrams', iconSrc: 'img/icons/connect.svg', title: 'Diagrams' }
    ],
    default: [
        { id: 'select', iconSrc: 'img/icons/arrow.svg', title: 'Select (V)' },
        { id: 'sticky', iconSrc: 'img/icons/sticky.svg', title: 'Sticky Note (N)' },
        { id: 'frame', iconSrc: 'img/icons/frame.svg', title: 'Frame (F)' },
        { id: 'template', iconSrc: 'img/icons/template.svg', title: 'Templates' },
        { id: 'text', iconSrc: 'img/icons/text.svg', title: 'Text (T)' },
        { id: 'shape', iconSrc: 'img/icons/shapes.svg', title: 'Shape (S)' },
        { id: 'pen', iconSrc: 'img/icons/pen.svg', title: 'Pen (P)' },
        { id: 'format', iconSrc: 'img/icons/format.svg', title: 'Formats and Flow' },
        { id: 'sticker', iconSrc: 'img/icons/sticker.svg', title: 'Stickers, emojis and GIFs' },
        { id: 'comment', iconSrc: 'img/icons/chat.svg', title: 'Comment' },
        { id: 'diagrams', iconSrc: 'img/icons/connect.svg', title: 'Diagrams' }
    ],
    custom: []
};

function renderSidebar(configKey) {
    sidebar.innerHTML = '';
    let tools;
    if (configKey === 'custom') {
        // Prefer the saved custom toolbar (enabled only, in order); fall back to legacy customSelectedTools
        if (typeof savedCustomToolbar !== 'undefined' && savedCustomToolbar) {
            tools = savedCustomToolbar.tools.filter(t => t.enabled);
        } else {
            tools = customSelectedTools;
        }
    } else {
        tools = toolConfigs[configKey];
    }
    tools.forEach((tool, index) => {
        const btn = document.createElement('button');
        btn.className = 'icon-btn tool-btn';
        btn.setAttribute('role', 'radio');
        if (index === 0) { btn.classList.add('active'); btn.setAttribute('aria-checked', 'true'); }
        else { btn.setAttribute('aria-checked', 'false'); }
        btn.dataset.tool = tool.id;
        btn.title = tool.title || tool.label || tool.id;
        if (tool.iconSrc) {
            const img = document.createElement('img');
            img.src = tool.iconSrc;
            img.alt = '';
            btn.appendChild(img);
        } else {
            btn.innerText = tool.icon;
        }
        btn.addEventListener('click', (e) => activateToolBtn(e.currentTarget));

        btn.setAttribute('aria-label', btn.title);
        sidebar.appendChild(btn);
    });
}

selectBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        selectBtns.forEach(b => {
            b.classList.remove('selected');
            const orig = b.getAttribute('data-original-text');
            if (orig) b.innerText = orig;
        });
        const target = e.currentTarget;
        if (!target.getAttribute('data-original-text')) {
            target.setAttribute('data-original-text', target.innerText);
        }
        target.classList.add('selected');
        target.innerText = '✓ Selected';
        selectedConfig = target.getAttribute('data-config');
        continueBtn.disabled = false;

        if (selectedConfig !== 'custom') {
            renderSidebar(selectedConfig);
        } else if (typeof savedCustomToolbar !== 'undefined' && savedCustomToolbar) {
            renderSidebar('custom');
        }
    });
});

continueBtn.addEventListener('click', () => {
    step1.classList.add('hidden');
    if (selectedConfig === 'custom' && !savedCustomToolbar) {
        modalHeader.classList.add('hidden');
        stepCustomName.classList.remove('hidden');
        document.getElementById('toolbar-name-input').focus();
        announceStep('step-custom-name');
    } else {
        if (selectedConfig === 'custom') renderSidebarFromDraft();
        step2.classList.remove('hidden');
        announceStep('step-2');
    }
});

document.getElementById('cancel-custom-name-btn').addEventListener('click', () => {
    // If launched from the accessibility menu, close the modal entirely
    if (modalEntryPoint === 'menu') {
        closeOnboardingAndReturnToBoard();
        return;
    }
    stepCustomName.classList.add('hidden');
    modalHeader.classList.remove('hidden');
    step1.classList.remove('hidden');
    // Revert sidebar to whatever the current selection was (saved custom, or last preset)
    if (selectedConfig === 'custom' && savedCustomToolbar) {
        renderSidebar('custom');
    } else if (selectedConfig && selectedConfig !== 'custom') {
        renderSidebar(selectedConfig);
    }
    announceStep('step-1');
});

// --- CUSTOMIZE CREATION TOOLBAR STEP ---

const CREATION_TOOLBAR_LIBRARY = [
    { id: 'select', iconSrc: 'img/icons/arrow.svg', label: 'Select', title: 'Select' },
    { id: 'format', iconSrc: 'img/icons/format.svg', label: 'Formats and Flow', title: 'Formats and Flow' },
    { id: 'template', iconSrc: 'img/icons/template.svg', label: 'Templates', title: 'Templates' },
    { id: 'sticky', iconSrc: 'img/icons/sticky.svg', label: 'Sticky Note', title: 'Sticky Note' },
    { id: 'text', iconSrc: 'img/icons/text.svg', label: 'Text', title: 'Text' },
    { id: 'shapes', iconSrc: 'img/icons/shapes.svg', label: 'Shapes and Lines', title: 'Shapes and Lines' },
    { id: 'pen', iconSrc: 'img/icons/pen.svg', label: 'Pen Tool', title: 'Pen Tool' },
    { id: 'frame', iconSrc: 'img/icons/frame.svg', label: 'Frame', title: 'Frame' },
    { id: 'sticker', iconSrc: 'img/icons/sticker.svg', label: 'Stickers, emojis and GIFs', title: 'Stickers, emojis and GIFs' },
    { id: 'comment', iconSrc: 'img/icons/chat.svg', label: 'Comment', title: 'Comment' },
    { id: 'diagrams', iconSrc: 'img/icons/connect.svg', label: 'Diagrams', title: 'Diagrams' },
    { id: 'integrations', iconSrc: 'img/icons/more.svg', label: 'Tools, Media and Integrations', title: 'Tools, Media and Integrations' },
];

let creationToolbarDraft = CREATION_TOOLBAR_LIBRARY.map(t => ({ ...t, enabled: true }));
let savedCustomToolbar = null; // { name, tools: [{ id, label, iconSrc, title, enabled }] }

const stepCustomizeCreation = document.getElementById('step-customize-creation');
const customizeToolsList = document.getElementById('customize-tools-list');

function makeDefaultDraft() {
    return CREATION_TOOLBAR_LIBRARY.map(t => ({ ...t, enabled: true }));
}

function renderToolRows() {
    customizeToolsList.innerHTML = '';
    creationToolbarDraft.forEach((tool, idx) => {
        const row = document.createElement('div');
        row.className = 'tool-row';
        row.dataset.toolId = tool.id;
        row.dataset.index = String(idx);
        // Rows are NOT in the tab order — the listbox container is. Enter on the container
        // moves focus to row 1; Escape on a row returns focus to the container.
        row.setAttribute('tabindex', '-1');
        row.setAttribute('draggable', 'true');
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', tool.enabled ? 'true' : 'false');
        row.setAttribute('aria-describedby', 'tool-row-help');
        // Accessible name: "<tool name>, <position> of <total>"
        // The "tool-row-help" element supplies the keyboard instructions after the name.
        row.setAttribute('aria-label', `${tool.label}, ${idx + 1} of ${creationToolbarDraft.length}`);

        // Toggle checkbox — not separately tabbable; row owns focus
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.tabIndex = -1;
        toggle.className = 'tool-toggle-btn ' + (tool.enabled ? 'is-enabled' : 'is-disabled');
        toggle.setAttribute('role', 'checkbox');
        toggle.setAttribute('aria-checked', tool.enabled ? 'true' : 'false');
        // toggle.setAttribute('aria-label', tool.label);
        toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5L10 17.5L19 8.5" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleTool(tool.id);
        });
        row.appendChild(toggle);

        // Tool icon
        const iconWrap = document.createElement('div');
        iconWrap.className = 'tool-row-icon';
        const iconImg = document.createElement('img');
        iconImg.src = tool.iconSrc;
        iconImg.alt = '';
        iconWrap.appendChild(iconImg);
        row.appendChild(iconWrap);

        // Label
        const label = document.createElement('span');
        label.className = 'tool-row-label';
        label.textContent = tool.label;
        row.appendChild(label);

        // Drag handle
        const handle = document.createElement('button');
        handle.type = 'button';
        handle.className = 'tool-drag-handle';
        // handle.setAttribute('aria-label', 'Drag to reorder ' + tool.label);
        handle.tabIndex = -1;
        handle.textContent = '☰';
        row.appendChild(handle);

        // Drag events
        row.addEventListener('dragstart', onRowDragStart);
        row.addEventListener('dragover', onRowDragOver);
        row.addEventListener('dragleave', onRowDragLeave);
        row.addEventListener('drop', onRowDrop);
        row.addEventListener('dragend', onRowDragEnd);

        // Keyboard
        row.addEventListener('keydown', onRowKeyDown);

        customizeToolsList.appendChild(row);
    });
}

function renderSidebarFromDraft() {
    sidebar.innerHTML = '';
    const enabled = creationToolbarDraft.filter(t => t.enabled);
    enabled.forEach((tool, index) => {
        const btn = document.createElement('button');
        btn.className = 'icon-btn tool-btn';
        btn.setAttribute('role', 'radio');
        if (index === 0) { btn.classList.add('active'); btn.setAttribute('aria-checked', 'true'); }
        else { btn.setAttribute('aria-checked', 'false'); }
        btn.dataset.tool = tool.id;
        btn.title = tool.title;
        btn.setAttribute('aria-label', tool.title);
        const img = document.createElement('img');
        img.src = tool.iconSrc;
        img.alt = '';
        btn.appendChild(img);
        btn.addEventListener('click', (e) => activateToolBtn(e.currentTarget));
        sidebar.appendChild(btn);
    });
}

function renderCustomColumnFromSaved() {
    const customBtn = document.getElementById('custom-toolbar-btn');
    const editBtn = document.getElementById('edit-custom-btn');
    const colTitle = document.getElementById('custom-col-title');
    const previewBox = document.getElementById('custom-preview-box');

    if (!savedCustomToolbar) {
        colTitle.textContent = 'Create your own toolbar';
        previewBox.innerHTML =
            '<span class="custom-placeholder-icon" aria-hidden="true">?</span>' +
            '<span class="custom-placeholder-icon" aria-hidden="true">?</span>' +
            '<span class="add-btn" aria-hidden="true">+</span>';
        editBtn.classList.add('hidden');
        customBtn.classList.remove('selected');
        const orig = customBtn.getAttribute('data-original-text');
        if (orig) customBtn.innerText = orig;
        return;
    }

    colTitle.textContent = savedCustomToolbar.name;

    // Rebuild preview box: enabled tool icons in order + add-btn
    previewBox.innerHTML = '';
    savedCustomToolbar.tools.filter(t => t.enabled).forEach(tool => {
        const span = document.createElement('span');
        span.className = 'preview-tool-icon';
        const img = document.createElement('img');
        img.src = tool.iconSrc;
        img.alt = '';
        span.appendChild(img);
        previewBox.appendChild(span);
    });

    // Mark the custom select button as selected
    selectBtns.forEach(b => {
        b.classList.remove('selected');
        const orig = b.getAttribute('data-original-text');
        if (orig) b.innerText = orig;
    });
    if (!customBtn.getAttribute('data-original-text')) {
        customBtn.setAttribute('data-original-text', customBtn.innerText);
    }
    customBtn.classList.add('selected');
    customBtn.innerText = '✓ Selected';
    selectedConfig = 'custom';
    continueBtn.disabled = false;

    editBtn.classList.remove('hidden');
}

// --- Toggle / Reorder ---

function toggleTool(toolId) {
    const tool = creationToolbarDraft.find(t => t.id === toolId);
    if (!tool) return;
    tool.enabled = !tool.enabled;
    renderToolRows();
    renderSidebarFromDraft();
    // Restore focus on the same row
    const row = customizeToolsList.querySelector(`[data-tool-id="${toolId}"]`);
    if (row) row.focus();
    announcePolite(`${tool.label} ${tool.enabled ? 'added to' : 'removed from'} toolbar.`);
}

function moveTool(fromIndex, toIndex) {
    if (toIndex < 0 || toIndex >= creationToolbarDraft.length) return;
    const [moved] = creationToolbarDraft.splice(fromIndex, 1);
    creationToolbarDraft.splice(toIndex, 0, moved);
    renderToolRows();
    renderSidebarFromDraft();
    const row = customizeToolsList.querySelector(`[data-tool-id="${moved.id}"]`);
    if (row) row.focus();
    announcePolite('Moved.');
}

// --- Drag and drop ---

let dragSrcId = null;

function onRowDragStart(e) {
    dragSrcId = e.currentTarget.dataset.toolId;
    e.currentTarget.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', dragSrcId); } catch (_) { }
}

function onRowDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const row = e.currentTarget;
    if (row.dataset.toolId === dragSrcId) return;
    const rect = row.getBoundingClientRect();
    const isAfter = (e.clientY - rect.top) > rect.height / 2;
    row.classList.toggle('drag-over-bottom', isAfter);
    row.classList.toggle('drag-over-top', !isAfter);
}

function onRowDragLeave(e) {
    e.currentTarget.classList.remove('drag-over-top', 'drag-over-bottom');
}

function onRowDrop(e) {
    e.preventDefault();
    const targetRow = e.currentTarget;
    const targetId = targetRow.dataset.toolId;
    targetRow.classList.remove('drag-over-top', 'drag-over-bottom');
    if (!dragSrcId || targetId === dragSrcId) return;

    const rect = targetRow.getBoundingClientRect();
    const isAfter = (e.clientY - rect.top) > rect.height / 2;

    const fromIdx = creationToolbarDraft.findIndex(t => t.id === dragSrcId);
    let toIdx = creationToolbarDraft.findIndex(t => t.id === targetId);
    if (fromIdx < 0 || toIdx < 0) return;

    const [moved] = creationToolbarDraft.splice(fromIdx, 1);
    if (fromIdx < toIdx) toIdx -= 1;
    if (isAfter) toIdx += 1;
    creationToolbarDraft.splice(toIdx, 0, moved);

    renderToolRows();
    renderSidebarFromDraft();
    const movedRow = customizeToolsList.querySelector(`[data-tool-id="${moved.id}"]`);
    if (movedRow) movedRow.focus();
    announcePolite('Moved.');
}

function onRowDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    customizeToolsList.querySelectorAll('.drag-over-top, .drag-over-bottom')
        .forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom'));
    dragSrcId = null;
}

// --- Keyboard interactions ---

function onRowKeyDown(e) {
    const row = e.currentTarget;
    const toolId = row.dataset.toolId;
    const idx = creationToolbarDraft.findIndex(t => t.id === toolId);
    if (idx < 0) return;

    switch (e.key) {
        case 'Enter':
        case ' ':
        case 'Spacebar':
            e.preventDefault();
            toggleTool(toolId);
            break;
        case 'ArrowUp':
            e.preventDefault();
            moveTool(idx, idx - 1);
            break;
        case 'ArrowDown':
            e.preventDefault();
            moveTool(idx, idx + 1);
            break;
        case 'Tab': {
            // While inside the listbox, Tab/Shift+Tab cycle through rows
            // (Escape exits the section to the listbox container).
            e.preventDefault();
            const rows = Array.from(customizeToolsList.children);
            const currentIdx = rows.indexOf(row);
            if (currentIdx === -1 || rows.length === 0) return;
            const dir = e.shiftKey ? -1 : 1;
            const nextIdx = (currentIdx + dir + rows.length) % rows.length;
            rows[nextIdx].focus();
            break;
        }
        case 'Escape':
            e.preventDefault();
            customizeToolsList.focus();
            break;
    }
}

// Enter on the listbox container itself moves focus to row 1 (entering "edit mode").
customizeToolsList.addEventListener('keydown', (e) => {
    // Only handle when the listbox container itself is the focus target (not a row).
    if (e.target !== customizeToolsList) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        const firstRow = customizeToolsList.firstElementChild;
        if (firstRow) firstRow.focus();
    }
});

// --- Step entry / exit handlers ---

function enterCustomizeStep(fromStep) {
    creationToolbarDraft = savedCustomToolbar
        ? savedCustomToolbar.tools.map(t => ({ ...t }))
        : makeDefaultDraft();
    renderToolRows();
    renderSidebarFromDraft();
    if (fromStep) fromStep.classList.add('hidden');
    modalHeader.classList.add('hidden');
    stepCustomizeCreation.classList.remove('hidden');
    // Focus the listbox container, not a row — user presses Enter to start editing.
    customizeToolsList.focus();
    announceStep('step-customize-creation');
}

document.getElementById('continue-custom-name-btn').addEventListener('click', () => {
    enterCustomizeStep(stepCustomName);
});

document.getElementById('edit-custom-btn').addEventListener('click', () => {
    enterCustomizeStep(step1);
});

document.getElementById('customize-back-btn').addEventListener('click', (e) => {
    e.preventDefault();
    stepCustomizeCreation.classList.add('hidden');
    stepCustomName.classList.remove('hidden');
    document.getElementById('toolbar-name-input').focus();
    announceStep('step-custom-name');
});

document.getElementById('reset-default-btn').addEventListener('click', () => {
    creationToolbarDraft = makeDefaultDraft();
    renderToolRows();
    renderSidebarFromDraft();
    announcePolite('Toolbar reset to default. All 12 tools enabled.');
    // Focus stays on the Reset button so sighted keyboard users aren't surprised.
});

document.getElementById('save-customize-btn').addEventListener('click', () => {
    const nameInput = document.getElementById('toolbar-name-input');
    const enteredName = (nameInput && nameInput.value.trim()) || (savedCustomToolbar && savedCustomToolbar.name) || 'Custom toolbar';
    savedCustomToolbar = {
        name: enteredName,
        tools: creationToolbarDraft.map(t => ({ ...t })),
    };
    renderCustomColumnFromSaved();
    renderSidebarFromDraft();
    announcePolite(`Custom toolbar "${enteredName}" saved with ${creationToolbarDraft.filter(t => t.enabled).length} tools.`);
    // If launched from the accessibility menu, close the modal entirely
    if (modalEntryPoint === 'menu') {
        closeOnboardingAndReturnToBoard();
        return;
    }
    stepCustomizeCreation.classList.add('hidden');
    modalHeader.classList.remove('hidden');
    step1.classList.remove('hidden');
    // Move focus to the Continue button so the user can continue the onboarding flow without hunting.
    continueBtn.focus();
});

doneBtn.addEventListener('click', () => {
    onboardingOverlay.classList.add('hidden');
    setOnboardingBackgroundInert(false);
    announcePolite('Onboarding complete. Toolbar is now ready. Press Tab to navigate objects, or use the toolbar to create new ones. Press ? for keyboard shortcuts.');
    // Activate the Select tool by default and focus it
    setTimeout(() => {
        const selectBtn = sidebar.querySelector('[data-tool="select"]');
        if (selectBtn) {
            activateToolBtn(selectBtn);
            selectBtn.focus();
        }
    }, 100);
});

document.getElementById('settings-back-btn').addEventListener('click', () => {
    step2.classList.add('hidden');
    step1.classList.remove('hidden');
    announceStep('step-1');
});

// ─────────────────────────────────────────────────────────────────
// 16. CUSTOM TOOLBAR PICKER
// ─────────────────────────────────────────────────────────────────
const MAX_TOOLS = 8;
let customSelectedTools = [];

const allAvailableTools = {
    core: [
        { id: 'select', icon: '↖', title: 'Select (V)', label: 'Select' },
        { id: 'frame', icon: '🪟', title: 'Frame (F)', label: 'Frame' },
    ],
    creation: [
        { id: 'sticky', icon: '📝', title: 'Sticky Note (N)', label: 'Sticky' },
        { id: 'text', icon: 'T', title: 'Text (T)', label: 'Text' },
        { id: 'shape', icon: '⬛', title: 'Shape (S)', label: 'Shape' },
        { id: 'pen', icon: '🖊', title: 'Pen (P)', label: 'Pen' },
        { id: 'connect', icon: '🔗', title: 'Connector', label: 'Connect' },
        { id: 'image', icon: '🖼️', title: 'Image', label: 'Image' },
        { id: 'table', icon: '⊞', title: 'Table', label: 'Table' },
        { id: 'card', icon: '📇', title: 'Card', label: 'Card' },
    ],
    a11y: [
        { id: 'sr-describe', icon: '🗣️', title: 'Describe (Ctrl+I)', label: 'Describe' },
        { id: 'sr-overview', icon: '📋', title: 'Overview (Ctrl+D)', label: 'Overview' },
        { id: 'sr-navigate', icon: '🧭', title: 'Navigate Objects', label: 'Navigate' },
        { id: 'sr-shortcuts', icon: '⌨️', title: 'Shortcuts Panel', label: 'Shortcuts' },
    ]
};

function initCustomPicker() {
    renderPickerCategory('picker-grid-core', allAvailableTools.core);
    renderPickerCategory('picker-grid-creation', allAvailableTools.creation);
    renderPickerCategory('picker-grid-a11y', allAvailableTools.a11y);
    updatePickerPreview();
}

function renderPickerCategory(containerId, tools) {
    const grid = document.getElementById(containerId);
    if (!grid) return;
    grid.innerHTML = '';
    tools.forEach(tool => {
        const chip = document.createElement('button');
        chip.className = 'picker-tool-chip';
        chip.dataset.toolId = tool.id;
        chip.innerHTML = `<span class="chip-icon" aria-hidden="true">${tool.icon}</span><span class="chip-label">${tool.label}</span>`;
        chip.setAttribute('aria-pressed', 'false');
        chip.setAttribute('title', tool.title);
        chip.setAttribute('type', 'button');
        chip.addEventListener('click', () => togglePickerTool(tool, chip));
        grid.appendChild(chip);
    });
}

function togglePickerTool(tool, chipEl) {
    const isSelected = chipEl.classList.contains('chip-selected');
    if (!isSelected && customSelectedTools.length >= MAX_TOOLS) {
        announceAssertive(`Maximum of ${MAX_TOOLS} tools reached.`);
        return;
    }
    if (isSelected) {
        customSelectedTools = customSelectedTools.filter(t => t.id !== tool.id);
        chipEl.classList.remove('chip-selected');
        chipEl.setAttribute('aria-pressed', 'false');
    } else {
        customSelectedTools.push(tool);
        chipEl.classList.add('chip-selected');
        chipEl.setAttribute('aria-pressed', 'true');
    }
    updatePickerPreview();
    updateCustomPreviewBox();
    if (selectedConfig === 'custom') {
        continueBtn.disabled = customSelectedTools.length === 0;
        renderSidebar('custom');
    }
}

function updatePickerPreview() {
    const livePreview = document.getElementById('picker-live-preview');
    const countEl = document.getElementById('picker-count');
    if (!livePreview || !countEl) return;
    livePreview.innerHTML = '';
    if (customSelectedTools.length === 0) {
        livePreview.innerHTML = '<span style="font-size:12px;color:#bbb;">No tools selected yet</span>';
    } else {
        customSelectedTools.forEach(tool => {
            const chip = document.createElement('div');
            chip.className = 'preview-chip';
            chip.title = tool.title;
            chip.setAttribute('aria-label', tool.label);
            chip.textContent = tool.icon;
            livePreview.appendChild(chip);
        });
    }
    const count = customSelectedTools.length;
    countEl.textContent = `${count} / ${MAX_TOOLS} selected`;
    countEl.classList.toggle('at-max', count >= MAX_TOOLS);
}

function updateCustomPreviewBox() {
    const previewBox = document.getElementById('custom-preview-box');
    if (!previewBox) return;
    previewBox.innerHTML = '';
    if (customSelectedTools.length === 0) {
        previewBox.innerHTML = `<span class="custom-placeholder-icon">?</span><span class="custom-placeholder-icon">?</span><span class="add-btn">+</span>`;
    } else {
        customSelectedTools.forEach(tool => {
            const s = document.createElement('span');
            s.textContent = tool.icon;
            s.title = tool.label;
            previewBox.appendChild(s);
        });
    }
}

initCustomPicker();

// ─────────────────────────────────────────────────────────────────
// 17. KEYBOARD SHORTCUTS PANEL
// ─────────────────────────────────────────────────────────────────
const shortcutsPanel = document.getElementById('shortcuts-panel');
const shortcutsToggleBtn = document.getElementById('shortcuts-toggle-btn');
const shortcutsCloseBtn = document.getElementById('shortcuts-close-btn');

function openShortcutsPanel() {
    shortcutsPanel.classList.remove('hidden');
    shortcutsToggleBtn.setAttribute('aria-expanded', 'true');
    shortcutsCloseBtn.focus();
    announcePolite('Keyboard shortcuts panel opened.');
}

function closeShortcutsPanel() {
    shortcutsPanel.classList.add('hidden');
    shortcutsToggleBtn.setAttribute('aria-expanded', 'false');
    shortcutsToggleBtn.focus();
    announcePolite('Keyboard shortcuts panel closed.');
}

shortcutsToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    shortcutsPanel.classList.contains('hidden') ? openShortcutsPanel() : closeShortcutsPanel();
});
shortcutsCloseBtn.addEventListener('click', (e) => { e.stopPropagation(); closeShortcutsPanel(); });

document.addEventListener('click', (e) => {
    if (!shortcutsPanel.classList.contains('hidden') &&
        !shortcutsPanel.contains(e.target) &&
        e.target !== shortcutsToggleBtn &&
        !shortcutsToggleBtn.contains(e.target)) {
        closeShortcutsPanel();
    }
});

// ─────────────────────────────────────────────────────────────────
// 18. EXTENDED STICKY COLOUR PANEL
// ─────────────────────────────────────────────────────────────────
function initExtendedColorPanel() {
    if (!colorGridContainer) return;
    colorGridContainer.innerHTML = '';
    miroColors.forEach(color => {
        const swatch = document.createElement('div');
        swatch.className = 'sticky-color-swatch';
        swatch.style.backgroundColor = color;
        swatch.setAttribute('tabindex', '0');
        swatch.setAttribute('role', 'button');
        swatch.setAttribute('aria-label', `Set sticky colour to ${color}`);
        if (color === currentStickyColor) swatch.classList.add('selected-color');
        const pick = (e) => {
            e.stopPropagation();
            currentStickyColor = color;
            document.querySelectorAll('.sticky-color-swatch').forEach(s => s.classList.remove('selected-color'));
            swatch.classList.add('selected-color');
        };
        swatch.addEventListener('click', pick);
        swatch.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') pick(e); });
        colorGridContainer.appendChild(swatch);
    });
}

let stickyPanelReturnFocus = null;
window.addEventListener('click', () => {
    if (!stickyColorPanel) return;
    const wasOpen = !stickyColorPanel.classList.contains('hidden');
    const shouldOpen = activeTool === 'sticky';
    if (shouldOpen && !wasOpen) {
        stickyPanelReturnFocus = document.activeElement;
        stickyColorPanel.classList.remove('hidden');
        const firstSwatch = stickyColorPanel.querySelector('.sticky-color-swatch');
        if (firstSwatch) firstSwatch.focus();
        announcePolite('Sticky note colour picker opened. Use Tab and Enter to choose a colour.');
    } else if (!shouldOpen && wasOpen) {
        stickyColorPanel.classList.add('hidden');
        if (stickyPanelReturnFocus && document.contains(stickyPanelReturnFocus)) {
            stickyPanelReturnFocus.focus();
        }
        stickyPanelReturnFocus = null;
    }
});

initExtendedColorPanel();

// Step-2 toggle switches (role=switch buttons). Two helpers below let click handlers
// AND menu mirrors set the value without re-toggling.
function setStep2Switch(btn, checked, announce = true) {
    if (!btn) return;
    const current = btn.getAttribute('aria-checked') === 'true';
    if (current === checked) return;
    btn.setAttribute('aria-checked', checked ? 'true' : 'false');
    if (announce) {
        // Mirror standard screen-reader checkbox feedback: just "checked" or "unchecked".
        announcePolite(checked ? 'Checked.' : 'Unchecked.');
    }
    if (typeof syncMenuTogglesFromSettings === 'function') syncMenuTogglesFromSettings();
}
document.querySelectorAll('#step-2 .toggle-switch[role="checkbox"]').forEach(btn => {
    btn.addEventListener('click', () => {
        setStep2Switch(btn, btn.getAttribute('aria-checked') !== 'true');
    });
});

// ─────────────────────────────────────────────────────────────────
// 17. ACCESSIBILITY MENU
// ─────────────────────────────────────────────────────────────────
const a11yMenuBtn = document.getElementById('a11y-menu-btn');
const a11yMenu = document.getElementById('a11y-menu');
const a11ySubmenuToolbars = document.getElementById('a11y-submenu-toolbars');
const a11ySubmenuSr = document.getElementById('a11y-submenu-sr');
let modalEntryPoint = null; // null | 'menu' | 'onboarding'

// ----- positioning -----
function positionA11yMenu() {
    const r = a11yMenuBtn.getBoundingClientRect();
    // Drop the menu directly under the trigger, aligning roughly with the board title position
    a11yMenu.style.top = `${r.bottom + 8}px`;
    a11yMenu.style.left = `${r.left - 60}px`;
}
function positionSubmenuFor(triggerEl, submenuEl) {
    const r = triggerEl.getBoundingClientRect();
    const menuR = a11yMenu.getBoundingClientRect();
    submenuEl.style.top = `${r.top}px`;
    submenuEl.style.left = `${menuR.right + 6}px`;
}

// ----- focusable items inside a menu -----
function getMenuItems(container) {
    return Array.from(container.querySelectorAll(':scope > .a11y-menu-item'));
}
function setRovingFocus(container, target) {
    const items = getMenuItems(container);
    items.forEach(it => it.setAttribute('tabindex', it === target ? '0' : '-1'));
    if (target) target.focus();
}

// ----- open / close -----
function openA11yMenu() {
    positionA11yMenu();
    a11yMenu.classList.remove('hidden');
    a11yMenuBtn.setAttribute('aria-expanded', 'true');
    const items = getMenuItems(a11yMenu);
    setRovingFocus(a11yMenu, items[0]);
}
function closeAllSubmenus() {
    [a11ySubmenuToolbars, a11ySubmenuSr].forEach(sub => {
        if (!sub) return;
        sub.classList.add('hidden');
        const trig = document.getElementById(sub.getAttribute('aria-labelledby'));
        if (trig) trig.setAttribute('aria-expanded', 'false');
    });
}
function closeA11yMenu(returnFocus = true) {
    closeAllSubmenus();
    a11yMenu.classList.add('hidden');
    a11yMenuBtn.setAttribute('aria-expanded', 'false');
    if (returnFocus) a11yMenuBtn.focus();
}
function openSubmenu(triggerEl) {
    const submenuId = triggerEl.getAttribute('aria-controls');
    const submenu = document.getElementById(submenuId);
    if (!submenu) return;
    // Close any other open submenu first
    [a11ySubmenuToolbars, a11ySubmenuSr].forEach(sub => {
        if (sub && sub !== submenu) {
            sub.classList.add('hidden');
            const otherTrig = document.getElementById(sub.getAttribute('aria-labelledby'));
            if (otherTrig) otherTrig.setAttribute('aria-expanded', 'false');
        }
    });
    if (submenuId === 'a11y-submenu-toolbars') renderToolbarSubmenu();
    positionSubmenuFor(triggerEl, submenu);
    submenu.classList.remove('hidden');
    triggerEl.setAttribute('aria-expanded', 'true');
    const items = getMenuItems(submenu);
    setRovingFocus(submenu, items[0]);
}
function closeSubmenu(submenuEl, returnFocus = true) {
    if (!submenuEl || submenuEl.classList.contains('hidden')) return;
    submenuEl.classList.add('hidden');
    const trig = document.getElementById(submenuEl.getAttribute('aria-labelledby'));
    if (trig) {
        trig.setAttribute('aria-expanded', 'false');
        if (returnFocus) {
            const mainItems = getMenuItems(a11yMenu);
            mainItems.forEach(it => it.setAttribute('tabindex', it === trig ? '0' : '-1'));
            trig.focus();
        }
    }
}

// ----- trigger button -----
a11yMenuBtn.addEventListener('click', () => {
    if (a11yMenu.classList.contains('hidden')) openA11yMenu();
    else closeA11yMenu();
});
a11yMenuBtn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openA11yMenu();
    }
});

// ----- submenu trigger clicks -----
document.querySelectorAll('#a11y-menu .submenu-trigger').forEach(trigger => {
    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const submenuId = trigger.getAttribute('aria-controls');
        const submenu = document.getElementById(submenuId);
        if (submenu && !submenu.classList.contains('hidden')) {
            closeSubmenu(submenu, false);
        } else {
            openSubmenu(trigger);
        }
    });
});

// ----- keyboard navigation inside menus -----
function handleMenuKeydown(container, e) {
    const items = getMenuItems(container);
    const idx = items.indexOf(document.activeElement);
    switch (e.key) {
        case 'ArrowDown':
            e.preventDefault();
            setRovingFocus(container, items[(idx + 1) % items.length]);
            break;
        case 'ArrowUp':
            e.preventDefault();
            setRovingFocus(container, items[(idx - 1 + items.length) % items.length]);
            break;
        case 'Home':
            e.preventDefault();
            setRovingFocus(container, items[0]);
            break;
        case 'End':
            e.preventDefault();
            setRovingFocus(container, items[items.length - 1]);
            break;
        case 'Escape':
            e.preventDefault();
            if (container === a11yMenu) closeA11yMenu();
            else closeSubmenu(container);
            break;
        case 'ArrowRight':
            if (container === a11yMenu && document.activeElement.classList.contains('submenu-trigger')) {
                e.preventDefault();
                openSubmenu(document.activeElement);
            }
            break;
        case 'ArrowLeft':
            if (container !== a11yMenu) {
                e.preventDefault();
                closeSubmenu(container);
            }
            break;
        case 'Enter':
        case ' ':
            e.preventDefault();
            document.activeElement.click();
            break;
    }
}
a11yMenu.addEventListener('keydown', (e) => handleMenuKeydown(a11yMenu, e));
a11ySubmenuToolbars.addEventListener('keydown', (e) => handleMenuKeydown(a11ySubmenuToolbars, e));
a11ySubmenuSr.addEventListener('keydown', (e) => handleMenuKeydown(a11ySubmenuSr, e));

// ----- click outside closes everything -----
document.addEventListener('click', (e) => {
    if (a11yMenu.classList.contains('hidden')) return;
    if (a11yMenuBtn.contains(e.target)) return;
    if (a11yMenu.contains(e.target)) return;
    if (a11ySubmenuToolbars.contains(e.target)) return;
    if (a11ySubmenuSr.contains(e.target)) return;
    closeA11yMenu(false);
});

// ----- toggle sync (menu ↔ step-2) -----
// Step-2 toggles are <button role="checkbox" aria-checked="true|false"> elements.
function getSettingInput(id) {
    const h4 = document.getElementById(id);
    if (!h4) return null;
    const card = h4.closest('.setting-card');
    return card ? card.querySelector('.toggle-switch[role="checkbox"]') : null;
}
function isSettingChecked(el) {
    return el && el.getAttribute('aria-checked') === 'true';
}
function setSettingChecked(el, checked) {
    if (el) el.setAttribute('aria-checked', checked ? 'true' : 'false');
}
function syncMenuTogglesFromSettings() {
    document.querySelectorAll('.a11y-toggle-row[data-mirrors]').forEach(row => {
        const btn = getSettingInput(row.dataset.mirrors);
        if (btn) row.setAttribute('aria-checked', isSettingChecked(btn) ? 'true' : 'false');
    });
}

document.querySelectorAll('.a11y-toggle-row').forEach(row => {
    const activate = () => {
        const next = row.getAttribute('aria-checked') !== 'true';
        row.setAttribute('aria-checked', String(next));
        const mirrorId = row.dataset.mirrors;
        if (mirrorId) {
            const btn = getSettingInput(mirrorId);
            // setStep2Switch updates aria-checked, announces, AND re-syncs all menu mirrors.
            setStep2Switch(btn, next);
        } else {
            announcePolite(`${row.querySelector('.a11y-menu-label').textContent.trim()} turned ${next ? 'on' : 'off'}.`);
        }
    };
    row.addEventListener('click', activate);
});

// ----- toolbar submenu rendering -----
function renderToolbarSubmenu() {
    a11ySubmenuToolbars.innerHTML = '';
    const make = (config, label) => {
        const row = document.createElement('div');
        row.className = 'a11y-menu-item a11y-radio-row';
        row.setAttribute('role', 'menuitemradio');
        row.setAttribute('tabindex', '-1');
        row.setAttribute('aria-checked', selectedConfig === config ? 'true' : 'false');
        row.dataset.config = config;
        row.innerHTML = `<span class="a11y-menu-label"></span><span class="a11y-radio-dot" aria-hidden="true"></span>`;
        row.querySelector('.a11y-menu-label').textContent = label;
        row.addEventListener('click', () => pickToolbarConfig(config));
        return row;
    };
    a11ySubmenuToolbars.appendChild(make('simple', 'Simple'));
    a11ySubmenuToolbars.appendChild(make('default', 'Default'));
    if (savedCustomToolbar) {
        a11ySubmenuToolbars.appendChild(make('custom', `${savedCustomToolbar.name} (custom)`));
    }
    const divider = document.createElement('div');
    divider.className = 'a11y-menu-divider';
    divider.setAttribute('role', 'separator');
    a11ySubmenuToolbars.appendChild(divider);

    const actionBtn = document.createElement('button');
    actionBtn.type = 'button';
    actionBtn.className = 'a11y-menu-item';
    actionBtn.setAttribute('role', 'menuitem');
    actionBtn.id = 'a11y-toolbar-action-btn';
    actionBtn.setAttribute('tabindex', '-1');
    actionBtn.textContent = savedCustomToolbar
        ? `Edit ${savedCustomToolbar.name}`
        : 'Create custom toolbar';
    actionBtn.addEventListener('click', openCustomFlowFromMenu);
    a11ySubmenuToolbars.appendChild(actionBtn);
}

function pickToolbarConfig(configKey) {
    selectedConfig = configKey;
    renderSidebar(configKey);
    // Keep step-1 select buttons in sync
    selectBtns.forEach(b => {
        const matches = b.getAttribute('data-config') === configKey;
        b.classList.toggle('selected', matches);
        const orig = b.getAttribute('data-original-text');
        if (!matches && orig) b.innerText = orig;
        if (matches) {
            if (!b.getAttribute('data-original-text')) b.setAttribute('data-original-text', b.innerText);
            b.innerText = '✓ Selected';
        }
    });
    continueBtn.disabled = false;
    a11ySubmenuToolbars.querySelectorAll('[role="menuitemradio"]').forEach(r => {
        r.setAttribute('aria-checked', r.dataset.config === configKey ? 'true' : 'false');
    });
    const niceName = configKey === 'custom' && savedCustomToolbar
        ? savedCustomToolbar.name
        : configKey.charAt(0).toUpperCase() + configKey.slice(1);
    announcePolite(`${niceName} toolbar selected.`);
}

// ----- open custom flow from menu (Edit / Create) -----
function openCustomFlowFromMenu() {
    modalEntryPoint = 'menu';
    closeA11yMenu(false);
    onboardingOverlay.classList.remove('hidden');
    setOnboardingBackgroundInert(true);
    step1.classList.add('hidden');
    step2.classList.add('hidden');
    stepCustomizeCreation.classList.add('hidden');
    modalHeader.classList.add('hidden');
    stepCustomName.classList.remove('hidden');
    const nameInput = document.getElementById('toolbar-name-input');
    if (savedCustomToolbar) nameInput.value = savedCustomToolbar.name;
    nameInput.focus();
    announceStep('step-custom-name');
}

// ----- shared close handler for menu-launched modal -----
function closeOnboardingAndReturnToBoard() {
    onboardingOverlay.classList.add('hidden');
    modalHeader.classList.remove('hidden');
    step1.classList.remove('hidden');
    stepCustomName.classList.add('hidden');
    stepCustomizeCreation.classList.add('hidden');
    step2.classList.add('hidden');
    setOnboardingBackgroundInert(false);
    modalEntryPoint = null;
    a11yMenuBtn.focus();
    announcePolite('Returned to board.');
}

// ----- "Accessibility Onboarding" menu item -----
document.getElementById('a11y-onboarding-btn').addEventListener('click', () => {
    modalEntryPoint = 'onboarding';
    closeA11yMenu(false);
    onboardingOverlay.classList.remove('hidden');
    setOnboardingBackgroundInert(true);
    modalHeader.classList.remove('hidden');
    step1.classList.remove('hidden');
    stepCustomName.classList.add('hidden');
    stepCustomizeCreation.classList.add('hidden');
    step2.classList.add('hidden');
    if (savedCustomToolbar) renderCustomColumnFromSaved();
    announceStep('step-1');
});

// ----- Accessibility Checker stub -----
document.getElementById('a11y-checker-btn').addEventListener('click', () => {
    announcePolite('Accessibility Checker is not yet available.');
});

// Initialize menu state
syncMenuTogglesFromSettings();

// On initial load, announce step 1 (do NOT auto-focus the title — that produced a triple
// "Accessibility Settings, heading level 2" announcement on top of the dialog's own
// aria-labelledby/describedby announcement).
if (onboardingOverlay && !onboardingOverlay.classList.contains('hidden')) {
    setTimeout(() => announceStep('step-1'), 50);
}
