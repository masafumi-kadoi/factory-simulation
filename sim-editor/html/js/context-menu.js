// Right-click Context Menu
export class ContextMenu {
    constructor(editor) {
        this.editor = editor;
        this._el = null;
        this._setupGlobalHide();
    }

    show(clientX, clientY, items) {
        this.hide();
        this._justShown = true;
        requestAnimationFrame(() => { this._justShown = false; });
        const el = document.createElement('div');
        el.className = 'context-menu';

        items.forEach(item => {
            if (item.type === 'separator') {
                const sep = document.createElement('div');
                sep.className = 'context-menu-separator';
                el.appendChild(sep);
                return;
            }

            const btn = document.createElement('button');
            btn.className = 'context-menu-item';

            const label = document.createElement('span');
            label.textContent = item.label;
            btn.appendChild(label);

            if (item.shortcut) {
                const sc = document.createElement('span');
                sc.className = 'shortcut';
                sc.textContent = item.shortcut;
                btn.appendChild(sc);
            }

            if (item.disabled) {
                btn.disabled = true;
                btn.style.opacity = '0.4';
                btn.style.cursor = 'default';
            }

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.hide();
                if (!item.disabled) item.action();
            });

            el.appendChild(btn);
        });

        el.style.left = clientX + 'px';
        el.style.top = clientY + 'px';
        document.body.appendChild(el);

        // Ensure menu stays within viewport
        const rect = el.getBoundingClientRect();
        if (rect.right > window.innerWidth) el.style.left = (clientX - rect.width) + 'px';
        if (rect.bottom > window.innerHeight) el.style.top = (clientY - rect.height) + 'px';

        this._el = el;
    }

    hide() {
        if (this._el) {
            this._el.remove();
            this._el = null;
        }
    }

    _setupGlobalHide() {
        document.addEventListener('click', () => this.hide());
        document.addEventListener('contextmenu', () => {
            if (!this._justShown) this.hide();
        });
    }

    // Build menu items for station right-click
    stationItems(stationId) {
        const station = this.editor.getStation(stationId);
        const items = [
            { label: 'コピー', shortcut: '\u2318C', action: () => this.editor.triggerCopy() },
            { label: 'カット', shortcut: '\u2318X', action: () => this.editor.triggerCut() },
            { label: 'ペースト', shortcut: '\u2318V', action: () => this.editor.triggerPaste(), disabled: !this.editor.hasClipboard() },
            { type: 'separator' },
            { label: '削除', shortcut: 'Delete', action: () => {
                if (this.editor.selectedStationIds.size > 1) {
                    this.editor.deleteMultipleStations([...this.editor.selectedStationIds]);
                } else {
                    this.editor.deleteStation(stationId);
                }
            }},
            { label: 'プロパティ', action: () => this.editor.selectItem({ type: 'station', id: stationId }) },
        ];
        if (station && station.type === 'moduler') {
            items.push({ type: 'separator' });
            items.push({ label: '内部を編集', action: () => this.editor.drillDown(stationId) });
        }
        return items;
    }

    // Build menu items for empty canvas right-click
    canvasItems() {
        return [
            { label: 'ペースト', shortcut: '\u2318V', action: () => this.editor.triggerPaste(), disabled: !this.editor.hasClipboard() },
            { label: '全選択', shortcut: '\u2318A', action: () => this.editor.selectAll() },
            { type: 'separator' },
            { label: '自動整列', action: () => this.editor.autoLayout() },
            { label: '画面にフィット', shortcut: '\u23180', action: () => this.editor.triggerFitToScreen() },
        ];
    }

    // Build menu items for connection right-click
    connectionItems(connectionIndex) {
        return [
            { label: '削除', shortcut: 'Delete', action: () => this.editor.deleteConnection(connectionIndex) },
            { label: 'プロパティ', action: () => this.editor.selectItem({ type: 'connection', index: connectionIndex }) },
        ];
    }
}
