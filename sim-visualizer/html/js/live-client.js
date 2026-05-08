// WebSocket Live client for realtime data streaming

export const LiveMode = {
    REPLAY: 'replay',
    LIVE: 'live',
    LIVE_LOST: 'live_lost',
};

export class LiveClient {
    constructor({ onEvent, onHeartbeat, onModeChange }) {
        this._onEvent = onEvent;
        this._onHeartbeat = onHeartbeat;
        this._onModeChange = onModeChange;
        this._ws = null;
        this._dataSourceId = null;
        this._mode = LiveMode.REPLAY;
        this._retryDelay = 1000;
        this._maxRetryDelay = 30000;
        this._retryTimer = null;
        this._heartbeatTimer = null;
        this._heartbeatTimeout = 60000;
    }

    get mode() { return this._mode; }
    get dataSourceId() { return this._dataSourceId; }

    subscribe(dataSourceId) {
        this._dataSourceId = dataSourceId;
        this._setMode(LiveMode.LIVE);
        this._connect();
    }

    unsubscribe() {
        this._clearRetry();
        this._clearHeartbeatTimer();
        if (this._ws) {
            if (this._ws.readyState === WebSocket.OPEN) {
                this._ws.send(JSON.stringify({ type: 'unsubscribe' }));
            }
            this._ws.close();
            this._ws = null;
        }
        this._setMode(LiveMode.REPLAY);
    }

    _connect() {
        if (this._ws) {
            this._ws.close();
            this._ws = null;
        }

        const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${wsProto}//${location.host}/ws/live`;

        const ws = new WebSocket(url);
        this._ws = ws;

        ws.onopen = () => {
            console.log('[LiveClient] connected');
            this._retryDelay = 1000;
            ws.send(JSON.stringify({ type: 'subscribe', data_source_id: this._dataSourceId }));
            this._resetHeartbeatTimer();
        };

        ws.onmessage = (ev) => {
            try {
                const msg = JSON.parse(ev.data);
                if (msg.type === 'event') {
                    this._resetHeartbeatTimer();
                    if (this._onEvent) this._onEvent(msg.data);
                } else if (msg.type === 'heartbeat') {
                    this._resetHeartbeatTimer();
                    if (this._onHeartbeat) this._onHeartbeat(msg.server_time);
                }
            } catch (e) {
                console.warn('[LiveClient] parse error:', e);
            }
        };

        ws.onclose = () => {
            console.log('[LiveClient] closed, mode =', this._mode);
            this._clearHeartbeatTimer();
            if (this._mode === LiveMode.LIVE || this._mode === LiveMode.LIVE_LOST) {
                this._setMode(LiveMode.LIVE_LOST);
                this._scheduleRetry();
            }
        };

        ws.onerror = (e) => {
            console.warn('[LiveClient] ws error:', e);
        };
    }

    _scheduleRetry() {
        this._clearRetry();
        this._retryTimer = setTimeout(() => {
            if (this._mode === LiveMode.LIVE_LOST) {
                console.log(`[LiveClient] retrying in ${this._retryDelay}ms`);
                this._connect();
                this._retryDelay = Math.min(this._retryDelay * 2, this._maxRetryDelay);
            }
        }, this._retryDelay);
    }

    _clearRetry() {
        if (this._retryTimer) {
            clearTimeout(this._retryTimer);
            this._retryTimer = null;
        }
    }

    _resetHeartbeatTimer() {
        this._clearHeartbeatTimer();
        this._heartbeatTimer = setTimeout(() => {
            if (this._mode === LiveMode.LIVE) {
                console.log('[LiveClient] heartbeat timeout → LIVE_LOST');
                this._setMode(LiveMode.LIVE_LOST);
                this._scheduleRetry();
            }
        }, this._heartbeatTimeout);
    }

    _clearHeartbeatTimer() {
        if (this._heartbeatTimer) {
            clearTimeout(this._heartbeatTimer);
            this._heartbeatTimer = null;
        }
    }

    _setMode(mode) {
        if (this._mode !== mode) {
            this._mode = mode;
            if (this._onModeChange) this._onModeChange(mode);
        }
    }

    onReconnect(callback) {
        this._onReconnect = callback;
    }
}

// Converts WDH event to internal format compatible with state builder
export function wdhEventToInternal(event, locationMap, startTime) {
    const baseMs = startTime ? new Date(startTime).getTime() : 0;
    const evMs = event.event_time ? new Date(event.event_time).getTime() : NaN;
    if (isNaN(evMs)) return null;
    const ts = baseMs > 0 ? (evMs - baseMs) / 1000 : evMs / 1000;

    if (event.table === 'item_movement') {
        const fromStation = locationMap.get(event.from_location_id);
        const toStation = locationMap.get(event.to_location_id);

        if (event.movement_type === 'arrived') {
            if (!toStation) return null;
            return {
                WorkID: event.item_id,
                StationID: toStation,
                Timestamp: ts,
                EventType: 'WorkArrived',
                PortIndex: event.port_index != null ? event.port_index : -1,
            };
        } else if (event.movement_type === 'departed') {
            if (!fromStation) return null;
            return {
                WorkID: event.item_id,
                StationID: fromStation,
                Timestamp: ts,
                EventType: 'WorkDeparted',
                PortIndex: event.port_index != null ? event.port_index : -1,
            };
        }
    } else if (event.table === 'machine_signal') {
        if (event.machine_id == null || event.signal_name == null || event.value == null) return null;
        return {
            StationID: event.machine_id,
            Timestamp: ts,
            StatusType: 'signal_change',
            SignalName: event.signal_name,
            Value: event.value,
        };
    }
    return null;
}
