import { Visualizer3D } from './visualizer.js';

let MouseConfig;
try {
    const mod = await import('../shared/js/mouse-config.js');
    MouseConfig = mod.MouseConfig;
} catch (e) {
    console.warn('[ModulerViewer] mouse-config.js not available:', e.message);
}

class ModulerViewerApp {
    constructor() {
        this._visualizer = null;
        this._modulerId = null;
        this._parentWindow = window.opener;
        this._mouseConfig = MouseConfig ? new MouseConfig('viewer') : null;

        if (!this._parentWindow) {
            document.getElementById('moduler-name').textContent = 'Error: No parent window';
            return;
        }

        window.addEventListener('message', (e) => this._onMessage(e));
        window.addEventListener('beforeunload', () => {
            this._parentWindow.postMessage({
                type: 'moduler-viewer-closed',
                modulerId: this._modulerId
            }, '*');
        });

        this._parentWindow.postMessage({ type: 'moduler-viewer-ready' }, '*');
    }

    _onMessage(event) {
        const data = event.data;
        if (!data || !data.type) return;

        switch (data.type) {
            case 'init':
                this._init(data.scenario, data.modulerName, data.modulerId);
                break;
            case 'update':
                this._update(data.works, data.signalStates, data.currentTime);
                break;
            case 'destroy':
                window.close();
                break;
        }
    }

    _init(scenario, modulerName, modulerId) {
        this._modulerId = modulerId;
        document.title = `Moduler: ${modulerName || modulerId}`;
        document.getElementById('moduler-name').textContent = modulerName || modulerId;

        const container = document.getElementById('container-3d');
        this._visualizer = new Visualizer3D(container, this._mouseConfig);
        this._visualizer.loadScenario(scenario);

        this._visualizer.setOnModulerDoubleClick((stationId) => {
            this._parentWindow.postMessage({
                type: 'open-nested-moduler',
                parentModulerId: this._modulerId,
                stationId: stationId
            }, '*');
        });
    }

    _update(works, signalStates, currentTime) {
        if (!this._visualizer) return;
        const worksMap = new Map(works);
        const signalsMap = new Map(signalStates.map(([k, v]) => [k, new Map(v)]));
        this._visualizer.updateWorks(worksMap, currentTime);
        this._visualizer.updateInterlockStates(signalsMap);
    }
}

new ModulerViewerApp();
