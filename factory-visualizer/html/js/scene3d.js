// 3D Scene manager for factory-visualizer
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const THEMES = {
    dark: {
        background: 0x0f1629,
        fog: [0x0f1629, 500, 2000],
        ground: 0x101828,
        gridCenter: 0x2a4070,
        gridLines: 0x1a2744,
    },
    light: {
        background: 0xf0f4f8,
        fog: [0xf0f4f8, 500, 2000],
        ground: 0xdde3ec,
        gridCenter: 0x9aacbf,
        gridLines: 0xc5d0dc,
    },
};

const STATION_COLORS = {
    source:     0x28a745,
    processing: 0x007bff,
    merge:      0x6f42c1,
    split:      0xfd7e14,
    switch:     0x17a2b8,
    inspection: 0xffc107,
    discharge:  0xdc3545,
    drain:      0x6c757d,
    entry:      0x2e7d32,
    exit:       0xe65100,
};

// Tetris-block geometry constants (shared with sim-visualizer)
const TETRIS_CELL = 14;
const TETRIS_BOX  = 12;
const TETRIS_H    = 18;

const STATION_SHAPES = {
    source:     [[0,0],[1,0],[2,0],[3,0]],
    drain:      [[0,0],[1,0],[0,1],[1,1]],
    processing: [[0,0],[1,0],[2,0],[2,1]],
    merge:      [[0,0],[1,0],[2,0],[1,1]],
    split:      [[1,0],[0,1],[1,1],[2,1]],
    switch:     [[0,1],[1,1],[1,0],[2,0]],
    entry:      [[0,0]],
    exit:       [[0,0]],
    inspection: [[0,0],[1,0],[2,0],[0,1]],
    discharge:  [[0,0],[1,0],[1,1]],
};

export class Scene3D {
    constructor(container) {
        this.container = container;
        this._machines = new Map();         // stationId → { mesh, group, station }
        this._internalStations = new Map(); // stationId → { group, mesh, station }
        this._equipmentGroups = new Map();  // equipName → { group, machines, centroid }
        this._works = new Map();            // workId → { mesh, stationId }
        this._connections = [];
        this._interlockIndicators = new Map();
        this._theme = 'dark';
        this._shellOpacity = 0.6;
        this._internalRadius = 15;
        this._showInternal = true;
        this._showStationNames = true;
        this._showWorks = true;
        this._showInterlocks = false;
        this._onMachineDoubleClick = null;
        this._onMachineClick = null;
        this._onWorkClick = null;
        this._onEquipmentDoubleClick = null;
        this._onEquipmentClick = null;
        this._orthoCamera = null;
        this._useOrtho = false;
        this._placementMode = false;
        this._selectedEquip = null;
        this._placementDragState = null;
        this._onEquipmentMove = null;
        this._dragOccurred = false;
        this._clickTimer = null;
        this._clickTarget = null;
        this._raycaster = new THREE.Raycaster();
        this._mouse = new THREE.Vector2();
        this._glbLoader = new GLTFLoader();

        this._initScene();
        this._animate();
    }

    _initScene() {
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(50, w / (h || 1), 1, 5000);
        this.camera.position.set(0, 600, 1000);
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(w, h);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.container.appendChild(this.renderer.domElement);

        const ambient = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambient);
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(200, 400, 200);
        dirLight.castShadow = true;
        this.scene.add(dirLight);

        this._createGround(2000);
        this._applyThemeColors();

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.minDistance = 50;
        this.controls.maxDistance = 3000;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
        this.controls.mouseButtons = {
            LEFT: THREE.MOUSE.PAN,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.ROTATE,
        };

        this._resizeObs = new ResizeObserver(() => this._onResize());
        this._resizeObs.observe(this.container);

        this.renderer.domElement.addEventListener('click', e => this._handleClick(e));
        this.renderer.domElement.addEventListener('mousedown', e => this._handleMouseDown(e));
        this.renderer.domElement.addEventListener('mousemove', e => this._handleMouseMove(e));
        this.renderer.domElement.addEventListener('mouseup', e => this._handleMouseUpPlacement(e));
        this.renderer.domElement.addEventListener('mouseleave', () => { this._placementDragState = null; this.controls.enabled = true; });
    }

    // ---- Theme ----

    applyTheme(theme) {
        this._theme = this._resolveTheme(theme);
        this._applyThemeColors();
    }

    _resolveTheme(theme) {
        if (theme === 'auto') {
            return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        return theme === 'light' ? 'light' : 'dark';
    }

    _applyThemeColors() {
        const t = THEMES[this._theme] || THEMES.dark;
        this.scene.background = new THREE.Color(t.background);
        if (this.scene.fog) {
            this.scene.fog.color.setHex(t.fog[0]);
            this.scene.fog.near = t.fog[1];
            this.scene.fog.far = t.fog[2];
        } else {
            this.scene.fog = new THREE.Fog(t.fog[0], t.fog[1], t.fog[2]);
        }
        if (this._ground) this._ground.material.color.setHex(t.ground);
        if (this._grid) {
            this.scene.remove(this._grid);
            this._grid.geometry.dispose();
        }
        if (this._groundSize) this._recreateGrid(this._groundSize, t);
    }

    _createGround(size) {
        this._groundSize = size;
        const geo = new THREE.PlaneGeometry(size, size);
        const mat = new THREE.MeshStandardMaterial({
            color: THEMES[this._theme].ground,
            roughness: 0.9, metalness: 0.1, depthWrite: false,
        });
        this._ground = new THREE.Mesh(geo, mat);
        this._ground.rotation.x = -Math.PI / 2;
        this._ground.receiveShadow = true;
        this._ground.renderOrder = -1;
        this.scene.add(this._ground);
        this._recreateGrid(size, THEMES[this._theme]);
    }

    _recreateGrid(size, t) {
        const divisions = Math.max(10, Math.round(size / 50));
        this._grid = new THREE.GridHelper(size, divisions, t.gridCenter, t.gridLines);
        this._grid.position.y = 0.2;
        if (this._ground) {
            this._grid.position.x = this._ground.position.x;
            this._grid.position.z = this._ground.position.z;
        }
        this.scene.add(this._grid);
    }

    // ---- Load factory ----

    loadFactory(stations, connections) {
        this._clearAll();

        const machines = stations.filter(s => s.stationType === 'machine');
        const internals = stations.filter(s => s.stationType !== 'machine');

        // Group machines by equipment name (strip .NNN suffix) and render shells
        const groups = this._groupByEquipment(machines);
        groups.forEach((mList, equipName) => this._addEquipmentGroup(equipName, mList));

        // Internal stations: render at parent machine's global position + local offset
        internals.forEach(s => {
            const parent = machines.find(m => m.stationId === s.parentId) || null;
            this._addInternalStation(s, parent);
        });

        connections.forEach(c => this._addConnectionLine(c, stations));

        const equipPositions = [...this._equipmentGroups.values()].map(eg => ({
            positionX: eg.centroid.x,
            positionY: eg.centroid.z,
        }));
        this._fitCamera(equipPositions.length > 0 ? equipPositions : machines);
        this._updateVisibility();
    }

    _clearAll() {
        this._equipmentGroups.forEach(eg => this.scene.remove(eg.group));
        this._equipmentGroups.clear();
        this._machines.forEach(m => this.scene.remove(m.group));
        this._machines.clear();
        this._internalStations.forEach(s => this.scene.remove(s.group));
        this._internalStations.clear();
        this._works.forEach(w => this.scene.remove(w.mesh));
        this._works.clear();
        this._connections.forEach(l => this.scene.remove(l));
        this._connections = [];
        this._interlockIndicators.forEach(g => this.scene.remove(g));
        this._interlockIndicators.clear();
    }

    // ---- Equipment grouping ----

    _getEquipmentName(stationId) {
        // Match trailing 3-digit suffix with optional dot/underscore/hyphen separator
        // Handles: "hoge.001" → "hoge", "fuga001" → "fuga", "conv_002" → "conv"
        const m = stationId.match(/^(.+?)[._-]?(\d{3})$/);
        return m ? m[1] : stationId;
    }

    _groupByEquipment(machines) {
        const groups = new Map();
        machines.forEach(m => {
            const name = this._getEquipmentName(m.stationId);
            if (!groups.has(name)) groups.set(name, []);
            groups.get(name).push(m);
        });
        return groups;
    }

    _addEquipmentGroup(equipName, machines) {
        // Bounding box of all machines (using their global positionX/Y)
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        machines.forEach(m => {
            const px = m.positionX || 0;
            const pz = m.positionY || 0;
            minX = Math.min(minX, px); maxX = Math.max(maxX, px);
            minZ = Math.min(minZ, pz); maxZ = Math.max(maxZ, pz);
        });

        const PAD = 60;
        const cx = (minX + maxX) / 2;
        const cz = (minZ + maxZ) / 2;
        const W = Math.max(maxX - minX + PAD * 2, 140);
        const D = Math.max(maxZ - minZ + PAD * 2, 140);
        const H = 110;

        const shellGroup = new THREE.Group();
        shellGroup.userData.equipmentName = equipName;
        shellGroup.userData.isEquipment = true;

        // Semi-transparent shell (also serves as invisible drag hitbox in placement mode)
        const shellGeo = new THREE.BoxGeometry(W, H, D);
        const shellMat = new THREE.MeshStandardMaterial({
            color: 0x4a9eff,
            transparent: true,
            opacity: 0.12,
            roughness: 0.5,
            metalness: 0.1,
            side: THREE.DoubleSide,
        });
        const shellMesh = new THREE.Mesh(shellGeo, shellMat);
        shellMesh.position.set(cx, H / 2, cz);
        shellMesh.userData.equipmentName = equipName;
        shellGroup.add(shellMesh);

        // Shell wireframe edges
        const edgeGeo = new THREE.EdgesGeometry(shellGeo);
        const edgeMat = new THREE.LineBasicMaterial({ color: 0x6ab4ff, transparent: true, opacity: 0.45 });
        const edgeMesh = new THREE.LineSegments(edgeGeo, edgeMat);
        edgeMesh.position.copy(shellMesh.position);
        shellGroup.add(edgeMesh);

        // Equipment name label above shell
        const label = this._createLabel(equipName, cx, H + 18, cz);
        shellGroup.add(label);

        // 1設備 = 1モデル: .000 ステーションが設備レベルのモデルを保持する設計
        // .000 がなければ後方互換でモデルを持つ最初のマシンを使用
        const masterMachine = machines.find(m => {
            const match = m.stationId.match(/^(.+?)[._-]?(\d{3})$/);
            return match && match[2] === '000';
        });
        const modelMachine = masterMachine || machines.find(m =>
            m.config?.model3DGlb?.data ||
            (Array.isArray(m.config?.model3DGrid?.cells) && m.config.model3DGrid.cells.length > 0)
        );
        const hasCustomModel = !!(modelMachine?.config?.model3DGlb?.data ||
            (Array.isArray(modelMachine?.config?.model3DGrid?.cells) && modelMachine.config.model3DGrid.cells.length > 0));

        if (hasCustomModel) {
            // shellMesh は opacity=0 にして不可視化するが visible=true のまま保持
            // → 配置モードのレイキャスト（ドラッグ）対象として機能させるため
            shellMesh.material.opacity = 0;
            shellMesh.material.depthWrite = false;
            edgeMesh.visible = false;

            // モデルをセントロイド位置に配置（設備グループの一部として移動に追従）
            const modelGroup = new THREE.Group();
            modelGroup.position.set(cx, 0, cz);
            shellGroup.add(modelGroup);

            const cfg = modelMachine.config || {};
            if (cfg.model3DGlb?.data) {
                this._loadGlbForMachine(cfg.model3DGlb.data, modelGroup);
            } else if (cfg.model3DGrid) {
                const voxelMesh = this._buildVoxelMesh(cfg.model3DGrid, 1.0);
                modelGroup.add(voxelMesh);
            }
        }

        this.scene.add(shellGroup);
        this._equipmentGroups.set(equipName, {
            group: shellGroup,
            shellMesh,
            hasCustomModel,
            machines,
            centroid: { x: cx, z: cz },
        });

        // 個別マシンを登録（設備にモデルがある場合はビジュアルメッシュを非表示）
        machines.forEach(m => this._addMachine(m, hasCustomModel));
    }

    _addMachine(station, groupHasCustomModel = false) {
        const cfg = station.config || {};
        const px = station.positionX || 0;
        const py = station.positionZ || 0;
        const pz = station.positionY || 0;

        const group = new THREE.Group();
        group.userData.stationId = station.stationId;
        group.userData.isMachine = true;

        let mesh;
        if (groupHasCustomModel) {
            // 設備レベルでモデルを表示済み。個別マシンは空グループ（クリック/ワーク用に登録だけ）
            mesh = new THREE.Group();
        } else if (cfg.model3DGlb?.data) {
            mesh = new THREE.Group(); // placeholder; filled asynchronously
            this._loadGlbForMachine(cfg.model3DGlb.data, mesh);
        } else if (cfg.model3DGrid) {
            mesh = this._buildVoxelMesh(cfg.model3DGrid, this._shellOpacity);
        } else {
            mesh = this._buildCylinderMesh(60, 80, this._shellOpacity);
        }
        mesh.userData.stationId = station.stationId;
        group.add(mesh);

        if (this._showStationNames) {
            const label = this._createLabel(station.name || station.stationId, 0, 50, 0);
            group.add(label);
            group.userData.labelMesh = label;
        }

        group.position.set(px, py, pz);
        this.scene.add(group);
        this._machines.set(station.stationId, { group, mesh, station });
    }

    _buildVoxelMesh(grid3d, opacity) {
        const METER_SCALE = 10;
        const gridSizeRaw = grid3d.gridSize || 0.5;
        // gridSize < 5 → meters format; >= 5 → legacy Three.js units
        const isMeters = gridSizeRaw < 5;
        const gridSize = isMeters ? gridSizeRaw * METER_SCALE : gridSizeRaw;
        const cellHeightRaw = grid3d.height || (isMeters ? 1.5 : gridSizeRaw * 2);
        const cellHeight = isMeters ? cellHeightRaw * METER_SCALE : cellHeightRaw;
        const cells = grid3d.cells || [];

        if (cells.length === 0) return this._buildCylinderMesh(60, 80, opacity);

        // Origin-based centering: origin cell maps to x=0, z=0
        const origin = grid3d.origin;
        const allC = cells.map(([c]) => c);
        const allR = cells.map(([, r]) => r);
        const refC = origin ? origin[0] : (Math.min(...allC) + Math.max(...allC)) / 2;
        const refR = origin ? origin[1] : (Math.min(...allR) + Math.max(...allR)) / 2;

        const group = new THREE.Group();
        const geo = new THREE.BoxGeometry(gridSize * 0.95, cellHeight, gridSize * 0.95);
        const mat = new THREE.MeshStandardMaterial({
            color: 0x4a9eff, transparent: true, opacity, roughness: 0.4, metalness: 0.3,
        });

        cells.forEach(([cx, cz]) => {
            const cube = new THREE.Mesh(geo, mat.clone());
            cube.position.set((cx - refC) * gridSize, cellHeight / 2, (cz - refR) * gridSize);
            group.add(cube);
        });

        geo.dispose();
        return group;
    }

    _loadGlbForMachine(base64data, targetGroup) {
        const binary = atob(base64data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'model/gltf-binary' });
        const url = URL.createObjectURL(blob);
        this._glbLoader.load(url, gltf => {
            URL.revokeObjectURL(url);
            const model = gltf.scene;
            const box = new THREE.Box3().setFromObject(model);
            const size = new THREE.Vector3();
            box.getSize(size);
            const maxDim = Math.max(size.x, size.y, size.z);
            if (maxDim > 0) model.scale.setScalar(100 / maxDim);
            box.setFromObject(model);
            model.position.y = -box.min.y;
            targetGroup.add(model);
        }, undefined, err => {
            URL.revokeObjectURL(url);
            console.error('GLB load error (machine):', err);
        });
    }

    _buildCylinderMesh(radius, height, opacity) {
        // Tetris-style box replaces the old cylinder fallback
        const W = radius * 1.4;
        const group = new THREE.Group();

        const geo = new THREE.BoxGeometry(W, height, W);
        const mat = new THREE.MeshStandardMaterial({
            color: 0x4a9eff,
            transparent: true,
            opacity,
            roughness: 0.35,
            metalness: 0.3,
            emissive: 0x4a9eff,
            emissiveIntensity: 0.35,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = height / 2;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);

        const edgeGeo = new THREE.EdgesGeometry(geo, 30);
        const edgeMat = new THREE.LineBasicMaterial({ color: 0xaaddff, transparent: true, opacity: 1.0 });
        const edges = new THREE.LineSegments(edgeGeo, edgeMat);
        edges.position.y = height / 2;
        group.add(edges);

        return group;
    }

    _addInternalStation(station, parentMachine) {
        const parentX = parentMachine ? (parentMachine.positionX || 0) : 0;
        const parentZ = parentMachine ? (parentMachine.positionY || 0) : 0;
        const px = (station.positionX || 0) + parentX;
        const pz = (station.positionY || 0) + parentZ;

        const stationType = station.stationType || 'processing';
        const cells = STATION_SHAPES[stationType] || [[0, 0]];
        const color = STATION_COLORS[stationType] || 0x666666;

        const minC = Math.min(...cells.map(([c]) => c));
        const maxC = Math.max(...cells.map(([c]) => c));
        const minR = Math.min(...cells.map(([, r]) => r));
        const maxR = Math.max(...cells.map(([, r]) => r));
        const cx = (minC + maxC) / 2;
        const cz = (minR + maxR) / 2;
        const edgeColor = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.55).getHex();

        const group = new THREE.Group();
        group.userData.stationId = station.stationId;
        group.userData.isInternal = true;

        for (const [c, r] of cells) {
            const ox = (c - cx) * TETRIS_CELL;
            const oz = (r - cz) * TETRIS_CELL;

            const geo = new THREE.BoxGeometry(TETRIS_BOX, TETRIS_H, TETRIS_BOX);
            const mat = new THREE.MeshStandardMaterial({
                color,
                emissive: color,
                emissiveIntensity: 0.4,
                roughness: 0.3,
                metalness: 0.35,
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(ox, TETRIS_H / 2, oz);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.userData.stationId = station.stationId;
            group.add(mesh);

            const edgeGeo = new THREE.EdgesGeometry(geo, 30);
            const edgeMat = new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.9 });
            const edgeMesh = new THREE.LineSegments(edgeGeo, edgeMat);
            edgeMesh.position.copy(mesh.position);
            group.add(edgeMesh);
        }

        if (this._showStationNames) {
            const label = this._createLabel(station.name || station.stationId, 0, TETRIS_H + 8, 0);
            group.add(label);
        }

        group.position.set(px, 0, pz);
        group.visible = this._showInternal;
        this.scene.add(group);
        // store with effective global position so setWorkPosition uses correct coords
        const effectiveStation = { ...station, positionX: px, positionY: pz };
        this._internalStations.set(station.stationId, { group, mesh: group, station: effectiveStation });
    }

    _addConnectionLine(conn, stations) {
        const fromSt = stations.find(s => s.stationId === conn.fromStation);
        const toSt = stations.find(s => s.stationId === conn.toStation);
        if (!fromSt || !toSt) return;

        const from = new THREE.Vector3(
            fromSt.positionX || 0, (fromSt.positionZ || 0) + 5, fromSt.positionY || 0
        );
        const to = new THREE.Vector3(
            toSt.positionX || 0, (toSt.positionZ || 0) + 5, toSt.positionY || 0
        );

        const points = [from, to];
        const geo = new THREE.BufferGeometry().setFromPoints(points);
        const mat = new THREE.LineBasicMaterial({ color: 0x2a4070, transparent: true, opacity: 0.6 });
        const line = new THREE.Line(geo, mat);
        this.scene.add(line);
        this._connections.push(line);
    }

    _createLabel(text, x, y, z) {
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 48;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0)';
        ctx.fillRect(0, 0, 256, 48);
        ctx.font = 'bold 20px sans-serif';
        ctx.fillStyle = '#e8edf5';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text.length > 20 ? text.substring(0, 18) + '…' : text, 128, 24);

        const tex = new THREE.CanvasTexture(canvas);
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(80, 15, 1);
        sprite.position.set(x, y, z);
        return sprite;
    }

    _fitCamera(machines) {
        if (machines.length === 0) return;

        let minX = Infinity, maxX = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        machines.forEach(s => {
            const px = s.positionX || 0;
            const pz = s.positionY || 0;
            minX = Math.min(minX, px); maxX = Math.max(maxX, px);
            minZ = Math.min(minZ, pz); maxZ = Math.max(maxZ, pz);
        });

        const cx = (minX + maxX) / 2;
        const cz = (minZ + maxZ) / 2;
        const rangeX = maxX - minX;
        const rangeZ = maxZ - minZ;
        const range = Math.max(rangeX, rangeZ, 200);
        const size = range + 400;

        this._groundSize = size;
        this._ground.scale.set(size / 2000, 1, size / 2000);
        this._ground.position.set(cx, 0, cz);

        if (this._grid) { this.scene.remove(this._grid); this._grid.geometry.dispose(); }
        this._recreateGrid(size, THEMES[this._theme]);
        this._grid.position.set(cx, 0.2, cz);

        this.scene.fog.near = size * 0.3;
        this.scene.fog.far = size * 1.5;

        const dist = range * 1.5 + 300;
        this.camera.position.set(cx, dist * 0.7, cz + dist);
        this.camera.far = size * 3;
        this.camera.updateProjectionMatrix();
        this.camera.lookAt(cx, 0, cz);
        this.controls.target.set(cx, 0, cz);
        this.controls.maxDistance = size * 1.5;
        this.controls.update();
    }

    fitView() {
        const box = new THREE.Box3();
        let hasObjects = false;
        this._equipmentGroups.forEach(({ group }) => {
            const b = new THREE.Box3().setFromObject(group);
            if (!b.isEmpty()) { box.union(b); hasObjects = true; }
        });

        if (!hasObjects) {
            const machines = [];
            this._machines.forEach((m) => machines.push(m.station));
            this._fitCamera(machines);
            return;
        }

        const center = new THREE.Vector3();
        const size = new THREE.Vector3();
        box.getCenter(center);
        box.getSize(size);

        const cx = center.x;
        const cz = center.z;
        const range = Math.max(size.x, size.z, 200);
        const groundSize = range + 400;

        this._groundSize = groundSize;
        this._ground.scale.set(groundSize / 2000, 1, groundSize / 2000);
        this._ground.position.set(cx, 0, cz);

        if (this._grid) { this.scene.remove(this._grid); this._grid.geometry.dispose(); }
        this._recreateGrid(groundSize, THEMES[this._theme]);
        this._grid.position.set(cx, 0.2, cz);

        this.scene.fog.near = groundSize * 0.3;
        this.scene.fog.far = groundSize * 1.5;

        const dist = range * 1.5 + 300;
        this.camera.position.set(cx, dist * 0.7, cz + dist);
        this.camera.far = groundSize * 3;
        this.camera.updateProjectionMatrix();
        this.camera.lookAt(cx, 0, cz);
        this.controls.target.set(cx, 0, cz);
        this.controls.maxDistance = groundSize * 1.5;
        this.controls.update();
    }

    // ---- Placement mode (equipment drag) ----

    setPlacementMode(enabled) {
        this._placementMode = enabled;
        if (!enabled) {
            this._placementDragState = null;
            if (this._selectedEquip) {
                this._unhighlightEquip(this._selectedEquip);
                this._selectedEquip = null;
            }
            this.controls.enabled = true;
        }
        this.renderer.domElement.style.cursor = enabled ? 'grab' : '';
    }

    setOnEquipmentMove(cb) { this._onEquipmentMove = cb; }

    _handleMouseDown(e) {
        if (!this._placementMode || e.button !== 0) return;

        const rect = this.renderer.domElement.getBoundingClientRect();
        this._mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this._mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        const activeCam = this._useOrtho ? this._orthoCamera : this.camera;
        this._raycaster.setFromCamera(this._mouse, activeCam);

        const shellMeshes = [];
        this._equipmentGroups.forEach(eg => { if (eg.shellMesh) shellMeshes.push(eg.shellMesh); });
        const hits = this._raycaster.intersectObjects(shellMeshes, false);
        if (hits.length === 0) return;

        const equipName = hits[0].object.userData.equipmentName;
        if (!equipName) return;

        if (this._selectedEquip && this._selectedEquip !== equipName) this._unhighlightEquip(this._selectedEquip);
        this._selectedEquip = equipName;
        this._highlightEquip(equipName);

        const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const floorPoint = new THREE.Vector3();
        this._raycaster.ray.intersectPlane(floorPlane, floorPoint);

        this._placementDragState = { equipName, lastFloorX: floorPoint.x, lastFloorZ: floorPoint.z };
        this._dragOccurred = false;
        this.controls.enabled = false;
        e.stopPropagation();
    }

    _handleMouseMove(e) {
        if (!this._placementMode || !this._placementDragState) return;

        const rect = this.renderer.domElement.getBoundingClientRect();
        this._mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this._mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        const activeCam = this._useOrtho ? this._orthoCamera : this.camera;
        this._raycaster.setFromCamera(this._mouse, activeCam);

        const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const floorPoint = new THREE.Vector3();
        if (!this._raycaster.ray.intersectPlane(floorPlane, floorPoint)) return;

        const dx = floorPoint.x - this._placementDragState.lastFloorX;
        const dz = floorPoint.z - this._placementDragState.lastFloorZ;
        if (Math.abs(dx) > 0.5 || Math.abs(dz) > 0.5) {
            this._placementDragState.lastFloorX = floorPoint.x;
            this._placementDragState.lastFloorZ = floorPoint.z;
            this._moveEquipDelta(this._placementDragState.equipName, dx, dz);
            this._dragOccurred = true;
        }
    }

    _handleMouseUpPlacement(e) {
        if (!this._placementMode || !this._placementDragState) return;
        const equipName = this._placementDragState.equipName;
        this._placementDragState = null;
        this.controls.enabled = true;
        this.renderer.domElement.style.cursor = 'grab';

        if (!this._dragOccurred) return;
        const eg = this._equipmentGroups.get(equipName);
        if (eg && this._onEquipmentMove) {
            this._onEquipmentMove(equipName, {
                centroid: { x: eg.centroid.x, z: eg.centroid.z },
                machines: eg.machines.map(m => ({
                    stationId: m.stationId,
                    positionX: m.positionX || 0,
                    positionY: m.positionY || 0,
                })),
            });
        }
    }

    _moveEquipDelta(equipName, dx, dz) {
        const eg = this._equipmentGroups.get(equipName);
        if (!eg) return;

        eg.group.position.x += dx;
        eg.group.position.z += dz;

        eg.machines.forEach(m => {
            m.positionX = (m.positionX || 0) + dx;
            m.positionY = (m.positionY || 0) + dz;
            const entry = this._machines.get(m.stationId);
            if (entry) {
                entry.group.position.x += dx;
                entry.group.position.z += dz;
                entry.station.positionX = m.positionX;
                entry.station.positionY = m.positionY;
            }
            this._internalStations.forEach(stEntry => {
                if (stEntry.station.parentId === m.stationId) {
                    stEntry.group.position.x += dx;
                    stEntry.group.position.z += dz;
                    stEntry.station.positionX = (stEntry.station.positionX || 0) + dx;
                    stEntry.station.positionY = (stEntry.station.positionY || 0) + dz;
                }
            });
        });

        eg.centroid.x += dx;
        eg.centroid.z += dz;
    }

    _highlightEquip(equipName) {
        const eg = this._equipmentGroups.get(equipName);
        if (!eg || !eg.shellMesh) return;
        eg.shellMesh.material.color.setHex(0xffaa00);
        eg.shellMesh.material.opacity = 0.35;
    }

    _unhighlightEquip(equipName) {
        const eg = this._equipmentGroups.get(equipName);
        if (!eg || !eg.shellMesh) return;
        eg.shellMesh.material.color.setHex(0x4a9eff);
        eg.shellMesh.material.opacity = eg.hasCustomModel ? 0 : 0.12;
    }

    setTopView() {
        const target = this.controls.target.clone();
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        const aspect = w / (h || 1);
        const dist = this.camera.position.distanceTo(target);
        const halfH = dist * 0.5;

        this._orthoCamera = new THREE.OrthographicCamera(
            -halfH * aspect, halfH * aspect, halfH, -halfH, 1, 5000
        );
        this._orthoCamera.position.set(target.x, dist, target.z);
        this._orthoCamera.lookAt(target);
        this._orthoCamera.updateProjectionMatrix();

        this._useOrtho = true;
        this.controls.object = this._orthoCamera;
        this.controls.enableRotate = false;
        this.controls.target.copy(target);
        this.controls.update();
    }

    setPerspView() {
        this._useOrtho = false;
        this._orthoCamera = null;
        this.controls.object = this.camera;
        this.controls.enableRotate = true;
        this.controls.update();
    }

    // ---- Works ----

    _workColor(workId, workType) {
        const PRESET = {
            'frame':         0xdd8833,
            'engine':        0x2288ee,
            'assembled-car': 0xeebb00,
            'raw-part':      0x11ccaa,
            'typeA':         0xff3355,
            'typeB':         0x3355ff,
            'typeC':         0xcc33ff,
        };
        if (workType && PRESET[workType]) return PRESET[workType];
        const key = workType || workId || 'default';
        let h = 0;
        for (let i = 0; i < key.length; i++) h = (h * 127 + key.charCodeAt(i)) >>> 0;
        return new THREE.Color().setHSL((h % 360) / 360, 0.75, 0.62).getHex();
    }

    setWorkPosition(workId, stationId, workType) {
        if (!this._showWorks) return;
        const stEntry = this._machines.get(stationId) || this._internalStations.get(stationId);
        if (!stEntry) return;

        const px = stEntry.station.positionX || 0;
        const py = (stEntry.station.positionZ || 0) + TETRIS_H + 20;
        const pz = stEntry.station.positionY || 0;

        let entry = this._works.get(workId);
        if (!entry) {
            const WBOX = 11;
            const color = this._workColor(workId, workType);
            const geo = new THREE.BoxGeometry(WBOX, WBOX, WBOX);
            const mat = new THREE.MeshStandardMaterial({
                color,
                emissive: color,
                emissiveIntensity: 0.5,
                roughness: 0.2,
                metalness: 0.6,
            });
            const fillMesh = new THREE.Mesh(geo, mat);

            const edgeGeo = new THREE.EdgesGeometry(geo);
            const edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
            const edgeMesh = new THREE.LineSegments(edgeGeo, edgeMat);

            const group = new THREE.Group();
            group.add(fillMesh);
            group.add(edgeMesh);
            group.userData.workId = workId;
            this.scene.add(group);

            entry = { mesh: group, stationId };
            this._works.set(workId, entry);
        }
        entry.mesh.position.set(px, py, pz);
        entry.stationId = stationId;
    }

    removeWork(workId) {
        const entry = this._works.get(workId);
        if (entry) {
            this.scene.remove(entry.mesh);
            entry.mesh.traverse(obj => {
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) obj.material.dispose();
            });
            this._works.delete(workId);
        }
    }

    clearWorks() {
        this._works.forEach((entry) => {
            this.scene.remove(entry.mesh);
            entry.mesh.traverse(obj => {
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) obj.material.dispose();
            });
        });
        this._works.clear();
    }

    // ---- Interlock indicators ----

    setInterlockSignal(machineId, signalName, value) {
        if (!this._showInterlocks) return;
        const key = `${machineId}:${signalName}`;
        const m = this._machines.get(machineId) || this._internalStations.get(machineId);
        if (!m) return;

        let indicator = this._interlockIndicators.get(key);
        if (!indicator) {
            const geo = new THREE.SphereGeometry(8, 8, 8);
            const mat = new THREE.MeshBasicMaterial({ color: value ? 0x4caf50 : 0xf44336 });
            indicator = new THREE.Mesh(geo, mat);
            const px = m.station.positionX || 0;
            const pz = m.station.positionY || 0;
            const offset = signalName === 'inputReady' ? -20 : 20;
            indicator.position.set(px + offset, 90, pz);
            this.scene.add(indicator);
            this._interlockIndicators.set(key, indicator);
        } else {
            indicator.material.color.setHex(value ? 0x4caf50 : 0xf44336);
        }
    }

    // ---- Display toggles ----

    setShellOpacity(v) {
        this._shellOpacity = v;
        this._equipmentGroups.forEach(({ shellMesh, hasCustomModel }) => {
            if (!shellMesh || hasCustomModel) return;
            shellMesh.material.opacity = v;
            shellMesh.material.transparent = v < 1;
        });
    }

    setShowInternal(v) {
        this._showInternal = v;
        this._internalStations.forEach(({ group }) => { group.visible = v; });
    }

    setInternalRadius(r) {
        // Internal stations now use fixed Tetris blocks; radius slider is a no-op
        this._internalRadius = r;
    }

    setShowWorks(v) {
        this._showWorks = v;
        this._works.forEach(({ mesh }) => { mesh.visible = v; });
    }

    setShowStationNames(v) {
        this._showStationNames = v;
        const toggle = (map) => {
            map.forEach(({ group }) => {
                group.children.forEach(child => {
                    if (child instanceof THREE.Sprite) child.visible = v;
                });
            });
        };
        toggle(this._machines);
        toggle(this._internalStations);
    }

    setShowInterlocks(v) {
        this._showInterlocks = v;
        this._interlockIndicators.forEach(m => { m.visible = v; });
    }

    _updateVisibility() {
        this.setShowInternal(this._showInternal);
        this.setShowWorks(this._showWorks);
        this.setShowStationNames(this._showStationNames);
        this.setShowInterlocks(this._showInterlocks);
    }

    // ---- Click handlers ----

    setOnMachineClick(cb) { this._onMachineClick = cb; }
    setOnMachineDoubleClick(cb) { this._onMachineDoubleClick = cb; }
    setOnWorkClick(cb) { this._onWorkClick = cb; }
    setOnEquipmentClick(cb) { this._onEquipmentClick = cb; }
    setOnEquipmentDoubleClick(cb) { this._onEquipmentDoubleClick = cb; }

    _handleClick(event) {
        if (this._dragOccurred) { this._dragOccurred = false; return; }
        const rect = this.renderer.domElement.getBoundingClientRect();
        this._mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this._mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        const activeCam = this._useOrtho ? this._orthoCamera : this.camera;
        this._raycaster.setFromCamera(this._mouse, activeCam);

        const allMeshes = [];
        this._machines.forEach(({ group }) => {
            group.traverse(obj => { if (obj.isMesh || obj.isSprite) allMeshes.push(obj); });
        });
        this._equipmentGroups.forEach(({ group }) => {
            group.traverse(obj => { if (obj.isMesh || obj.isSprite) allMeshes.push(obj); });
        });

        const hits = this._raycaster.intersectObjects(allMeshes, false);
        if (hits.length > 0) {
            let obj = hits[0].object;

            // Prefer stationId (machine mesh) over equipmentName (shell)
            let stObj = obj;
            while (stObj && !stObj.userData.stationId) stObj = stObj.parent;
            const sid = stObj && stObj.userData.stationId;

            if (sid && this._machines.has(sid)) {
                if (this._onMachineDoubleClick) {
                    if (this._clickTimer && this._clickTarget === sid) {
                        clearTimeout(this._clickTimer);
                        this._clickTimer = null;
                        this._onMachineDoubleClick(sid);
                        return;
                    }
                    this._clickTarget = sid;
                    this._clickTimer = setTimeout(() => {
                        this._clickTimer = null;
                        if (this._onMachineClick) this._onMachineClick(sid);
                    }, 250);
                    return;
                }
                if (this._onMachineClick) this._onMachineClick(sid);
                return;
            }

            // Equipment shell click
            let eqObj = obj;
            while (eqObj && !eqObj.userData.equipmentName) eqObj = eqObj.parent;
            const equipName = eqObj && eqObj.userData.equipmentName;

            if (equipName && (this._onEquipmentDoubleClick || this._onEquipmentClick)) {
                if (this._clickTimer && this._clickTarget === equipName) {
                    clearTimeout(this._clickTimer);
                    this._clickTimer = null;
                    if (this._onEquipmentDoubleClick) this._onEquipmentDoubleClick(equipName);
                    return;
                }
                this._clickTarget = equipName;
                this._clickTimer = setTimeout(() => {
                    this._clickTimer = null;
                    if (this._onEquipmentClick) this._onEquipmentClick(equipName);
                }, 250);
                return;
            }
        }

        // Check works
        const workMeshes = [];
        this._works.forEach(({ mesh }) => workMeshes.push(mesh));
        const workHits = this._raycaster.intersectObjects(workMeshes, false);
        if (workHits.length > 0) {
            const workId = workHits[0].object.userData.workId;
            if (workId && this._onWorkClick) this._onWorkClick(workId);
        }
    }

    // ---- Render loop ----

    _animate() {
        this._raf = requestAnimationFrame(() => this._animate());
        this.controls && this.controls.update();

        const t = Date.now() * 0.001;
        this._works.forEach(({ mesh }) => {
            mesh.rotation.x = t * 0.5;
            mesh.rotation.y = t * 0.8;
        });

        const cam = this._useOrtho ? this._orthoCamera : this.camera;
        this.renderer && this.renderer.render(this.scene, cam);
    }

    _onResize() {
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        if (!w || !h) return;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        if (this._orthoCamera) {
            const aspect = w / h;
            const halfH = this._orthoCamera.top;
            this._orthoCamera.left = -halfH * aspect;
            this._orthoCamera.right = halfH * aspect;
            this._orthoCamera.updateProjectionMatrix();
        }
        this.renderer.setSize(w, h);
    }

    attachTo(newContainer) {
        if (this.container === newContainer) return;
        const canvas = this.renderer.domElement;
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        newContainer.appendChild(canvas);
        this.container = newContainer;
        this._resizeObs.disconnect();
        this._resizeObs.observe(newContainer);
        this._onResize();
    }

    dispose() {
        if (this._raf) cancelAnimationFrame(this._raf);
        this._resizeObs && this._resizeObs.disconnect();
        this.renderer && this.renderer.dispose();
    }
}
