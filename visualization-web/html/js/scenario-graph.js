// Scenario structure visualization using Cytoscape.js

// Station type colors
const STATION_COLORS = {
    'source': '#28a745',      // Green
    'processing': '#007bff',  // Blue
    'merge': '#6f42c1',       // Purple
    'split': '#fd7e14',       // Orange
    'inspection': '#ffc107',  // Yellow
    'discharge': '#dc3545',   // Red
    'drain': '#6c757d'        // Gray
};

// Connection condition colors
const CONNECTION_COLORS = {
    'default': '#212529',     // Black
    'quality_ok': '#28a745',  // Green
    'quality_ng': '#dc3545'   // Red
};

function renderScenarioGraph(scenarioData, containerId) {
    // Convert stations to Cytoscape nodes
    const nodes = scenarioData.stations.map(station => ({
        data: {
            id: station.id,
            label: station.id,
            type: station.type,
            config: station.config
        }
    }));

    // Convert connections to Cytoscape edges
    const edges = scenarioData.connections.map((conn, index) => ({
        data: {
            id: `edge-${index}`,
            source: conn.from,
            target: conn.to,
            condition: conn.condition || 'default'
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
                    'background-color': function(ele) {
                        return STATION_COLORS[ele.data('type')] || '#6c757d';
                    },
                    'color': '#fff',
                    'font-size': '12px',
                    'font-weight': 'bold',
                    'width': 80,
                    'height': 80,
                    'text-wrap': 'wrap',
                    'text-max-width': '70px'
                }
            },

            // Edge styles
            {
                selector: 'edge',
                style: {
                    'width': 3,
                    'line-color': function(ele) {
                        return CONNECTION_COLORS[ele.data('condition')] || CONNECTION_COLORS['default'];
                    },
                    'target-arrow-color': function(ele) {
                        return CONNECTION_COLORS[ele.data('condition')] || CONNECTION_COLORS['default'];
                    },
                    'target-arrow-shape': 'triangle',
                    'curve-style': 'bezier'
                }
            }
        ],

        layout: {
            name: 'breadthfirst',
            directed: true,
            spacingFactor: 1.5,
            padding: 30
        },

        // Enable user interaction
        userZoomingEnabled: true,
        userPanningEnabled: true,
        boxSelectionEnabled: false
    });

    // Add tooltip on node hover
    cy.on('tap', 'node', function(evt) {
        const node = evt.target;
        const data = node.data();
        console.log('Station clicked:', data);
        // Could show a tooltip or detail panel here
    });

    return cy;
}
