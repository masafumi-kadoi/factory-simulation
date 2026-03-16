// Menu Bar - Mac-style dropdown menus
export class MenuBar {
    constructor(container, editor) {
        this.container = container;
        this.editor = editor;
        this._openMenu = null;
        this._menuDefs = this._buildMenuDefs();
        this._render();
        this._setupGlobalClose();
    }

    _buildMenuDefs() {
        return [
            {
                id: 'scenario', label: 'シナリオ',
                items: [
                    { id: 'import', label: 'JSONインポート', shortcut: '', action: () => this.editor.triggerImport() },
                    { id: 'export', label: 'JSONエクスポート', shortcut: '', action: () => this.editor.triggerExport() },
                    { type: 'separator' },
                    { id: 'save', label: '保存', shortcut: '\u2318S', action: () => this.editor.triggerSave() },
                    { id: 'autosave', label: '自動保存', shortcut: '', toggle: () => this.editor.isAutoSave(), action: () => this.editor.toggleAutoSave() },
                ]
            },
            {
                id: 'edit', label: '編集',
                items: [
                    { id: 'undo', label: '元に戻す', shortcut: '\u2318Z', action: () => this.editor.triggerUndo() },
                    { id: 'redo', label: 'やり直し', shortcut: '\u21e7\u2318Z', action: () => this.editor.triggerRedo() },
                    { type: 'separator' },
                    { id: 'copy', label: 'コピー', shortcut: '\u2318C', action: () => this.editor.triggerCopy(), disabled: () => !this.editor.hasSelection() },
                    { id: 'cut', label: 'カット', shortcut: '\u2318X', action: () => this.editor.triggerCut(), disabled: () => !this.editor.hasSelection() },
                    { id: 'paste', label: 'ペースト', shortcut: '\u2318V', action: () => this.editor.triggerPaste(), disabled: () => !this.editor.hasClipboard() },
                ]
            },
            {
                id: 'view', label: '表示',
                items: [
                    { id: 'fit', label: '画面にフィット', shortcut: '\u23180', action: () => this.editor.triggerFitToScreen() },
                    { id: 'zoom-in', label: 'ズームイン', shortcut: '\u2318+', action: () => this.editor.triggerZoomIn() },
                    { id: 'zoom-out', label: 'ズームアウト', shortcut: '\u2318-', action: () => this.editor.triggerZoomOut() },
                    { id: 'auto-layout', label: '自動整列', shortcut: '', action: () => this.editor.autoLayout() },
                    { type: 'separator' },
                    { id: 'minimap', label: 'ミニマップ', shortcut: '', toggle: () => this.editor.isMinimapVisible(), action: () => this.editor.toggleMinimap() },
                    { id: 'grid-snap', label: 'グリッドスナップ', shortcut: '', toggle: () => this.editor.isGridSnap(), action: () => this.editor.toggleGridSnap() },
                    { id: 'alignment-guide', label: 'アライメントガイド', shortcut: '', toggle: () => this.editor.isAlignmentGuide(), action: () => this.editor.toggleAlignmentGuide() },
                    { type: 'separator' },
                    { id: 'line-style', label: '接続線スタイル', shortcut: '', submenu: [
                        { id: 'line-straight', label: '直線', action: () => this.editor.setLineStyle('straight'), active: () => this.editor.getLineStyle() === 'straight' },
                        { id: 'line-bezier', label: 'ベジェ曲線', action: () => this.editor.setLineStyle('bezier'), active: () => this.editor.getLineStyle() === 'bezier' },
                        { id: 'line-orthogonal', label: '直角折れ線', action: () => this.editor.setLineStyle('orthogonal'), active: () => this.editor.getLineStyle() === 'orthogonal' },
                    ]},
                    { type: 'separator' },
                    { id: 'theme', label: 'テーマ', shortcut: '', submenu: [
                        { id: 'theme-light', label: 'ライト', action: () => this.editor.setTheme('light'), active: () => this.editor.getThemeMode() === 'light' },
                        { id: 'theme-dark', label: 'ダーク', action: () => this.editor.setTheme('dark'), active: () => this.editor.getThemeMode() === 'dark' },
                        { id: 'theme-auto', label: 'OS連動', action: () => this.editor.setTheme('auto'), active: () => this.editor.getThemeMode() === 'auto' },
                    ]},
                ]
            },
            {
                id: 'settings', label: '設定',
                items: [
                    { id: 'mouse-config', label: 'マウス操作設定', shortcut: '', action: () => this.editor.openMouseConfig() },
                ]
            },
            {
                id: 'simdb', label: 'SimDB',
                items: [
                    { id: 'simdb-settings', label: '接続先設定', shortcut: '', action: () => this.editor.openSimDBSettings() },
                ]
            },
            {
                id: 'help', label: 'ヘルプ',
                items: [
                    { id: 'shortcuts', label: 'キーボードショートカット', shortcut: '', action: () => this.editor.openShortcutsDialog() },
                ]
            },
        ];
    }

    _render() {
        this.container.innerHTML = '';
        this.container.className = 'menubar';

        const left = document.createElement('div');
        left.className = 'menubar-left';

        // Back button
        const backBtn = document.createElement('span');
        backBtn.className = 'menu-label';
        backBtn.textContent = '←';
        backBtn.title = '一覧に戻る';
        backBtn.addEventListener('click', () => {
            if (this.editor.dirty && !confirm('保存していない変更があります。戻りますか？')) return;
            window.location.href = 'index.html';
        });
        left.appendChild(backBtn);

        this._menuDefs.forEach(menuDef => {
            const item = document.createElement('div');
            item.className = 'menu-item';
            item.dataset.menu = menuDef.id;

            const label = document.createElement('span');
            label.className = 'menu-label';
            label.textContent = menuDef.label;
            item.appendChild(label);

            const dropdown = document.createElement('div');
            dropdown.className = 'menu-dropdown';
            this._renderDropdownItems(dropdown, menuDef.items);
            item.appendChild(dropdown);

            label.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this._openMenu === item) {
                    this._closeAll();
                } else {
                    this._closeAll();
                    item.classList.add('open');
                    this._openMenu = item;
                    this._refreshDropdown(dropdown, menuDef.items);
                }
            });

            label.addEventListener('mouseenter', () => {
                if (this._openMenu && this._openMenu !== item) {
                    this._closeAll();
                    item.classList.add('open');
                    this._openMenu = item;
                    this._refreshDropdown(dropdown, menuDef.items);
                }
            });

            left.appendChild(item);
        });

        this.container.appendChild(left);

        // Right side: scenario name + save indicator
        const right = document.createElement('div');
        right.className = 'menubar-right';

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'menubar-scenario-name';
        nameInput.id = 'scenario-name';
        nameInput.placeholder = 'シナリオ名';
        nameInput.addEventListener('change', (e) => {
            this.editor.scenario.name = e.target.value;
            this.editor._markDirty();
        });
        right.appendChild(nameInput);

        const saveInd = document.createElement('span');
        saveInd.className = 'save-indicator saved';
        saveInd.id = 'save-indicator';
        saveInd.textContent = '保存済み';
        right.appendChild(saveInd);

        this.container.appendChild(right);
    }

    _renderDropdownItems(dropdown, items) {
        items.forEach(itemDef => {
            if (itemDef.type === 'separator') {
                const sep = document.createElement('div');
                sep.className = 'menu-separator';
                dropdown.appendChild(sep);
                return;
            }

            if (itemDef.submenu) {
                // Render submenu items inline with radio-like active indicator
                const subLabel = document.createElement('div');
                subLabel.className = 'menu-dropdown-item';
                subLabel.style.fontWeight = '600';
                subLabel.style.fontSize = '0.75rem';
                subLabel.style.color = 'var(--text-secondary)';
                subLabel.style.cursor = 'default';
                subLabel.textContent = itemDef.label;
                dropdown.appendChild(subLabel);

                itemDef.submenu.forEach(subItem => {
                    const btn = document.createElement('button');
                    btn.className = 'menu-dropdown-item';
                    if (subItem.active && subItem.active()) btn.classList.add('active');

                    const labelSpan = document.createElement('span');
                    labelSpan.textContent = subItem.label;
                    btn.appendChild(labelSpan);

                    const indicator = document.createElement('span');
                    indicator.className = 'toggle-indicator';
                    btn.appendChild(indicator);

                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        subItem.action();
                        this._closeAll();
                    });
                    dropdown.appendChild(btn);
                });
                return;
            }

            const btn = document.createElement('button');
            btn.className = 'menu-dropdown-item';
            if (itemDef.toggle && itemDef.toggle()) btn.classList.add('active');
            if (itemDef.disabled && itemDef.disabled()) {
                btn.disabled = true;
                btn.style.opacity = '0.4';
                btn.style.cursor = 'default';
            }

            const labelSpan = document.createElement('span');
            labelSpan.textContent = itemDef.label;
            btn.appendChild(labelSpan);

            if (itemDef.toggle) {
                const indicator = document.createElement('span');
                indicator.className = 'toggle-indicator';
                btn.appendChild(indicator);
            } else if (itemDef.shortcut) {
                const shortcutSpan = document.createElement('span');
                shortcutSpan.className = 'shortcut';
                shortcutSpan.textContent = itemDef.shortcut;
                btn.appendChild(shortcutSpan);
            }

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (itemDef.disabled && itemDef.disabled()) return;
                itemDef.action();
                this._closeAll();
            });
            dropdown.appendChild(btn);
        });
    }

    _refreshDropdown(dropdown, items) {
        dropdown.innerHTML = '';
        this._renderDropdownItems(dropdown, items);
    }

    _closeAll() {
        this.container.querySelectorAll('.menu-item.open').forEach(el => el.classList.remove('open'));
        this._openMenu = null;
    }

    _setupGlobalClose() {
        document.addEventListener('click', () => this._closeAll());
    }

    updateSaveIndicator(state) {
        const el = document.getElementById('save-indicator');
        if (!el) return;
        el.className = 'save-indicator';
        switch (state) {
            case 'saved':
                el.classList.add('saved');
                el.textContent = '保存済み';
                break;
            case 'unsaved':
                el.classList.add('unsaved');
                el.textContent = '未保存の変更あり';
                break;
            case 'saving':
                el.classList.add('saving');
                el.textContent = '保存中...';
                break;
        }
    }
}
