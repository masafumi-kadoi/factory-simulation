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
    constructor(container, mouseConfig) {
        this.container = container;
        this._mouseConfig = mouseConfig || null;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;

        this.stations = new Map();
        this.works = new Map();
        this.connections = [];
        this.showWorkIDs = true;
        this.showStationNames = true;
        this.showInterlocks = false;
        this.interlockIndicators = [];
        this.modulerHierarchy = new Map();
        this.ground = null;
        this.gridHelper = null;
        this._raycaster = new THREE.Raycaster();
        this._mouse = new THREE.Vector2();
        this._onWorkClick = null;
        this._onModulerDoubleClick = null;
        this._activeWorks = null;
        this._clickTimer = null;
        this._clickTarget = null;

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
        this._applyMouseConfig();

        if (this._mouseConfig) {
            this._mouseConfig.onChange(() => this._applyMouseConfig());
        }

        this._resizeHandler = () => this._onResize();
        window.addEventListener('resize', this._resizeHandler);

        this.renderer.domElement.addEventListener('click', (event) => this._handleClick(event));
    }

    _applyMouseConfig() {
        if (!this.controls) return;
        const ACTION_MAP = { pan: THREE.MOUSE.PAN, rotate: THREE.MOUSE.ROTATE, dolly: THREE.MOUSE.DOLLY };
        if (this._mouseConfig) {
            const cfg = this._mouseConfig.config;
            this.controls.mouseButtons = {
                LEFT: ACTION_MAP[cfg.left] ?? THREE.MOUSE.PAN,
                MIDDLE: ACTION_MAP[cfg.middle] ?? THREE.MOUSE.DOLLY,
                RIGHT: ACTION_MAP[cfg.right] ?? THREE.MOUSE.ROTATE,
            };
        } else {
            this.controls.mouseButtons = {
                LEFT: THREE.MOUSE.PAN,
                MIDDLE: THREE.MOUSE.DOLLY,
                RIGHT: THREE.MOUSE.ROTATE,
            };
        }
    }

    setOnWorkClick(callback) {
        this._onWorkClick = callback;
    }

    setOnModulerDoubleClick(callback) {
        this._onModulerDoubleClick = callback;
    }

    _handleClick(event) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this._mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this._mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this._raycaster.setFromCamera(this._mouse, this.camera);

        // Detect which station or work was clicked
        const stationMeshes = [];
        this.stations.forEach((station) => {
            stationMeshes.push(station.mesh);
            station.mesh.children.forEach(child => stationMeshes.push(child));
        });

        const stationIntersects = this._raycaster.intersectObjects(stationMeshes, false);
        let clickedStationId = null;
        if (stationIntersects.length > 0) {
            let obj = stationIntersects[0].object;
            while (obj && !obj.userData.stationId) {
                obj = obj.parent;
            }
            if (obj && obj.userData.stationId) {
                clickedStationId = obj.userData.stationId;
            }
        }

        // Double-click detection for moduler stations
        if (clickedStationId && this.modulerHierarchy.has(clickedStationId)) {
            if (this._clickTimer && this._clickTarget === clickedStationId) {
                clearTimeout(this._clickTimer);
                this._clickTimer = null;
                this._clickTarget = null;
                if (this._onModulerDoubleClick) {
                    this._onModulerDoubleClick(clickedStationId);
                }
                return;
            }
            this._clickTarget = clickedStationId;
            this._clickTimer = setTimeout(() => {
                this._clickTimer = null;
                this._clickTarget = null;
            }, 300);
            return;
        }

        // Work click
        if (this._onWorkClick) {
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
    }

    _onResize() {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        if (width === 0 || height === 0) return;
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
        this._animFrameId = requestAnimationFrame(() => this._animate());
        if (this.controls) this.controls.update();
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    dispose() {
        if (this._animFrameId) {
            cancelAnimationFrame(this._animFrameId);
            this._animFrameId = null;
        }
        if (this._resizeHandler) {
            window.removeEventListener('resize', this._resizeHandler);
        }
        if (this.scene) {
            this.clear();
        }
        if (this.controls) {
            this.controls.dispose();
        }
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer.forceContextLoss();
            this.renderer = null;
        }
        this.scene = null;
    }

    loadScenario(scenario) {
        console.log('[Visualizer3D] Loading scenario:', scenario.name);

        const hasSavedPositions = scenario.stations.some(s => s.positionX != null && s.positionY != null);
        const positions = hasSavedPositions
            ? this._positionsFromSaved(scenario.stations)
            : this._calculateLayout(scenario.stations, scenario.connections);

        this._adjustSceneToPositions(positions);

        const stationTypes = new Map();
        scenario.stations.forEach(s => stationTypes.set(s.id, s.type));
        const portTargets = this._buildPortTargetMap(scenario.connections, stationTypes, positions);

        scenario.stations.forEach(station => {
            const pos = positions.get(station.id);
            if (!pos) return;

            const { mesh, label } = this._createStation(station, pos);
            const portSlots = this._createPortSlots(station, pos, portTargets.get(station.id) || []);

            this.stations.set(station.id, {
                mesh, position: pos, label,
                stationType: station.type,
                portSlots,
                portConfig: station.config?.ports || [],
                bufferSlots: station.type === 'moduler' ? (station.config?.bufferSlots || null) : null,
                stationName: station.name || station.id,
            });
        });

        const resolveModulerChild = (id) => {
            const dotIdx = id.lastIndexOf('.');
            if (dotIdx === -1) return null;
            const parentId = id.substring(0, dotIdx);
            const suffix = id.substring(dotIdx + 1);
            const entryMatch = suffix.match(/^entry-(\d+)$/);
            if (entryMatch) return { parentId, portType: 'entry', portIndex: parseInt(entryMatch[1]) };
            const exitMatch = suffix.match(/^exit-(\d+)$/);
            if (exitMatch) return { parentId, portType: 'exit', portIndex: parseInt(exitMatch[1]) };
            return null;
        };

        scenario.connections.forEach(conn => {
            let from = this.stations.get(conn.from);
            let to = this.stations.get(conn.to);
            let fromPos, toPos;

            if (!from) {
                const child = resolveModulerChild(conn.from);
                if (child) {
                    from = this.stations.get(child.parentId);
                    if (from) {
                        const slot = this._findPortSlot(from, child.portIndex, child.portType);
                        fromPos = slot ? slot.position : from.position;
                    }
                }
            }
            if (!to) {
                const child = resolveModulerChild(conn.to);
                if (child) {
                    to = this.stations.get(child.parentId);
                    if (to) {
                        const slot = this._findPortSlot(to, child.portIndex, child.portType);
                        toPos = slot ? slot.position : to.position;
                    }
                }
            }

            if (!from || !to) return;

            if (!fromPos) fromPos = from.position;
            if (!toPos) toPos = to.position;

            if (from.stationType === 'split' && from.portSlots.length > 0 && conn.fromPortIndex >= 0) {
                const slot = this._findPortSlot(from, conn.fromPortIndex, 'exit');
                if (slot) fromPos = slot.position;
            }

            if (to.stationType === 'merge' && to.portSlots.length > 0 && conn.toPortIndex >= 0) {
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

            this._createInterlockIndicators(connData, from, to);
        });

        this._buildModulerHierarchy();

        console.log(`[Visualizer3D] Created ${this.stations.size} stations and ${this.connections.length} connections`);
        if (this.modulerHierarchy.size > 0) {
            console.log(`[Visualizer3D] Found ${this.modulerHierarchy.size} moduler station group(s)`);
        }
    }

    _buildModulerHierarchy() {
        this.modulerHierarchy.clear();
        this.stations.forEach((stationData, stationId) => {
            if (stationData.stationType === 'moduler') {
                this.modulerHierarchy.set(stationId, new Set());
            }
        });
    }

    _getParentModulerId(stationId) {
        const dotIdx = stationId.lastIndexOf('.');
        if (dotIdx === -1) return null;
        const parentId = stationId.substring(0, dotIdx);
        return this.modulerHierarchy.has(parentId) ? parentId : null;
    }

    _createPortSlots(station, stationPos, portTargets) {
        if (station.type === 'moduler') {
            return this._createModulerPortSlots(station, stationPos, portTargets);
        }

        const ports = station.config?.ports || [];
        if (ports.length === 0) return [];

        const color = STATION_COLORS[station.type] || 0x6c757d;
        const portRadius = 14;
        const portHeight = 3;
        const spacing = 35;
        const offset = 60;

        const portType = station.type === 'merge' ? 'entry' : (station.type === 'split' ? 'exit' : null);
        if (!portType) return [];

        return ports.map((port, i) => {
            const { x, z } = this._calcPortPosition(stationPos, i, ports.length, spacing, offset, portType, portTargets);
            const position = { x, y: 0, z };

            const discGeo = new THREE.CylinderGeometry(portRadius, portRadius, portHeight, 24);
            const discMat = new THREE.MeshStandardMaterial({
                color, transparent: true, opacity: 0.3,
                emissive: color, emissiveIntensity: 0.3
            });
            const discMesh = new THREE.Mesh(discGeo, discMat);

            const ringGeo = new THREE.RingGeometry(portRadius - 1.5, portRadius, 32);
            const ringMat = new THREE.MeshBasicMaterial({
                color, transparent: true, opacity: 0.7, side: THREE.DoubleSide
            });
            const ringMesh = new THREE.Mesh(ringGeo, ringMat);
            ringMesh.rotation.x = -Math.PI / 2;
            ringMesh.position.y = portHeight / 2 + 0.1;

            const group = new THREE.Group();
            group.add(discMesh);
            group.add(ringMesh);
            group.position.set(x, portHeight / 2, z);
            this.scene.add(group);

            const labelText = `B${i}`;
            const label = this._createLabel(labelText, x, 12, z);

            const connLine = this._createSlotConnectorLine({ x, z }, stationPos, color);

            return { mesh: group, label, position, connLine };
        });
    }

    _createModulerPortSlots(station, stationPos, portTargets) {
        const entryCount = station.config?.entryCount || station.entryCount || 1;
        const exitCount = station.config?.exitCount || station.exitCount || 1;
        const portRadius = 12;
        const portHeight = 3;
        const spacing = 30;
        const offset = 70;
        const slots = [];

        const entryColor = STATION_COLORS['entry'];
        for (let i = 0; i < entryCount; i++) {
            const { x, z } = this._calcPortPosition(stationPos, i, entryCount, spacing, offset, 'entry', portTargets);
            const position = { x, y: 0, z };

            const discGeo = new THREE.CylinderGeometry(portRadius, portRadius, portHeight, 24);
            const discMat = new THREE.MeshStandardMaterial({
                color: entryColor, transparent: true, opacity: 0.3,
                emissive: entryColor, emissiveIntensity: 0.3
            });
            const discMesh = new THREE.Mesh(discGeo, discMat);

            const ringGeo = new THREE.RingGeometry(portRadius - 1.5, portRadius, 32);
            const ringMat = new THREE.MeshBasicMaterial({
                color: entryColor, transparent: true, opacity: 0.7, side: THREE.DoubleSide
            });
            const ringMesh = new THREE.Mesh(ringGeo, ringMat);
            ringMesh.rotation.x = -Math.PI / 2;
            ringMesh.position.y = portHeight / 2 + 0.1;

            const group = new THREE.Group();
            group.add(discMesh);
            group.add(ringMesh);
            group.position.set(x, portHeight / 2, z);
            this.scene.add(group);

            const label = this._createLabel(`E${i}`, x, 12, z);
            const connLine = this._createSlotConnectorLine({ x, z }, stationPos, entryColor);

            slots.push({ mesh: group, label, position, connLine, portType: 'entry', portIndex: i });
        }

        const exitColor = STATION_COLORS['exit'];
        for (let i = 0; i < exitCount; i++) {
            const { x, z } = this._calcPortPosition(stationPos, i, exitCount, spacing, offset, 'exit', portTargets);
            const position = { x, y: 0, z };

            const discGeo = new THREE.CylinderGeometry(portRadius, portRadius, portHeight, 24);
            const discMat = new THREE.MeshStandardMaterial({
                color: exitColor, transparent: true, opacity: 0.3,
                emissive: exitColor, emissiveIntensity: 0.3
            });
            const discMesh = new THREE.Mesh(discGeo, discMat);

            const ringGeo = new THREE.RingGeometry(portRadius - 1.5, portRadius, 32);
            const ringMat = new THREE.MeshBasicMaterial({
                color: exitColor, transparent: true, opacity: 0.7, side: THREE.DoubleSide
            });
            const ringMesh = new THREE.Mesh(ringGeo, ringMat);
            ringMesh.rotation.x = -Math.PI / 2;
            ringMesh.position.y = portHeight / 2 + 0.1;

            const group = new THREE.Group();
            group.add(discMesh);
            group.add(ringMesh);
            group.position.set(x, portHeight / 2, z);
            this.scene.add(group);

            const label = this._createLabel(`X${i}`, x, 12, z);
            const connLine = this._createSlotConnectorLine({ x, z }, stationPos, exitColor);

            slots.push({ mesh: group, label, position, connLine, portType: 'exit', portIndex: i });
        }

        return slots;
    }

    _createSlotConnectorLine(slotPos, stationPos, color) {
        const points = [
            new THREE.Vector3(slotPos.x, 4, slotPos.z),
            new THREE.Vector3(stationPos.x, 4, stationPos.z)
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
                if (dist < 0.001) return;
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

        const isModuler = station.type === 'moduler';
        const radius = isModuler ? 45 : 30;
        const discHeight = 4;

        const discGeo = new THREE.CylinderGeometry(radius, radius, discHeight, 32);
        const discMat = new THREE.MeshStandardMaterial({
            color, transparent: true, opacity: isModuler ? 0.3 : 0.4,
            emissive: color, emissiveIntensity: 0.4,
            roughness: 0.4, metalness: 0.1
        });
        const discMesh = new THREE.Mesh(discGeo, discMat);

        const ringGeo = new THREE.RingGeometry(radius - 2, radius, 48);
        const ringMat = new THREE.MeshBasicMaterial({
            color, transparent: true, opacity: 0.8, side: THREE.DoubleSide
        });
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.rotation.x = -Math.PI / 2;
        ringMesh.position.y = discHeight / 2 + 0.1;

        const group = new THREE.Group();
        group.add(discMesh);
        group.add(ringMesh);

        if (isModuler) {
            const innerRingGeo = new THREE.RingGeometry(radius - 8, radius - 6, 48);
            const innerRingMat = new THREE.MeshBasicMaterial({
                color, transparent: true, opacity: 0.5, side: THREE.DoubleSide
            });
            const innerRingMesh = new THREE.Mesh(innerRingGeo, innerRingMat);
            innerRingMesh.rotation.x = -Math.PI / 2;
            innerRingMesh.position.y = discHeight / 2 + 0.2;
            group.add(innerRingMesh);
        }

        group.position.set(position.x, discHeight / 2, position.z);
        group.userData = { stationId: station.id, type: station.type };

        this.scene.add(group);

        const labelText = station.name || station.id;
        const labelY = isModuler ? 25 : 20;
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

    _shortWorkId(workId) {
        if (!workId) return '';
        // UUID: 8-4-4-4-12 → show first segment only
        const dashIdx = workId.indexOf('-');
        if (dashIdx > 0 && dashIdx <= 8) return workId.substring(0, dashIdx);
        return workId.length > 12 ? workId.substring(0, 12) : workId;
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

        const fromPos = connData.from;
        const toPos = connData.to;
        const dx = toPos.x - fromPos.x;
        const dz = toPos.z - fromPos.z;

        const outX = fromPos.x + dx * 0.2;
        const outZ = fromPos.z + dz * 0.2;
        const outMaterial = new THREE.MeshStandardMaterial({
            color: 0x28a745, emissive: 0x28a745, emissiveIntensity: 0.5,
            transparent: true, opacity: 0.9
        });
        const outMesh = new THREE.Mesh(new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize), outMaterial);
        outMesh.position.set(outX, cubeSize / 2 + 1, outZ);
        outMesh.visible = this.showInterlocks;
        this.scene.add(outMesh);
        this.interlockIndicators.push({
            mesh: outMesh,
            stationId: connData.fromStationId,
            signalName: 'outputReady',
            connectionIndex: this.connections.length - 1
        });

        const inX = fromPos.x + dx * 0.8;
        const inZ = fromPos.z + dz * 0.8;
        const inMaterial = new THREE.MeshStandardMaterial({
            color: 0x28a745, emissive: 0x28a745, emissiveIntensity: 0.5,
            transparent: true, opacity: 0.9
        });
        const inMesh = new THREE.Mesh(new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize), inMaterial);
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
        this.interlockIndicators.forEach(indicator => {
            const stationSignals = signalStates.get(indicator.stationId);
            if (!stationSignals) return;

            const value = stationSignals.get(indicator.signalName);
            if (value === undefined) return;

            const color = value ? 0x28a745 : 0xdc3545;
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

    _getPortSlotPosition(stationData, portIndex) {
        if (!stationData.portSlots || stationData.portSlots.length === 0) return null;
        if (portIndex < 0 || portIndex >= stationData.portSlots.length) return null;
        return stationData.portSlots[portIndex].position;
    }

    _findPortSlot(stationData, portIndex, portType) {
        if (!stationData.portSlots || stationData.portSlots.length === 0) return null;

        if (stationData.stationType === 'moduler') {
            const matching = stationData.portSlots.filter(s => s.portType === portType);
            if (portIndex < 0 || portIndex >= matching.length) return null;
            return matching[portIndex];
        }

        if (portIndex < 0 || portIndex >= stationData.portSlots.length) return null;
        return stationData.portSlots[portIndex];
    }

    _calcPortPosition(stationPos, portIndex, totalCount, spacing, offset, portType, portTargets) {
        const target = portTargets.find(t => t.portIndex === portIndex && t.portType === portType);

        if (target && target.targetPos) {
            const dx = target.targetPos.x - stationPos.x;
            const dz = target.targetPos.z - stationPos.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist > 0.01) {
                const dirX = dx / dist;
                const dirZ = dz / dist;
                return {
                    x: stationPos.x + dirX * offset,
                    z: stationPos.z + dirZ * offset
                };
            }
        }

        const zSign = portType === 'entry' ? -1 : 1;
        return {
            x: stationPos.x + (portIndex - (totalCount - 1) / 2) * spacing,
            z: stationPos.z + zSign * offset
        };
    }

    _buildPortTargetMap(connections, stationTypes, positions) {
        const map = new Map();

        const parseModulerChild = (id) => {
            const dotIdx = id.lastIndexOf('.');
            if (dotIdx === -1) return null;
            const parentId = id.substring(0, dotIdx);
            const suffix = id.substring(dotIdx + 1);
            const entryMatch = suffix.match(/^entry-(\d+)$/);
            if (entryMatch) return { parentId, portType: 'entry', portIndex: parseInt(entryMatch[1]) };
            const exitMatch = suffix.match(/^exit-(\d+)$/);
            if (exitMatch) return { parentId, portType: 'exit', portIndex: parseInt(exitMatch[1]) };
            return null;
        };

        const resolvePos = (id) => {
            const pos = positions.get(id);
            if (pos) return pos;
            const child = parseModulerChild(id);
            if (child) return positions.get(child.parentId) || null;
            return null;
        };

        connections.forEach(conn => {
            const fromPos = resolvePos(conn.from);
            const toPos = resolvePos(conn.to);

            const toChild = parseModulerChild(conn.to);
            if (toChild && fromPos && stationTypes.get(toChild.parentId) === 'moduler') {
                if (!map.has(toChild.parentId)) map.set(toChild.parentId, []);
                map.get(toChild.parentId).push({ portIndex: toChild.portIndex, portType: 'entry', targetPos: fromPos });
            }

            const fromChild = parseModulerChild(conn.from);
            if (fromChild && toPos && stationTypes.get(fromChild.parentId) === 'moduler') {
                if (!map.has(fromChild.parentId)) map.set(fromChild.parentId, []);
                map.get(fromChild.parentId).push({ portIndex: fromChild.portIndex, portType: 'exit', targetPos: toPos });
            }

            if (!fromPos || !toPos) return;

            const toType = stationTypes.get(conn.to);
            if (toType === 'merge' && conn.toPortIndex >= 0) {
                if (!map.has(conn.to)) map.set(conn.to, []);
                map.get(conn.to).push({ portIndex: conn.toPortIndex, portType: 'entry', targetPos: fromPos });
            }

            const fromType = stationTypes.get(conn.from);
            if (fromType === 'split' && conn.fromPortIndex >= 0) {
                if (!map.has(conn.from)) map.set(conn.from, []);
                map.get(conn.from).push({ portIndex: conn.fromPortIndex, portType: 'exit', targetPos: toPos });
            }
        });

        return map;
    }

    updateWorks(activeWorks, currentTime) {
        this._activeWorks = activeWorks;

        const toRemove = [];
        this.works.forEach((work, workId) => {
            if (!activeWorks.has(workId)) {
                this.scene.remove(work.mesh);
                this._disposeObject3D(work.mesh);
                if (work.label) {
                    this.scene.remove(work.label);
                    this._disposeMesh(work.label);
                }
                toRemove.push(workId);
            }
        });
        toRemove.forEach(id => this.works.delete(id));

        // Build per-station work count for offset positioning
        const stationWorkCounts = new Map();
        const stationWorkIndex = new Map();
        activeWorks.forEach((workInfo, workId) => {
            if (workInfo.state === 'at_station') {
                const sid = workInfo.stationId;
                if (!stationWorkCounts.has(sid)) stationWorkCounts.set(sid, []);
                stationWorkCounts.get(sid).push(workId);
            }
        });
        stationWorkCounts.forEach((workIds, sid) => {
            workIds.sort();
            workIds.forEach((wid, idx) => {
                stationWorkIndex.set(wid, { index: idx, total: workIds.length });
            });
        });

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

                const label = this._createWorkLabel(this._shortWorkId(workId), 0, 60, 0);

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

                    if (workInfo.portIndex >= 0) {
                        const slotPos = this._getPortSlotPosition(station, workInfo.portIndex);
                        if (slotPos) {
                            x = slotPos.x;
                            z = slotPos.z;
                        }
                    }

                    // Multi-work offset
                    const offsetInfo = stationWorkIndex.get(workId);
                    if (offsetInfo && offsetInfo.total > 1) {
                        const angle = (offsetInfo.index / offsetInfo.total) * Math.PI * 2;
                        x += Math.cos(angle) * 15;
                        z += Math.sin(angle) * 15;
                    }

                    work.mesh.position.set(x, y, z);
                    if (work.label) work.label.position.set(x, y + 20, z);
                }
            } else if (workInfo.state === 'moving') {
                const fromStation = this.stations.get(workInfo.fromStation);
                const toStation = this.stations.get(workInfo.toStation);

                if (fromStation && toStation) {
                    const duration = Math.max(0.001, workInfo.arriveTime - workInfo.departTime);
                    const elapsed = currentTime - workInfo.departTime;
                    const progress = Math.max(0, Math.min(1, elapsed / duration));

                    let startX = fromStation.position.x, startZ = fromStation.position.z;
                    let endX = toStation.position.x, endZ = toStation.position.z;

                    if ((fromStation.stationType === 'split' || fromStation.stationType === 'moduler') && workInfo.fromPortIndex >= 0) {
                        const slot = this._findPortSlot(fromStation, workInfo.fromPortIndex, 'exit');
                        if (slot) { startX = slot.position.x; startZ = slot.position.z; }
                    }

                    if ((toStation.stationType === 'merge' || toStation.stationType === 'moduler') && workInfo.toPortIndex >= 0) {
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

        this._updateModulerOccupancy(activeWorks);
    }

    _updateModulerOccupancy(activeWorks) {
        this.stations.forEach((stationData, stationId) => {
            if (stationData.stationType !== 'moduler' || !stationData.bufferSlots) return;
            // In layer-1 view, sub-station works are already mapped to the moduler's own ID.
            // Count works whose stationId IS this moduler (works physically inside it).
            let occupied = 0;
            activeWorks.forEach((workInfo) => {
                if (workInfo.state === 'at_station' && workInfo.stationId === stationId) occupied++;
            });
            const ratio = Math.min(1, occupied / stationData.bufferSlots);
            // Lerp color: green (0x4caf50) → red (0xe53935)
            const r = Math.round(0x4c + (0xe5 - 0x4c) * ratio);
            const g = Math.round(0xaf + (0x39 - 0xaf) * ratio);
            const b = Math.round(0x50 + (0x35 - 0x50) * ratio);
            const newColor = (r << 16) | (g << 8) | b;
            const discMesh = stationData.mesh.children[0];
            if (discMesh?.material) {
                discMesh.material.color.setHex(newColor);
                discMesh.material.emissive.setHex(newColor);
            }
        });
    }

    _easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    _disposeMesh(mesh) {
        if (!mesh) return;
        // Sprite geometry is shared internally by Three.js — do not dispose it
        if (mesh.geometry && !(mesh instanceof THREE.Sprite)) mesh.geometry.dispose();
        if (mesh.material) {
            if (mesh.material.map) mesh.material.map.dispose();
            mesh.material.dispose();
        }
    }

    _disposeObject3D(obj) {
        if (!obj) return;
        obj.traverse(child => this._disposeMesh(child));
    }

    clear() {
        this.stations.forEach(station => {
            this.scene.remove(station.mesh);
            this._disposeObject3D(station.mesh);
            if (station.label) {
                this.scene.remove(station.label);
                this._disposeMesh(station.label);
            }
            if (station.portSlots) {
                station.portSlots.forEach(slot => {
                    this.scene.remove(slot.mesh);
                    this._disposeObject3D(slot.mesh);
                    if (slot.label) {
                        this.scene.remove(slot.label);
                        this._disposeMesh(slot.label);
                    }
                    if (slot.connLine) {
                        this.scene.remove(slot.connLine);
                        this._disposeMesh(slot.connLine);
                    }
                });
            }
        });
        this.stations.clear();

        this.works.forEach(work => {
            this.scene.remove(work.mesh);
            this._disposeObject3D(work.mesh);
            if (work.label) {
                this.scene.remove(work.label);
                this._disposeMesh(work.label);
            }
        });
        this.works.clear();

        this.connections.forEach(conn => {
            const line = conn.line || conn;
            this.scene.remove(line);
            this._disposeMesh(line);
        });
        this.connections = [];

        this.interlockIndicators.forEach(indicator => {
            this.scene.remove(indicator.mesh);
            indicator.mesh.geometry.dispose();
            indicator.mesh.material.dispose();
        });
        this.interlockIndicators = [];
    }
}
