import { Visualizer3D } from './visualizer.js';

export class ModulerModal {
    constructor(parentElement, zIndexBase = 10000) {
        this._parentElement = parentElement;
        this._zIndexBase = zIndexBase;
        this._overlay = null;
        this._visualizer = null;
        this._childModals = [];
        this._opened = false;
        this._modulerId = null;
        this._onClose = null;
        this._onOpenNestedModal = null;
    }

    open(scenario, modulerName, modulerId, mouseConfig) {
        this._modulerId = modulerId;
        this._opened = true;

        this._overlay = document.createElement('div');
        this._overlay.style.cssText = `position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:${this._zIndexBase}`;

        const modal = document.createElement('div');
        modal.style.cssText = 'background:#1a1a2e;border-radius:12px;width:80vw;height:70vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.7);overflow:hidden';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:12px 20px;background:#16213e;border-bottom:1px solid #2a3f5f';

        const title = document.createElement('span');
        title.style.cssText = 'color:#89b4fa;font-size:16px;font-weight:bold';
        title.textContent = modulerName || modulerId;

        const closeBtn = document.createElement('button');
        closeBtn.style.cssText = 'background:none;border:none;color:#6c7086;font-size:24px;cursor:pointer;padding:0 4px;line-height:1';
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', () => this.close());

        header.appendChild(title);
        header.appendChild(closeBtn);
        modal.appendChild(header);

        const container3d = document.createElement('div');
        container3d.style.cssText = 'flex:1;position:relative';
        modal.appendChild(container3d);

        this._overlay.appendChild(modal);

        this._overlay.addEventListener('click', (e) => {
            if (e.target === this._overlay) this.close();
        });
        modal.addEventListener('click', (e) => e.stopPropagation());

        this._parentElement.appendChild(this._overlay);

        this._visualizer = new Visualizer3D(container3d, mouseConfig);
        this._visualizer.loadScenario(scenario);

        this._visualizer.setOnModulerDoubleClick((stationId) => {
            if (this._onOpenNestedModal) {
                this._onOpenNestedModal(stationId, this);
            }
        });
    }

    setOnOpenNestedModal(callback) {
        this._onOpenNestedModal = callback;
    }

    setOnClose(callback) {
        this._onClose = callback;
    }

    update(works, signalStates, currentTime) {
        if (!this._visualizer || !this._opened) return;
        this._visualizer.updateWorks(works, currentTime);
        this._visualizer.updateInterlockStates(signalStates);
    }

    addChildModal(modal) {
        this._childModals.push(modal);
    }

    close() {
        for (const child of [...this._childModals]) {
            child.close();
        }
        this._childModals = [];

        if (this._visualizer) {
            this._visualizer.clear();
            this._visualizer = null;
        }
        if (this._overlay) {
            this._overlay.remove();
            this._overlay = null;
        }
        this._opened = false;

        if (this._onClose) {
            this._onClose(this);
        }
    }

    isOpen() {
        return this._opened;
    }

    get modulerId() {
        return this._modulerId;
    }
}
