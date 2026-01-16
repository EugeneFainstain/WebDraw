const COLORS = [
    // Color circle - saturated colors
    '#FF0000', // Red
    '#FF8000', // Orange
    '#FFFF00', // Yellow
    '#00FF00', // Green
    '#00FFFF', // Cyan
    '#0000FF', // Blue
    '#8000FF', // Purple
    '#FF00FF', // Magenta
    // Grayscale
    '#FFFFFF', // White
    '#808080', // 50% gray
    '#404040', // 25% gray
    '#000000', // Black
];

const SIZES = [1, 2, 3, 4, 6, 8, 10, 13, 16, 20, 25, 40];

export function createCombinedPicker(
    triggerElement: HTMLElement,
    onColorChange: (color: string) => void,
    onSizeChange: (size: number) => void,
    onGridToggle?: () => void,
    onBeforeOpen?: () => void
) {
    let currentColor = COLORS[1]; // Orange
    let currentSize = SIZES[4]; // Default to 6
    let popup: HTMLElement | null = null;
    let isGridActive = false;

    // Style the trigger element - looks like size picker but with colored dot
    function updateTrigger() {
        triggerElement.style.backgroundColor = '#333';
        triggerElement.style.border = '2px solid #666';
        triggerElement.style.borderRadius = '4px';
        triggerElement.style.cursor = 'pointer';
        triggerElement.style.display = 'flex';
        triggerElement.style.alignItems = 'center';
        triggerElement.style.justifyContent = 'center';

        // Clear and redraw the size indicator with current color
        triggerElement.innerHTML = '';
        const dot = document.createElement('div');
        const displaySize = Math.min(currentSize, 24); // Cap display size
        dot.style.cssText = `
            width: ${displaySize}px;
            height: ${displaySize}px;
            background: ${currentColor};
            border-radius: 50%;
        `;
        triggerElement.appendChild(dot);
    }

    function createPopup() {
        const container = document.createElement('div');
        container.style.cssText = `
            position: absolute;
            background: #2a2a2a;
            border: 1px solid #555;
            border-radius: 8px;
            padding: 8px;
            z-index: 1000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            display: flex;
            flex-direction: column;
            gap: 8px;
        `;

        // Color picker section
        const colorGrid = document.createElement('div');
        colorGrid.style.cssText = `
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 6px;
        `;

        COLORS.forEach(color => {
            const swatch = document.createElement('div');
            swatch.style.cssText = `
                width: 40px;
                height: 40px;
                background: ${color};
                border: 2px solid ${color === currentColor ? '#fff' : '#444'};
                border-radius: 4px;
                cursor: pointer;
            `;
            swatch.addEventListener('click', (e) => {
                e.stopPropagation();
                currentColor = color;
                onColorChange(color);
                updateTrigger();
                // Update all swatches to show current selection
                updateColorSwatches();
                // Update size dots to use new color
                updateSizeDots();
                closePopup();
            });
            colorGrid.appendChild(swatch);
        });

        // Separator line
        const separator = document.createElement('div');
        separator.style.cssText = `
            height: 1px;
            background: #555;
            margin: 0;
        `;

        // Size picker section
        const sizeGrid = document.createElement('div');
        sizeGrid.style.cssText = `
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 6px;
        `;

        SIZES.forEach(size => {
            const cell = document.createElement('div');
            cell.style.cssText = `
                width: 40px;
                height: 40px;
                background: ${size === currentSize ? '#555' : '#333'};
                border: 2px solid ${size === currentSize ? '#fff' : '#444'};
                border-radius: 4px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
            `;

            const dot = document.createElement('div');
            const displaySize = Math.min(size, 32); // Cap display size in popup
            dot.style.cssText = `
                width: ${displaySize}px;
                height: ${displaySize}px;
                background: ${currentColor};
                border-radius: 50%;
            `;
            cell.appendChild(dot);

            cell.addEventListener('click', (e) => {
                e.stopPropagation();
                currentSize = size;
                onSizeChange(size);
                updateTrigger();
                // Update all size cells to show current selection
                updateSizeCells();
                closePopup();
            });

            sizeGrid.appendChild(cell);
        });

        // Second separator line
        const separator2 = document.createElement('div');
        separator2.style.cssText = `
            height: 1px;
            background: #555;
            margin: 0;
        `;

        // Buttons section
        const buttonsContainer = document.createElement('div');
        buttonsContainer.style.cssText = `
            display: flex;
            gap: 8px;
        `;

        // Grid button
        let gridBtn: HTMLElement | null = null;
        if (onGridToggle) {
            gridBtn = document.createElement('button');
            gridBtn.style.cssText = `
                flex: 1;
                height: 40px;
                background: ${isGridActive ? '#4a90d9' : '#555'};
                color: #fff;
                border: 2px solid #444;
                border-radius: 4px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                font-size: 14px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            `;

            // Grid icon SVG
            const gridIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            gridIcon.setAttribute('viewBox', '0 0 24 24');
            gridIcon.setAttribute('width', '18');
            gridIcon.setAttribute('height', '18');
            gridIcon.setAttribute('fill', 'currentColor');
            const gridPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            gridPath.setAttribute('d', 'M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z');
            gridIcon.appendChild(gridPath);

            const gridText = document.createElement('span');
            gridText.textContent = 'Grid';

            gridBtn.appendChild(gridIcon);
            gridBtn.appendChild(gridText);

            gridBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                onGridToggle();
                closePopup();
            });

            buttonsContainer.appendChild(gridBtn);
        }

        container.appendChild(colorGrid);
        container.appendChild(separator);
        container.appendChild(sizeGrid);

        // Only add the second separator and buttons if we have grid toggle callback
        if (onGridToggle) {
            container.appendChild(separator2);
            container.appendChild(buttonsContainer);
        }

        // Store references for updating
        (container as any)._colorGrid = colorGrid;
        (container as any)._sizeGrid = sizeGrid;
        (container as any)._gridBtn = gridBtn;

        return container;
    }

    function updateColorSwatches() {
        if (!popup) return;
        const colorGrid = (popup as any)._colorGrid;
        if (!colorGrid) return;

        const swatches = colorGrid.children;
        COLORS.forEach((color, index) => {
            const swatch = swatches[index] as HTMLElement;
            if (swatch) {
                swatch.style.border = `2px solid ${color === currentColor ? '#fff' : '#444'}`;
            }
        });
    }

    function updateSizeDots() {
        if (!popup) return;
        const sizeGrid = (popup as any)._sizeGrid;
        if (!sizeGrid) return;

        const cells = sizeGrid.children;
        for (let i = 0; i < cells.length; i++) {
            const cell = cells[i] as HTMLElement;
            const dot = cell.firstChild as HTMLElement;
            if (dot) {
                dot.style.background = currentColor;
            }
        }
    }

    function updateSizeCells() {
        if (!popup) return;
        const sizeGrid = (popup as any)._sizeGrid;
        if (!sizeGrid) return;

        const cells = sizeGrid.children;
        SIZES.forEach((size, index) => {
            const cell = cells[index] as HTMLElement;
            if (cell) {
                cell.style.background = size === currentSize ? '#555' : '#333';
                cell.style.border = `2px solid ${size === currentSize ? '#fff' : '#444'}`;
            }
        });
    }

    function positionPopup() {
        if (!popup) return;
        const rect = triggerElement.getBoundingClientRect();
        popup.style.left = `${rect.left}px`;
        popup.style.top = `${rect.bottom + 4}px`;
    }

    function openPopup() {
        if (popup) return;
        // Close any other open pickers first
        if (onBeforeOpen) onBeforeOpen();
        popup = createPopup();
        document.body.appendChild(popup);
        positionPopup();

        // Close on outside click (for non-canvas elements like other toolbar buttons).
        // This only handles mouse clicks and touches on non-canvas areas.
        // Canvas taps don't fire 'click' events because pointer handlers call preventDefault(),
        // so canvas taps are handled via state machine -> CLEAR_HIGHLIGHTING -> closePickersIfOutside()
        setTimeout(() => {
            document.addEventListener('click', handleOutsideClick);
        }, 0);
    }

    function closePopup() {
        if (popup) {
            popup.remove();
            popup = null;
            document.removeEventListener('click', handleOutsideClick);
        }
    }

    function handleOutsideClick(e: MouseEvent) {
        if (popup && !popup.contains(e.target as Node) && e.target !== triggerElement) {
            closePopup();
        }
    }

    function updateGridButton() {
        if (!popup) return;
        const gridBtn = (popup as any)._gridBtn as HTMLElement | null;
        if (gridBtn) {
            gridBtn.style.background = isGridActive ? '#4a90d9' : '#555';
        }
    }

    triggerElement.addEventListener('click', (e) => {
        e.stopPropagation();
        if (popup) {
            closePopup();
        } else {
            openPopup();
        }
    });

    updateTrigger();

    return {
        getColor: () => currentColor,
        getSize: () => currentSize,
        setColor: (color: string) => {
            if (COLORS.includes(color)) {
                currentColor = color;
                updateTrigger();
            }
        },
        setSize: (size: number) => {
            // Accept any valid size value, not just ones in SIZES array
            // This allows the radial menu to use its own size values
            currentSize = size;
            updateTrigger();
        },
        setGridActive: (active: boolean) => {
            isGridActive = active;
            updateGridButton();
        },
        close: closePopup,
        isOpen: () => popup !== null
    };
}
