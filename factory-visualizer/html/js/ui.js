// UI module: left panel object list, settings bindings

export function initLeftPanel({ onFilterChange, onSettingChange }) {
    // Collapsible sections
    document.querySelectorAll('.section-header').forEach(hdr => {
        hdr.addEventListener('click', () => {
            const key = hdr.dataset.toggle;
            const body = document.getElementById(`${key}-body`);
            if (body) body.classList.toggle('collapsed');
            hdr.querySelector('.toggle-icon').textContent =
                body.classList.contains('collapsed') ? '▸' : '▾';
        });
    });

    // Filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.classList.toggle('active');
            const active = [...document.querySelectorAll('.filter-btn.active')].map(b => b.dataset.filter);
            onFilterChange && onFilterChange(active);
        });
    });

    // Theme
    document.getElementById('scene-theme').addEventListener('change', e => {
        applyDocTheme(e.target.value);
        onSettingChange && onSettingChange('theme', e.target.value);
    });

    // Shell opacity
    const opacitySlider = document.getElementById('shell-opacity');
    const opacityVal = document.getElementById('shell-opacity-val');
    opacitySlider.addEventListener('input', e => {
        const v = parseFloat(e.target.value);
        opacityVal.textContent = v.toFixed(2);
        onSettingChange && onSettingChange('shellOpacity', v);
    });

    // Internal radius
    const radiusSlider = document.getElementById('internal-radius');
    const radiusVal = document.getElementById('internal-radius-val');
    radiusSlider.addEventListener('input', e => {
        const v = parseFloat(e.target.value);
        radiusVal.textContent = v;
        onSettingChange && onSettingChange('internalRadius', v);
    });

    const workSizeSlider = document.getElementById('work-size');
    const workSizeVal = document.getElementById('work-size-val');
    if (workSizeSlider) {
        workSizeSlider.addEventListener('input', e => {
            const v = parseFloat(e.target.value);
            workSizeVal.textContent = v;
            onSettingChange && onSettingChange('workSize', v);
        });
    }

    // Checkboxes
    const checkboxes = {
        'show-internal': 'showInternal',
        'show-machine-names': 'showMachineNames',
        'show-station-names': 'showStationNames',
        'show-works': 'showWorks',
        'show-interlocks': 'showInterlocks',
    };
    Object.entries(checkboxes).forEach(([id, key]) => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', () => {
                onSettingChange && onSettingChange(key, el.checked);
            });
        }
    });

    initHeightSettings(onSettingChange);
}

// ---- Height settings ----

const HEIGHT_ITEMS = [
    { key: 'machineLabel',  sliderId: 'h-machine-label',  numId: 'h-machine-label-num' },
    { key: 'stationLabel',  sliderId: 'h-station-label',  numId: 'h-station-label-num' },
    { key: 'workMachine',   sliderId: 'h-work-machine',   numId: 'h-work-machine-num' },
    { key: 'workStation',   sliderId: 'h-work-station',   numId: 'h-work-station-num' },
];

const HEIGHT_RANGES = {
    relative: { min: 0, max: 5 },
    absolute: { min: 0, max: 20 },
};

export function updateHeightSliders(displayVals) {
    const { mode, machineLabel, stationLabel, workMachine, workStation } = displayVals;
    const range = HEIGHT_RANGES[mode];

    document.querySelectorAll('#label-height-mode .seg-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === mode);
    });
    const hint = document.getElementById('height-mode-hint');
    if (hint) hint.textContent = mode === 'relative'
        ? 'モデル上端からのオフセット (m)'
        : '地面からの絶対高さ (m)';

    const vals = { machineLabel, stationLabel, workMachine, workStation };
    HEIGHT_ITEMS.forEach(({ key, sliderId, numId }) => {
        const v = vals[key];
        if (v == null) return;
        const slider = document.getElementById(sliderId);
        const num = document.getElementById(numId);
        if (slider) { slider.min = range.min; slider.max = range.max; slider.value = v; }
        if (num)    { num.min = range.min; num.max = range.max; num.value = v.toFixed(1); }
    });
}

function initHeightSettings(onSettingChange) {
    // Mode toggle
    document.querySelectorAll('#label-height-mode .seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.classList.contains('active')) return;
            onSettingChange && onSettingChange('labelHeightMode', btn.dataset.mode);
        });
    });

    // Slider + number input pairs
    HEIGHT_ITEMS.forEach(({ key, sliderId, numId }) => {
        const slider = document.getElementById(sliderId);
        const num = document.getElementById(numId);
        if (!slider || !num) return;

        slider.addEventListener('input', () => {
            const v = Math.round(parseFloat(slider.value) * 10) / 10;
            num.value = v.toFixed(1);
            onSettingChange && onSettingChange('height_' + key, v);
        });

        num.addEventListener('change', () => {
            const min = parseFloat(slider.min), max = parseFloat(slider.max);
            let v = parseFloat(num.value);
            v = Math.max(min, Math.min(max, isNaN(v) ? min : Math.round(v * 10) / 10));
            num.value = v.toFixed(1);
            slider.value = v;
            onSettingChange && onSettingChange('height_' + key, v);
        });
    });

    // Restore saved settings
    try {
        const saved = JSON.parse(localStorage.getItem('fv_height_settings') || 'null');
        if (saved && saved.mode && saved.heights) {
            onSettingChange && onSettingChange('labelHeightMode', saved.mode);
            Object.entries(saved.heights).forEach(([key, val]) => {
                onSettingChange && onSettingChange('height_' + key, val);
            });
        }
    } catch { /* ignore */ }
}

export function applyDocTheme(theme) {
    const root = document.documentElement;
    root.className = theme === 'auto' ? 'theme-auto' : (theme === 'light' ? 'theme-light' : '');
}

function getEquipmentName(stationId) {
    const m = stationId.match(/^(.+?)[._-]?(\d{3})$/);
    return m ? m[1] : stationId;
}

export function renderObjectList(stations, works, activeFilters) {
    const container = document.getElementById('object-list');
    if (!container) return;

    const items = [];

    if (activeFilters.includes('machine')) {
        // Group machines by equipment name and show one entry per group
        const equipMap = new Map();
        stations.filter(s => s.stationType === 'machine').forEach(s => {
            const equip = getEquipmentName(s.stationId);
            if (!equipMap.has(equip)) equipMap.set(equip, []);
            equipMap.get(equip).push(s);
        });
        equipMap.forEach((members, equipName) => {
            const label = members.length > 1
                ? `${equipName} (×${members.length})`
                : (members[0].name || members[0].stationId);
            items.push({ type: 'machine', id: equipName, name: label, icon: '🏭' });
        });
    }
    if (activeFilters.includes('station')) {
        stations.filter(s => s.stationType !== 'machine').forEach(s => {
            const icon = stationIcon(s.stationType);
            items.push({ type: 'station', id: s.stationId, name: s.name || s.stationId, icon, subtype: s.stationType });
        });
    }
    if (activeFilters.includes('work') && works.size > 0) {
        works.forEach((stationId, workId) => {
            items.push({ type: 'work', id: workId, name: workId, icon: '⬤', subtype: stationId });
        });
    }

    if (items.length === 0) {
        container.innerHTML = '<div class="empty-hint">表示するオブジェクトがありません</div>';
        return;
    }

    container.innerHTML = items.map(item => `
        <div class="object-item" data-type="${esc(item.type)}" data-id="${esc(item.id)}">
            <span class="obj-icon">${item.icon}</span>
            <span class="obj-name" title="${esc(item.id)}">${esc(item.name)}</span>
            ${item.subtype ? `<span class="obj-type">${esc(item.subtype)}</span>` : ''}
        </div>
    `).join('');
}

export function setObjectListClickHandler(cb) {
    const container = document.getElementById('object-list');
    if (!container) return;
    container.addEventListener('click', e => {
        const item = e.target.closest('.object-item');
        if (!item) return;
        document.querySelectorAll('.object-item.selected').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
        cb && cb(item.dataset.type, item.dataset.id);
    });
}

export function setStatus(text, cls = 'status-idle') {
    const el = document.getElementById('status-text');
    if (!el) return;
    el.textContent = text;
    el.className = cls;
}

export function setICStatus(text) {
    const el = document.getElementById('ic-status');
    if (el) el.textContent = text;
}

export function setTimeDisplay(ms) {
    const el = document.getElementById('tl-time');
    if (!el) return;
    if (!ms) { el.textContent = '--:--:--'; return; }
    const d = new Date(ms);
    el.textContent = d.toLocaleString('ja-JP', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
}

export function renderExecutionList(executions) {
    const container = document.getElementById('execution-list');
    if (!container) return;

    if (!executions || executions.length === 0) {
        container.innerHTML = '<div class="empty-hint">実行履歴がありません</div>';
        return;
    }

    container.innerHTML = executions.map(exec => {
        const _toLocale = (str, opts) => { const d = str && new Date(str); return d && !isNaN(d) ? d.toLocaleString('ja-JP', opts) : '—'; };
        const startDt = _toLocale(exec.startTime, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        const createdDt = _toLocale(exec.createdAt, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        return `
        <div class="exec-item" data-exec-id="${esc(exec.id)}" data-ds-id="${esc(exec.dataSourceId || '')}">
            <div class="exec-start">${esc(startDt)}</div>
            <div class="exec-meta">実行: ${esc(createdDt)}</div>
        </div>`;
    }).join('');
}

export function setExecutionListClickHandler(cb) {
    const container = document.getElementById('execution-list');
    if (!container) return;
    container.addEventListener('click', e => {
        const item = e.target.closest('.exec-item');
        if (!item) return;
        document.querySelectorAll('.exec-item.selected').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
        cb && cb(item.dataset.execId, item.dataset.dsId);
    });
}

function stationIcon(type) {
    const icons = {
        source: '⬤', processing: '⬟', drain: '⬛',
        merge: '⬯', split: '⭩', entry: '→', exit: '→',
        inspection: '🔍', discharge: '⚡', switch: '↔',
    };
    return icons[type] || '◆';
}

function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
