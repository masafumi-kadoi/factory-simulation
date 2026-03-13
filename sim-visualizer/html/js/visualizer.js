// 3D Visualizer inspired by Mini Tokyo 3D
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const STATION_COLORS = {
    'source': 0x28a745,
    'processing': 0x007bff,
    'merge': 0x6f42c1,
    'split': 0xfd7e14,
    'inspection': 0xffc107,
    'discharge': 0xdc3545,
    'drain': 0x6c757d,
    'moduler': 0x4a148c,
    'entry': 0x2e7d32,
    'exit': 0xe65100
};

export class Visualizer3D {
    constructor(container) {
        this.container = container;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;

        this.stations = new Map(); // Map<stationId, {mesh, position, label, stationType, portSlots}>
        this.works = new Map(); // Map<workId, {mesh, label}>
        this.connections = []; // [{line, from, to, fromStationId, toStationId, indicators}]
        this.showWorkIDs = true;
        this.showStationNames = true;
        this.showInterlocks = false;
        this.interlockIndicators = []; // [{mesh, stationId, signalName, connectionIndex}]
        this.modulerHierarchy = new Map(); // Map<parentId, Set<childId>> (dot-ID based)
        this.modulerCollapseState = new Map(); // Map<parentStationId, boolean> (true = collapsed)
        this.ground = null;
        this.gridHelper = null;
        this._raycaster = new THREE.Raycaster();
        this._mouse = new THREE.Vector2();
        this._onWorkClick = null; // callback: (workId) => void
        this._activeWorks = null; // reference to current activeWorks map

        this._initScene();
        this._animate();
    }

    _initScene() {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0a0a);
        this.scene.fog = new THREE.Fog(0x0a0a0a, 500, 2000);

        this.camera = new THREE.PerspectiveCamera(50, width / height, 1, 5000);
        this.camera.position.set(0, 600, 1000);
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.container.appendChild(this.renderer.domElement);

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(200, 400, 200);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        directionalLight.shadow.camera.near = 0.5;
        directionalLight.shadow.camera.far = 1000;
        this.scene.add(directionalLight);

        this._createGroundAndGrid(2000);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.minDistance = 200;
        this.controls.maxDistance = 2000;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.1;
        this.controls.mouseButtons = {
            LEFT: THREE.MOUSE.PAN,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.ROTATE
        };

        window.addEventListener('resize', () => this._onResize());

        // Click handler for work selection
        this.renderer.domElement.addEventListener('click', (event) => this._handleClick(event));
    }

    setOnWorkClick(callback) {
        this._onWorkClick = callback;
    }

    _handleClick(event) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this._mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this._mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this._raycaster.setFromCamera(this._mouse, this.camera);

        // Check station clicks first (for moduler collapse/expand)
        const stationMeshes = [];
        this.stations.forEach((station) => {
            stationMeshes.push(station.mesh);
            station.mesh.children.forEach(child => stationMeshes.push(child));
        });

        const stationIntersects = this._raycaster.intersectObjects(stationMeshes, false);
        if (stationIntersects.length > 0) {
            let obj = stationIntersects[0].object;
            while (obj && !obj.userData.stationId) {
                obj = obj.parent;
            }
            if (obj && obj.userData.stationId) {
                const stationId = obj.userData.stationId;
                // Toggle collapse for moduler stations
                if (this.modulerHierarchy.has(stationId)) {
                    this.toggleModulerCollapse(stationId);
                    return;
                }
            }
        }

        // Then check work clicks
        if (!this._onWorkClick) return;

        const workMeshes = [];
        this.works.forEach((work) => {
            workMeshes.push(work.mesh);
            work.mesh.children.forEach(child => workMeshes.push(child));
        });

        const intersects = this._raycaster.intersectObjects(workMeshes, false);
        if (intersects.length > 0) {
            let obj = intersects[0].object;
            while (obj && !obj.userData.workId) {
                obj = obj.parent;
            }
            if (obj && obj.userData.workId) {
                this._onWorkClick(obj.userData.workId);
            }
        }
    }

    _onResize() {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    _createGroundAndGrid(size) {
        if (this.ground) {
            this.scene.remove(this.ground);
            this.ground.geometry.dispose();
            this.ground.material.dispose();
        }
        if (this.gridHelper) {
            this.scene.remove(this.gridHelper);
            this.gridHelper.geometry.dispose();
            this.gridHelper.material.dispose();
        }

        const groundGeometry = new THREE.PlaneGeometry(size, size);
        const groundMaterial = new THREE.MeshStandardMaterial({
            color: 0x1a1a2e, roughness: 0.8, metalness: 0.2
        });
        this.ground = new THREE.Mesh(groundGeometry, groundMaterial);
        this.ground.rotation.x = -Math.PI / 2;
        this.ground.receiveShadow = true;
        this.scene.add(this.ground);

        const divisions = Math.max(10, Math.round(size / 50));
        this.gridHelper = new THREE.GridHelper(size, divisions, 0x2a3f5f, 0x1a2332);
        this.gridHelper.position.y = 0.1;
        this.scene.add(this.gridHelper);
    }

    _adjustSceneToPositions(positions) {
        if (positions.size === 0) return;

        let minX = Infinity, maxX = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        positions.forEach(pos => {
            minX = Math.min(minX, pos.x);
            maxX = Math.max(maxX, pos.x);
            minZ = Math.min(minZ, pos.z);
            maxZ = Math.max(maxZ, pos.z);
        });

        const rangeX = maxX - minX;
        const rangeZ = maxZ - minZ;
        const maxRange = Math.max(rangeX, rangeZ, 200);
        const padding = maxRange * 0.5 + 200;
        const floorSize = maxRange + padding * 2;

        const centerX = (minX + maxX) / 2;
        const centerZ = (minZ + maxZ) / 2;

        this._createGroundAndGrid(floorSize);
        this.ground.position.set(centerX, 0, centerZ);
        this.gridHelper.position.set(centerX, 0.1, centerZ);

        this.scene.fog.near = floorSize * 0.3;
        this.scene.fog.far = floorSize * 1.5;

        const viewDistance = maxRange * 1.2 + 400;
        this.camera.position.set(centerX, viewDistance * 0.6, centerZ + viewDistance);
        this.camera.lookAt(centerX, 0, centerZ);
        this.camera.far = floorSize * 3;
        this.camera.updateProjectionMatrix();

        this.controls.target.set(centerX, 0, centerZ);
        this.controls.maxDistance = floorSize * 1.5;
        this.controls.update();
    }

    _animate() {
        requestAnimationFrame(() => this._animate());
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    loadScenario(scenario) {
        console.log('[Visualizer3D] Loading scenario:', scenario.name);

        const hasSavedPositions = scenario.stations.some(s => s.positionX != null && s.positionY != null);
        const positions = hasSavedPositions
            ? this._positionsFromSaved(scenario.stations)
            : this._calculateLayout(scenario.stations, scenario.connections);

        this._adjustSceneToPositions(positions);

        // Create stations with port slots
        scenario.stations.forEach(station => {
            const pos = positions.get(station.id);
            if (!pos) return;

            const { mesh, label } = this._createStation(station, pos);
            const portSlots = this._createPortSlots(station, pos);

            this.stations.set(station.id, {
                mesh, position: pos, label,
                stationType: station.type,
                portSlots,
                portConfig: station.config?.ports || []
            });
        });

        // Create connections (route to port slots when applicable)
        scenario.connections.forEach(conn => {
            const from = this.stations.get(conn.from);
            const to = this.stations.get(conn.to);
            if (!from || !to) return;

            let fromPos = from.position;
            let toPos = to.position;

            // Split/Moduler: connect from port slot by index
            if ((from.stationType === 'split' || from.stationType === 'moduler') && from.portSlots.length > 0 && conn.fromPortIndex >= 0) {
                const slot = this._findPortSlot(from, conn.fromPortIndex, 'exit');
                if (slot) fromPos = slot.position;
            }

            // Merge/Moduler: connect to port slot by index
            if ((to.stationType === 'merge' || to.stationType === 'moduler') && to.portSlots.length > 0 && conn.toPortIndex >= 0) {
                const slot = this._findPortSlot(to, conn.toPortIndex, 'entry');
                if (slot) toPos = slot.position;
            }

            const line = this._createConnection(fromPos, toPos, conn.condition);
            const connData = {
                line,
                from: fromPos,
                to: toPos,
                fromStationId: conn.from,
                toStationId: conn.to
            };
            this.connections.push(connData);

            // Create interlock indicator cubes on the connection
            this._createInterlockIndicators(connData, from, to);
        });

        // Build moduler hierarchy from dot-separated station IDs
        this._buildModulerHierarchy();

        // Default: all moduler stations collapsed
        this.modulerHierarchy.forEach((children, parentId) => {
            this.modulerCollapseState.set(parentId, true);
        });

        // Apply initial collapse state
        this._applyCollapseState();

        console.log(`[Visualizer3D] Created ${this.stations.size} stations and ${this.connections.length} connections`);
        if (this.modulerHierarchy.size > 0) {
            console.log(`[Visualizer3D] Found ${this.modulerHierarchy.size} moduler station group(s)`);
        }
    }

    _buildModulerHierarchy() {
        this.modulerHierarchy.clear();

        // Find stations with dot-separated IDs and group by parent prefix
        this.stations.forEach((stationData, stationId) => {
            const dotIdx = stationId.indexOf('.');
            if (dotIdx === -1) return; // Top-level station

            const parentId = stationId.substring(0, dotIdx);
            if (!this.modulerHierarchy.has(parentId)) {
                this.modulerHierarchy.set(parentId, new Set());
            }
            this.modulerHierarchy.get(parentId).add(stationId);
        });
    }

    // Get the parent moduler station ID for a child station, or null if not a child
    _getParentModulerId(stationId) {
        const dotIdx = stationId.indexOf('.');
        if (dotIdx === -1) return null;
        const parentId = stationId.substring(0, dotIdx);
        return this.modulerHierarchy.has(parentId) ? parentId : null;
    }

    // Check if a station is inside a collapsed moduler
    _isInsideCollapsedModuler(stationId) {
        const parentId = this._getParentModulerId(stationId);
        if (!parentId) return false;
        return this.modulerCollapseState.get(parentId) !== false;
    }

    // Get display position for a station, redirecting to parent moduler if collapsed
    _getDisplayPosition(stationId) {
        const parentId = this._getParentModulerId(stationId);
        if (parentId && this.modulerCollapseState.get(parentId) !== false) {
            const parentStation = this.stations.get(parentId);
            if (parentStation) return parentStation.position;
        }
        const station = this.stations.get(stationId);
        return station ? station.position : null;
    }

    toggleModulerCollapse(parentStationId) {
        const current = this.modulerCollapseState.get(parentStationId);
        if (current === undefined) return;
        this.modulerCollapseState.set(parentStationId, !current);
        this._applyCollapseState();
    }

    _applyCollapseState() {
        this.modulerHierarchy.forEach((children, parentId) => {
            const collapsed = this.modulerCollapseState.get(parentId) !== false;
            const parentStation = this.stations.get(parentId);

            // Show/hide child stations
            children.forEach(childId => {
                const child = this.stations.get(childId);
                if (!child) return;
                child.mesh.visible = !collapsed;
                if (child.label) child.label.visible = !collapsed && this.showStationNames;
                if (child.portSlots) {
                    child.portSlots.forEach(slot => {
                        slot.mesh.visible = !collapsed;
                        if (slot.label) slot.label.visible = !collapsed && this.showStationNames;
                        if (slot.connLine) slot.connLine.visible = !collapsed;
                    });
                }
            });

            // Show/hide connections between children
            this.connections.forEach(conn => {
                const fromIsChild = children.has(conn.fromStationId);
                const toIsChild = children.has(conn.toStationId);
                // Internal connections (both ends are children)
                if (fromIsChild && toIsChild) {
                    if (conn.line) conn.line.visible = !collapsed;
                }
            });

            // Update parent station signals text if collapsed
            if (parentStation && collapsed) {
                this._updateModulerSignalText(parentId);
            }
        });
    }

    _updateModulerSignalText(parentStationId) {
        // Signal text is updated via updateInterlockStates - this is a placeholder
        // The actual signal values are shown through the interlock indicators
    }

    _createPortSlots(station, stationPos) {
        // Moduler stations: create entry/exit port slots
        if (station.type === 'moduler') {
            return this._createModulerPortSlots(station, stationPos);
        }

        const ports = station.config?.ports || [];
        if (ports.length === 0) return [];

        const color = STATION_COLORS[station.type] || 0x6c757d;
        const slotSize = 25;
        const spacing = 35;
        const count = ports.length;

        // Merge: slots on upstream side (Z-), Split: slots on downstream side (Z+)
        const zOffset = station.type === 'merge' ? -60 : (station.type === 'split' ? 60 : 0);
        if (zOffset === 0) return [];

        return ports.map((port, i) => {
            const x = stationPos.x + (i - (count - 1) / 2) * spacing;
            const z = stationPos.z + zOffset;
            const position = { x, y: 0, z };

            // Create small box mesh
            const geometry = new THREE.BoxGeometry(slotSize, slotSize, slotSize);
            const fillMaterial = new THREE.MeshStandardMaterial({
                color, transparent: true, opacity: 0.15,
                emissive: color, emissiveIntensity: 0.1
            });
            const fillMesh = new THREE.Mesh(geometry, fillMaterial);
            const wireGeom = new THREE.EdgesGeometry(geometry);
            const wireMat = new THREE.LineBasicMaterial({ color, linewidth: 1, transparent: true, opacity: 0.5 });
            const wireMesh = new THREE.LineSegments(wireGeom, wireMat);
            const group = new THREE.Group();
            group.add(fillMesh);
            group.add(wireMesh);
            group.position.set(x, slotSize / 2, z);
            this.scene.add(group);

            // Create label for port index
            const labelText = `B${i}`;
            const label = this._createLabel(labelText, x, slotSize + 10, z);

            // Create connector line from slot to station body
            const connLine = this._createSlotConnectorLine(
                { x, z },
                stationPos,
                color
            );

            return { mesh: group, label, position, connLine };
        });
    }

    _createModulerPortSlots(station, stationPos) {
        const entryCount = station.config?.entryCount || station.entryCount || 1;
        const exitCount = station.config?.exitCount || station.exitCount || 1;
        const slotSize = 20;
        const spacing = 30;
        const slots = [];

        // Entry ports on upstream side (Z-)
        const entryColor = STATION_COLORS['entry'];
        for (let i = 0; i < entryCount; i++) {
            const x = stationPos.x + (i - (entryCount - 1) / 2) * spacing;
            const z = stationPos.z - 70;
            const position = { x, y: 0, z };

            const geometry = new THREE.BoxGeometry(slotSize, slotSize, slotSize);
            const fillMaterial = new THREE.MeshStandardMaterial({
                color: entryColor, transparent: true, opacity: 0.15,
                emissive: entryColor, emissiveIntensity: 0.1
            });
            const fillMesh = new THREE.Mesh(geometry, fillMaterial);
            const wireGeom = new THREE.EdgesGeometry(geometry);
            const wireMat = new THREE.LineBasicMaterial({ color: entryColor, linewidth: 1, transparent: true, opacity: 0.5 });
            const wireMesh = new THREE.LineSegments(wireGeom, wireMat);
            const group = new THREE.Group();
            group.add(fillMesh);
            group.add(wireMesh);
            group.position.set(x, slotSize / 2, z);
            this.scene.add(group);

            const label = this._createLabel(`E${i}`, x, slotSize + 10, z);
            const connLine = this._createSlotConnectorLine({ x, z }, stationPos, entryColor);

            slots.push({ mesh: group, label, position, connLine, portType: 'entry', portIndex: i });
        }

        // Exit ports on downstream side (Z+)
        const exitColor = STATION_COLORS['exit'];
        for (let i = 0; i < exitCount; i++) {
            const x = stationPos.x + (i - (exitCount - 1) / 2) * spacing;
            const z = stationPos.z + 70;
            const position = { x, y: 0, z };

            const geometry = new THREE.BoxGeometry(slotSize, slotSize, slotSize);
            const fillMaterial = new THREE.MeshStandardMaterial({
                color: exitColor, transparent: true, opacity: 0.15,
                emissive: exitColor, emissiveIntensity: 0.1
            });
            const fillMesh = new THREE.Mesh(geometry, fillMaterial);
            const wireGeom = new THREE.EdgesGeometry(geometry);
            const wireMat = new THREE.LineBasicMaterial({ color: exitColor, linewidth: 1, transparent: true, opacity: 0.5 });
            const wireMesh = new THREE.LineSegments(wireGeom, wireMat);
            const group = new THREE.Group();
            group.add(fillMesh);
            group.add(wireMesh);
            group.position.set(x, slotSize / 2, z);
            this.scene.add(group);

            const label = this._createLabel(`X${i}`, x, slotSize + 10, z);
            const connLine = this._createSlotConnectorLine({ x, z }, stationPos, exitColor);

            slots.push({ mesh: group, label, position, connLine, portType: 'exit', portIndex: i });
        }

        return slots;
    }

    _createSlotConnectorLine(slotPos, stationPos, color) {
        const points = [
            new THREE.Vector3(slotPos.x, 12, slotPos.z),
            new THREE.Vector3(stationPos.x, 12, stationPos.z)
        ];
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({
            color, opacity: 0.3, transparent: true, linewidth: 1
        });
        const line = new THREE.Line(geometry, material);
        this.scene.add(line);
        return line;
    }

    _positionsFromSaved(stations) {
        const positions = new Map();
        stations.forEach(station => {
            positions.set(station.id, {
                x: station.positionX || 0, y: 0, z: station.positionY || 0
            });
        });
        return positions;
    }

    _calculateLayout(stations, connections) {
        const positions = new Map();
        stations.forEach(station => {
            positions.set(station.id, {
                x: (Math.random() - 0.5) * 600, y: 0, z: (Math.random() - 0.5) * 600
            });
        });

        for (let iter = 0; iter < 150; iter++) {
            const forces = new Map();
            stations.forEach(s => forces.set(s.id, { x: 0, y: 0, z: 0 }));

            stations.forEach(s1 => {
                stations.forEach(s2 => {
                    if (s1.id === s2.id) return;
                    const p1 = positions.get(s1.id);
                    const p2 = positions.get(s2.id);
                    const dx = p1.x - p2.x;
                    const dz = p1.z - p2.z;
                    const distSq = dx * dx + dz * dz + 1;
                    const force = 8000 / distSq;
                    const f = forces.get(s1.id);
                    const dist = Math.sqrt(distSq);
                    f.x += force * dx / dist;
                    f.z += force * dz / dist;
                });
            });

            connections.forEach(conn => {
                const p1 = positions.get(conn.from);
                const p2 = positions.get(conn.to);
                if (!p1 || !p2) return;
                const dx = p2.x - p1.x;
                const dz = p2.z - p1.z;
                const dist = Math.sqrt(dx * dx + dz * dz);
                const force = dist * 0.015;
                const f1 = forces.get(conn.from);
                const f2 = forces.get(conn.to);
                f1.x += force * dx / dist;
                f1.z += force * dz / dist;
                f2.x -= force * dx / dist;
                f2.z -= force * dz / dist;
            });

            stations.forEach(station => {
                const pos = positions.get(station.id);
                const force = forces.get(station.id);
                pos.x += force.x * 0.1;
                pos.z += force.z * 0.1;
            });
        }

        return positions;
    }

    _createStation(station, position) {
        const color = STATION_COLORS[station.type] || 0x6c757d;

        // Moduler stations are larger
        const isModuler = station.type === 'moduler';
        const boxSize = isModuler ? 80 : 50;

        const geometry = new THREE.BoxGeometry(boxSize, boxSize, boxSize);
        const fillMaterial = new THREE.MeshStandardMaterial({
            color, transparent: true, opacity: isModuler ? 0.2 : 0.3,
            emissive: color, emissiveIntensity: 0.2
        });
        const fillMesh = new THREE.Mesh(geometry, fillMaterial);

        const wireframeGeometry = new THREE.EdgesGeometry(geometry);
        const wireframeMaterial = new THREE.LineBasicMaterial({ color, linewidth: 2 });
        const wireframeMesh = new THREE.LineSegments(wireframeGeometry, wireframeMaterial);

        const group = new THREE.Group();
        group.add(fillMesh);
        group.add(wireframeMesh);

        // Moduler: add inner wireframe for double-border effect
        if (isModuler) {
            const innerGeo = new THREE.BoxGeometry(boxSize - 10, boxSize - 10, boxSize - 10);
            const innerWireGeo = new THREE.EdgesGeometry(innerGeo);
            const innerWireMat = new THREE.LineBasicMaterial({ color, linewidth: 1, transparent: true, opacity: 0.5 });
            const innerWire = new THREE.LineSegments(innerWireGeo, innerWireMat);
            group.add(innerWire);
        }

        group.position.set(position.x, boxSize / 2, position.z);
        group.userData = { stationId: station.id, type: station.type };

        this.scene.add(group);

        const labelText = station.name || station.id;
        const labelY = isModuler ? boxSize + 15 : 65;
        const label = this._createLabel(labelText, position.x, labelY, position.z);

        return { mesh: group, label };
    }

    _createLabel(text, x, y, z) {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 512;
        canvas.height = 128;

        context.fillStyle = 'rgba(255, 255, 255, 0.5)';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.font = 'Bold 48px Arial';
        context.fillStyle = '#000';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(text, canvas.width / 2, canvas.height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
        const sprite = new THREE.Sprite(material);
        sprite.position.set(x, y, z);
        sprite.scale.set(100, 25, 1);
        sprite.visible = this.showStationNames;

        this.scene.add(sprite);
        return sprite;
    }

    _createWorkLabel(text, x, y, z) {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 512;
        canvas.height = 128;

        context.fillStyle = 'rgba(255, 200, 0, 0.7)';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.font = 'Bold 40px Arial';
        context.fillStyle = '#000';
        context.textAlign = 'center';
        context.textBaseline = 'middle';

        const displayText = text.length > 20 ? text.substring(0, 17) + '...' : text;
        context.fillText(displayText, canvas.width / 2, canvas.height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
        const sprite = new THREE.Sprite(material);
        sprite.position.set(x, y, z);
        sprite.scale.set(80, 20, 1);
        sprite.visible = this.showWorkIDs;

        this.scene.add(sprite);
        return sprite;
    }

    getWorkInfo(workId) {
        if (!this._activeWorks) return null;
        return this._activeWorks.get(workId) || null;
    }

    setShowWorkIDs(show) {
        this.showWorkIDs = show;
        this.works.forEach(work => {
            if (work.label) work.label.visible = show;
        });
    }

    setShowStationNames(show) {
        this.showStationNames = show;
        this.stations.forEach(station => {
            if (station.label) station.label.visible = show;
            if (station.portSlots) {
                station.portSlots.forEach(slot => {
                    if (slot.label) slot.label.visible = show;
                });
            }
        });
    }

    _createInterlockIndicators(connData, fromStationData, toStationData) {
        const cubeSize = 8;
        const geometry = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);

        const fromPos = connData.from;
        const toPos = connData.to;
        const dx = toPos.x - fromPos.x;
        const dz = toPos.z - fromPos.z;

        // outputReady indicator near the "from" station (20% along the line)
        const outX = fromPos.x + dx * 0.2;
        const outZ = fromPos.z + dz * 0.2;
        const outMaterial = new THREE.MeshStandardMaterial({
            color: 0x28a745, emissive: 0x28a745, emissiveIntensity: 0.5,
            transparent: true, opacity: 0.9
        });
        const outMesh = new THREE.Mesh(geometry, outMaterial);
        outMesh.position.set(outX, cubeSize / 2 + 1, outZ);
        outMesh.visible = this.showInterlocks;
        this.scene.add(outMesh);
        this.interlockIndicators.push({
            mesh: outMesh,
            stationId: connData.fromStationId,
            signalName: 'outputReady',
            connectionIndex: this.connections.length - 1
        });

        // inputReady indicator near the "to" station (80% along the line)
        const inX = fromPos.x + dx * 0.8;
        const inZ = fromPos.z + dz * 0.8;
        const inMaterial = new THREE.MeshStandardMaterial({
            color: 0x28a745, emissive: 0x28a745, emissiveIntensity: 0.5,
            transparent: true, opacity: 0.9
        });
        const inMesh = new THREE.Mesh(geometry, inMaterial);
        inMesh.position.set(inX, cubeSize / 2 + 1, inZ);
        inMesh.visible = this.showInterlocks;
        this.scene.add(inMesh);
        this.interlockIndicators.push({
            mesh: inMesh,
            stationId: connData.toStationId,
            signalName: 'inputReady',
            connectionIndex: this.connections.length - 1
        });
    }

    setShowInterlocks(show) {
        this.showInterlocks = show;
        this.interlockIndicators.forEach(indicator => {
            indicator.mesh.visible = show;
        });
    }

    updateInterlockStates(signalStates) {
        // signalStates: Map<stationId, Map<signalName, bool>>
        this.interlockIndicators.forEach(indicator => {
            const stationSignals = signalStates.get(indicator.stationId);
            if (!stationSignals) return;

            const value = stationSignals.get(indicator.signalName);
            if (value === undefined) return;

            const color = value ? 0x28a745 : 0xdc3545; // green=ON, red=OFF
            indicator.mesh.material.color.setHex(color);
            indicator.mesh.material.emissive.setHex(color);
        });
    }

    _createConnection(from, to, condition) {
        let color = 0x3a4f6f;
        if (condition === 'quality_ok') color = 0x28a745;
        else if (condition === 'quality_ng') color = 0xdc3545;
        else if (typeof condition === 'string' && condition.startsWith('workType:')) color = 0x9966cc;

        const points = [
            new THREE.Vector3(from.x, 1, from.z),
            new THREE.Vector3(to.x, 1, to.z)
        ];

        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({
            color, opacity: 0.5, transparent: true, linewidth: 2
        });

        const line = new THREE.Line(geometry, material);
        this.scene.add(line);
        return line;
    }

    // Find the port slot position by index
    _getPortSlotPosition(stationData, portIndex) {
        if (!stationData.portSlots || stationData.portSlots.length === 0) return null;
        if (portIndex < 0 || portIndex >= stationData.portSlots.length) return null;
        return stationData.portSlots[portIndex].position;
    }

    // Find port slot by index and type (for moduler stations with mixed entry/exit slots)
    _findPortSlot(stationData, portIndex, portType) {
        if (!stationData.portSlots || stationData.portSlots.length === 0) return null;

        // For moduler stations, filter by portType
        if (stationData.stationType === 'moduler') {
            const matching = stationData.portSlots.filter(s => s.portType === portType);
            return matching[portIndex] || null;
        }

        // For merge/split, use index directly
        if (portIndex < 0 || portIndex >= stationData.portSlots.length) return null;
        return stationData.portSlots[portIndex];
    }

    updateWorks(activeWorks, currentTime) {
        this._activeWorks = activeWorks;

        // Remove works that no longer exist
        const toRemove = [];
        this.works.forEach((work, workId) => {
            if (!activeWorks.has(workId)) {
                this.scene.remove(work.mesh);
                if (work.label) this.scene.remove(work.label);
                toRemove.push(workId);
            }
        });
        toRemove.forEach(id => this.works.delete(id));

        // Add or update works
        activeWorks.forEach((workInfo, workId) => {
            if (!this.works.has(workId)) {
                const geometry = new THREE.SphereGeometry(12, 32, 32);
                const fillMaterial = new THREE.MeshStandardMaterial({
                    color: 0xff4444, transparent: false, opacity: 1.0,
                    emissive: 0xff0000, emissiveIntensity: 0.3,
                    roughness: 0.3, metalness: 0.7
                });
                const fillMesh = new THREE.Mesh(geometry, fillMaterial);

                const wireframeGeometry = new THREE.WireframeGeometry(geometry);
                const wireframeMaterial = new THREE.LineBasicMaterial({ color: 0xff8888, linewidth: 1 });
                const wireframeMesh = new THREE.LineSegments(wireframeGeometry, wireframeMaterial);

                const group = new THREE.Group();
                group.add(fillMesh);
                group.add(wireframeMesh);
                group.userData = { workId };

                const label = this._createWorkLabel(workId, 0, 60, 0);

                this.scene.add(group);
                this.works.set(workId, { mesh: group, label });
            }

            const work = this.works.get(workId);

            if (workInfo.state === 'at_station') {
                // If inside a collapsed moduler, show at parent moduler position
                const displayPos = this._getDisplayPosition(workInfo.stationId);
                const station = this.stations.get(workInfo.stationId);
                if (displayPos) {
                    let x = displayPos.x;
                    let z = displayPos.z;
                    const y = 40;

                    // For port works (merge input / split output), position at port slot
                    // (only when not redirected to parent moduler)
                    if (!this._isInsideCollapsedModuler(workInfo.stationId) && station && workInfo.isInPort && workInfo.portIndex >= 0) {
                        const slotPos = this._getPortSlotPosition(station, workInfo.portIndex);
                        if (slotPos) {
                            x = slotPos.x;
                            z = slotPos.z;
                        }
                    }

                    work.mesh.position.set(x, y, z);
                    if (work.label) work.label.position.set(x, y + 20, z);
                }
            } else if (workInfo.state === 'moving') {
                const fromStation = this.stations.get(workInfo.fromStation);
                const toStation = this.stations.get(workInfo.toStation);

                if (!fromStation || !toStation) {
                    if (!this._warnedMissing) this._warnedMissing = new Set();
                    const key = `${workInfo.fromStation}->${workInfo.toStation}`;
                    if (!this._warnedMissing.has(key)) {
                        console.warn('[Visualizer3D] Moving work missing station:', workId, 'from:', workInfo.fromStation, !!fromStation, 'to:', workInfo.toStation, !!toStation);
                        console.warn('[Visualizer3D] Available stations:', [...this.stations.keys()]);
                        this._warnedMissing.add(key);
                    }
                }

                if (fromStation && toStation) {
                    const duration = workInfo.arriveTime - workInfo.departTime;
                    const elapsed = currentTime - workInfo.departTime;
                    const progress = Math.max(0, Math.min(1, elapsed / duration));

                    // Determine start/end positions (may be port slots)
                    // Use display position (redirects to parent moduler if collapsed)
                    const fromPos = this._getDisplayPosition(workInfo.fromStation) || fromStation.position;
                    const toPos = this._getDisplayPosition(workInfo.toStation) || toStation.position;
                    let startX = fromPos.x, startZ = fromPos.z;
                    let endX = toPos.x, endZ = toPos.z;

                    // If departing from split/moduler station, use port slot position (only if not collapsed)
                    if (!this._isInsideCollapsedModuler(workInfo.fromStation) && (fromStation.stationType === 'split' || fromStation.stationType === 'moduler') && workInfo.fromPortIndex >= 0) {
                        const slot = this._findPortSlot(fromStation, workInfo.fromPortIndex, 'exit');
                        if (slot) { startX = slot.position.x; startZ = slot.position.z; }
                    }

                    // If arriving at merge/moduler station, use port slot position (only if not collapsed)
                    if (!this._isInsideCollapsedModuler(workInfo.toStation) && (toStation.stationType === 'merge' || toStation.stationType === 'moduler') && workInfo.toPortIndex >= 0) {
                        const slot = this._findPortSlot(toStation, workInfo.toPortIndex, 'entry');
                        if (slot) { endX = slot.position.x; endZ = slot.position.z; }
                    }

                    const t = this._easeInOutCubic(progress);
                    const x = startX + (endX - startX) * t;
                    const z = startZ + (endZ - startZ) * t;
                    const y = 40 + Math.sin(t * Math.PI) * 30;

                    work.mesh.position.set(x, y, z);
                    if (work.label) work.label.position.set(x, y + 20, z);
                }
            }
        });
    }

    _easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    clear() {
        // Clear stations (including port slots)
        this.stations.forEach(station => {
            this.scene.remove(station.mesh);
            if (station.label) this.scene.remove(station.label);
            if (station.portSlots) {
                station.portSlots.forEach(slot => {
                    this.scene.remove(slot.mesh);
                    if (slot.label) this.scene.remove(slot.label);
                    if (slot.connLine) this.scene.remove(slot.connLine);
                });
            }
        });
        this.stations.clear();

        // Clear works
        this.works.forEach(work => {
            this.scene.remove(work.mesh);
            if (work.label) this.scene.remove(work.label);
        });
        this.works.clear();

        // Clear connections
        this.connections.forEach(conn => {
            if (conn.line) this.scene.remove(conn.line);
            else this.scene.remove(conn); // backward compat
        });
        this.connections = [];

        // Clear interlock indicators
        this.interlockIndicators.forEach(indicator => {
            this.scene.remove(indicator.mesh);
            indicator.mesh.geometry.dispose();
            indicator.mesh.material.dispose();
        });
        this.interlockIndicators = [];
    }
}
