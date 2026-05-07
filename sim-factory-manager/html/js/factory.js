// Factory detail page

const params = new URLSearchParams(location.search);
const FACTORY_ID = params.get('id');
let currentDataSourceId = null;

async function init() {
    if (!FACTORY_ID) { location.href = 'index.html'; return; }
    try {
        const f = await FactoryAPI.getFactory(FACTORY_ID);
        document.getElementById('page-title').textContent = f.name;
        document.getElementById('factory-name').textContent = f.name;
        document.getElementById('factory-description').textContent = f.description || '';
    } catch (err) {
        showError('Failed to load factory: ' + err.message);
        return;
    }
    // Setup "New Scenario" link
    const newScenarioBtn = document.getElementById('btn-new-scenario');
    if (newScenarioBtn) {
        newScenarioBtn.href = `/editor/editor.html?new=1&factoryId=${encodeURIComponent(FACTORY_ID)}`;
    }
    await Promise.all([loadStations(), loadScenarios(), loadDataSources()]);
}

async function loadStations() {
    const tbody = document.getElementById('stations-tbody');
    try {
        const stations = await FactoryAPI.listStations(FACTORY_ID);
        if (!stations || stations.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#757575;padding:24px">No stations. Add stations or import CSV.</td></tr>`;
            return;
        }
        tbody.innerHTML = stations.map(s => `
            <tr>
                <td><code>${escapeHtml(s.station_id)}</code></td>
                <td>${escapeHtml(s.name || '')}</td>
                <td><span class="badge badge-inactive">${escapeHtml(s.station_type)}</span></td>
                <td style="font-size:12px;color:#757575">${formatPos(s)}</td>
                <td>
                    <button class="btn btn-danger btn-sm" onclick="deleteStation(${JSON.stringify(s.station_id)})">Delete</button>
                </td>
            </tr>`).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="5" class="alert-error" style="padding:12px">Error: ${escapeHtml(err.message)}</td></tr>`;
    }
}

function formatPos(s) {
    if (s.pos_x == null) return '-';
    return `(${+s.pos_x.toFixed(1)}, ${+s.pos_y.toFixed(1)}, ${+s.pos_z.toFixed(1)})`;
}

async function deleteStation(stationId) {
    if (!confirm(`Delete station "${stationId}"?`)) return;
    try {
        await FactoryAPI.deleteStation(FACTORY_ID, stationId);
        await loadStations();
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

async function loadScenarios() {
    const tbody = document.getElementById('scenarios-tbody');
    if (!tbody) return;
    try {
        const scenarios = await FactoryAPI.listScenarios(FACTORY_ID);
        if (!scenarios || scenarios.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#757575;padding:24px">No scenarios. Create one with "New Scenario".</td></tr>`;
            return;
        }
        tbody.innerHTML = scenarios.map(s => `
            <tr>
                <td style="font-size:12px;color:#757575">${s.id.substring(0,8)}...</td>
                <td>${escapeHtml(s.name)}</td>
                <td><span class="badge badge-inactive">${escapeHtml(s.scenarioType || 'simulation')}</span></td>
                <td style="font-size:12px;color:#757575">${s.updatedAt ? new Date(s.updatedAt).toLocaleString('ja-JP') : '-'}</td>
                <td>
                    <a href="/editor/editor.html?scenarioId=${encodeURIComponent(s.id)}&factoryId=${encodeURIComponent(FACTORY_ID)}" class="btn btn-outline btn-sm" target="_blank">Edit</a>
                </td>
            </tr>`).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="5" class="alert-error" style="padding:12px">Error: ${escapeHtml(err.message)}</td></tr>`;
    }
}

async function loadDataSources() {
    const el = document.getElementById('datasource-list');
    try {
        const all = await FactoryAPI.listDataSources();
        const ds = (all || []).filter(d => d.factory_id === FACTORY_ID);
        if (ds.length === 0) {
            el.innerHTML = `<div style="text-align:center;color:#757575;padding:24px">No data sources for this factory.</div>`;
            return;
        }
        const liveDs = ds.find(d => !d.ended_at);
        if (liveDs) {
            currentDataSourceId = liveDs.id;
            updateLiveUI(true);
        }
        const viewerBase = '/visualizer/';
        el.innerHTML = `<div class="table-wrap"><table>
            <thead><tr><th>ID</th><th>Label</th><th>Type</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>${ds.map(d => `
                <tr>
                    <td style="font-size:12px;color:#757575">${d.id.substring(0,8)}...</td>
                    <td>${escapeHtml(d.label || d.id)}</td>
                    <td>${escapeHtml(d.source_type)}</td>
                    <td>${d.ended_at ? `<span class="badge badge-inactive">Ended</span>` : `<span class="badge badge-live"><span class="live-dot"></span>Live</span>`}</td>
                    <td>
                        <a href="${viewerBase}?ds=${d.id}" class="btn btn-outline btn-sm" target="_blank">View</a>
                    </td>
                </tr>`).join('')}
            </tbody></table></div>`;
    } catch (err) {
        el.innerHTML = `<div class="alert alert-error">Error: ${escapeHtml(err.message)}</div>`;
    }
}

function updateLiveUI(isLive) {
    document.getElementById('live-indicator').classList.toggle('hidden', !isLive);
    document.getElementById('btn-start-live').classList.toggle('hidden', isLive);
    document.getElementById('btn-stop-live').classList.toggle('hidden', !isLive);
    const viewerBtn = document.getElementById('btn-open-viewer');
    if (isLive && currentDataSourceId) {
        viewerBtn.classList.remove('hidden');
        viewerBtn.href = `/visualizer/?ds=${currentDataSourceId}&live=1`;
    } else {
        viewerBtn.classList.add('hidden');
    }
}

async function startMonitoring() {
    try {
        const ds = await FactoryAPI.createDataSource(FACTORY_ID, `Live ${new Date().toLocaleString('ja-JP')}`);
        currentDataSourceId = ds.id;
        updateLiveUI(true);
        await loadDataSources();
    } catch (err) {
        alert('Error starting monitoring: ' + err.message);
    }
}

async function stopMonitoring() {
    if (!currentDataSourceId) return;
    if (!confirm('Stop this monitoring session?')) return;
    try {
        await FactoryAPI.patchDataSource(currentDataSourceId, { ended_at: new Date().toISOString() });
        currentDataSourceId = null;
        updateLiveUI(false);
        await loadDataSources();
    } catch (err) {
        alert('Error stopping monitoring: ' + err.message);
    }
}

function showAddStationModal() {
    ['station-id','station-name','station-x','station-y','station-z'].forEach(id => {
        document.getElementById(id).value = '';
    });
    document.getElementById('station-type').value = 'machine';
    document.getElementById('add-station-error').className = 'hidden';
    showModal('modal-add-station');
}

async function addStation() {
    const stationId = document.getElementById('station-id').value.trim();
    const name = document.getElementById('station-name').value.trim();
    const stationType = document.getElementById('station-type').value;
    const x = parseFloat(document.getElementById('station-x').value) || 0;
    const y = parseFloat(document.getElementById('station-y').value) || 0;
    const z = parseFloat(document.getElementById('station-z').value) || 0;
    const errEl = document.getElementById('add-station-error');

    if (!stationId) { showAlert(errEl, 'error', 'Station ID is required.'); return; }
    if (!/^.+\.\d{3}$/.test(stationId)) {
        showAlert(errEl, 'error', 'Station ID must match {equipment_id}.{3digits} format.');
        return;
    }
    try {
        await FactoryAPI.addStation(FACTORY_ID, { station_id: stationId, name, station_type: stationType, pos_x: x, pos_y: y, pos_z: z });
        hideModal('modal-add-station');
        await loadStations();
    } catch (err) {
        showAlert(errEl, 'error', err.message);
    }
}

function showImportModal() {
    document.getElementById('csv-file').value = '';
    document.getElementById('import-result').className = 'hidden';
    showModal('modal-import');
}

async function importCSV() {
    const fileInput = document.getElementById('csv-file');
    const resultEl = document.getElementById('import-result');
    if (!fileInput.files.length) {
        showAlert(resultEl, 'error', 'Please select a CSV file.');
        return;
    }
    const text = await fileInput.files[0].text();
    const res = await FactoryAPI.importCSV(FACTORY_ID, text);
    if (res.ok) {
        showAlert(resultEl, 'success', `Imported ${res.imported} stations successfully.`);
        await loadStations();
    } else if (res.errors && res.errors.length > 0) {
        const errHtml = res.errors.map(e =>
            `<div class="error-row"><span class="error-line">Line ${e.line}</span>
            ${e.column ? ` [${escapeHtml(e.column)}]` : ''}: ${escapeHtml(e.message)}</div>`
        ).join('');
        resultEl.className = 'alert alert-error';
        resultEl.innerHTML = `<b>Import failed (${res.errors.length} errors):</b><div class="error-list mt">${errHtml}</div>`;
    } else {
        showAlert(resultEl, 'error', 'Import failed.');
    }
}

function showModal(id) { document.getElementById(id).classList.remove('hidden'); }
function hideModal(id) { document.getElementById(id).classList.add('hidden'); }

function showAlert(el, type, msg) {
    el.className = `alert alert-${type}`;
    el.textContent = msg;
}

function showError(msg) {
    document.querySelector('.main').innerHTML = `<div class="alert alert-error">${escapeHtml(msg)}</div>`;
}

function escapeHtml(text) {
    if (!text) return '';
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
}

init();
