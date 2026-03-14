// Theme Manager
export class ThemeManager {
    constructor() {
        this._mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        this._mode = localStorage.getItem('sim-editor-theme') || 'auto';
        this._applyTheme();
        this._mediaQuery.addEventListener('change', () => {
            if (this._mode === 'auto') this._applyTheme();
        });
    }

    get mode() { return this._mode; }

    setMode(mode) {
        this._mode = mode;
        localStorage.setItem('sim-editor-theme', mode);
        this._applyTheme();
    }

    get effectiveTheme() {
        if (this._mode === 'auto') {
            return this._mediaQuery.matches ? 'dark' : 'light';
        }
        return this._mode;
    }

    _applyTheme() {
        document.documentElement.setAttribute('data-theme', this.effectiveTheme);
    }
}
