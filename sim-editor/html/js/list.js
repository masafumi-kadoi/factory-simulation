// Scenario List Screen
const API_BASE = 'http://localhost:8080/api';

class ScenarioList {
    constructor() {
        this.scenarios = [];
        this._init();
    }

    async _init() {
        // Load scenarios from localStorage (later: from API)
        this._loadFromLocalStorage();
        this._render();
        this._setupEventListeners();
    }

    _loadFromLocalStorage() {
        const stored = localStorage.getItem('sim-editor-scenarios');
        if (stored) {
            try {
                this.scenarios = JSON.parse(stored);
            } catch (e) {
                console.error('Failed to parse scenarios:', e);
                this.scenarios = [];
            }
        }
    }

    _saveToLocalStorage() {
        localStorage.setItem('sim-editor-scenarios', JSON.stringify(this.scenarios));
    }

    _render() {
        const listElement = document.getElementById('scenario-list');
        const emptyState = document.getElementById('empty-state');

        if (this.scenarios.length === 0) {
            listElement.style.display = 'none';
            emptyState.style.display = 'block';
            return;
        }

        listElement.style.display = 'grid';
        emptyState.style.display = 'none';

        listElement.innerHTML = this.scenarios.map((scenario, index) => `
            <div class="scenario-card" data-index="${index}">
                <div class="scenario-card-header">
                    <h3 class="scenario-card-title">${this._escapeHtml(scenario.name)}</h3>
                </div>
                <div class="scenario-card-meta">
                    作成日: ${new Date(scenario.createdAt).toLocaleString('ja-JP')}
                </div>
                <div class="scenario-card-meta">
                    ステーション: ${scenario.stations.length} | 接続: ${scenario.connections.length}
                </div>
                <div class="scenario-card-actions">
                    <button class="btn-primary edit-btn" data-index="${index}">編集</button>
                    <button class="btn-secondary duplicate-btn" data-index="${index}">複製</button>
                    <button class="btn-danger delete-btn" data-index="${index}">削除</button>
                </div>
            </div>
        `).join('');
    }

    _setupEventListeners() {
        document.getElementById('new-scenario-btn').addEventListener('click', () => {
            this._createNewScenario();
        });

        document.getElementById('scenario-list').addEventListener('click', (e) => {
            const index = e.target.dataset.index;
            if (!index) return;

            if (e.target.classList.contains('edit-btn')) {
                this._editScenario(parseInt(index));
            } else if (e.target.classList.contains('duplicate-btn')) {
                this._duplicateScenario(parseInt(index));
            } else if (e.target.classList.contains('delete-btn')) {
                this._deleteScenario(parseInt(index));
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

        this.scenarios.push(newScenario);
        this._saveToLocalStorage();

        // Navigate to editor
        window.location.href = `editor.html?id=${newScenario.id}`;
    }

    _editScenario(index) {
        const scenario = this.scenarios[index];
        window.location.href = `editor.html?id=${scenario.id}`;
    }

    _duplicateScenario(index) {
        const original = this.scenarios[index];
        const duplicate = {
            ...JSON.parse(JSON.stringify(original)),
            id: this._generateId(),
            name: original.name + ' (コピー)',
            createdAt: new Date().toISOString()
        };

        this.scenarios.push(duplicate);
        this._saveToLocalStorage();
        this._render();
    }

    _deleteScenario(index) {
        const scenario = this.scenarios[index];
        if (confirm(`「${scenario.name}」を削除しますか？`)) {
            this.scenarios.splice(index, 1);
            this._saveToLocalStorage();
            this._render();
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
