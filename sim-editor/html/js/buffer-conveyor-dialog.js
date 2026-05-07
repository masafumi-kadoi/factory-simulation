// Buffer Conveyor Template Dialog
// Generates a Moduler station pre-configured as a linear buffer conveyor.

export class BufferConveyorDialog {
    constructor(editor) {
        this.editor = editor;
        this._overlay = null;
    }

    open() {
        this._overlay = document.createElement('div');
        this._overlay.className = 'modal-overlay';
        this._overlay.innerHTML = `
            <div class="modal" style="width:420px">
                <div class="modal-header">
                    <span class="modal-title">バッファコンベア追加</span>
                    <button class="modal-close" id="bc-close">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label>コンベア名</label>
                        <input type="text" id="bc-name" value="Buffer Conveyor" style="width:100%">
                    </div>
                    <div class="form-group">
                        <label>スロット数 (バッファ容量)</label>
                        <input type="number" id="bc-slots" value="5" min="1" max="20" style="width:100%">
                    </div>
                    <div class="form-group">
                        <label>搬送方式</label>
                        <select id="bc-mode" style="width:100%">
                            <option value="push">PUSH (上流が押し込む)</option>
                            <option value="pull">PULL (下流が引き出す)</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>スロット通過時間 (秒)</label>
                        <input type="number" id="bc-slot-time" value="2.0" min="0.1" step="0.1" style="width:100%">
                    </div>
                </div>
                <div class="modal-footer" style="display:flex;justify-content:flex-end;gap:8px;padding:12px 16px">
                    <button id="bc-cancel" class="tool-btn" style="width:auto">キャンセル</button>
                    <button id="bc-create" class="tool-btn" style="width:auto;background:#1565c0;color:#fff">作成</button>
                </div>
            </div>
        `;
        document.body.appendChild(this._overlay);

        document.getElementById('bc-close').addEventListener('click', () => this._close());
        document.getElementById('bc-cancel').addEventListener('click', () => this._close());
        document.getElementById('bc-create').addEventListener('click', () => this._create());
        this._overlay.addEventListener('click', e => { if (e.target === this._overlay) this._close(); });
        document.getElementById('bc-name').focus();
    }

    _close() {
        if (this._overlay) {
            document.body.removeChild(this._overlay);
            this._overlay = null;
        }
    }

    _create() {
        const name = document.getElementById('bc-name').value.trim() || 'Buffer Conveyor';
        const slots = Math.max(1, Math.min(20, parseInt(document.getElementById('bc-slots').value) || 5));
        const slotTime = parseFloat(document.getElementById('bc-slot-time').value) || 2.0;

        const subScenario = this._buildSubScenario(slots, slotTime);

        const center = this.editor.getViewCenter();

        const id = `moduler-${Date.now()}`;
        const station = {
            id,
            name,
            type: 'moduler',
            config: {
                entryCount: 1,
                exitCount: 1,
                bufferSlots: slots,
                subScenario,
            },
            x: center.x,
            y: center.y,
        };

        this.editor.addStationFull(station);

        this._close();
    }

    _buildSubScenario(slots, slotTime) {
        const xSpacing = 120;
        const startX = 100;
        const y = 300;

        const stations = [
            { id: 'entry-0', name: 'IN', type: 'entry', config: {}, x: startX, y },
        ];
        for (let i = 0; i < slots; i++) {
            stations.push({
                id: `slot-${i}`,
                name: `Slot ${i + 1}`,
                type: 'processing',
                config: {
                    processingTime: slotTime,
                    arrivalTime: 0.1,
                    departureTime: 0.1,
                },
                x: startX + xSpacing * (i + 1),
                y,
            });
        }
        stations.push({
            id: 'exit-0',
            name: 'OUT',
            type: 'exit',
            config: {},
            x: startX + xSpacing * (slots + 1),
            y,
        });

        const connections = [];
        // entry-0 → slot-0
        connections.push({ id: `c-entry-0`, from: 'entry-0', to: 'slot-0' });
        // slot-i → slot-i+1
        for (let i = 0; i < slots - 1; i++) {
            connections.push({ id: `c-${i}-${i + 1}`, from: `slot-${i}`, to: `slot-${i + 1}` });
        }
        // slot-N-1 → exit-0
        connections.push({ id: `c-slot-exit`, from: `slot-${slots - 1}`, to: 'exit-0' });

        return { stations, connections };
    }
}
