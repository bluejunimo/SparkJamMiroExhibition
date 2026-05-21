// --- 1. STATE & GLOBALS ---
let activeTool = 'select'; // select, text, sticky, shape, pen, frame
let boardX = 0, boardY = 0; // Board pan offset
const connections = [];

// DOM Elements
const viewport = document.getElementById('viewport');
const board = document.getElementById('board');
const htmlLayer = document.getElementById('html-layer');
const pathsGroup = document.getElementById('paths');
const drawingsGroup = document.getElementById('drawings');
const toolBtns = document.querySelectorAll('.tool-btn');
const sidebar = document.getElementById('sidebar');

// Unified 16-color modern Miro palette matrix
const miroColors = [
    '#fff59d', '#ffe082', // Soft Light Yellow, Rich Amber Warm Yellow
    '#ffb74d', '#ff8a80', // Light Vibrant Orange, Muted Coral Salmon Pink
    '#f8bbd0', '#f48fb1', // Pastel Light Pink, Deep Fuchsia Pink Accent
    '#ce93d8', '#b39ddb', // Soft Lavender Blossom, Electric Violet Purple
    '#81d4fa', '#90caf9', // Sky Blue, Classic Dodger Blue Tint
    '#80cbc4', '#a5d6a7', // Mint Teal Green, Leafy Emerald Sage Green
    '#c5e1a5', '#e6ee9c', // Soft Pastel Olive Green, Neon Chartreuse
    '#eeeeee', '#212121'  // Crisp Clean Solid White, Deep Charcoal Slate Black
];
let currentStickyColor = miroColors[0];

const stickyColorPanel = document.getElementById('sticky-color-panel');
const colorGridContainer = document.getElementById('color-grid-container');

// --- 2. TOOLBAR SELECTION & INITIALIZATION ---
// Main UI sidebar click handler tracking
toolBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        toolBtns.forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        activeTool = e.currentTarget.dataset.tool;

        // Update cursors
        viewport.style.cursor = activeTool === 'select' ? 'grab' : 'crosshair';
    });
});

// Calculate true coordinates relative to the panning board
function getBoardCoordinates(clientX, clientY) {
    return {
        x: clientX - boardX,
        y: clientY - boardY
    };
}

// --- 3. VIEWPORT INTERACTIONS (Panning, Drawing, Spawning) ---
let isPanning = false, isDrawing = false;
let startPanX = 0, startPanY = 0;
let currentDrawingPath = null;

viewport.addEventListener('mousedown', (e) => {
    if (e.target.closest('.toolbar') || e.target.closest('.board-object') || e.target.closest('#sticky-color-panel')) return;

    // Deselect everything
    document.querySelectorAll('.board-object').forEach(el => el.classList.remove('active-obj'));

    const coords = getBoardCoordinates(e.clientX, e.clientY);

    if (activeTool === 'select') {
        isPanning = true;
        startPanX = e.clientX - boardX;
        startPanY = e.clientY - boardY;
        viewport.style.cursor = 'grabbing';
    }
    else if (activeTool === 'pen') {
        isDrawing = true;
        currentDrawingPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        currentDrawingPath.setAttribute('stroke', '#050038');
        currentDrawingPath.setAttribute('stroke-width', '4');
        currentDrawingPath.setAttribute('fill', 'none');
        currentDrawingPath.setAttribute('stroke-linecap', 'round');
        currentDrawingPath.setAttribute('stroke-linejoin', 'round');
        currentDrawingPath.setAttribute('d', `M ${coords.x} ${coords.y}`);
        drawingsGroup.appendChild(currentDrawingPath);
    }
    else {
        spawnObject(activeTool, coords.x, coords.y);

        // Auto-revert to select tool after spawning
        const selectBtn = document.querySelector('[data-tool="select"]');
        if (selectBtn) selectBtn.click();
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
        const coords = getBoardCoordinates(e.clientX, e.clientY);
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

// --- 4. OBJECT CREATION FACTORY ---
function fitTextToContainer(el) {
    const textarea = el.querySelector('textarea');
    if (!textarea) return;

    let fontSize = parseInt(el.style.height || el.offsetHeight) * 0.35;
    fontSize = Math.max(12, Math.min(fontSize, 48));

    textarea.style.fontSize = `${fontSize}px`;

    while (
        (textarea.scrollHeight > el.clientHeight || textarea.scrollWidth > el.clientWidth) &&
        fontSize > 10
    ) {
        fontSize--;
        textarea.style.fontSize = `${fontSize}px`;
    }
}

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

function addColorPicker(el) {
    const palette = document.createElement('div');
    palette.className = 'color-palette';

    // Rainbow colors for general shape structures
    const shapeColors = ['#ffeb3b', '#ff9800', '#ff5722', '#e91e63', '#9c27b0', '#2196f3', '#4caf50'];

    shapeColors.forEach(color => {
        const dot = document.createElement('div');
        dot.className = 'color-dot';
        dot.style.backgroundColor = color;
        dot.addEventListener('click', (e) => {
            e.stopPropagation();
            el.style.backgroundColor = color;
        });
        palette.appendChild(dot);
    });
    el.appendChild(palette);
}

function spawnDrawingObject(bbox, pathData) {
    const el = document.createElement('div');
    el.className = 'board-object drawing-box';
    el.style.left = `${bbox.x}px`;
    el.style.top = `${bbox.y}px`;
    el.style.width = `${bbox.width}px`;
    el.style.height = `${bbox.height}px`;

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
    el.appendChild(textarea);

    htmlLayer.appendChild(el);
    makeDraggable(el);
    setupTextEditing(el, textarea);
}

function autoResizeTextarea(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
}

function spawnObject(type, x, y) {
    const el = document.createElement('div');
    el.className = 'board-object';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;

    const wrapper = document.createElement('div');
    wrapper.className = 'text-container-wrapper';

    const textarea = document.createElement('textarea');
    textarea.placeholder = 'Type...';
    wrapper.appendChild(textarea);

    if (type === 'sticky') {
        el.classList.add('sticky-note');
        el.style.backgroundColor = currentStickyColor;

        el.appendChild(wrapper);
        addHandles(el);
        setupTextEditing(el, textarea);

        textarea.addEventListener('input', () => {
            autoResizeTextarea(textarea);
            if (typeof updateConnections === 'function') updateConnections();
        });
        setTimeout(() => autoResizeTextarea(textarea), 10);
        
        // REMOVED: Color mutation click handling listener from here entirely
    }
    else if (type === 'shape') {
        el.classList.add('shape-rect');
        el.appendChild(wrapper);
        addHandles(el);
        addColorPicker(el);
        setupTextEditing(el, textarea);

        textarea.addEventListener('input', () => fitTextToContainer(el));
        setTimeout(() => fitTextToContainer(el), 10);
    }
    else if (type === 'text') {
        el.classList.add('text-box');
        textarea.placeholder = 'Add text...';
        el.appendChild(wrapper);
        setupTextEditing(el, textarea);
    }
    else if (type === 'frame') {
        el.classList.add('frame-box');
        const title = document.createElement('div');
        title.className = 'frame-title';
        title.innerText = 'New Frame';
        el.appendChild(title);
    }

    htmlLayer.appendChild(el);
    makeDraggable(el);
    el.classList.add('active-obj');
}

function addHandles(el) {
    ['top', 'right', 'bottom', 'left'].forEach(pos => {
        const handle = document.createElement('div');
        handle.className = `conn-handle ${pos}`;
        handle.onmousedown = (e) => beginConnectionDraw(e, el);
        el.appendChild(handle);
    });
}

// --- 5. DRAGGING LOGIC ---
function makeDraggable(el) {
    el.onmousedown = function(e) {
        if (activeTool !== 'select') return;
        if (e.target.classList.contains('conn-handle') || e.target.classList.contains('color-dot') || e.target.closest('.color-palette')) return;
        if (el.classList.contains('editing')) return;

        document.querySelectorAll('.board-object').forEach(obj => obj.classList.remove('active-obj'));
        el.classList.add('active-obj');

        let shiftX = e.clientX - el.getBoundingClientRect().left;
        let shiftY = e.clientY - el.getBoundingClientRect().top;
        
        let attachedObjects = [];
        if (el.classList.contains('frame-box')) {
            const frameRect = el.getBoundingClientRect();
            
            document.querySelectorAll('.board-object:not(.frame-box)').forEach(obj => {
                const objRect = obj.getBoundingClientRect();
                if (
                    objRect.left >= frameRect.left && 
                    objRect.right <= frameRect.right &&
                    objRect.top >= frameRect.top && 
                    objRect.bottom <= frameRect.bottom
                ) {
                    attachedObjects.push({
                        element: obj,
                        offsetX: obj.offsetLeft - el.offsetLeft,
                        offsetY: obj.offsetTop - el.offsetTop
                    });
                }
            });
        }

        function moveAt(pageX, pageY) {
            const coords = getBoardCoordinates(pageX, pageY);
            const newX = coords.x - shiftX;
            const newY = coords.y - shiftY;
            
            el.style.left = `${newX}px`;
            el.style.top = `${newY}px`;

            attachedObjects.forEach(item => {
                item.element.style.left = `${newX + item.offsetX}px`;
                item.element.style.top = `${newY + item.offsetY}px`;
            });

            if (typeof updateConnections === 'function') updateConnections();
        }

        function onMouseMove(moveEvent) {
            moveAt(moveEvent.clientX, moveEvent.clientY);
        }

        document.addEventListener('mousemove', onMouseMove);
        
        el.onmouseup = function() {
            document.removeEventListener('mousemove', onMouseMove);
            el.onmouseup = null;
        };
    };
    el.ondragstart = () => false;
}

// --- 6. CONNECTOR LOGIC ---
// --- 6. UPDATED CONNECTOR LOGIC (MIRO CURVES) ---
let isDrawingConnection = false;
let tempPath = null;
let currentSourceObj = null;

function beginConnectionDraw(e, sourceObj) {
    e.stopPropagation();
    isDrawingConnection = true;
    currentSourceObj = sourceObj;

    tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    tempPath.setAttribute('stroke', '#9b99af'); // Modern Miro slate-grey accent
    tempPath.setAttribute('stroke-width', '2');
    tempPath.setAttribute('fill', 'none');
    tempPath.setAttribute('stroke-linecap', 'round');
    tempPath.setAttribute('marker-end', 'url(#arrowhead)');
    pathsGroup.appendChild(tempPath);
}

// Generates an elegant, natural horizontal S-curve path string between coordinates
function calculateMiroCurve(sx, sy, tx, ty) {
    const deltaX = Math.abs(tx - sx);
    // Control point distance dynamically scales based on how far apart the items are
    const controlOffset = Math.min(deltaX * 0.5, 120); 
    
    const cp1x = sx + controlOffset;
    const cp1y = sy;
    const cp2x = tx - controlOffset;
    const cp2y = ty;

    return `M ${sx} ${sy} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${tx} ${ty}`;
}

window.addEventListener('mousemove', (e) => {
    if (isDrawingConnection && tempPath) {
        const sx = currentSourceObj.offsetLeft + currentSourceObj.offsetWidth / 2;
        const sy = currentSourceObj.offsetTop + currentSourceObj.offsetHeight / 2;
        const coords = getBoardCoordinates(e.clientX, e.clientY);
        
        // Dynamically bend path data in real-time tracking
        tempPath.setAttribute('d', calculateMiroCurve(sx, sy, coords.x, coords.y));
    }
});

window.addEventListener('mouseup', (e) => {
    if (isDrawingConnection) {
        isDrawingConnection = false;
        const targetObj = document.elementFromPoint(e.clientX, e.clientY)?.closest('.board-object');

        if (targetObj && targetObj !== currentSourceObj) {
            const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            pathEl.setAttribute('stroke', '#9b99af');
            pathEl.setAttribute('stroke-width', '2');
            pathEl.setAttribute('fill', 'none');
            pathEl.setAttribute('stroke-linecap', 'round');
            pathEl.setAttribute('marker-end', 'url(#arrowhead)');
            pathsGroup.appendChild(pathEl);

            connections.push({ source: currentSourceObj, target: targetObj, path: pathEl });
            updateConnections();
        }

        if (tempPath) tempPath.remove();
        tempPath = null;
        currentSourceObj = null;
        
        const selectBtn = document.querySelector('[data-tool="select"]');
        if (selectBtn) selectBtn.click();
    }
});

function updateConnections() {
    connections.forEach(conn => {
        const sRect = { left: conn.source.offsetLeft, top: conn.source.offsetTop, width: conn.source.offsetWidth, height: conn.source.offsetHeight };
        const tRect = { left: conn.target.offsetLeft, top: conn.target.offsetTop, width: conn.target.offsetWidth, height: conn.target.offsetHeight };

        const sx = sRect.left + sRect.width / 2;
        const sy = sRect.top + sRect.height / 2;
        const tx = tRect.left + tRect.width / 2;
        const ty = tRect.top + tRect.height / 2;

        const dx = tx - sx;
        const dy = ty - sy;

        // Uses your streamlined local coordinate intersection math natively
        const start = getIntersection(sRect, dx, dy, false);
        const end = getIntersection(tRect, -dx, -dy, true);

        // Apply smooth Bezier algorithm calculations directly to standard state loops
        conn.path.setAttribute('d', calculateMiroCurve(start.x, start.y, end.x, end.y));
    });
}

function getIntersection(rect, dx, dy, isTarget) {
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const hw = rect.width / 2;
    const hh = rect.height / 2;

    const scaleX = dx === 0 ? Infinity : hw / Math.abs(dx);
    const scaleY = dy === 0 ? Infinity : hh / Math.abs(dy);
    const scale = Math.min(scaleX, scaleY);

    const padding = isTarget ? 14 : 0;
    const length = Math.sqrt(dx * dx + dy * dy);
    const adjustedScale = Math.max(0, scale - (padding / length));

    return { x: cx + dx * adjustedScale, y: cy + dy * adjustedScale };
}


// --- 7. ONBOARDING & DYNAMIC SIDEBAR LOGIC ---
const onboardingOverlay = document.getElementById('onboarding-overlay');
const step1 = document.getElementById('step-1');
const step2 = document.getElementById('step-2');
const selectBtns = document.querySelectorAll('.select-tool-btn');
const continueBtn = document.getElementById('continue-btn');
const doneBtn = document.getElementById('done-btn');

let selectedConfig = null;

const toolConfigs = {
    simple: [
        { id: 'select', icon: '↖', title: 'Select (V)' },
        { id: 'frame', icon: '🪟', title: 'Frame (F)' },
        { id: 'sticky', icon: '📝', title: 'Sticky Note (N)' },
        { id: 'shape', icon: '⬛', title: 'Shape (S)' }
    ],
    default: [
        { id: 'select', icon: '↖', title: 'Select (V)' },
        { id: 'text', icon: 'T', title: 'Text (T)' },
        { id: 'sticky', icon: '📝', title: 'Sticky Note (N)' },
        { id: 'shape', icon: '⬛', title: 'Shape (S)' },
        { id: 'pen', icon: '🖊', title: 'Pen (P)' },
        { id: 'frame', icon: '🪟', title: 'Frame (F)' }
    ],
    custom: [
        { id: 'select', icon: '↖', title: 'Select (V)' },
        { id: 'text', icon: 'T', title: 'Text (T)' },
        { id: 'custom-add', icon: '➕', title: 'Add Tools' }
    ]
};

function renderSidebar(configKey) {
    sidebar.innerHTML = '';
    const tools = toolConfigs[configKey];

    tools.forEach((tool, index) => {
        const btn = document.createElement('button');
        btn.className = 'icon-btn tool-btn';
        if (index === 0) btn.classList.add('active');
        btn.dataset.tool = tool.id;
        btn.title = tool.title;
        btn.innerText = tool.icon;

        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            activeTool = e.currentTarget.dataset.tool;
            viewport.style.cursor = activeTool === 'select' ? 'grab' : 'crosshair';
        });

        sidebar.appendChild(btn);
    });
}

selectBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        selectBtns.forEach(b => {
            b.classList.remove('selected');
            b.innerText = b.getAttribute('data-original-text') || b.innerText;
        });

        const target = e.currentTarget;
        if (!target.getAttribute('data-original-text')) {
            target.setAttribute('data-original-text', target.innerText);
        }

        target.classList.add('selected');
        target.innerText = 'Selected';

        selectedConfig = target.getAttribute('data-config');
        continueBtn.disabled = false;

        renderSidebar(selectedConfig);
    });
});

continueBtn.addEventListener('click', () => {
    step1.classList.add('hidden');
    step2.classList.remove('hidden');
});

doneBtn.addEventListener('click', () => {
    onboardingOverlay.classList.add('hidden');
});

// --- 8. EXTENDED COLOR PALETTE LIFECYCLE ---
function initExtendedColorPanel() {
    if (!colorGridContainer) return;
    colorGridContainer.innerHTML = '';
    
    miroColors.forEach(color => {
        const swatch = document.createElement('div');
        swatch.className = 'sticky-color-swatch';
        swatch.style.backgroundColor = color;
        
        if (color === currentStickyColor) {
            swatch.classList.add('selected-color');
        }

        swatch.addEventListener('click', (e) => {
            e.stopPropagation();
            currentStickyColor = color;
            
            document.querySelectorAll('.sticky-color-swatch').forEach(s => s.classList.remove('selected-color'));
            swatch.classList.add('selected-color');

            const stickyBtn = document.querySelector('[data-tool="sticky"]');
            if (stickyBtn) stickyBtn.style.backgroundColor = currentStickyColor;
        });

        colorGridContainer.appendChild(swatch);
    });
}

// Global UI visibility alignment listener loop tracking tool swaps cleanly
window.addEventListener('click', () => {
    if (!stickyColorPanel) return;

    if (activeTool === 'sticky') {
        stickyColorPanel.classList.remove('hidden');
        const stickyBtn = document.querySelector('[data-tool="sticky"]');
        if (stickyBtn) stickyBtn.style.backgroundColor = currentStickyColor;
    } else {
        stickyColorPanel.classList.add('hidden');
        const stickyBtn = document.querySelector('[data-tool="sticky"]');
        if (stickyBtn) stickyBtn.style.backgroundColor = 'transparent';
    }
});

initExtendedColorPanel();

// --- 9. ACCESSIBLE KEYBOARD NAVIGATION & SPARK GENERATOR (BLIND USER OPTIMIZED) ---
let isWaitingForDirection = false;
let directionTimeout = null;

// Accessible Hidden Live Region for Screen Readers
const sraudio = document.createElement('div');
sraudio.setAttribute('aria-live', 'assertive');
sraudio.setAttribute('aria-atomic', 'true');
sraudio.className = 'sr-only'; 
// Style note for your CSS: .sr-only { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden; }
document.body.appendChild(sraudio);

function announceToScreenReader(message) {
    sraudio.textContent = '';
    setTimeout(() => {
        sraudio.textContent = message;
    }, 50);
}

window.addEventListener('keydown', (e) => {
    // 1. Never intercept if they are actively typing text details inside a sticky
    if (document.activeElement && document.activeElement.tagName === 'TEXTAREA') return;

    const selectedEl = document.querySelector('.board-object.active-obj');
    
    // Phase 1: User hits 'N' or 'n' to initialize the note generation sequence
    if ((e.key === 'n' || e.key === 'N') && !isWaitingForDirection) {
        if (!selectedEl) {
            announceToScreenReader("No object selected. Please select an element first using Tab.");
            return;
        }
        
        isWaitingForDirection = true;
        e.preventDefault();
        
        announceToScreenReader("Create note mode active. Press Right Arrow to clone right, or Shift plus Down Arrow to link below.");
        
        // Timeout window: Clear state if they don't press an arrow within 5 seconds
        clearTimeout(directionTimeout);
        directionTimeout = setTimeout(() => {
            if (isWaitingForDirection) {
                isWaitingForDirection = false;
                announceToScreenReader("Create note mode timed out.");
            }
        }, 5000);
        return;
    }

    // Phase 2: Action execution once sequence is listening
    if (isWaitingForDirection && selectedEl) {
        const currentX = parseFloat(selectedEl.style.left);
        const currentY = parseFloat(selectedEl.style.top);
        const currentW = selectedEl.offsetWidth || 100;
        const currentH = selectedEl.offsetHeight || 100;
        const spacingGap = 60; // Slightly larger gap for cleaner structural layout tracking

        // Action 1: N -> Right Arrow (Spawn to the right)
        if (e.key === 'ArrowRight' && !e.shiftKey) {
            e.preventDefault();
            isWaitingForDirection = false;
            clearTimeout(directionTimeout);

            const spawnX = currentX + currentW + spacingGap;
            const spawnY = currentY;

            spawnObject('sticky', spawnX, spawnY);
            
            // Move systemic active focus smoothly to the newly generated asset
            const newSticky = document.querySelector('.board-object.active-obj');
            if (newSticky) {
                const textarea = newSticky.querySelector('textarea');
                if (textarea) textarea.focus();
            }
            announceToScreenReader("Sticky note created to the right. Text editor opened.");
        }

        // Action 2: Shift + Down Arrow (Spawn below with a curve connector)
        if (e.key === 'ArrowDown' && e.shiftKey) {
            e.preventDefault();
            isWaitingForDirection = false;
            clearTimeout(directionTimeout);

            const spawnX = currentX;
            const spawnY = currentY + currentH + spacingGap;

            // Spawn the object natively
            spawnObject('sticky', spawnX, spawnY);
            const targetEl = document.querySelector('.board-object.active-obj');

            if (targetEl && targetEl !== selectedEl) {
                // Build Miro curved vector connector path explicitly
                const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                pathEl.setAttribute('stroke', '#9b99af');
                pathEl.setAttribute('stroke-width', '2');
                pathEl.setAttribute('fill', 'none');
                pathEl.setAttribute('stroke-linecap', 'round');
                pathEl.setAttribute('marker-end', 'url(#arrowhead)');
                pathsGroup.appendChild(pathEl);

                connections.push({ source: selectedEl, target: targetEl, path: pathEl });
                updateConnections();
                
                const textarea = targetEl.querySelector('textarea');
                if (textarea) textarea.focus();
            }
            announceToScreenReader("Sticky note created below and linked with a connector line. Text editor opened.");
        }
    }
});