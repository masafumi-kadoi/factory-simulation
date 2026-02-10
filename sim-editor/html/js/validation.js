// Validation utilities

export function validateScenario(scenario) {
    const errors = [];

    // Check if there's at least one source
    const sources = scenario.stations.filter(s => s.type === 'source');
    if (sources.length === 0) {
        errors.push('少なくとも1つのSourceステーションが必要です');
    }

    // Check if there's at least one drain
    const drains = scenario.stations.filter(s => s.type === 'drain');
    if (drains.length === 0) {
        errors.push('少なくとも1つのDrainステーションが必要です');
    }

    // Check each station
    scenario.stations.forEach(station => {
        const stationErrors = validateStation(station);
        Object.entries(stationErrors).forEach(([key, error]) => {
            errors.push(`${station.id}: ${error}`);
        });
    });

    // Check for disconnected stations
    const connectedStations = new Set();
    scenario.connections.forEach(conn => {
        connectedStations.add(conn.from);
        connectedStations.add(conn.to);
    });

    scenario.stations.forEach(station => {
        if (!connectedStations.has(station.id)) {
            errors.push(`${station.id}が接続されていません`);
        }
    });

    // Check for circular references (simple check)
    const graph = new Map();
    scenario.stations.forEach(s => graph.set(s.id, []));
    scenario.connections.forEach(c => {
        if (graph.has(c.from)) {
            graph.get(c.from).push(c.to);
        }
    });

    // Warning: This is a simple cycle detection, not comprehensive
    scenario.stations.forEach(station => {
        if (hasCycle(station.id, graph, new Set())) {
            errors.push('循環参照が検出されました');
        }
    });

    return errors;
}

export function validateStation(station) {
    const errors = {};
    const config = station.config;

    if (station.type === 'source') {
        if (!config.workCount || config.workCount < 1) {
            errors.workCount = 'workCountは1以上である必要があります';
        }
        if (!config.departureTime || config.departureTime <= 0) {
            errors.departureTime = 'departureTimeは0より大きい必要があります';
        }
    } else if (station.type === 'processing') {
        if (!config.processingTime || config.processingTime <= 0) {
            errors.processingTime = 'processingTimeは0より大きい必要があります';
        }
        if (!config.arrivalTime || config.arrivalTime <= 0) {
            errors.arrivalTime = 'arrivalTimeは0より大きい必要があります';
        }
        if (!config.departureTime || config.departureTime <= 0) {
            errors.departureTime = 'departureTimeは0より大きい必要があります';
        }
    } else if (station.type === 'drain') {
        if (!config.arrivalTime || config.arrivalTime <= 0) {
            errors.arrivalTime = 'arrivalTimeは0より大きい必要があります';
        }
    }

    return errors;
}

function hasCycle(nodeId, graph, visited) {
    if (visited.has(nodeId)) {
        return true;
    }

    visited.add(nodeId);
    const neighbors = graph.get(nodeId) || [];

    for (const neighbor of neighbors) {
        if (hasCycle(neighbor, graph, new Set(visited))) {
            return true;
        }
    }

    return false;
}
