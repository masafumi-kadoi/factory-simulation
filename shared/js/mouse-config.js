// Mouse button configuration module for editor and viewer
// Shared between sim-editor and sim-visualizer

// --- Presets ---

export const EDITOR_PRESETS = {
    default: {
        name: 'デフォルト',
        description: '中クリック: パン、右クリック: コンテキストメニュー',
        middle: 'pan',
        right: 'contextMenu',
    },
    panRight: {
        name: 'パン重視',
        description: '中クリック: コンテキストメニュー、右クリック: パン',
        middle: 'contextMenu',
        right: 'pan',
    },
};

export const VIEWER_PRESETS = {
    default: {
        name: 'デフォルト',
        description: '左: パン、中: ドリー、右: 回転',
        left: 'pan',
        middle: 'dolly',
        right: 'rotate',
    },
    blender: {
        name: 'Blender風',
        description: '左: 回転、中: パン、右: ドリー',
        left: 'rotate',
        middle: 'pan',
        right: 'dolly',
    },
    cad: {
        name: 'CAD風',
        description: '左: パン、中: 回転、右: ドリー',
        left: 'pan',
        middle: 'rotate',
        right: 'dolly',
    },
};

const EDITOR_ACTIONS = {
    pan: 'パン（キャンバス移動）',
    contextMenu: 'コンテキストメニュー',
};

const VIEWER_ACTIONS = {
    pan: 'パン（平行移動）',
    rotate: '回転',
    dolly: 'ドリー（ズーム）',
};

// --- MouseConfig class ---

export class MouseConfig {
    /**
     * @param {'editor'|'viewer'} mode
     */
    constructor(mode) {
        this._mode = mode;
        this._storageKey = mode === 'editor' ? 'sim-editor-mouse-config' : 'sim-visualizer-mouse-config';
        this._listeners = [];
        this._config = this._load();
    }

    _defaultConfig() {
        if (this._mode === 'editor') {
            return { middle: 'pan', right: 'contextMenu' };
        }
        return { left: 'pan', middle: 'dolly', right: 'rotate' };
    }

    _load() {
        try {
            const raw = localStorage.getItem(this._storageKey);
            if (raw) {
                const parsed = JSON.parse(raw);
                // Validate
                const def = this._defaultConfig();
                for (const key of Object.keys(def)) {
                    if (!(key in parsed)) return def;
                }
                return parsed;
            }
        } catch { /* ignore */ }
        return this._defaultConfig();
    }

    save(config) {
        this._config = { ...config };
        localStorage.setItem(this._storageKey, JSON.stringify(this._config));
        for (const fn of this._listeners) fn(this._config);
    }

    get config() {
        return { ...this._config };
    }

    onChange(fn) {
        this._listeners.push(fn);
    }

    /** Returns the mouse button number (0=left, 1=middle, 2=right) for a given action */
    getButton(action) {
        const cfg = this._config;
        if (this._mode === 'editor') {
            // Left is always 0 (fixed for select/connect/place)
            if (cfg.middle === action) return 1;
            if (cfg.right === action) return 2;
            return -1;
        }
        // viewer
        if (cfg.left === action) return 0;
        if (cfg.middle === action) return 1;
        if (cfg.right === action) return 2;
        return -1;
    }

    /** Returns which preset matches the current config, or null */
    getActivePreset() {
        const presets = this._mode === 'editor' ? EDITOR_PRESETS : VIEWER_PRESETS;
        for (const [id, preset] of Object.entries(presets)) {
            const keys = this._mode === 'editor' ? ['middle', 'right'] : ['left', 'middle', 'right'];
            const match = keys.every(k => preset[k] === this._config[k]);
            if (match) return id;
        }
        return null;
    }
}

// --- MouseConfigModal class ---

export class MouseConfigModal {
    /**
     * @param {MouseConfig} mouseConfig
     */
    constructor(mouseConfig) {
        this._mouseConfig = mouseConfig;
        this._mode = mouseConfig._mode;
        this._overlay = null;
    }

    open() {
        this._editConfig = this._mouseConfig.config;
        this._createOverlay();
        this._render();
    }

    close() {
        if (this._overlay) {
            this._overlay.remove();
            this._overlay = null;
        }
    }

    _createOverlay() {
        if (this._overlay) this._overlay.remove();
        this._overlay = document.createElement('div');
        this._overlay.className = 'mouse-config-overlay';
        this._overlay.innerHTML = '<div class="mouse-config-modal"></div>';
        document.body.appendChild(this._overlay);

        // Close on overlay click
        this._overlay.addEventListener('click', (e) => {
            if (e.target === this._overlay) this.close();
        });

        // Close on Escape
        this._escHandler = (e) => {
            if (e.key === 'Escape') this.close();
        };
        document.addEventListener('keydown', this._escHandler);
    }

    _render() {
        const modal = this._overlay.querySelector('.mouse-config-modal');
        const presets = this._mode === 'editor' ? EDITOR_PRESETS : VIEWER_PRESETS;
        const actions = this._mode === 'editor' ? EDITOR_ACTIONS : VIEWER_ACTIONS;
        const activePreset = this._getActivePresetForEdit();
        const title = this._mode === 'editor' ? 'エディタ マウス操作設定' : 'ビューワー マウス操作設定';

        // Build preset options
        const presetOptions = Object.entries(presets).map(([id, p]) =>
            `<option value="${id}" ${id === activePreset ? 'selected' : ''}>${p.name} — ${p.description}</option>`
        ).join('');

        // Build button rows
        const buttons = this._mode === 'editor'
            ? [
                { key: 'left', label: '左クリック', fixed: true, fixedLabel: '選択 / 配置 / 接続' },
                { key: 'middle', label: '中クリック', fixed: false },
                { key: 'right', label: '右クリック', fixed: false },
            ]
            : [
                { key: 'left', label: '左クリック', fixed: false },
                { key: 'middle', label: '中クリック', fixed: false },
                { key: 'right', label: '右クリック', fixed: false },
            ];

        const rowsHtml = buttons.map(btn => {
            if (btn.fixed) {
                return `
                    <tr>
                        <td class="mc-btn-label">${btn.label}</td>
                        <td><span class="mc-fixed">${btn.fixedLabel}</span></td>
                    </tr>`;
            }
            const opts = Object.entries(actions).map(([val, label]) =>
                `<option value="${val}" ${this._editConfig[btn.key] === val ? 'selected' : ''}>${label}</option>`
            ).join('');
            return `
                <tr>
                    <td class="mc-btn-label">${btn.label}</td>
                    <td><select class="mc-select" data-key="${btn.key}">${opts}</select></td>
                </tr>`;
        }).join('');

        const wheelNote = this._mode === 'editor'
            ? 'ホイール: ズーム（固定）'
            : 'ホイール: ズーム（固定）';

        modal.innerHTML = `
            <div class="mc-header">
                <span class="mc-title">${title}</span>
                <button class="mc-close">&times;</button>
            </div>
            <div class="mc-body">
                <div class="mc-preset-row">
                    <label class="mc-label">プリセット</label>
                    <select class="mc-preset-select">${presetOptions}
                        <option value="custom" ${activePreset === null ? 'selected' : ''}>カスタム</option>
                    </select>
                </div>
                <table class="mc-table">
                    <thead><tr><th>ボタン</th><th>操作</th></tr></thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
                <div class="mc-note">${wheelNote}</div>
            </div>
            <div class="mc-footer">
                <button class="mc-btn mc-btn-cancel">キャンセル</button>
                <button class="mc-btn mc-btn-save">保存</button>
            </div>
        `;

        // Event listeners
        modal.querySelector('.mc-close').addEventListener('click', () => this.close());
        modal.querySelector('.mc-btn-cancel').addEventListener('click', () => this.close());
        modal.querySelector('.mc-btn-save').addEventListener('click', () => {
            this._mouseConfig.save(this._editConfig);
            this.close();
        });

        // Preset change
        const presetSelect = modal.querySelector('.mc-preset-select');
        presetSelect.addEventListener('change', () => {
            const id = presetSelect.value;
            if (id !== 'custom' && presets[id]) {
                const p = presets[id];
                const keys = this._mode === 'editor' ? ['middle', 'right'] : ['left', 'middle', 'right'];
                keys.forEach(k => { this._editConfig[k] = p[k]; });
                this._render();
            }
        });

        // Individual select change
        modal.querySelectorAll('.mc-select').forEach(sel => {
            sel.addEventListener('change', () => {
                this._editConfig[sel.dataset.key] = sel.value;
                // Update preset dropdown
                const newPreset = this._getActivePresetForEdit();
                presetSelect.value = newPreset || 'custom';
            });
        });
    }

    _getActivePresetForEdit() {
        const presets = this._mode === 'editor' ? EDITOR_PRESETS : VIEWER_PRESETS;
        const keys = this._mode === 'editor' ? ['middle', 'right'] : ['left', 'middle', 'right'];
        for (const [id, preset] of Object.entries(presets)) {
            if (keys.every(k => preset[k] === this._editConfig[k])) return id;
        }
        return null;
    }

    close() {
        if (this._overlay) {
            this._overlay.remove();
            this._overlay = null;
        }
        if (this._escHandler) {
            document.removeEventListener('keydown', this._escHandler);
            this._escHandler = null;
        }
    }
}

// --- Inject modal CSS (once) ---

let cssInjected = false;
export function injectMouseConfigCSS() {
    if (cssInjected) return;
    cssInjected = true;

    const style = document.createElement('style');
    style.textContent = `
.mouse-config-overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: var(--bg-overlay, rgba(0,0,0,0.4));
    z-index: 6000;
    display: flex;
    align-items: center;
    justify-content: center;
}
.mouse-config-modal {
    background: var(--bg-surface, #ffffff);
    border-radius: 8px;
    width: 440px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-lg, 0 8px 32px rgba(0,0,0,0.2));
    color: var(--text-primary, #333);
}
.mc-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.875rem 1.25rem;
    border-bottom: 1px solid var(--border-color, #dee2e6);
}
.mc-title {
    font-size: 1rem;
    font-weight: 600;
}
.mc-close {
    background: none;
    border: none;
    font-size: 1.4rem;
    color: var(--text-secondary, #6c757d);
    cursor: pointer;
    padding: 0 0.25rem;
    line-height: 1;
}
.mc-close:hover { color: var(--text-primary, #333); }
.mc-body {
    padding: 1rem 1.25rem;
    overflow-y: auto;
    flex: 1;
}
.mc-preset-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1rem;
}
.mc-label {
    font-weight: 500;
    white-space: nowrap;
    font-size: 0.875rem;
}
.mc-preset-select, .mc-select {
    flex: 1;
    padding: 0.375rem 0.5rem;
    border: 1px solid var(--border-color, #dee2e6);
    border-radius: 4px;
    background: var(--bg-surface, #fff);
    color: var(--text-primary, #333);
    font-size: 0.8125rem;
}
.mc-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 0.75rem;
}
.mc-table th, .mc-table td {
    padding: 0.5rem 0.625rem;
    text-align: left;
    border-bottom: 1px solid var(--border-color-light, #e9ecef);
    font-size: 0.8125rem;
}
.mc-table th {
    font-weight: 500;
    color: var(--text-secondary, #6c757d);
    font-size: 0.75rem;
}
.mc-btn-label {
    white-space: nowrap;
    font-weight: 500;
    width: 90px;
}
.mc-fixed {
    color: var(--text-muted, #999);
    font-style: italic;
    font-size: 0.8125rem;
}
.mc-note {
    color: var(--text-muted, #999);
    font-size: 0.75rem;
}
.mc-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.625rem;
    padding: 0.75rem 1.25rem;
    border-top: 1px solid var(--border-color, #dee2e6);
}
.mc-btn {
    padding: 0.375rem 1rem;
    border-radius: 4px;
    border: 1px solid var(--border-color, #dee2e6);
    cursor: pointer;
    font-size: 0.8125rem;
    background: var(--bg-surface, #fff);
    color: var(--text-primary, #333);
}
.mc-btn:hover {
    background: var(--bg-surface-hover, #f8f9fa);
}
.mc-btn-save {
    background: var(--accent-color, #4a9eff);
    color: var(--text-on-accent, #fff);
    border-color: var(--accent-color, #4a9eff);
}
.mc-btn-save:hover {
    background: var(--accent-color-dark, #3d7ed0);
    border-color: var(--accent-color-dark, #3d7ed0);
}
`;
    document.head.appendChild(style);
}
