export function createMenuPicker(
    triggerElement: HTMLElement,
    onFullscreen: () => void,
    onReset: () => void
) {
    let popup: HTMLElement | null = null;

    // Style the trigger element - hamburger menu icon
    function updateTrigger() {
        triggerElement.style.backgroundColor = '#555';
        triggerElement.style.border = '2px solid #666';
        triggerElement.style.borderRadius = '4px';
        triggerElement.style.cursor = 'pointer';
        triggerElement.style.display = 'flex';
        triggerElement.style.alignItems = 'center';
        triggerElement.style.justifyContent = 'center';

        // Clear and create hamburger icon (square with three horizontal lines)
        triggerElement.innerHTML = '';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '20');
        svg.setAttribute('height', '20');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.style.color = '#fff';

        // Outer square
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', '3');
        rect.setAttribute('y', '3');
        rect.setAttribute('width', '18');
        rect.setAttribute('height', '18');
        rect.setAttribute('rx', '2');
        rect.setAttribute('ry', '2');
        svg.appendChild(rect);

        // Three horizontal lines
        const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line1.setAttribute('x1', '7');
        line1.setAttribute('y1', '8');
        line1.setAttribute('x2', '17');
        line1.setAttribute('y2', '8');
        svg.appendChild(line1);

        const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line2.setAttribute('x1', '7');
        line2.setAttribute('y1', '12');
        line2.setAttribute('x2', '17');
        line2.setAttribute('y2', '12');
        svg.appendChild(line2);

        const line3 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line3.setAttribute('x1', '7');
        line3.setAttribute('y1', '16');
        line3.setAttribute('x2', '17');
        line3.setAttribute('y2', '16');
        svg.appendChild(line3);

        triggerElement.appendChild(svg);
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
            min-width: 160px;
        `;

        // Fullscreen button
        const fullscreenBtn = document.createElement('button');
        fullscreenBtn.style.cssText = `
            height: 44px;
            background: #555;
            color: #fff;
            border: 2px solid #444;
            border-radius: 4px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: flex-start;
            gap: 10px;
            padding: 0 12px;
            font-size: 14px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;

        // Check current fullscreen state
        const isFullscreen = !!document.fullscreenElement;

        // Fullscreen icon SVG
        const fullscreenIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        fullscreenIcon.setAttribute('viewBox', '0 0 24 24');
        fullscreenIcon.setAttribute('width', '18');
        fullscreenIcon.setAttribute('height', '18');
        fullscreenIcon.setAttribute('fill', 'none');
        fullscreenIcon.setAttribute('stroke', 'currentColor');
        fullscreenIcon.setAttribute('stroke-width', '2');
        fullscreenIcon.setAttribute('stroke-linecap', 'round');
        fullscreenIcon.setAttribute('stroke-linejoin', 'round');
        const fullscreenPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        fullscreenPath.setAttribute('d', 'M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3');
        fullscreenIcon.appendChild(fullscreenPath);

        const fullscreenText = document.createElement('span');
        fullscreenText.textContent = isFullscreen ? 'Exit Fullscreen' : 'Fullscreen';

        fullscreenBtn.appendChild(fullscreenIcon);
        fullscreenBtn.appendChild(fullscreenText);

        fullscreenBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            onFullscreen();
            closePopup();
        });

        container.appendChild(fullscreenBtn);

        // Separator
        const separator = document.createElement('div');
        separator.style.cssText = `
            height: 1px;
            background: #555;
            margin: 0;
        `;
        container.appendChild(separator);

        // Reset button
        const resetBtn = document.createElement('button');
        resetBtn.style.cssText = `
            height: 44px;
            background: #d94a4a;
            color: #fff;
            border: 2px solid #444;
            border-radius: 4px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: flex-start;
            gap: 10px;
            padding: 0 12px;
            font-size: 14px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;

        // Reset icon SVG (same as clear button)
        const resetIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        resetIcon.setAttribute('viewBox', '0 0 512 512');
        resetIcon.setAttribute('width', '18');
        resetIcon.setAttribute('height', '18');
        resetIcon.setAttribute('fill', 'currentColor');
        const resetPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        resetPath.setAttribute('d', 'M228.576 26.213v207.32h54.848V26.214h-54.848zm-28.518 45.744C108.44 96.58 41 180.215 41 279.605c0 118.74 96.258 215 215 215 118.74 0 215-96.26 215-215 0-99.39-67.44-183.025-159.057-207.647v50.47c64.6 22.994 110.85 84.684 110.85 157.177 0 92.117-74.676 166.794-166.793 166.794-92.118 0-166.794-74.678-166.794-166.795 0-72.494 46.25-134.183 110.852-157.178v-50.47z');
        resetIcon.appendChild(resetPath);

        const resetText = document.createElement('span');
        resetText.textContent = 'Reset';

        resetBtn.appendChild(resetIcon);
        resetBtn.appendChild(resetText);

        resetBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            onReset();
            closePopup();
        });

        container.appendChild(resetBtn);

        return container;
    }

    function positionPopup() {
        if (!popup) return;
        const rect = triggerElement.getBoundingClientRect();
        // Position popup to the left of the trigger so it doesn't go off-screen
        const popupWidth = 176; // min-width + padding + border
        popup.style.left = `${Math.max(10, rect.right - popupWidth)}px`;
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
        close: closePopup,
        isOpen: () => popup !== null
    };
}
