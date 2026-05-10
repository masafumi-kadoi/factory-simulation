import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const STATION_COLORS = {
    source:     0x2e7d32,
    processing: 0x1565c0,
    machine:    0x1565c0,
    drain:      0x616161,
    merge:      0xf9a825,
    split:      0xe65100,
    moduler:    0x4a148c,
};

const STATION_H = 2;
const STANDARD_W = 1;
const STANDARD_D = 0.75;

export class Editor3DView {
    constructor(canvas) {
        this._canvas = canvas;
        this._animId = null;
        this._scene = null;
        this._camera = null;
        this._renderer = null;
        this._controls = null;
    }

    show(scenario) {
        this._canvas.style.display = 'block';
        this._build(scenario);
    }

    hide() {
        this._canvas.style.display = 'none';
        this._dispose();
    }

    _dispose() {
        if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; }
        if (this._controls) { this._controls.dispose(); this._controls = null; }
        if (this._renderer) { this._renderer.dispose(); this._renderer = null; }
        this._scene = null;
        this._camera = null;
    }

    _build(scenario) {
        this._dispose();
        const canvas = this._canvas;
        const w = canvas.clientWidth || 800;
        const h = canvas.clientHeight || 600;

        // Scene
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0a0a0a);
        scene.fog = new THREE.Fog(0x0a0a0a, 200, 600);
        this._scene = scene;

        // Camera
        const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 2000);
        this._camera = camera;

        // Renderer
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(w, h);
        this._renderer = renderer;

        // Controls
        const controls = new OrbitControls(camera, canvas);
        controls.enableDamping = true;
        controls.dampingFactor = 0.12;
        this._controls = controls;

        // Lights
        scene.add(new THREE.AmbientLight(0xffffff, 0.4));
        const dir = new THREE.DirectionalLight(0xffffff, 0.8);
        dir.position.set(30, 50, 30);
        scene.add(dir);

        // Ground
        const gridHelper = new THREE.GridHelper(200, 200, 0x333333, 0x222222);
        scene.add(gridHelper);

        // Compute center of all stations for camera target
        const stations = scenario.stations || [];
        if (stations.length === 0) return;

        const xs = stations.map(s => s.x);
        const ys = stations.map(s => s.y);
        const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
        const centerZ = (Math.min(...ys) + Math.max(...ys)) / 2;
        const spanX = Math.max(...xs) - Math.min(...xs);
        const spanZ = Math.max(...ys) - Math.min(...ys);
        const maxSpan = Math.max(spanX, spanZ, 50);

        // Scale: SVG pixels to 3D units.  80px ≈ 1m in the 2D editor
        const SCALE = 1 / 80;

        // Build stations
        for (const st of stations) {
            const px = (st.x - centerX) * SCALE;
            const pz = (st.y - centerZ) * SCALE;
            this._addStation(scene, st, px, pz, SCALE);
        }

        // Build connections
        const conns = scenario.connections || [];
        const stMap = new Map(stations.map(s => [s.id, s]));
        for (const c of conns) {
            const from = stMap.get(c.from);
            const to = stMap.get(c.to);
            if (!from || !to) continue;
            const fx = (from.x - centerX) * SCALE;
            const fz = (from.y - centerZ) * SCALE;
            const tx = (to.x - centerX) * SCALE;
            const tz = (to.y - centerZ) * SCALE;
            const points = [
                new THREE.Vector3(fx, STATION_H / 2, fz),
                new THREE.Vector3(tx, STATION_H / 2, tz),
            ];
            const lineGeom = new THREE.BufferGeometry().setFromPoints(points);
            const lineMat = new THREE.LineBasicMaterial({ color: 0x666666 });
            scene.add(new THREE.Line(lineGeom, lineMat));
        }

        // Position camera
        const camDist = maxSpan * SCALE * 1.2 + 10;
        camera.position.set(camDist * 0.6, camDist * 0.5, camDist * 0.6);
        controls.target.set(0, STATION_H / 2, 0);
        controls.update();

        // Resize observer
        this._resizeObs = new ResizeObserver(() => {
            const pw = canvas.clientWidth;
            const ph = canvas.clientHeight;
            if (pw > 0 && ph > 0) {
                camera.aspect = pw / ph;
                camera.updateProjectionMatrix();
                renderer.setSize(pw, ph);
            }
        });
        this._resizeObs.observe(canvas);

        // Animation loop
        const animate = () => {
            this._animId = requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
        };
        animate();
    }

    _addStation(scene, st, px, pz, scale) {
        const color = STATION_COLORS[st.type] || 0x888888;

        // ModulerStation with model3DGrid: render custom 3D model
        const grid = st.config?.model3DGrid;
        if (st.type === 'moduler' && grid?.cells?.length > 0) {
            const gs = grid.gridSize || 1;
            const h = grid.height || 2;
            const { cells, origin } = grid;
            const minC = Math.min(...cells.map(([c]) => c));
            const maxC = Math.max(...cells.map(([c]) => c));
            const minR = Math.min(...cells.map(([, r]) => r));
            const maxR = Math.max(...cells.map(([, r]) => r));

            // Reference point: origin cell or bounding box center
            const refC = origin ? origin[0] : (minC + maxC) / 2;
            const refR = origin ? origin[1] : (minR + maxR) / 2;

            const group = new THREE.Group();
            const boxGeom = new THREE.BoxGeometry(gs, h, gs);
            for (const [cx, cy] of cells) {
                const mat = new THREE.MeshStandardMaterial({
                    color: 0x4a148c,
                    transparent: true,
                    opacity: 0.7,
                    roughness: 0.5,
                    metalness: 0.1,
                });
                const mesh = new THREE.Mesh(boxGeom, mat);
                mesh.position.set(
                    (cx - refC) * gs,
                    h / 2,
                    (cy - refR) * gs
                );
                group.add(mesh);
            }
            group.position.set(px, 0, pz);
            scene.add(group);

            // Label at visual center of bounding box
            const labelX = px + ((minC + maxC) / 2 - refC) * gs;
            const labelZ = pz + ((minR + maxR) / 2 - refR) * gs;
            this._addLabel(scene, st.name || st.id, labelX, h + 0.5, labelZ);
            return;
        }

        // Standard station: simple box
        const geom = new THREE.BoxGeometry(STANDARD_W, STATION_H, STANDARD_D);
        const mat = new THREE.MeshStandardMaterial({
            color,
            roughness: 0.6,
            metalness: 0.1,
        });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.set(px, STATION_H / 2, pz);
        scene.add(mesh);

        this._addLabel(scene, st.name || st.id, px, STATION_H + 0.5, pz);
    }

    _addLabel(scene, text, x, y, z) {
        const canvas2d = document.createElement('canvas');
        canvas2d.width = 256;
        canvas2d.height = 64;
        const ctx = canvas2d.getContext('2d');
        ctx.fillStyle = 'transparent';
        ctx.fillRect(0, 0, 256, 64);
        ctx.font = 'bold 28px sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 128, 32);

        const texture = new THREE.CanvasTexture(canvas2d);
        const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true });
        const sprite = new THREE.Sprite(spriteMat);
        sprite.position.set(x, y, z);
        sprite.scale.set(3, 0.75, 1);
        scene.add(sprite);
    }
}
