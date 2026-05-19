// Factory list page

async function loadFactories() {
    const list = document.getElementById('factory-list');
    try {
        const factories = await FactoryAPI.listFactories();
        if (!factories || factories.length === 0) {
            list.innerHTML = `
                <div class="empty">
                    <h3>No factories yet</h3>
                    <p style="margin-top:8px;color:#757575">Create a factory to start managing your production line.</p>
                    <button class="btn btn-primary" style="margin-top:16px" onclick="showNewFactoryModal()">+ New Factory</button>
                </div>`;
            return;
        }
        list.innerHTML = `<div class="factory-grid">${factories.map(f => `
            <div class="factory-card">
                <a href="factory.html?id=${f.id}" class="factory-card-link">
                    <div class="factory-card-name">${escapeHtml(f.name)}</div>
                    <div class="factory-card-meta">${escapeHtml(f.description || '')}${f.description ? '<br>' : ''}
                        <span style="font-size:12px">${f.stationCount || 0} stations</span>
                    </div>
                </a>
                <button class="btn btn-danger btn-sm factory-card-delete" data-factory-id="${escapeHtml(f.id)}" onclick="deleteFactory(this.dataset.factoryId)">Delete</button>
            </div>`).join('')}</div>`;
    } catch (err) {
        list.innerHTML = `<div class="alert alert-error">Failed to load factories: ${escapeHtml(err.message)}</div>`;
    }
}

async function deleteFactory(id) {
    if (!confirm('Delete this factory and all its stations and scenarios?')) return;
    try {
        await FactoryAPI.deleteFactory(id);
        await loadFactories();
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

function showNewFactoryModal() {
    document.getElementById('new-factory-name').value = '';
    document.getElementById('new-factory-desc').value = '';
    const err = document.getElementById('new-factory-error');
    err.className = 'hidden';
    showModal('modal-new-factory');
}

async function createFactory() {
    const name = document.getElementById('new-factory-name').value.trim();
    const desc = document.getElementById('new-factory-desc').value.trim();
    const errEl = document.getElementById('new-factory-error');
    if (!name) {
        showAlert(errEl, 'error', 'Factory name is required.');
        return;
    }
    try {
        const f = await FactoryAPI.createFactory(name, desc);
        hideModal('modal-new-factory');
        window.location.href = `factory.html?id=${f.id}`;
    } catch (err) {
        showAlert(errEl, 'error', err.message);
    }
}

function showModal(id) { document.getElementById(id).classList.remove('hidden'); }
function hideModal(id) { document.getElementById(id).classList.add('hidden'); }

function showAlert(el, type, msg) {
    el.className = `alert alert-${type}`;
    el.textContent = msg;
}

function escapeHtml(text) {
    if (!text) return '';
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
}

loadFactories();
