// API client for Factory Manager - all calls go through nginx-proxy to realtime-gateway
const API = '/api';

const FactoryAPI = {
    async listFactories() {
        const r = await fetch(`${API}/factories`);
        if (!r.ok) throw new Error(await r.text());
        return r.json();
    },

    async getFactory(id) {
        const r = await fetch(`${API}/factories/${id}`);
        if (!r.ok) throw new Error(await r.text());
        return r.json();
    },

    async createFactory(name, description) {
        const r = await fetch(`${API}/factories`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description }),
        });
        if (!r.ok) throw new Error(await r.text());
        return r.json();
    },

    async listStations(factoryId) {
        const r = await fetch(`${API}/factories/${factoryId}/stations`);
        if (!r.ok) throw new Error(await r.text());
        return r.json();
    },

    async addStation(factoryId, station) {
        const r = await fetch(`${API}/factories/${factoryId}/stations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(station),
        });
        if (!r.ok) throw new Error(await r.text());
        return r.json();
    },

    async deleteStation(factoryId, stationId) {
        const r = await fetch(`${API}/factories/${factoryId}/stations/${encodeURIComponent(stationId)}`, {
            method: 'DELETE',
        });
        if (!r.ok) throw new Error(await r.text());
    },

    async importCSV(factoryId, csvText) {
        const r = await fetch(`${API}/factories/${factoryId}/stations/import-csv`, {
            method: 'POST',
            headers: { 'Content-Type': 'text/csv' },
            body: csvText,
        });
        const body = await r.json();
        if (!r.ok) return { ok: false, ...body };
        return { ok: true, ...body };
    },

    async validateFactory(factoryId) {
        const r = await fetch(`${API}/factories/${factoryId}/validate`, { method: 'POST' });
        if (!r.ok) throw new Error(await r.text());
        return r.json();
    },

    async listDataSources() {
        const r = await fetch(`${API}/data-sources`);
        if (!r.ok) throw new Error(await r.text());
        return r.json();
    },

    async createDataSource(factoryId, label) {
        const r = await fetch(`${API}/data-sources`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ factoryId, sourceType: 'realtime', label }),
        });
        if (!r.ok) throw new Error(await r.text());
        return r.json();
    },

    async patchDataSource(id, patch) {
        const r = await fetch(`${API}/data-sources/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
        });
        if (!r.ok) throw new Error(await r.text());
        return r.json();
    },

    async deleteFactory(id) {
        const r = await fetch(`${API}/factories/${id}`, { method: 'DELETE' });
        if (!r.ok) throw new Error(await r.text());
    },

    async listScenarios(factoryId) {
        const url = factoryId ? `${API}/scenarios?factory_id=${encodeURIComponent(factoryId)}` : `${API}/scenarios`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(await r.text());
        return r.json();
    },
};
