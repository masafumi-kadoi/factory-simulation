// 3D Visualizer inspired by Mini Tokyo 3D
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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
        this.showInternal = false;
        this.showInternalNames = true;
        this.interlockIndicators = [];
        this.modulerHierarchy = new Map();
        this._internalObjects = [];
        this._internalLabels = [];
        this._internalPositions = new Map();
        this.internalStationRadius = 15;
        this._lastFlatScenario = null;
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

        this.camera = new THREE.PerspectiveCamera(50, width / (height || 1), 1, 5000);
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
            if (!station.mesh) return;
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
            // GridHelper uses an array of materials
            if (Array.isArray(this.gridHelper.material)) {
                this.gridHelper.material.forEach(m => m.dispose());
            } else if (this.gridHelper.material) {
                this.gridHelper.material.dispose();
            }
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

    async loadScenario(scenario) {
        console.log('[Visualizer3D] Loading scenario:', scenario.name);

        const hasSavedPositions = scenario.stations.some(s => s.positionX != null && s.positionY != null);
        const positions = hasSavedPositions
            ? this._positionsFromSaved(scenario.stations)
            : this._calculateLayout(scenario.stations, scenario.connections);

        this._adjustSceneToPositions(positions);

        const stationTypes = new Map();
        scenario.stations.forEach(s => stationTypes.set(s.id, s.type));
        const portTargets = this._buildPortTargetMap(scenario.connections, stationTypes, positions);

        for (const station of scenario.stations) {
            const pos = positions.get(station.id);
            if (!pos) continue;

            const cfg = station.config;
            if (station.type === 'moduler') {
                if (cfg?.model3DGrid) {
                    this._createModulerGridModel(station.id, station, pos, portTargets.get(station.id) || []);
                } else if (cfg?.model3DGltf || cfg?.model3DGlb) {
                    await this._createModulerGltfModel(station.id, station, pos, portTargets.get(station.id) || []);
                } else {
                    const { mesh, label } = this._createStation(station, pos);
                    this.stations.set(station.id, {
                        mesh, position: pos, label,
                        stationType: 'moduler',
                        portSlots: [],
                        portConfig: cfg?.ports || [],
                        bufferSlots: cfg?.bufferSlots || null,
                        stationName: station.name || station.id,
                    });
                }
            } else {
                const { mesh, label } = this._createStation(station, pos);
                const portSlots = this._createPortSlots(station, pos, portTargets.get(station.id) || []);
                this.stations.set(station.id, {
                    mesh, position: pos, label,
                    stationType: station.type,
                    portSlots,
                    portConfig: cfg?.ports || [],
                    bufferSlots: null,
                    stationName: station.name || station.id,
                });
            }
        }

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
                toStationId: conn.to,
                originalFrom: conn.originalFrom || conn.from,
                originalTo: conn.originalTo || conn.to,
                defaultFrom: fromPos,
                defaultTo: toPos,
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

    _createModulerGridModel(stationId, station, pos, portTargetList) {
        const grid = station.config.model3DGrid;
        const { gridSize, height, cells, origin } = grid;
        const PX_PER_M = 80;
        const cellUnit = gridSize * PX_PER_M;
        const modelH = height * PX_PER_M;

        const minC = Math.min(...cells.map(([c]) => c));
        const maxC = Math.max(...cells.map(([c]) => c));
        const minR = Math.min(...cells.map(([, r]) => r));
        const maxR = Math.max(...cells.map(([, r]) => r));

        const refC = origin ? origin[0] : (minC + maxC) / 2;
        const refR = origin ? origin[1] : (minR + maxR) / 2;

        const shellGeom = this._buildShellGeometry(cells, cellUnit, modelH, refC, refR);
        const material = new THREE.MeshStandardMaterial({
            color: 0x4a148c,
            transparent: true,
            opacity: 0.7,
            roughness: 0.5,
            metalness: 0.1,
        });
        const mesh = new THREE.Mesh(shellGeom, material);

        const edgeGeom = new THREE.EdgesGeometry(shellGeom, 1);
        const edgeMat = new THREE.LineBasicMaterial({ color: 0x7c43bd, transparent: true, opacity: 0.9 });
        mesh.add(new THREE.LineSegments(edgeGeom, edgeMat));

        const group = new THREE.Group();
        group.add(mesh);
        group.position.set(pos.x, 0, pos.z);
        group.userData = { stationId, type: 'moduler' };
        this.scene.add(group);

        const labelX = pos.x + ((minC + maxC) / 2 - refC) * cellUnit;
        const labelZ = pos.z + ((minR + maxR) / 2 - refR) * cellUnit;
        const label = this._createLabel(station.name || stationId, labelX, modelH + 15, labelZ);

        this.stations.set(stationId, {
            mesh: group,
            position: pos,
            label,
            stationType: 'moduler',
            portSlots: [],
            portConfig: station.config?.ports || [],
            bufferSlots: station.config?.bufferSlots || null,
            stationName: station.name || stationId,
        });
    }

    _buildShellGeometry(cells, cellSize, height, refC, refR) {
        const cellSet = new Set(cells.map(([c, r]) => `${c},${r}`));
        const positions = [];
        const normals = [];
        const indices = [];
        const addQuad = (v0, v1, v2, v3, n) => {
            const base = positions.length / 3;
            positions.push(...v0, ...v1, ...v2, ...v3);
            normals.push(...n, ...n, ...n, ...n);
            indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        };
        for (const [c, r] of cells) {
            const x0 = (c - refC) * cellSize;
            const x1 = (c + 1 - refC) * cellSize;
            const z0 = (r - refR) * cellSize;
            const z1 = (r + 1 - refR) * cellSize;
            addQuad([x0, height, z0], [x1, height, z0], [x1, height, z1], [x0, height, z1], [0, 1, 0]);
            addQuad([x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [x0, 0, z0], [0, -1, 0]);
            if (!cellSet.has(`${c - 1},${r}`))
                addQuad([x0, 0, z1], [x0, 0, z0], [x0, height, z0], [x0, height, z1], [-1, 0, 0]);
            if (!cellSet.has(`${c + 1},${r}`))
                addQuad([x1, 0, z0], [x1, 0, z1], [x1, height, z1], [x1, height, z0], [1, 0, 0]);
            if (!cellSet.has(`${c},${r - 1}`))
                addQuad([x0, 0, z0], [x1, 0, z0], [x1, height, z0], [x0, height, z0], [0, 0, -1]);
            if (!cellSet.has(`${c},${r + 1}`))
                addQuad([x1, 0, z1], [x0, 0, z1], [x0, height, z1], [x1, height, z1], [0, 0, 1]);
        }
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geom.setIndex(indices);
        return geom;
    }

    async _createModulerGltfModel(stationId, station, pos, portTargetList) {
        const { model3DGltf, model3DGlb } = station.config;
        const loader = new GLTFLoader();
        let url;

        try {
            if (model3DGltf) {
                const blob = new Blob([JSON.stringify(model3DGltf)], { type: 'model/gltf+json' });
                url = URL.createObjectURL(blob);
            } else {
                const binary = Uint8Array.from(atob(model3DGlb), c => c.charCodeAt(0));
                const blob = new Blob([binary], { type: 'model/gltf-binary' });
                url = URL.createObjectURL(blob);
            }

            const gltf = await new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
            URL.revokeObjectURL(url);
            url = null;

            gltf.scene.position.set(pos.x, 0, pos.z);
            gltf.scene.userData = { stationId, type: 'moduler' };
            this.scene.add(gltf.scene);

            const label = this._createLabel(station.name || stationId, pos.x, 50, pos.z);

            this.stations.set(stationId, {
                mesh: gltf.scene,
                position: pos,
                label,
                stationType: 'moduler',
                portSlots: [],
                portConfig: station.config?.ports || [],
                bufferSlots: station.config?.bufferSlots || null,
                stationName: station.name || stationId,
            });
        } catch (err) {
            if (url) URL.revokeObjectURL(url);
            console.error(`[Visualizer3D] Failed to load glTF model for ${stationId}:`, err);
            // Fallback to default cylinder
            const { mesh, label } = this._createStation(station, pos);
            this.stations.set(stationId, {
                mesh, position: pos, label,
                stationType: 'moduler',
                portSlots: [],
                portConfig: station.config?.ports || [],
                bufferSlots: station.config?.bufferSlots || null,
                stationName: station.name || stationId,
            });
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
            return [];
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

    loadInternalStations(flatScenario) {
        this._lastFlatScenario = flatScenario;
        this._clearInternalObjects();
        this._internalPositions.clear();
        const PX_PER_M = 80;
        const discHeight = 4;

        const topModulers = flatScenario.stations.filter(s => s.type === 'moduler' && !s.id.includes('.'));
        for (const moduler of topModulers) {
            const prefix = moduler.id + '.';
            const internalStations = flatScenario.stations.filter(s => {
                if (!s.id.startsWith(prefix)) return false;
                const relative = s.id.substring(prefix.length);
                return !relative.includes('.');
            });
            if (internalStations.length === 0) continue;

            // Parent moduler's world position (origin cell anchor)
            const parentX = moduler.positionX || 0;
            const parentZ = moduler.positionY || 0;

            // --- Derive model geometry from model3DGrid ---
            // modelCenterX/Z: world-space center of the model's bounding box
            // modelExtentX/Z: usable width/depth (80% of model span) for station placement
            // modelH: model height in world units
            const grid = moduler.config?.model3DGrid;
            let modelCenterX = parentX;
            let modelCenterZ = parentZ;
            let modelExtentX = 90;
            let modelExtentZ = 90;
            let modelH = discHeight;

            if (grid?.cells?.length > 0) {
                const gs = grid.gridSize || 0.5;
                const cellUnit = gs * PX_PER_M;
                const cells = grid.cells;
                const minC = Math.min(...cells.map(([c]) => c));
                const maxC = Math.max(...cells.map(([c]) => c));
                const minR = Math.min(...cells.map(([, r]) => r));
                const maxR = Math.max(...cells.map(([, r]) => r));
                const spanC = maxC - minC + 1;
                const spanR = maxR - minR + 1;
                // refC/refR: origin cell (if set) is placed at world (parentX, parentZ)
                const refC = grid.origin ? grid.origin[0] : (minC + maxC) / 2;
                const refR = grid.origin ? grid.origin[1] : (minR + maxR) / 2;
                // Bounding box center in world space
                modelCenterX = parentX + ((minC + maxC + 1) / 2 - refC) * cellUnit;
                modelCenterZ = parentZ + ((minR + maxR + 1) / 2 - refR) * cellUnit;
                modelExtentX = spanC * cellUnit * 0.8;
                modelExtentZ = spanR * cellUnit * 0.8;
                modelH = (grid.height || 2) * PX_PER_M;
            }

            // --- Map sub-scenario positions to model world space ---
            // Sub-scenario stations have flat-scenario positions = parentX + localX.
            // Recover localX by subtracting parentX.
            const relPositions = internalStations.map(s => ({
                x: (s.positionX || 0) - parentX,
                z: (s.positionY || 0) - parentZ,
            }));
            const minRX = Math.min(...relPositions.map(p => p.x));
            const maxRX = Math.max(...relPositions.map(p => p.x));
            const minRZ = Math.min(...relPositions.map(p => p.z));
            const maxRZ = Math.max(...relPositions.map(p => p.z));
            const centerRX = (minRX + maxRX) / 2;
            const centerRZ = (minRZ + maxRZ) / 2;
            const srcExtentX = maxRX - minRX;
            const srcExtentZ = maxRZ - minRZ;

            // Use independent X/Z scales so stations always fit within the model bounding box.
            // When all stations share the same axis coordinate (extent=0), the scale is irrelevant.
            const scaleX = srcExtentX > 0 ? modelExtentX / srcExtentX : 1;
            const scaleZ = srcExtentZ > 0 ? modelExtentZ / srcExtentZ : scaleX;

            const posY = discHeight / 2;

            const positions = new Map();
            for (let i = 0; i < internalStations.length; i++) {
                const s = internalStations[i];
                const rel = relPositions[i];
                const pos = {
                    x: modelCenterX + (rel.x - centerRX) * scaleX,
                    y: posY,
                    z: modelCenterZ + (rel.z - centerRZ) * scaleZ,
                };
                positions.set(s.id, pos);
                this._internalPositions.set(s.id, pos);
            }

            // --- Render station discs ---
            for (const s of internalStations) {
                const pos = positions.get(s.id);
                const color = STATION_COLORS[s.type] || 0x6c757d;
                const radius = this.internalStationRadius;
                const discGeo = new THREE.CylinderGeometry(radius, radius, discHeight, 24);
                const discMat = new THREE.MeshStandardMaterial({
                    color, transparent: true, opacity: 0.5,
                    emissive: color, emissiveIntensity: 0.3,
                    roughness: 0.4, metalness: 0.1,
                });
                const mesh = new THREE.Mesh(discGeo, discMat);
                const ringGeo = new THREE.RingGeometry(Math.max(0.5, radius - 1.5), radius, 32);
                const ringMat = new THREE.MeshBasicMaterial({
                    color, transparent: true, opacity: 0.6, side: THREE.DoubleSide,
                });
                const ring = new THREE.Mesh(ringGeo, ringMat);
                ring.rotation.x = -Math.PI / 2;
                ring.position.y = discHeight / 2 + 0.1;
                const group = new THREE.Group();
                group.add(mesh);
                group.add(ring);
                group.position.set(pos.x, pos.y, pos.z);
                group.visible = this.showInternal;
                this.scene.add(group);
                this._internalObjects.push(group);

                const shortName = s.name || s.id.substring(prefix.length);
                const labelY = posY + discHeight / 2 + 5;
                const label = this._createLabel(shortName, pos.x, labelY, pos.z);
                label.visible = this.showInternal && this.showInternalNames;
                this.scene.add(label);
                this._internalObjects.push(label);
                this._internalLabels.push(label);
            }

            // --- Render internal connection lines ---
            const internalIds = new Set(internalStations.map(s => s.id));
            const internalConns = flatScenario.connections.filter(c =>
                internalIds.has(c.from) && internalIds.has(c.to)
            );
            for (const conn of internalConns) {
                const fromPos = positions.get(conn.from);
                const toPos = positions.get(conn.to);
                if (!fromPos || !toPos) continue;
                const points = [
                    new THREE.Vector3(fromPos.x, fromPos.y, fromPos.z),
                    new THREE.Vector3(toPos.x, toPos.y, toPos.z),
                ];
                const geom = new THREE.BufferGeometry().setFromPoints(points);
                const mat = new THREE.LineBasicMaterial({ color: 0x5a7aaa, transparent: true, opacity: 0.6 });
                const line = new THREE.Line(geom, mat);
                line.visible = this.showInternal;
                this.scene.add(line);
                this._internalObjects.push(line);
            }
        }
    }

    setShowInternal(show) {
        this.showInternal = show;
        for (const obj of this._internalObjects) {
            if (this._internalLabels.includes(obj)) {
                obj.visible = show && this.showInternalNames;
            } else {
                obj.visible = show;
            }
        }
        this._rerouteConnections();
    }

    _rerouteConnections() {
        for (const conn of this.connections) {
            let fromPos = conn.defaultFrom;
            let toPos = conn.defaultTo;

            if (this.showInternal) {
                const internalFrom = this._internalPositions.get(conn.originalFrom);
                if (internalFrom) fromPos = internalFrom;
                const internalTo = this._internalPositions.get(conn.originalTo);
                if (internalTo) toPos = internalTo;
            }

            conn.from = fromPos;
            conn.to = toPos;
            const positions = conn.line.geometry.attributes.position;
            positions.setXYZ(0, fromPos.x, 1, fromPos.z);
            positions.setXYZ(1, toPos.x, 1, toPos.z);
            positions.needsUpdate = true;
        }
    }

    setShowInternalNames(show) {
        this.showInternalNames = show;
        for (const label of this._internalLabels) {
            label.visible = this.showInternal && show;
        }
    }

    getInternalPosition(stationId) {
        return this._internalPositions.get(stationId) || null;
    }

    setInternalStationRadius(r) {
        this.internalStationRadius = r;
        if (this._lastFlatScenario) {
            this.loadInternalStations(this._lastFlatScenario);
            this._rerouteConnections();
        }
    }

    _clearInternalObjects() {
        for (const obj of this._internalObjects) {
            this.scene.remove(obj);
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
        }
        this._internalObjects = [];
        this._internalLabels = [];
    }

    updateInterlockStates(signalStates) {
        this.interlockIndicators.forEach(indicator => {
            const stationSignals = signalStates.get(indicator.stationId);
            if (!stationSignals) return;

            const value = stationSignals.get(indicator.signalName);
            if (value == null) return;

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
                const internalPos = this._internalPositions.get(workInfo.stationId);
                if (this.showInternal && internalPos) {
                    const y = 30;
                    work.mesh.position.set(internalPos.x, y, internalPos.z);
                    if (work.label) work.label.position.set(internalPos.x, y + 20, internalPos.z);
                } else {
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

                        const offsetInfo = stationWorkIndex.get(workId);
                        if (offsetInfo && offsetInfo.total > 1) {
                            const angle = (offsetInfo.index / offsetInfo.total) * Math.PI * 2;
                            x += Math.cos(angle) * 15;
                            z += Math.sin(angle) * 15;
                        }

                        work.mesh.position.set(x, y, z);
                        if (work.label) work.label.position.set(x, y + 20, z);
                    }
                }
            } else if (workInfo.state === 'moving') {
                const fromInternal = this.showInternal && this._internalPositions.get(workInfo.fromStation);
                const toInternal = this.showInternal && this._internalPositions.get(workInfo.toStation);
                const fromStation = fromInternal ? null : this.stations.get(workInfo.fromStation);
                const toStation = toInternal ? null : this.stations.get(workInfo.toStation);

                let startX, startZ, endX, endZ;
                let hasFrom = false, hasTo = false;

                if (fromInternal) {
                    startX = fromInternal.x; startZ = fromInternal.z; hasFrom = true;
                } else if (fromStation) {
                    startX = fromStation.position.x; startZ = fromStation.position.z; hasFrom = true;
                    if ((fromStation.stationType === 'split' || fromStation.stationType === 'moduler') && workInfo.fromPortIndex >= 0) {
                        const slot = this._findPortSlot(fromStation, workInfo.fromPortIndex, 'exit');
                        if (slot) { startX = slot.position.x; startZ = slot.position.z; }
                    }
                }

                if (toInternal) {
                    endX = toInternal.x; endZ = toInternal.z; hasTo = true;
                } else if (toStation) {
                    endX = toStation.position.x; endZ = toStation.position.z; hasTo = true;
                    if ((toStation.stationType === 'merge' || toStation.stationType === 'moduler') && workInfo.toPortIndex >= 0) {
                        const slot = this._findPortSlot(toStation, workInfo.toPortIndex, 'entry');
                        if (slot) { endX = slot.position.x; endZ = slot.position.z; }
                    }
                }

                if (hasFrom && hasTo) {
                    const duration = Math.max(0.001, workInfo.arriveTime - workInfo.departTime);
                    const elapsed = currentTime - workInfo.departTime;
                    const progress = Math.max(0, Math.min(1, elapsed / duration));
                    const t = this._easeInOutCubic(progress);
                    const x = startX + (endX - startX) * t;
                    const z = startZ + (endZ - startZ) * t;
                    const y = 30 + Math.sin(t * Math.PI) * 20;

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

        if (this.ground) {
            this.scene.remove(this.ground);
            this.ground.geometry.dispose();
            this.ground.material.dispose();
            this.ground = null;
        }
        if (this.gridHelper) {
            this.scene.remove(this.gridHelper);
            this.gridHelper.geometry.dispose();
            if (Array.isArray(this.gridHelper.material)) {
                this.gridHelper.material.forEach(m => m.dispose());
            } else if (this.gridHelper.material) {
                this.gridHelper.material.dispose();
            }
            this.gridHelper = null;
        }
    }
}
