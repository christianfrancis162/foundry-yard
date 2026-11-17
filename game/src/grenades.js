// Frag grenades: the player throws one with G. It arcs under gravity, bounces off
// the world, and detonates on a fuse. Blast damage falls off with distance and is
// halved through walls. A fixed pool of four grenades, reused — nothing allocated
// per throw or per frame.
import * as THREE from 'three';

const GRAVITY = 14;
const FUSE = 1.4;
const BLAST_RADIUS = 6;
const MAX_DAMAGE = 90;
const MIN_DAMAGE = 15;
const RADIUS = 0.12;
const POOL = 4;

export function createGrenades(scene, world, hooks) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 40;
  const probe = new THREE.Box3();
  const toTarget = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const from = new THREE.Vector3();

  const grenades = [];
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2c323a'), roughness: 0.6, metalness: 0.4 });
  const bandMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#f0a830'), roughness: 0.5, metalness: 0.2 });
  for (let i = 0; i < POOL; i += 1) {
    const group = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 12, 8), bodyMat);
    const band = new THREE.Mesh(new THREE.TorusGeometry(RADIUS * 0.95, 0.02, 6, 16), bandMat);
    band.rotation.x = Math.PI / 2;
    group.add(ball, band);
    group.visible = false;
    group.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    scene.add(group);
    grenades.push({ group, pos: new THREE.Vector3(), vel: new THREE.Vector3(), fuse: 0, active: false });
  }

  function overlaps(x, y, z) {
    probe.min.set(x - RADIUS, y - RADIUS, z - RADIUS);
    probe.max.set(x + RADIUS, y + RADIUS, z + RADIUS);
    for (const c of world.colliders) if (probe.intersectsBox(c)) return true;
    return false;
  }

  function detonate(g) {
    g.active = false;
    g.group.visible = false;
    hooks.effects.explode(g.pos);
    hooks.sounds.explosion();
    // Damage falls off with distance; a wall between blast and target halves it.
    const hurt = (targetPos, apply) => {
      const dist = targetPos.distanceTo(g.pos);
      if (dist > BLAST_RADIUS) return;
      let amount = MAX_DAMAGE - ((MAX_DAMAGE - MIN_DAMAGE) * dist) / BLAST_RADIUS;
      from.copy(g.pos);
      toTarget.copy(targetPos).sub(from);
      const len = toTarget.length();
      dir.copy(toTarget).normalize();
      raycaster.set(from, dir);
      const wall = raycaster.intersectObjects(world.shootables, false)[0];
      if (wall && wall.distance < len - 0.3) amount *= 0.5;
      apply(Math.round(amount));
    };
    for (const bot of hooks.bots) {
      if (!bot.alive) continue;
      toTarget.set(bot.position.x, 1.2, bot.position.z);
      hurt(toTarget, (amount) => hooks.damageBot(bot, amount, 'torso', 'player'));
    }
    if (hooks.playerAlive()) {
      toTarget.copy(hooks.playerPos());
      toTarget.y += 1.2;
      hurt(toTarget, (amount) => hooks.damagePlayer(amount));
    }
  }

  return {
    get activeCount() {
      return grenades.filter((g) => g.active).length;
    },
    throwGrenade(origin, direction) {
      const g = grenades.find((slot) => !slot.active);
      if (!g) return false;
      g.pos.copy(origin).addScaledVector(direction, 0.5);
      g.vel.copy(direction).multiplyScalar(14);
      g.vel.y += 3.5;
      g.fuse = FUSE;
      g.active = true;
      g.group.visible = true;
      g.group.position.copy(g.pos);
      hooks.sounds.grenadeThrow();
      return true;
    },
    step(dt) {
      for (const g of grenades) {
        if (!g.active) continue;
        g.fuse -= dt;
        g.vel.y -= GRAVITY * dt;
        // Move one axis at a time; a blocked axis bounces instead of sticking.
        const nx = g.pos.x + g.vel.x * dt;
        if (!overlaps(nx, g.pos.y, g.pos.z)) g.pos.x = nx;
        else g.vel.x *= -0.45;
        const nz = g.pos.z + g.vel.z * dt;
        if (!overlaps(g.pos.x, g.pos.y, nz)) g.pos.z = nz;
        else g.vel.z *= -0.45;
        const ny = g.pos.y + g.vel.y * dt;
        if (ny < RADIUS) {
          g.pos.y = RADIUS;
          g.vel.y = Math.abs(g.vel.y) > 1 ? -g.vel.y * 0.45 : 0;
          g.vel.x *= 0.8;
          g.vel.z *= 0.8;
        } else if (!overlaps(g.pos.x, ny, g.pos.z)) {
          g.pos.y = ny;
        } else {
          g.vel.y *= -0.45;
        }
        g.group.position.copy(g.pos);
        g.group.rotation.x += dt * 6;
        g.group.rotation.z += dt * 4;
        if (g.fuse <= 0) detonate(g);
      }
    },
    resetRound() {
      for (const g of grenades) {
        g.active = false;
        g.group.visible = false;
      }
    },
  };
}
