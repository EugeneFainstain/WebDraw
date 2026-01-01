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
    onSizeChange: (size: number) => void
) {
    let currentColor = COLORS[1]; // Orange
    let currentSize = SIZES[4]; // Default to 6
    let popup: HTMLElement | null = null;

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
            });

            sizeGrid.appendChild(cell);
        });

        container.appendChild(colorGrid);
        container.appendChild(separator);
        container.appendChild(sizeGrid);

        // Store references for updating
        (container as any)._colorGrid = colorGrid;
        (container as any)._sizeGrid = sizeGrid;

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
        popup = createPopup();
        document.body.appendChild(popup);
        positionPopup();

        // Close on outside click
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
            if (SIZES.includes(size)) {
                currentSize = size;
                updateTrigger();
            }
        },
        close: closePopup,
        isOpen: () => popup !== null
    };
}
