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
    'drain': 0x6c757d
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

        window.addEventListener('resize', () => this._onResize());

        // Click handler for work selection
        this.renderer.domElement.addEventListener('click', (event) => this._handleClick(event));
    }

    setOnWorkClick(callback) {
        this._onWorkClick = callback;
    }

    _handleClick(event) {
        if (!this._onWorkClick) return;

        const rect = this.renderer.domElement.getBoundingClientRect();
        this._mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this._mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this._raycaster.setFromCamera(this._mouse, this.camera);

        // Collect all work meshes
        const workMeshes = [];
        this.works.forEach((work) => {
            workMeshes.push(work.mesh);
            // Also add children for group intersection
            work.mesh.children.forEach(child => workMeshes.push(child));
        });

        const intersects = this._raycaster.intersectObjects(workMeshes, false);
        if (intersects.length > 0) {
            // Find the work group (may be a child mesh)
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

            // Split station: connect from port slot by index
            if (from.stationType === 'split' && from.portSlots.length > 0 && conn.fromPortIndex >= 0) {
                const slot = from.portSlots[conn.fromPortIndex];
                if (slot) fromPos = slot.position;
            }

            // Merge station: connect to port slot by index
            if (to.stationType === 'merge' && to.portSlots.length > 0 && conn.toPortIndex >= 0) {
                const slot = to.portSlots[conn.toPortIndex];
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

        console.log(`[Visualizer3D] Created ${this.stations.size} stations and ${this.connections.length} connections`);
    }

    _createPortSlots(station, stationPos) {
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

        const geometry = new THREE.BoxGeometry(50, 50, 50);
        const fillMaterial = new THREE.MeshStandardMaterial({
            color, transparent: true, opacity: 0.3,
            emissive: color, emissiveIntensity: 0.2
        });
        const fillMesh = new THREE.Mesh(geometry, fillMaterial);

        const wireframeGeometry = new THREE.EdgesGeometry(geometry);
        const wireframeMaterial = new THREE.LineBasicMaterial({ color, linewidth: 2 });
        const wireframeMesh = new THREE.LineSegments(wireframeGeometry, wireframeMaterial);

        const group = new THREE.Group();
        group.add(fillMesh);
        group.add(wireframeMesh);
        group.position.set(position.x, 25, position.z);
        group.userData = { stationId: station.id, type: station.type };

        this.scene.add(group);

        const labelText = station.name || station.id;
        const label = this._createLabel(labelText, position.x, 65, position.z);

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
                const station = this.stations.get(workInfo.stationId);
                if (station) {
                    let x = station.position.x;
                    let z = station.position.z;
                    const y = 40;

                    // For port works (merge input / split output), position at port slot
                    if (workInfo.isInPort && workInfo.portIndex >= 0) {
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

                if (fromStation && toStation) {
                    const duration = workInfo.arriveTime - workInfo.departTime;
                    const elapsed = currentTime - workInfo.departTime;
                    const progress = Math.max(0, Math.min(1, elapsed / duration));

                    // Determine start/end positions (may be port slots)
                    let startX = fromStation.position.x, startZ = fromStation.position.z;
                    let endX = toStation.position.x, endZ = toStation.position.z;

                    // If departing from split station, use port slot position
                    if (fromStation.stationType === 'split' && workInfo.fromPortIndex >= 0) {
                        const slotPos = this._getPortSlotPosition(fromStation, workInfo.fromPortIndex);
                        if (slotPos) { startX = slotPos.x; startZ = slotPos.z; }
                    }

                    // If arriving at merge station, use port slot position
                    if (toStation.stationType === 'merge' && workInfo.toPortIndex >= 0) {
                        const slotPos = this._getPortSlotPosition(toStation, workInfo.toPortIndex);
                        if (slotPos) { endX = slotPos.x; endZ = slotPos.z; }
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
