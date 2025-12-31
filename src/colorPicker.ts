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

export function createColorPicker(
    triggerElement: HTMLElement,
    onChange: (color: string) => void,
    onOpen?: () => void
) {
    let currentColor = COLORS[0];
    let popup: HTMLElement | null = null;

    // Style the trigger element to show current color
    function updateTrigger() {
        triggerElement.style.backgroundColor = '#333';
        triggerElement.style.border = '2px solid #666';
        triggerElement.style.borderRadius = '4px';
        triggerElement.style.cursor = 'pointer';
        triggerElement.style.display = 'flex';
        triggerElement.style.alignItems = 'center';
        triggerElement.style.justifyContent = 'center';

        // Clear and redraw the color indicator
        triggerElement.innerHTML = '';
        const colorSquare = document.createElement('div');
        colorSquare.style.cssText = `
            width: 26px;
            height: 26px;
            background: ${currentColor};
            border-radius: 2px;
        `;
        triggerElement.appendChild(colorSquare);
    }

    function createPopup() {
        const div = document.createElement('div');
        div.style.cssText = `
            position: absolute;
            background: #2a2a2a;
            border: 1px solid #555;
            border-radius: 8px;
            padding: 8px;
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 6px;
            z-index: 1000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
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
                onChange(color);
                updateTrigger();
                closePopup();
            });
            div.appendChild(swatch);
        });

        return div;
    }

    function positionPopup() {
        if (!popup) return;
        const rect = triggerElement.getBoundingClientRect();
        popup.style.left = `${rect.left}px`;
        popup.style.top = `${rect.bottom + 4}px`;
    }

    function openPopup() {
        if (popup) return;
        // Notify that this picker is opening (to close other pickers)
        if (onOpen) onOpen();
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
        setColor: (color: string) => {
            if (COLORS.includes(color)) {
                currentColor = color;
                updateTrigger();
            }
        },
        close: closePopup,
        isOpen: () => popup !== null
    };
}
