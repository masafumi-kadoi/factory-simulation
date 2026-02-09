// Work lineage (traceability) visualization

function renderLineageGraph(lineageData, workEvents, containerId) {
    // Collect all unique work IDs
    const workIds = new Set();

    lineageData.forEach(edge => {
        workIds.add(edge.childWorkId);
        workIds.add(edge.parentWorkId);
    });

    // Create nodes for all works
    const nodes = Array.from(workIds).map(workId => ({
        data: {
            id: workId,
            label: workId
        }
    }));

    // Create edges from lineage data
    const edges = lineageData.map((edge, index) => ({
        data: {
            id: `lineage-edge-${index}`,
            source: edge.parentWorkId,
            target: edge.childWorkId,
            operationType: edge.operationType,
            stationId: edge.stationId,
            timestamp: edge.timestamp
        }
    }));

    // Initialize Cytoscape
    const cy = cytoscape({
        container: document.getElementById(containerId),

        elements: {
            nodes: nodes,
            edges: edges
        },

        style: [
            // Node styles
            {
                selector: 'node',
                style: {
                    'label': 'data(label)',
                    'text-valign': 'center',
                    'text-halign': 'center',
                    'background-color': '#007bff',
                    'color': '#fff',
                    'font-size': '10px',
                    'font-weight': 'bold',
                    'width': 60,
                    'height': 60
                }
            },

            // Edge styles
            {
                selector: 'edge',
                style: {
                    'width': 2,
                    'line-color': function(ele) {
                        return ele.data('operationType') === 'merge' ? '#6f42c1' : '#fd7e14';
                    },
                    'target-arrow-color': function(ele) {
                        return ele.data('operationType') === 'merge' ? '#6f42c1' : '#fd7e14';
                    },
                    'target-arrow-shape': 'triangle',
                    'curve-style': 'bezier',
                    'label': 'data(operationType)',
                    'font-size': '8px',
                    'text-rotation': 'autorotate'
                }
            }
        ],

        layout: {
            name: 'breadthfirst',
            directed: true,
            spacingFactor: 1.2,
            padding: 30,
            avoidOverlap: true
        },

        userZoomingEnabled: true,
        userPanningEnabled: true,
        boxSelectionEnabled: false
    });

    // Add click handler to show work details
    cy.on('tap', 'node', function(evt) {
        const node = evt.target;
        const workId = node.data('id');

        // Find events for this work
        const events = workEvents.filter(e => e.WorkID === workId);

        // Show modal with work details
        showWorkDetailModal(workId, events);
    });

    return cy;
}

function showWorkDetailModal(workId, events) {
    const modal = new bootstrap.Modal(document.getElementById('workDetailModal'));
    const content = document.getElementById('work-detail-content');

    // Build event list HTML
    const eventListHTML = events.map(e => `
        <tr>
            <td>${e.Timestamp.toFixed(2)}s</td>
            <td><code>${e.StationID}</code></td>
            <td><span class="badge bg-info">${e.EventType}</span></td>
        </tr>
    `).join('');

    content.innerHTML = `
        <h6>ワークID: <code>${workId}</code></h6>
        <hr>
        <h6>イベント履歴</h6>
        <table class="table table-sm">
            <thead>
                <tr>
                    <th>時刻</th>
                    <th>ステーション</th>
                    <th>イベント</th>
                </tr>
            </thead>
            <tbody>
                ${eventListHTML}
            </tbody>
        </table>
    `;

    modal.show();
}
