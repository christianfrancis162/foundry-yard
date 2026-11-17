// Shared visual effects: tracer lines, hit sparks and the explosion flash.
// One fixed pool per effect, reused every frame — nothing is allocated in the
// hot loop, and nothing here touches the simulation.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACER_COUNT = 24;
const TRACER_LIFE = 0.07;
const SPARK_COUNT = 48;
const SPARK_LIFE = 0.4;

export function createEffects(scene) {
  // Tracer pool: one line per slot, each with its own material so colour and
  // opacity can change independently.
  const tracers = [];
  for (let i = 0; i < TRACER_COUNT; i += 1) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0 }));
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerNext = 0;

  // Spark pool: small tetrahedra that fly out from a hit point and fade.
  const sparks = [];
  const sparkGeo = new THREE.TetrahedronGeometry(0.055);
  for (let i = 0; i < SPARK_COUNT; i += 1) {
    const mesh = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0 }));
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    sparks.push({ mesh, vel: new THREE.Vector3(), life: 0 });
  }
  let sparkNext = 0;

  // Explosion flash: one sphere that scales up and fades, plus one light.
  const blast = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 16, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff7a3c'), transparent: true, opacity: 0, depthWrite: false }),
  );
  blast.visible = false;
  blast.frustumCulled = false;
  scene.add(blast);
  const blastLight = new THREE.PointLight(new THREE.Color('#ff7a3c'), 0, 26);
  scene.add(blastLight);
  let blastLife = 0;

  return {
    fireTracer(from, to, color) {
      const t = tracers[tracerNext];
      tracerNext = (tracerNext + 1) % tracers.length;
      const pos = t.line.geometry.attributes.position;
      pos.setXYZ(0, from.x, from.y, from.z);
      pos.setXYZ(1, to.x, to.y, to.z);
      pos.needsUpdate = true;
      t.line.material.color.set(color);
      t.line.material.opacity = 0.85;
      t.line.visible = true;
      t.life = TRACER_LIFE;
    },
    burstSparks(at, count, color) {
      for (let i = 0; i < count; i += 1) {
        const s = sparks[sparkNext];
        sparkNext = (sparkNext + 1) % sparks.length;
        s.mesh.position.copy(at);
        s.vel.set((Math.random() * 2 - 1) * 3.2, Math.random() * 3.4 + 0.6, (Math.random() * 2 - 1) * 3.2);
        s.mesh.material.color.set(color);
        s.mesh.material.opacity = 1;
        s.mesh.visible = true;
        s.life = SPARK_LIFE * (0.6 + Math.random() * 0.4);
      }
    },
    explode(at) {
      blast.position.copy(at);
      blast.scale.setScalar(1);
      blast.visible = true;
      blast.material.opacity = 0.9;
      blastLight.position.copy(at);
      blastLight.position.y += 0.5;
      blastLight.intensity = 90;
      blastLife = 0.45;
      this.burstSparks(at, 24, '#ff7a3c');
    },
    step(dt) {
      for (const t of tracers) {
        if (t.life > 0) {
          t.life -= dt;
          t.line.material.opacity = Math.max(0, t.life / TRACER_LIFE) * 0.85;
          if (t.life <= 0) t.line.visible = false;
        }
      }
      for (const s of sparks) {
        if (s.life > 0) {
          s.life -= dt;
          s.vel.y -= 14 * dt;
          s.mesh.position.addScaledVector(s.vel, dt);
          s.mesh.rotation.x += dt * 9;
          s.mesh.rotation.y += dt * 7;
          s.mesh.material.opacity = Math.max(0, s.life / SPARK_LIFE);
          if (s.life <= 0) s.mesh.visible = false;
        }
      }
      if (blastLife > 0) {
        blastLife -= dt;
        const k = Math.max(0, blastLife / 0.45);
        blast.scale.setScalar(1 + (1 - k) * 11);
        blast.material.opacity = 0.9 * k;
        blastLight.intensity = 90 * k;
        if (blastLife <= 0) {
          blast.visible = false;
          blastLight.intensity = 0;
        }
      }
    },
  };
}
