// Clipboard for copy/cut/paste of stations and connections
export class Clipboard {
    constructor(editor) {
        this.editor = editor;
        this._data = null; // { stations: [], connections: [] }
    }

    hasData() {
        // Check internal buffer or sessionStorage (cross-scenario)
        if (this._data) return true;
        const stored = sessionStorage.getItem('sim-editor-clipboard');
        return !!stored;
    }

    copy() {
        const ids = this.editor.selectedStationIds;
        if (ids.size === 0) return;

        const idSet = new Set(ids);
        const stations = this.editor.scenario.stations
            .filter(s => idSet.has(s.id))
            .map(s => JSON.parse(JSON.stringify(s)));
        const connections = this.editor.scenario.connections
            .filter(c => idSet.has(c.from) && idSet.has(c.to))
            .map(c => ({ ...c }));

        this._data = { stations, connections };
        sessionStorage.setItem('sim-editor-clipboard', JSON.stringify(this._data));
    }

    cut() {
        this.copy();
        const ids = [...this.editor.selectedStationIds];
        this.editor.deleteMultipleStations(ids);
    }

    paste(mouseX, mouseY) {
        let data = this._data;
        if (!data) {
            const stored = sessionStorage.getItem('sim-editor-clipboard');
            if (!stored) return;
            try { data = JSON.parse(stored); } catch { return; }
        }
        if (!data || !data.stations || data.stations.length === 0) return;

        // Calculate centroid of copied stations (default to 0 for stations without position)
        let cx = 0, cy = 0;
        data.stations.forEach(s => { cx += (s.x || 0); cy += (s.y || 0); });
        cx /= data.stations.length;
        cy /= data.stations.length;

        // Build ID mapping (old -> new)
        const idMap = new Map();
        const now = Date.now();
        data.stations.forEach((s, i) => {
            const newId = `${s.type}-${now + i}`;
            idMap.set(s.id, newId);
        });

        // Create new stations offset to mouse position
        const newStations = data.stations.map(s => {
            const newS = JSON.parse(JSON.stringify(s));
            newS.id = idMap.get(s.id);
            newS.x = mouseX + (s.x - cx);
            newS.y = mouseY + (s.y - cy);
            return newS;
        });

        // Create new connections with remapped IDs
        const newConnections = data.connections
            .filter(c => idMap.has(c.from) && idMap.has(c.to))
            .map(c => ({
                ...c,
                from: idMap.get(c.from),
                to: idMap.get(c.to)
            }));

        // Add to scenario
        this.editor.scenario.stations.push(...newStations);
        this.editor.scenario.connections.push(...newConnections);
        this.editor._markDirty();

        // Select pasted stations
        this.editor.setSelection(newStations.map(s => s.id));
    }
}
