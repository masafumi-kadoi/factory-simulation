// Undo/Redo Command Pattern
export class CommandManager {
    constructor(editor) {
        this.editor = editor;
        this.undoStack = [];
        this.redoStack = [];
        this.maxStackSize = 50;
    }

    execute(command) {
        command.execute();
        this.undoStack.push(command);
        this.redoStack = []; // Clear redo stack on new action

        // Limit stack size
        if (this.undoStack.length > this.maxStackSize) {
            this.undoStack.shift();
        }
    }

    undo() {
        if (this.undoStack.length === 0) return false;

        const command = this.undoStack.pop();
        command.undo();
        this.redoStack.push(command);
        return true;
    }

    redo() {
        if (this.redoStack.length === 0) return false;

        const command = this.redoStack.pop();
        command.execute();
        this.undoStack.push(command);
        return true;
    }

    canUndo() {
        return this.undoStack.length > 0;
    }

    canRedo() {
        return this.redoStack.length > 0;
    }

    clear() {
        this.undoStack = [];
        this.redoStack = [];
    }
}

// Command: Add Station
export class AddStationCommand {
    constructor(editor, station) {
        this.editor = editor;
        this.station = station;
    }

    execute() {
        this.editor.scenario.stations.push(this.station);
        this.editor._markDirty();
        this.editor._render();
    }

    undo() {
        this.editor.scenario.stations = this.editor.scenario.stations.filter(s => s.id !== this.station.id);
        // Also remove related connections
        this.editor.scenario.connections = this.editor.scenario.connections.filter(
            c => c.from !== this.station.id && c.to !== this.station.id
        );
        if (this.editor.selectedItem?.type === 'station' && this.editor.selectedItem.id === this.station.id) {
            this.editor.selectedItem = null;
        }
        this.editor._markDirty();
        this.editor._render();
    }
}

// Command: Delete Station
export class DeleteStationCommand {
    constructor(editor, stationId) {
        this.editor = editor;
        this.stationId = stationId;
        this.station = null;
        this.connections = [];
    }

    execute() {
        // Store station and related connections for undo
        this.station = this.editor.scenario.stations.find(s => s.id === this.stationId);
        this.connections = this.editor.scenario.connections.filter(
            c => c.from === this.stationId || c.to === this.stationId
        );

        // Remove station and connections
        this.editor.scenario.stations = this.editor.scenario.stations.filter(s => s.id !== this.stationId);
        this.editor.scenario.connections = this.editor.scenario.connections.filter(
            c => c.from !== this.stationId && c.to !== this.stationId
        );

        if (this.editor.selectedItem?.type === 'station' && this.editor.selectedItem.id === this.stationId) {
            this.editor.selectedItem = null;
        }

        this.editor._markDirty();
        this.editor._render();
    }

    undo() {
        // Restore station and connections
        this.editor.scenario.stations.push(this.station);
        this.editor.scenario.connections.push(...this.connections);
        this.editor._markDirty();
        this.editor._render();
    }
}

// Command: Update Station
export class UpdateStationCommand {
    constructor(editor, stationId, oldConfig, newConfig) {
        this.editor = editor;
        this.stationId = stationId;
        this.oldConfig = { ...oldConfig };
        this.newConfig = { ...newConfig };
    }

    execute() {
        const station = this.editor.scenario.stations.find(s => s.id === this.stationId);
        if (station) {
            station.config = { ...this.newConfig };
            this.editor._markDirty();
            this.editor._render();
        }
    }

    undo() {
        const station = this.editor.scenario.stations.find(s => s.id === this.stationId);
        if (station) {
            station.config = { ...this.oldConfig };
            this.editor._markDirty();
            this.editor._render();
        }
    }
}

// Command: Move Station
export class MoveStationCommand {
    constructor(editor, stationId, oldX, oldY, newX, newY) {
        this.editor = editor;
        this.stationId = stationId;
        this.oldX = oldX;
        this.oldY = oldY;
        this.newX = newX;
        this.newY = newY;
    }

    execute() {
        const station = this.editor.scenario.stations.find(s => s.id === this.stationId);
        if (station) {
            station.x = this.newX;
            station.y = this.newY;
            this.editor._markDirty();
            this.editor._render();
        }
    }

    undo() {
        const station = this.editor.scenario.stations.find(s => s.id === this.stationId);
        if (station) {
            station.x = this.oldX;
            station.y = this.oldY;
            this.editor._markDirty();
            this.editor._render();
        }
    }
}

// Command: Move Multiple Stations
export class MoveMultipleStationsCommand {
    constructor(editor, moves) {
        this.editor = editor;
        this.moves = moves; // [{id, fromX, fromY, toX, toY}, ...]
    }

    execute() {
        this.moves.forEach(m => {
            const s = this.editor.scenario.stations.find(s => s.id === m.id);
            if (s) { s.x = m.toX; s.y = m.toY; }
        });
        this.editor._markDirty();
        this.editor._render();
    }

    undo() {
        this.moves.forEach(m => {
            const s = this.editor.scenario.stations.find(s => s.id === m.id);
            if (s) { s.x = m.fromX; s.y = m.fromY; }
        });
        this.editor._markDirty();
        this.editor._render();
    }
}

// Command: Delete Multiple Stations
export class DeleteMultipleStationsCommand {
    constructor(editor, stationIds) {
        this.editor = editor;
        this.stationIds = stationIds;
        this.stations = [];
        this.connections = [];
    }

    execute() {
        const idSet = new Set(this.stationIds);
        this.stations = this.editor.scenario.stations.filter(s => idSet.has(s.id));
        this.connections = this.editor.scenario.connections.filter(
            c => idSet.has(c.from) || idSet.has(c.to)
        );
        this.editor.scenario.stations = this.editor.scenario.stations.filter(s => !idSet.has(s.id));
        this.editor.scenario.connections = this.editor.scenario.connections.filter(
            c => !idSet.has(c.from) && !idSet.has(c.to)
        );
        this.editor.selectItem(null);
        this.editor._markDirty();
        this.editor._render();
    }

    undo() {
        this.editor.scenario.stations.push(...this.stations);
        this.editor.scenario.connections.push(...this.connections);
        this.editor._markDirty();
        this.editor._render();
    }
}

// Command: Add Connection
export class AddConnectionCommand {
    constructor(editor, connection) {
        this.editor = editor;
        this.connection = connection;
    }

    execute() {
        this.editor.scenario.connections.push(this.connection);
        this.editor._markDirty();
        this.editor._render();
    }

    undo() {
        this.editor.scenario.connections = this.editor.scenario.connections.filter(
            c => !(c.from === this.connection.from && c.to === this.connection.to)
        );
        this.editor._markDirty();
        this.editor._render();
    }
}

// Command: Delete Connection
export class DeleteConnectionCommand {
    constructor(editor, connection, index) {
        this.editor = editor;
        this.connection = { ...connection };
        this.index = index;
    }

    execute() {
        this.editor.scenario.connections.splice(this.index, 1);
        if (this.editor.selectedItem?.type === 'connection' && this.editor.selectedItem.index === this.index) {
            this.editor.selectedItem = null;
        }
        this.editor._markDirty();
        this.editor._render();
    }

    undo() {
        this.editor.scenario.connections.splice(this.index, 0, this.connection);
        this.editor._markDirty();
        this.editor._render();
    }
}
