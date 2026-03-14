// Scenario List Screen
import { apiClient } from './api.js';

class ScenarioList {
    constructor() {
        this.localScenarios = [];
        this.apiScenarios = [];
        this.currentSort = 'updatedAt'; // 'name', 'createdAt', 'updatedAt'
        this._init();
    }

    async _init() {
        this._loadFromLocalStorage();
        await this._loadFromAPI();
        this._render();
        this._setupEventListeners();
    }

    _loadFromLocalStorage() {
        const stored = localStorage.getItem('sim-editor-scenarios');
        if (stored) {
            try {
                this.localScenarios = JSON.parse(stored);
            } catch (e) {
                console.error('Failed to parse scenarios:', e);
                this.localScenarios = [];
            }
        }
    }

    async _loadFromAPI() {
        try {
            const data = await apiClient.listScenarios();
            this.apiScenarios = (data.scenarios || []).map(s => ({
                id: s.scenarioId,
                apiScenarioId: s.scenarioId,
                name: s.name,
                stationCount: s.stationCount,
                connectionCount: s.connectionCount,
                simdbConfig: s.simdbConfig || null,
                createdAt: s.createdAt || null,
                updatedAt: s.updatedAt || null,
                source: 'api'
            }));
        } catch (e) {
            console.error('Failed to load scenarios from API:', e);
            this.apiScenarios = [];
        }
    }

    _saveToLocalStorage() {
        localStorage.setItem('sim-editor-scenarios', JSON.stringify(this.localScenarios));
    }

    _getSortedAPIScenarios() {
        const sorted = [...this.apiScenarios];
        switch (this.currentSort) {
            case 'name':
                sorted.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ja'));
                break;
            case 'createdAt':
                sorted.sort((a, b) => {
                    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                    return tb - ta; // newest first
                });
                break;
            case 'updatedAt':
                sorted.sort((a, b) => {
                    const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
                    const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
                    return tb - ta; // newest first
                });
                break;
        }
        return sorted;
    }

    _getSortedLocalScenarios() {
        const sorted = [...this.localScenarios];
        switch (this.currentSort) {
            case 'name':
                sorted.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ja'));
                break;
            case 'createdAt':
            case 'updatedAt':
                sorted.sort((a, b) => {
                    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                    return tb - ta;
                });
                break;
        }
        return sorted;
    }

    _formatDate(dateStr) {
        if (!dateStr) return '-';
        try {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return '-';
            return d.toLocaleString('ja-JP', {
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit'
            });
        } catch {
            return '-';
        }
    }

    _render() {
        const listElement = document.getElementById('scenario-list');
        const emptyState = document.getElementById('empty-state');

        const hasLocal = this.localScenarios.length > 0;
        const hasAPI = this.apiScenarios.length > 0;

        if (!hasLocal && !hasAPI) {
            listElement.style.display = 'none';
            emptyState.style.display = 'block';
            return;
        }

        listElement.style.display = 'grid';
        emptyState.style.display = 'none';

        let html = '';

        // API scenarios (sorted)
        if (hasAPI) {
            const sortedAPI = this._getSortedAPIScenarios();
            html += '<div class="scenario-section-label">Saved Scenarios</div>';
            html += sortedAPI.map(scenario => {
                const origIndex = this.apiScenarios.indexOf(scenario);
                return `
                <div class="scenario-card">
                    <div class="scenario-card-header">
                        <h3 class="scenario-card-title">${this._escapeHtml(scenario.name)}</h3>
                    </div>
                    <div class="scenario-card-meta">
                        Stations: ${scenario.stationCount} | Connections: ${scenario.connectionCount}
                    </div>
                    <div class="scenario-card-meta">
                        作成: ${this._formatDate(scenario.createdAt)} | 更新: ${this._formatDate(scenario.updatedAt)}
                    </div>
                    <div class="scenario-card-actions">
                        <a href="editor.html?scenarioId=${encodeURIComponent(scenario.apiScenarioId)}" class="btn-primary" style="text-decoration:none;text-align:center;">Edit</a>
                        <button class="btn-secondary api-duplicate-btn" data-api-index="${origIndex}">Duplicate</button>
                        <button class="btn-danger api-delete-btn" data-api-index="${origIndex}">Delete</button>
                    </div>
                </div>
            `}).join('');
        }

        // Local scenarios (sorted)
        if (hasLocal) {
            const sortedLocal = this._getSortedLocalScenarios();
            if (hasAPI) {
                html += '<div class="scenario-section-label">Local Drafts</div>';
            }
            html += sortedLocal.map(scenario => {
                const origIndex = this.localScenarios.indexOf(scenario);
                return `
                <div class="scenario-card" data-index="${origIndex}">
                    <div class="scenario-card-header">
                        <h3 class="scenario-card-title">${this._escapeHtml(scenario.name)}</h3>
                    </div>
                    <div class="scenario-card-meta">
                        作成日: ${new Date(scenario.createdAt).toLocaleString('ja-JP')}
                    </div>
                    <div class="scenario-card-meta">
                        Stations: ${scenario.stations.length} | Connections: ${scenario.connections.length}
                    </div>
                    <div class="scenario-card-actions">
                        <button class="btn-primary edit-btn" data-index="${origIndex}">Edit</button>
                        <button class="btn-secondary duplicate-btn" data-index="${origIndex}">Duplicate</button>
                        <button class="btn-danger delete-btn" data-index="${origIndex}">Delete</button>
                    </div>
                </div>
            `}).join('');
        }

        listElement.innerHTML = html;
    }

    _setupEventListeners() {
        document.getElementById('new-scenario-btn').addEventListener('click', () => {
            this._createNewScenario();
        });

        // Sort buttons
        document.querySelectorAll('.sort-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.currentSort = btn.dataset.sort;
                document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this._render();
            });
        });

        document.getElementById('scenario-list').addEventListener('click', (e) => {
            // Local scenario actions
            const index = e.target.dataset.index;
            if (index != null) {
                if (e.target.classList.contains('edit-btn')) {
                    this._editScenario(parseInt(index));
                } else if (e.target.classList.contains('duplicate-btn')) {
                    this._duplicateScenario(parseInt(index));
                } else if (e.target.classList.contains('delete-btn')) {
                    this._deleteScenario(parseInt(index));
                }
            }

            // API scenario actions
            const apiIndex = e.target.dataset.apiIndex;
            if (apiIndex != null) {
                if (e.target.classList.contains('api-delete-btn')) {
                    this._deleteAPIScenario(parseInt(apiIndex));
                } else if (e.target.classList.contains('api-duplicate-btn')) {
                    this._duplicateAPIScenario(parseInt(apiIndex));
                }
            }
        });
    }

    _createNewScenario() {
        const newScenario = {
            id: this._generateId(),
            name: '新規シナリオ',
            description: '',
            stations: [],
            connections: [],
            ui: { layout: {} },
            createdAt: new Date().toISOString(),
            dirty: true
        };

        this.localScenarios.push(newScenario);
        this._saveToLocalStorage();

        // Navigate to editor
        window.location.href = `editor.html?id=${newScenario.id}`;
    }

    _editScenario(index) {
        const scenario = this.localScenarios[index];
        window.location.href = `editor.html?id=${scenario.id}`;
    }

    _duplicateScenario(index) {
        const original = this.localScenarios[index];
        const duplicate = {
            ...JSON.parse(JSON.stringify(original)),
            id: this._generateId(),
            name: original.name + ' (コピー)',
            createdAt: new Date().toISOString()
        };

        this.localScenarios.push(duplicate);
        this._saveToLocalStorage();
        this._render();
    }

    _deleteScenario(index) {
        const scenario = this.localScenarios[index];
        if (confirm(`「${scenario.name}」を削除しますか？`)) {
            this.localScenarios.splice(index, 1);
            this._saveToLocalStorage();
            this._render();
        }
    }

    async _deleteAPIScenario(index) {
        const scenario = this.apiScenarios[index];
        if (!scenario) return;

        if (!confirm(`「${scenario.name}」を削除しますか？\nこの操作は取り消せません。`)) {
            return;
        }

        try {
            await apiClient.deleteScenario(scenario.apiScenarioId);
            this.apiScenarios.splice(index, 1);
            this._render();
        } catch (err) {
            console.error('Failed to delete API scenario:', err);
            alert('削除に失敗しました: ' + err.message);
        }
    }

    async _duplicateAPIScenario(index) {
        const scenario = this.apiScenarios[index];
        if (!scenario) return;

        const newName = prompt('新しいシナリオ名を入力してください:', scenario.name + ' (コピー)');
        if (newName === null) return; // cancelled
        if (newName.trim() === '') {
            alert('シナリオ名を入力してください');
            return;
        }

        try {
            // Fetch the full scenario data from API
            const fullScenario = await apiClient.getScenario(scenario.apiScenarioId);

            // Create a new scenario with the new name
            const scenarioData = {
                name: newName.trim(),
                simdbConfig: fullScenario.simdbConfig || undefined,
                stations: fullScenario.stations || [],
                connections: fullScenario.connections || []
            };

            const response = await apiClient.createScenario(scenarioData);

            // Add to list and re-render
            this.apiScenarios.push({
                id: response.scenarioId,
                apiScenarioId: response.scenarioId,
                name: newName.trim(),
                stationCount: (fullScenario.stations || []).length,
                connectionCount: (fullScenario.connections || []).length,
                simdbConfig: fullScenario.simdbConfig || null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                source: 'api'
            });
            this._render();
        } catch (err) {
            console.error('Failed to duplicate API scenario:', err);
            alert('複製に失敗しました: ' + err.message);
        }
    }

    _generateId() {
        return 'scenario-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    }

    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize
new ScenarioList();
