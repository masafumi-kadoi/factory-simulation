// Tooltip Manager
export class TooltipManager {
    constructor() {
        this.tooltip = null;
        this.currentTarget = null;
        this.showTimeout = null;
        this._createTooltip();
    }

    _createTooltip() {
        this.tooltip = document.createElement('div');
        this.tooltip.className = 'tooltip';
        document.body.appendChild(this.tooltip);
    }

    attach(element, text, delay = 500) {
        element.addEventListener('mouseenter', (e) => {
            this.currentTarget = element;
            this.showTimeout = setTimeout(() => {
                this._show(e, text);
            }, delay);
        });

        element.addEventListener('mouseleave', () => {
            this._hide();
        });

        element.addEventListener('mousemove', (e) => {
            if (this.tooltip.classList.contains('show')) {
                this._updatePosition(e);
            }
        });
    }

    _show(e, text) {
        if (!this.currentTarget) return;

        this.tooltip.textContent = text;
        this.tooltip.classList.add('show');
        this._updatePosition(e);
    }

    _hide() {
        clearTimeout(this.showTimeout);
        this.currentTarget = null;
        this.tooltip.classList.remove('show');
    }

    _updatePosition(e) {
        const rect = this.tooltip.getBoundingClientRect();
        let x = e.clientX - rect.width / 2;
        let y = e.clientY - rect.height - 10;

        // Keep tooltip within viewport
        if (x < 5) x = 5;
        if (x + rect.width > window.innerWidth - 5) {
            x = window.innerWidth - rect.width - 5;
        }
        if (y < 5) {
            y = e.clientY + 10; // Show below cursor if too close to top
        }

        this.tooltip.style.left = x + 'px';
        this.tooltip.style.top = y + 'px';
    }

    destroy() {
        if (this.tooltip) {
            this.tooltip.remove();
        }
    }
}
