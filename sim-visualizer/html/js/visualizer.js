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

        this.stations = new Map(); // Map<stationId, {mesh, position}>
        this.works = new Map(); // Map<workId, {mesh, fromStation, toStation, progress}>
        this.connections = [];

        this._initScene();
        this._animate();
    }

    _initScene() {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;

        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0a0a);
        this.scene.fog = new THREE.Fog(0x0a0a0a, 500, 2000);

        // Camera
        this.camera = new THREE.PerspectiveCamera(50, width / height, 1, 5000);
        this.camera.position.set(0, 600, 1000);
        this.camera.lookAt(0, 0, 0);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.container.appendChild(this.renderer.domElement);

        // Lights
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

        // Ground
        const groundGeometry = new THREE.PlaneGeometry(2000, 2000);
        const groundMaterial = new THREE.MeshStandardMaterial({
            color: 0x1a1a2e,
            roughness: 0.8,
            metalness: 0.2
        });
        const ground = new THREE.Mesh(groundGeometry, groundMaterial);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        this.scene.add(ground);

        // Grid
        const gridHelper = new THREE.GridHelper(2000, 40, 0x2a3f5f, 0x1a2332);
        gridHelper.position.y = 0.1;
        this.scene.add(gridHelper);

        // Controls
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.minDistance = 200;
        this.controls.maxDistance = 2000;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.1;

        // Handle resize
        window.addEventListener('resize', () => this._onResize());
    }

    _onResize() {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    _animate() {
        requestAnimationFrame(() => this._animate());
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    loadScenario(scenario) {
        console.log('[Visualizer3D] Loading scenario:', scenario.name);

        // Calculate station layout
        const positions = this._calculateLayout(scenario.stations, scenario.connections);

        // Create stations
        scenario.stations.forEach(station => {
            const pos = positions.get(station.id);
            if (!pos) return;

            const stationMesh = this._createStation(station, pos);
            this.stations.set(station.id, { mesh: stationMesh, position: pos });
        });

        // Create connections
        scenario.connections.forEach(conn => {
            const from = this.stations.get(conn.from);
            const to = this.stations.get(conn.to);
            if (!from || !to) return;

            const line = this._createConnection(from.position, to.position, conn.condition);
            this.connections.push(line);
        });

        console.log(`[Visualizer3D] Created ${this.stations.size} stations and ${this.connections.length} connections`);
    }

    _calculateLayout(stations, connections) {
        const positions = new Map();

        // Simple force-directed layout
        stations.forEach(station => {
            positions.set(station.id, {
                x: (Math.random() - 0.5) * 600,
                y: 0,
                z: (Math.random() - 0.5) * 600
            });
        });

        // Run layout algorithm
        for (let iter = 0; iter < 150; iter++) {
            const forces = new Map();
            stations.forEach(s => forces.set(s.id, { x: 0, y: 0, z: 0 }));

            // Repulsion between all stations
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

            // Attraction for connected stations
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

            // Apply forces
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

        // Create station mesh (box with wireframe + transparent cube)
        const geometry = new THREE.BoxGeometry(50, 50, 50);

        // Transparent filled cube
        const fillMaterial = new THREE.MeshStandardMaterial({
            color: color,
            transparent: true,
            opacity: 0.3,
            emissive: color,
            emissiveIntensity: 0.2
        });
        const fillMesh = new THREE.Mesh(geometry, fillMaterial);

        // Wireframe
        const wireframeGeometry = new THREE.EdgesGeometry(geometry);
        const wireframeMaterial = new THREE.LineBasicMaterial({
            color: color,
            linewidth: 2
        });
        const wireframeMesh = new THREE.LineSegments(wireframeGeometry, wireframeMaterial);

        // Group both together
        const group = new THREE.Group();
        group.add(fillMesh);
        group.add(wireframeMesh);
        group.position.set(position.x, 25, position.z);
        group.userData = { stationId: station.id, type: station.type };

        this.scene.add(group);

        // Add label
        this._createLabel(station.id, position.x, 65, position.z);

        return group;
    }

    _createLabel(text, x, y, z) {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 512;
        canvas.height = 128;

        // Background with 50% transparency
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

        this.scene.add(sprite);
    }

    _createConnection(from, to, condition) {
        let color = 0x3a4f6f;
        if (condition === 'quality_ok') color = 0x28a745;
        else if (condition === 'quality_ng') color = 0xdc3545;

        const points = [
            new THREE.Vector3(from.x, 1, from.z),
            new THREE.Vector3(to.x, 1, to.z)
        ];

        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({
            color: color,
            opacity: 0.5,
            transparent: true,
            linewidth: 2
        });

        const line = new THREE.Line(geometry, material);
        this.scene.add(line);
        return line;
    }

    updateWorks(activeWorks) {
        // Remove works that no longer exist
        const toRemove = [];
        this.works.forEach((work, workId) => {
            if (!activeWorks.has(workId)) {
                this.scene.remove(work.mesh);
                toRemove.push(workId);
            }
        });
        toRemove.forEach(id => this.works.delete(id));

        // Add or update works
        activeWorks.forEach((stationId, workId) => {
            const station = this.stations.get(stationId);
            if (!station) return;

            if (!this.works.has(workId)) {
                // Create new work (sphere with wireframe, opaque)
                const geometry = new THREE.SphereGeometry(12, 32, 32);

                // Opaque filled sphere
                const fillMaterial = new THREE.MeshStandardMaterial({
                    color: 0xff4444,
                    transparent: false,
                    opacity: 1.0,
                    emissive: 0xff0000,
                    emissiveIntensity: 0.3,
                    roughness: 0.3,
                    metalness: 0.7
                });
                const fillMesh = new THREE.Mesh(geometry, fillMaterial);

                // Wireframe
                const wireframeGeometry = new THREE.WireframeGeometry(geometry);
                const wireframeMaterial = new THREE.LineBasicMaterial({
                    color: 0xff8888,
                    linewidth: 1
                });
                const wireframeMesh = new THREE.LineSegments(wireframeGeometry, wireframeMaterial);

                // Group both together
                const group = new THREE.Group();
                group.add(fillMesh);
                group.add(wireframeMesh);
                group.position.set(station.position.x, 40, station.position.z);
                group.userData = { workId: workId };

                this.scene.add(group);
                this.works.set(workId, {
                    mesh: group,
                    currentStation: stationId,
                    targetStation: null,
                    progress: 1.0
                });
            } else {
                // Update existing work
                const work = this.works.get(workId);

                if (work.currentStation !== stationId) {
                    // Start moving to new station
                    const fromStation = this.stations.get(work.currentStation);
                    const toStation = this.stations.get(stationId);

                    if (fromStation && toStation) {
                        work.targetStation = stationId;
                        work.fromPos = { ...fromStation.position };
                        work.toPos = { ...toStation.position };
                        work.progress = 0;
                    }
                }

                // Animate movement
                if (work.targetStation && work.progress < 1.0) {
                    work.progress += 0.02; // Smooth animation

                    if (work.progress >= 1.0) {
                        work.progress = 1.0;
                        work.currentStation = work.targetStation;
                        work.targetStation = null;
                    }

                    // Interpolate position
                    const t = this._easeInOutCubic(work.progress);
                    work.mesh.position.x = work.fromPos.x + (work.toPos.x - work.fromPos.x) * t;
                    work.mesh.position.z = work.fromPos.z + (work.toPos.z - work.fromPos.z) * t;
                    work.mesh.position.y = 40 + Math.sin(t * Math.PI) * 30; // Arc movement
                }
            }
        });
    }

    _easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    clear() {
        // Clear stations
        this.stations.forEach(station => {
            this.scene.remove(station.mesh);
        });
        this.stations.clear();

        // Clear works
        this.works.forEach(work => {
            this.scene.remove(work.mesh);
        });
        this.works.clear();

        // Clear connections
        this.connections.forEach(line => {
            this.scene.remove(line);
        });
        this.connections = [];
    }
}
