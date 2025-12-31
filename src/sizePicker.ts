// 12 sizes in a 4x3 grid (1 to 40, exponentially distributed for better UX)
const SIZES = [1, 2, 3, 4, 6, 8, 10, 13, 16, 20, 25, 40];

export function createSizePicker(
    triggerElement: HTMLElement,
    onChange: (size: number) => void,
    onOpen?: () => void
) {
    let currentSize = SIZES[4]; // Default to 6
    let popup: HTMLElement | null = null;

    // Style the trigger element and draw current size
    function updateTrigger() {
        triggerElement.style.backgroundColor = '#333';
        triggerElement.style.border = '2px solid #666';
        triggerElement.style.borderRadius = '4px';
        triggerElement.style.cursor = 'pointer';
        triggerElement.style.display = 'flex';
        triggerElement.style.alignItems = 'center';
        triggerElement.style.justifyContent = 'center';

        // Clear and redraw the size indicator
        triggerElement.innerHTML = '';
        const dot = document.createElement('div');
        const displaySize = Math.min(currentSize, 24); // Cap display size
        dot.style.cssText = `
            width: ${displaySize}px;
            height: ${displaySize}px;
            background: white;
            border-radius: 50%;
        `;
        triggerElement.appendChild(dot);
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
                background: white;
                border-radius: 50%;
            `;
            cell.appendChild(dot);

            cell.addEventListener('click', (e) => {
                e.stopPropagation();
                currentSize = size;
                onChange(size);
                updateTrigger();
                closePopup();
            });

            div.appendChild(cell);
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
        getSize: () => currentSize,
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
