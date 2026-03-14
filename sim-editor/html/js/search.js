// Station search with SubScenario traversal
export class SearchBar {
    constructor(editor) {
        this.editor = editor;
        this._el = null;
        this._input = null;
        this._results = null;
        this._visible = false;
        this._create();
    }

    _create() {
        this._el = document.createElement('div');
        this._el.className = 'search-bar';
        this._el.style.display = 'none';

        this._input = document.createElement('input');
        this._input.type = 'text';
        this._input.placeholder = 'ステーション検索...';
        this._input.className = 'search-input';

        this._results = document.createElement('div');
        this._results.className = 'search-results';

        this._el.appendChild(this._input);
        this._el.appendChild(this._results);

        const container = document.querySelector('.canvas-container');
        if (container) container.appendChild(this._el);

        this._input.addEventListener('input', () => this._search());
        this._input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.hide();
        });
    }

    show() {
        this._visible = true;
        this._el.style.display = 'block';
        this._input.value = '';
        this._results.innerHTML = '';
        this._input.focus();
    }

    hide() {
        this._visible = false;
        this._el.style.display = 'none';
    }

    toggle() {
        if (this._visible) this.hide();
        else this.show();
    }

    _search() {
        const query = this._input.value.trim().toLowerCase();
        this._results.innerHTML = '';
        if (!query) return;

        const results = [];

        // Search current scenario
        this.editor.scenario.stations.forEach(s => {
            const name = s.config?.name || s.id;
            if (name.toLowerCase().includes(query) || s.id.toLowerCase().includes(query) || s.type.toLowerCase().includes(query)) {
                results.push({ station: s, name, path: [], depth: this.editor._editStack.length });
            }
        });

        // Search SubScenarios recursively
        this._searchSubScenarios(this.editor.scenario.stations, query, [], results);

        // Also search parent scenarios in the edit stack
        for (let i = this.editor._editStack.length - 1; i >= 0; i--) {
            const parentScenario = this.editor._editStack[i].scenario;
            parentScenario.stations.forEach(s => {
                const name = s.config?.name || s.id;
                if (name.toLowerCase().includes(query) || s.id.toLowerCase().includes(query)) {
                    results.push({ station: s, name, path: [], depth: i, isParent: true });
                }
            });
        }

        // Render results (max 20)
        results.slice(0, 20).forEach(r => {
            const item = document.createElement('div');
            item.className = 'search-result-item';

            const label = document.createElement('span');
            label.className = 'search-result-label';
            label.textContent = r.name;

            const info = document.createElement('span');
            info.className = 'search-result-info';
            const pathStr = r.path.length > 0 ? r.path.join(' > ') + ' > ' : '';
            info.textContent = `${pathStr}${r.station.type}`;

            item.appendChild(label);
            item.appendChild(info);

            item.addEventListener('click', () => {
                this.hide();
                this._navigateToResult(r);
            });

            this._results.appendChild(item);
        });
    }

    _searchSubScenarios(stations, query, path, results) {
        stations.forEach(s => {
            if (s.type === 'moduler' && s.config?.subScenario) {
                const subStations = s.config.subScenario.stations || [];
                const subPath = [...path, s.config?.name || s.id];
                subStations.forEach(sub => {
                    const name = sub.config?.name || sub.id;
                    if (name.toLowerCase().includes(query) || sub.id.toLowerCase().includes(query) || sub.type.toLowerCase().includes(query)) {
                        results.push({ station: sub, name, path: subPath, parentStationIds: [...path.map((_, i) => path[i]), s.id], modulerChain: this._buildModulerChain(stations, s.id, path) });
                    }
                });
                // Recurse deeper
                this._searchSubScenarios(subStations, query, subPath, results);
            }
        });
    }

    _buildModulerChain(stations, targetId, path) {
        return [targetId];
    }

    _navigateToResult(result) {
        if (result.isParent) {
            // Navigate up to the parent level
            this.editor.drillToDepth(result.depth);
        }

        // Select the station and scroll to it
        const station = this.editor.scenario.stations.find(s => s.id === result.station.id);
        if (station) {
            this.editor.selectItem({ type: 'station', id: station.id });
            // Pan to station
            const c = this.editor.canvas;
            c.viewBox.x = station.x - c.viewBox.width / 2;
            c.viewBox.y = station.y - c.viewBox.height / 2;
            c._updateViewBox();
        }
    }
}
