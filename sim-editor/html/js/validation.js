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

    // Check for cycles using DFS
    const visited = new Set();
    const recStack = new Set();

    for (const stationId of scenario.stations.map(s => s.id)) {
        if (hasCycleAdvanced(stationId, graph, visited, recStack)) {
            errors.push('循環参照が検出されました');
            break;
        }
    }

    // Check location_id when SimDB is configured
    if (scenario.simdbConfig && scenario.simdbConfig.host) {
        scenario.stations.forEach(station => {
            if (!station.locationId) {
                errors.push(`${station.id}: locationIdが設定されていません`);
            }
        });

        const locationIds = scenario.stations
            .filter(s => s.locationId)
            .map(s => ({ stationId: s.id, locationId: s.locationId }));
        const seen = new Map();
        locationIds.forEach(({ stationId, locationId }) => {
            if (seen.has(locationId)) {
                seen.get(locationId).push(stationId);
            } else {
                seen.set(locationId, [stationId]);
            }
        });
        for (const [locId, stationIds] of seen) {
            if (stationIds.length > 1) {
                errors.push(`locationId ${locId} が重複しています: ${stationIds.join(', ')}`);
            }
        }
    }

    // Check for invalid branching/merging patterns
    // source, processing, drain can only have 1:1 connections
    scenario.stations.forEach(station => {
        const stationType = station.type;

        // Only validate for basic station types (not future types like merge, split, etc.)
        if (stationType === 'source' || stationType === 'processing' || stationType === 'drain') {
            // Count outgoing connections (分岐チェック)
            const outgoingCount = scenario.connections.filter(c => c.from === station.id).length;

            // Count incoming connections (合流チェック)
            const incomingCount = scenario.connections.filter(c => c.to === station.id).length;

            // Source and Processing can only have 1 outgoing connection
            if ((stationType === 'source' || stationType === 'processing') && outgoingCount > 1) {
                errors.push(`${station.id} (${stationType}): 複数のステーションへの分岐は許可されていません（接続数: ${outgoingCount}）`);
            }

            // Processing and Drain can only have 1 incoming connection
            if ((stationType === 'processing' || stationType === 'drain') && incomingCount > 1) {
                errors.push(`${station.id} (${stationType}): 複数のステーションからの合流は許可されていません（接続数: ${incomingCount}）`);
            }

            // Source should not have incoming connections
            if (stationType === 'source' && incomingCount > 0) {
                errors.push(`${station.id} (source): Sourceステーションへの入力接続は許可されていません`);
            }

            // Drain should not have outgoing connections
            if (stationType === 'drain' && outgoingCount > 0) {
                errors.push(`${station.id} (drain): Drainステーションからの出力接続は許可されていません`);
            }
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

function hasCycleAdvanced(nodeId, graph, visited, recStack) {
    if (recStack.has(nodeId)) {
        return true; // Cycle detected
    }

    if (visited.has(nodeId)) {
        return false; // Already processed
    }

    visited.add(nodeId);
    recStack.add(nodeId);

    const neighbors = graph.get(nodeId) || [];
    for (const neighbor of neighbors) {
        if (hasCycleAdvanced(neighbor, graph, visited, recStack)) {
            return true;
        }
    }

    recStack.delete(nodeId);
    return false;
}
