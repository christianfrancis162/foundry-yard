// The map: "Foundry Yard", a 36 x 30 m outdoor yard with two bombsites, three lanes
// and a mid wall. Blue spawns south, red spawns north. Site A (west, sand floor) and
// Site B (east, slate floor) are walled pockets with two entrances each; mid is a
// 3 m doorway through the wall at z=0, and the west/east lanes flank around it.
// Cover crates, tall pillars and jumpable platforms give every lane a corner to play.
// Every box is a collider and a surface a bullet stops on. Procedural geometry only.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Bombsite rectangles: centre + half extents, in world metres.
export const SITES = {
  A: { letter: 'A', cx: -13, cz: -9.5, hw: 3.5, hd: 3 },
  B: { letter: 'B', cx: 13, cz: -9.5, hw: 3.5, hd: 3 },
};

export function inSite(site, x, z) {
  return Math.abs(x - site.cx) <= site.hw && Math.abs(z - site.cz) <= site.hd;
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    if (name === 'skyTop' || name === 'skyHorizon') continue;
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: 0.03,
    });
  }

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // A sign painted on a wall from a canvas texture: procedural, no asset file.
  function wallSign(text, x, y, z, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 512, 128);
    ctx.font = '700 84px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text, 256, 66);
    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 4;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 1.1),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
    );
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  }

  // Flat floor plates: thin planes, not colliders, so they never block movement.
  function plate(width, depth, x, z, material) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), materials[material]);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.012, z);
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  // A letter painted on the floor from a canvas texture: procedural, no asset file.
  function floorLetter(letter, x, z, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 256);
    ctx.font = '700 190px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(letter, 128, 138);
    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 4;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 3.4),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.02, z);
    group.add(mesh);
    return mesh;
  }

  // Outer shell: 36 x 30 m, 4.6 m walls, open to the sky.
  box(36.4, 0.4, 30.4, 0, -0.2, 0, 'canvas');
  box(0.4, 4.6, 30.4, -18.2, 2.3, 0, 'surface');
  box(0.4, 4.6, 30.4, 18.2, 2.3, 0, 'surface');
  box(36.4, 4.6, 0.4, 0, 2.3, -15.2, 'surface');
  box(36.4, 4.6, 0.4, 0, 2.3, 15.2, 'surface');

  // Site A pocket (brick walls, 3.2 high): east wall with a 3.75 m gap, south wall
  // with a 3 m gap. Interior roughly x -18..-9.5, z -15..-5.5.
  box(0.4, 3.2, 3, -9.5, 1.6, -13.5, 'brick');
  box(0.4, 3.2, 2.5, -9.5, 1.6, -7, 'brick');
  box(3.5, 3.2, 0.4, -16.25, 1.6, -5.5, 'brick');
  box(2.5, 3.2, 0.4, -10.25, 1.6, -5.5, 'brick');
  // Site B pocket, mirrored.
  box(0.4, 3.2, 3, 9.5, 1.6, -13.5, 'brick');
  box(0.4, 3.2, 2.5, 9.5, 1.6, -7, 'brick');
  box(3.5, 3.2, 0.4, 16.25, 1.6, -5.5, 'brick');
  box(2.5, 3.2, 0.4, 10.25, 1.6, -5.5, 'brick');

  // Mid wall at z=0: only spans x -6..6, so the west and east lanes flank around it.
  // The 3 m doorway at the centre is the fast, exposed route.
  box(4.5, 3.2, 0.4, -3.75, 1.6, 0, 'surface');
  box(4.5, 3.2, 0.4, 3.75, 1.6, 0, 'surface');

  // Site floor plates, painted letters and wall signs: A reads warm sand, B cool
  // slate, so the two sites are distinct at a glance from anywhere on the map.
  plate(7, 6, -13, -9.5, 'siteA');
  plate(7, 6, 13, -9.5, 'siteB');
  floorLetter('A', -13, -9.5, PALETTE.ink);
  floorLetter('B', 13, -9.5, PALETTE.ink);
  wallSign('SITE A', -13, 2.4, -14.95, PALETTE.siteA);
  wallSign('SITE B', 13, 2.4, -14.95, PALETTE.siteB);

  // Cover crates (1.1 m: crouch cover) and low blocks.
  box(2, 1.1, 2, -6, 0.55, 9, 'hairline');
  box(2, 1.1, 2, 6, 0.55, 9, 'hairline');
  box(3, 0.9, 1.2, 0, 0.45, 11, 'hairline');
  box(1.6, 1.1, 1.6, -4, 0.55, 2.5, 'hairline');
  box(1.6, 1.1, 1.6, 4, 0.55, -2.5, 'hairline');
  box(2, 1.1, 2, -3, 0.55, -9, 'hairline');
  box(2, 1.1, 2, 3, 0.55, -9, 'hairline');
  box(2, 1.1, 1.2, -15, 0.55, -8, 'siteA');
  box(1.6, 1.1, 1.6, -11, 0.55, -12.5, 'siteA');
  box(2, 1.1, 1.2, 15, 0.55, -8, 'siteB');
  box(1.6, 1.1, 1.6, 11, 0.55, -12.5, 'siteB');
  box(1.2, 1.1, 2.4, -14.5, 0.55, 3, 'hairline');
  box(1.2, 1.1, 2.4, 14.5, 0.55, 3, 'hairline');
  box(1.2, 1.1, 2.4, -14.5, 0.55, -2.5, 'hairline');
  box(1.2, 1.1, 2.4, 14.5, 0.55, -2.5, 'hairline');

  // Tall pillars (2.4 m): hard cover that breaks sightlines at the lane junctions.
  box(1.2, 2.4, 1.2, -12.5, 1.2, 0, 'hairline');
  box(1.2, 2.4, 1.2, 12.5, 1.2, 0, 'hairline');
  box(1.2, 2.4, 1.2, 0, 1.2, -3.5, 'hairline');

  // Jumpable platforms (0.55 m): sightline perches over the lanes and north plaza.
  box(3, 0.55, 3, -16, 0.275, 0, 'surface');
  box(3, 0.55, 3, 16, 0.275, 0, 'surface');
  box(4, 0.55, 2, 0, 0.275, -11, 'surface');

  // Gradient sky dome: dusk blue overhead fading to a warm horizon. A shader on a
  // back-facing sphere, no texture file and no network.
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(PALETTE.skyTop) },
      horizon: { value: new THREE.Color(PALETTE.skyHorizon) },
    },
    vertexShader: 'varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec3 vPos; uniform vec3 top; uniform vec3 horizon; void main(){ float h = normalize(vPos).y; float t = smoothstep(-0.02, 0.45, h); gl_FragColor = vec4(mix(horizon, top, t), 1.0); }',
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(120, 24, 12), skyMat);
  scene.add(sky);

  // Light: warm low sun from the south-west, cool fill from the north-east, sky/ground.
  const hemi = new THREE.HemisphereLight(new THREE.Color(PALETTE.surface), new THREE.Color(PALETTE.canvas), 1.5);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(new THREE.Color(PALETTE.ink), 2.6);
  key.position.set(14, 20, 12);
  key.target.position.set(0, 0, -3);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -22;
  key.shadow.camera.right = 22;
  key.shadow.camera.top = 22;
  key.shadow.camera.bottom = -22;
  key.shadow.camera.far = 64;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);

  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.muted), 0.8);
  fill.position.set(-12, 10, -14);
  scene.add(fill);

  return { colliders, shootables, group, sites: SITES };
}
