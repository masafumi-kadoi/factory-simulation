// API client for factory-visualizer
// All requests go through /api (nginx-proxy → realtime-gateway)

const BASE = '/api';

async function req(method, path, body) {
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json' },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(BASE + path, opts);
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text}`);
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return res.json();
    return res.text();
}

// ---- Factories ----

export async function fetchFactories() {
    return req('GET', '/factories');
}

export async function fetchFactory(id) {
    return req('GET', `/factories/${encodeURIComponent(id)}`);
}

export async function createFactory(name, description = '') {
    return req('POST', '/factories', { name, description });
}

export async function updateFactory(id, fields) {
    return req('PUT', `/factories/${encodeURIComponent(id)}`, fields);
}

// ---- Stations ----

export async function fetchFactoryStations(factoryId) {
    return req('GET', `/factories/${encodeURIComponent(factoryId)}/stations`);
}

export async function createStation(factoryId, data) {
    return req('POST', `/factories/${encodeURIComponent(factoryId)}/stations`, data);
}

export async function updateStation(factoryId, stationId, fields) {
    return req('PUT', `/factories/${encodeURIComponent(factoryId)}/stations/${encodeURIComponent(stationId)}`, fields);
}

export async function deleteStation(factoryId, stationId) {
    return req('DELETE', `/factories/${encodeURIComponent(factoryId)}/stations/${encodeURIComponent(stationId)}`);
}

// ---- Connections ----

export async function fetchFactoryConnections(factoryId) {
    return req('GET', `/factories/${encodeURIComponent(factoryId)}/connections`);
}

export async function createConnection(factoryId, fromStation, toStation, condition = 'default', fromPortIndex = -1, toPortIndex = -1) {
    return req('POST', `/factories/${encodeURIComponent(factoryId)}/connections`, {
        fromStation, toStation, condition, fromPortIndex, toPortIndex,
    });
}

export async function deleteConnection(factoryId, connId) {
    return req('DELETE', `/factories/${encodeURIComponent(factoryId)}/connections/${connId}`);
}

// ---- Machine logic batch save ----

export async function saveMachineLogic(factoryId, machineStationId, stations, connections) {
    return req('PUT', `/factories/${encodeURIComponent(factoryId)}/machines/${encodeURIComponent(machineStationId)}/logic`, {
        children: stations, connections,
    });
}

// ---- SimDB ----

export async function fetchSimDBLocations(factoryId) {
    return req('GET', `/factories/${encodeURIComponent(factoryId)}/simdb/locations`);
}

export async function testSimDBConnection(factoryId) {
    return req('POST', `/factories/${encodeURIComponent(factoryId)}/simdb/test-connection`, {});
}

export async function fetchInitialConditions(factoryId, startDatetime) {
    return req('POST', `/factories/${encodeURIComponent(factoryId)}/simdb/initial-conditions`, { startDatetime });
}

// ---- Data sources ----

export async function fetchDataSources(factoryId) {
    const all = await req('GET', '/data-sources');
    if (!factoryId) return all;
    const arr = Array.isArray(all) ? all : (all.dataSources || []);
    return arr.filter(ds => ds.factoryId === factoryId);
}

export async function fetchDataSourceLayout(dataSourceId) {
    return req('GET', `/data-sources/${encodeURIComponent(dataSourceId)}/layout`);
}

export async function fetchDataSourceEvents(dataSourceId, fromTime, toTime, limit) {
    let path = `/data-sources/${encodeURIComponent(dataSourceId)}/events`;
    const params = new URLSearchParams();
    if (fromTime) params.set('from', fromTime);
    if (toTime) params.set('to', toTime);
    if (limit) params.set('limit', String(limit));
    const qs = params.toString();
    return req('GET', qs ? `${path}?${qs}` : path);
}

// ---- Factory data sources ----

export async function fetchFactoryDataSources(factoryId, type) {
    let path = `/factories/${encodeURIComponent(factoryId)}/datasources`;
    if (type) path += `?type=${encodeURIComponent(type)}`;
    return req('GET', path);
}

// ---- Poller control ----

export async function startPoller(factoryId) {
    return req('POST', `/factories/${encodeURIComponent(factoryId)}/poller/start`, {});
}

export async function stopPoller(factoryId) {
    return req('POST', `/factories/${encodeURIComponent(factoryId)}/poller/stop`, {});
}

export async function fetchPollerStatus(factoryId) {
    return req('GET', `/factories/${encodeURIComponent(factoryId)}/poller/status`);
}

// ---- Executions ----

export async function fetchExecutions() {
    return req('GET', '/executions');
}

export async function fetchFactoryExecutions(factoryId) {
    return req('GET', `/factories/${encodeURIComponent(factoryId)}/executions`);
}

export async function fetchExecution(execId) {
    return req('GET', `/executions/${encodeURIComponent(execId)}`);
}

export async function createExecution(factoryId, startDatetime, simulationTime, initialConditions = {}) {
    return req('POST', '/executions', {
        factoryId,
        startDatetime,
        simulationTime,
        initialConditions,
    });
}
