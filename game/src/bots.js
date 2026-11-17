// Bots: two teams of three. The player plus two friendly bots (ink) against three
// enemy bots (accent). AI: patrol waypoints that use cover, engage the nearest
// visible enemy inside range and field of view, strafe while firing in bursts.
// Aggression varies per bot: Blitz pushes, Rook holds, the rest sit between.
// A bot under 35 HP retreats toward its own half for a few seconds. Each bot runs
// its own economy — round wins and kills pay, and it buys a better weapon when it
// can afford one. Red attacks the round's target bombsite; blue defends a site each
// and converges on a planted bomb. The planter and the defuser stand still.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const HEALTH = 100;
const EYE = 1.5;
const CHEST = 1.2;
const RADIUS = 0.34;
const PATROL_SPEED = 2.6;
const ENGAGE_SPEED = 2.1;
const SIGHT_RANGE = 30;
const SIGHT_HALF_FOV = 0.96; // ~55 degrees each side
const FALL_SECONDS = 0.4;
const RETREAT_HP = 35;
const RETREAT_SECONDS = 2.5;

// Bot weapons: what a bot's money buys, and what its shots do.
const BOT_WEAPONS = {
  pistol: { damage: 12, gap: 0.16, burstMin: 3, burstMax: 5 },
  smg: { damage: 13, gap: 0.13, burstMin: 4, burstMax: 6 },
  rifle: { damage: 17, gap: 0.15, burstMin: 3, burstMax: 5 },
};

const NAMES_BLUE = ['Ghost', 'Viper'];
const NAMES_RED = ['Rook', 'Havoc', 'Blitz'];
// Aggression: how hard a bot pushes, how long its bursts run, how fast it strafes.
const AGGRESSION = { Ghost: 1.0, Viper: 1.15, Rook: 0.85, Havoc: 1.0, Blitz: 1.25 };
// Roles: Blitz rushes the objective site, Rook holds angles and waits at his
// waypoints; the rest patrol normally.
const ROLES = { Blitz: 'rusher', Rook: 'holder' };

// Waypoints by zone. Patrols pick from the pool that fits the bot's job, so red
// funnels toward the target site and blue holds its site.
const WAYPOINTS = {
  south: [[-12, 10], [-6, 11], [0, 13], [6, 11], [12, 10]],
  westLane: [[-14, 5], [-14, 0], [-13, -3]],
  eastLane: [[14, 5], [14, 0], [13, -3]],
  mid: [[0, 6], [0, 3], [2, -3], [0, -6]],
  north: [[-6, -9], [6, -9], [-3, -12], [3, -12]],
  siteA: [[-13, -8], [-15, -11], [-11, -7]],
  siteB: [[13, -8], [15, -11], [11, -7]],
};

// Blue defends the sites, so the defenders start at their site entrances —
// Ghost at Site A, Viper at Site B — ready to contest the plant from the
// first second instead of walking the whole map. The player spawns south and
// rotates in.
const BLUE_SPAWNS = [[-13, -4], [13, -4]];
const RED_SPAWNS = [[-5, -13.5], [0, -13.5], [5, -13.5]];

const FRIENDLY_COLOR = new THREE.Color(PALETTE.ink);
const ENEMY_COLOR = new THREE.Color(PALETTE.accent);
const DARK = new THREE.Color(PALETTE.hairline);

export function createBots(scene, world, hooks) {
  const random = hooks.random || Math.random;
  const effects = hooks.effects;
  const raycaster = new THREE.Raycaster();
  raycaster.far = 80;
  const dir = new THREE.Vector3();
  const toTarget = new THREE.Vector3();
  const eye = new THREE.Vector3();
  const aim = new THREE.Vector3();
  const probe = new THREE.Box3();
  const chestPos = new THREE.Vector3();
  const muzzleV = new THREE.Vector3();
  const endV = new THREE.Vector3();

  // A name floating over each bot's head, drawn on a canvas: procedural, no asset.
  function makeNameSprite(name, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 40;
    const ctx = canvas.getContext('2d');
    ctx.font = '700 24px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(name, 64, 20);
    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
    sprite.scale.set(1.5, 0.47, 1);
    sprite.position.y = 2.05;
    return sprite;
  }

  function buildMesh(team, name) {
    const color = team === 'blue' ? FRIENDLY_COLOR : ENEMY_COLOR;
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05 });
    const darkMat = new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.8 });
    const group = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.78, 0.3), bodyMat);
    torso.position.y = 1.0;
    torso.userData.part = 'torso';
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 16, 12), bodyMat);
    head.position.y = 1.53;
    head.userData.part = 'head';
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.55, 0.2), darkMat);
    legL.position.set(-0.14, 0.28, 0);
    const legR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.55, 0.2), darkMat);
    legR.position.set(0.14, 0.28, 0);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.55), darkMat);
    gun.position.set(0.2, 1.25, -0.3);
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(0.46, 0.46, 0.02, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55 }),
    );
    ring.position.y = 0.02;
    const tag = makeNameSprite(name, team === 'blue' ? PALETTE.ink : PALETTE.accent);
    group.add(torso, head, legL, legR, gun, ring, tag);
    group.traverse((mesh) => {
      if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; }
    });
    scene.add(group);
    return { group, torso, head };
  }

  const bots = [];
  function addBot(team, name, spawn) {
    const { group, torso, head } = buildMesh(team, name);
    const bot = {
      id: bots.length,
      name,
      team,
      aggression: AGGRESSION[name] || 1,
      role: ROLES[name] || 'patrol',
      dwellUntil: 0,
      position: new THREE.Vector3(spawn[0], 0, spawn[1]),
      yaw: team === 'blue' ? Math.PI : 0,
      health: HEALTH,
      armor: false,
      money: 800,
      weapon: 'pistol',
      alive: true,
      state: 'patrol',
      waypoint: new THREE.Vector3(spawn[0], 0, spawn[1]),
      waypointTimer: 0,
      losTimer: random() * 0.15,
      target: null,
      burstLeft: 0,
      burstPause: 0,
      shootTimer: 0,
      strafeDir: random() > 0.5 ? 1 : -1,
      strafeTimer: 0,
      fall: 0,
      retreatUntil: -10,
      retreatPoint: new THREE.Vector3(),
      defendSite: team === 'blue' ? (name === 'Ghost' ? 'A' : 'B') : null,
      group,
      torso,
      head,
      home: new THREE.Vector3(spawn[0], 0, spawn[1]),
    };
    torso.userData.bot = bot;
    head.userData.bot = bot;
    group.position.copy(bot.position);
    bots.push(bot);
    return bot;
  }

  BLUE_SPAWNS.forEach((spawn, i) => addBot('blue', NAMES_BLUE[i], spawn));
  RED_SPAWNS.forEach((spawn, i) => addBot('red', NAMES_RED[i], spawn));

  function overlaps(x, z) {
    probe.min.set(x - RADIUS, 0.02, z - RADIUS);
    probe.max.set(x + RADIUS, 1.7, z + RADIUS);
    for (const c of world.colliders) if (probe.intersectsBox(c)) return true;
    return false;
  }

  function moveToward(bot, tx, tz, dt, speed) {
    const dx = tx - bot.position.x;
    const dz = tz - bot.position.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.15) return true;
    const stepX = (dx / len) * speed * dt;
    const stepZ = (dz / len) * speed * dt;
    const nx = bot.position.x + stepX;
    if (!overlaps(nx, bot.position.z)) bot.position.x = nx;
    const nz = bot.position.z + stepZ;
    if (!overlaps(bot.position.x, nz)) bot.position.z = nz;
    return false;
  }

  function hasLineOfSight(from, to) {
    eye.set(from.x, from.y + EYE, from.z);
    toTarget.set(to.x - eye.x, to.y + EYE - eye.y, to.z - eye.z);
    const dist = toTarget.length();
    if (dist > SIGHT_RANGE) return false;
    dir.copy(toTarget).normalize();
    raycaster.set(eye, dir);
    const hit = raycaster.intersectObjects(world.shootables, false)[0];
    return !hit || hit.distance > dist - 0.3;
  }

  function visibleEnemy(bot, playerState) {
    let best = null;
    let bestDist = Infinity;
    const consider = (pos, ref) => {
      const dx = pos.x - bot.position.x;
      const dz = pos.z - bot.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= bestDist || dist > SIGHT_RANGE) return;
      // Field of view: the bot must roughly face its target.
      const ang = Math.atan2(-dx, -dz);
      let diff = ang - bot.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > SIGHT_HALF_FOV) return;
      if (!hasLineOfSight(bot.position, pos)) return;
      best = ref;
      bestDist = dist;
    };
    if (bot.team === 'red' && playerState.alive) consider(playerState.position, { kind: 'player' });
    for (const other of bots) {
      if (!other.alive || other.team === bot.team) continue;
      consider(other.position, { kind: 'bot', bot: other });
    }
    return best;
  }

  function botShoot(bot, target, time) {
    // Aim at the target chest with spread that grows with distance.
    const w = BOT_WEAPONS[bot.weapon];
    const targetPos = target.kind === 'player' ? hooks.getPlayerPos() : target.bot.position;
    const dist = Math.hypot(targetPos.x - bot.position.x, targetPos.z - bot.position.z);
    const spread = 0.035 + dist * 0.0028;
    aim.set(targetPos.x, CHEST, targetPos.z);
    aim.x += (random() * 2 - 1) * spread * dist * 0.5;
    aim.y += (random() * 2 - 1) * spread * dist * 0.3;
    aim.z += (random() * 2 - 1) * spread * dist * 0.5;
    eye.set(bot.position.x, bot.position.y + EYE, bot.position.z);
    dir.copy(aim).sub(eye).normalize();
    raycaster.set(eye, dir);
    const wall = raycaster.intersectObjects(world.shootables, false)[0];
    const wallDist = wall ? wall.distance : Infinity;
    // Perpendicular distance from the target chest to the shot ray.
    toTarget.set(targetPos.x, CHEST, targetPos.z).sub(eye);
    const along = toTarget.dot(dir);
    const closest = Math.sqrt(Math.max(0, toTarget.lengthSq() - along * along));
    // Reused temps, not clones: this runs on every bot shot.
    muzzleV.copy(eye).addScaledVector(dir, 0.6);
    endV.copy(eye).addScaledVector(dir, Math.min(wallDist, 40));
    effects.fireTracer(muzzleV, endV, bot.team === 'blue' ? PALETTE.ink : PALETTE.accent);
    hooks.onBotShotFired?.(bot);
    if (along > 0 && closest < 0.5 && along < wallDist) {
      if (target.kind === 'player') hooks.onDamagePlayer(w.damage, bot);
      else damageBot(target.bot, w.damage, 'torso', bot);
    }
  }

  function damageBot(bot, amount, part, killer) {
    if (!bot.alive) return false;
    const final = bot.armor ? Math.ceil(amount / 2) : amount;
    bot.health -= final;
    if (bot.health > 0) return false;
    bot.alive = false;
    bot.fall = 0;
    bot.state = 'dead';
    if (killer && killer !== 'player' && killer.money !== undefined) killer.money += 300;
    if (killer && killer !== 'player') {
      chestPos.set(bot.position.x, CHEST, bot.position.z);
      effects.burstSparks(chestPos, 4, PALETTE.accent);
    }
    hooks.onKill?.(killer, bot);
    return true;
  }

  function waypointPool(bot) {
    const plantedSite = hooks.getBombSite?.();
    const bombPlanted = hooks.bombPlanted?.();
    if (bombPlanted && plantedSite) {
      // Everyone converges on the planted site.
      return WAYPOINTS[plantedSite === 'A' ? 'siteA' : 'siteB'].concat(WAYPOINTS.north, WAYPOINTS.mid);
    }
    if (bot.team === 'red') {
      const site = hooks.getTargetSite?.() || 'A';
      const lane = site === 'A' ? WAYPOINTS.westLane : WAYPOINTS.eastLane;
      const siteWps = site === 'A' ? WAYPOINTS.siteA : WAYPOINTS.siteB;
      // The rusher goes straight for the site; the holder watches mid and north.
      if (bot.role === 'rusher') return siteWps.concat(siteWps, lane);
      if (bot.role === 'holder') return WAYPOINTS.mid.concat(WAYPOINTS.north, siteWps);
      // The target site twice over: red pushes it, and the lanes lead to it.
      return siteWps.concat(siteWps, lane, WAYPOINTS.mid, WAYPOINTS.north);
    }
    // Blue holds its assigned site and watches mid and south.
    const siteWps = bot.defendSite === 'A' ? WAYPOINTS.siteA : WAYPOINTS.siteB;
    return siteWps.concat(siteWps, WAYPOINTS.mid, WAYPOINTS.south);
  }

  function pickWaypoint(bot) {
    const pool = waypointPool(bot);
    const wp = pool[Math.floor(random() * pool.length)];
    bot.waypoint.set(wp[0], 0, wp[1]);
    bot.waypointTimer = 0;
  }

  function stepBot(bot, dt, time, playerState) {
    if (!bot.alive) {
      bot.fall = Math.min(1, bot.fall + dt / FALL_SECONDS);
      bot.group.rotation.x = -bot.fall * 1.45;
      bot.group.position.y = -bot.fall * 0.08;
      return;
    }
    // Planting or defusing: stand still, hands on the bomb.
    if (hooks.isPlanter?.(bot) || hooks.isDefuser?.(bot)) {
      bot.group.position.copy(bot.position);
      return;
    }
    // Retreat: under 35 HP and under fire, fall back toward home for a few seconds.
    // Rushers never retreat — they push the objective regardless.
    if (bot.retreatUntil > time) {
      moveToward(bot, bot.retreatPoint.x, bot.retreatPoint.z, dt, PATROL_SPEED * 1.2);
      const dx = bot.retreatPoint.x - bot.position.x;
      const dz = bot.retreatPoint.z - bot.position.z;
      if (Math.hypot(dx, dz) > 0.3) {
        const wantYaw = Math.atan2(-dx, -dz);
        let diff = wantYaw - bot.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        bot.yaw += diff * Math.min(1, dt * 6);
      }
      bot.group.position.copy(bot.position);
      bot.group.rotation.y = bot.yaw;
      return;
    }
    // A bot that drops under 35 HP while under fire falls back toward home. The
    // 4 s after a retreat ends are a cooldown, so it does not ping-pong.
    if (bot.health <= RETREAT_HP && bot.target && bot.role !== 'rusher' && time > bot.retreatUntil + 4) {
      const tp = bot.target.kind === 'player' ? hooks.getPlayerPos() : bot.target.bot.position;
      const dx = bot.position.x - tp.x;
      const dz = bot.position.z - tp.z;
      const len = Math.hypot(dx, dz) || 1;
      bot.retreatPoint.set(
        Math.max(-17, Math.min(17, bot.position.x + (dx / len) * 7)),
        0,
        Math.max(-14, Math.min(14, bot.position.z + (dz / len) * 7)),
      );
      bot.retreatUntil = time + RETREAT_SECONDS;
    }
    bot.losTimer -= dt;
    if (bot.losTimer <= 0) {
      bot.losTimer = 0.15;
      bot.target = visibleEnemy(bot, playerState);
      bot.state = bot.target ? 'engage' : 'patrol';
    }
    if (bot.state === 'engage' && bot.target) {
      const targetPos = bot.target.kind === 'player' ? hooks.getPlayerPos() : bot.target.bot.position;
      if (bot.target.kind === 'bot' && !bot.target.bot.alive) { bot.target = null; bot.state = 'patrol'; }
      else {
        const dx = targetPos.x - bot.position.x;
        const dz = targetPos.z - bot.position.z;
        const dist = Math.hypot(dx, dz);
        const wantYaw = Math.atan2(-dx, -dz);
        let diff = wantYaw - bot.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        bot.yaw += diff * Math.min(1, dt * 10);
        // Strafe perpendicular to the target, switching direction regularly.
        // Aggressive bots also advance on the target; cautious ones hold ground.
        bot.strafeTimer -= dt;
        if (bot.strafeTimer <= 0) {
          bot.strafeTimer = 0.8 + random() * 0.9;
          bot.strafeDir = random() > 0.5 ? 1 : -1;
        }
        const px = -dz;
        const pz = dx;
        const plen = Math.hypot(px, pz) || 1;
        const strafeSpeed = ENGAGE_SPEED * bot.aggression;
        moveToward(bot, bot.position.x + (px / plen) * bot.strafeDir, bot.position.z + (pz / plen) * bot.strafeDir, dt, strafeSpeed);
        if (bot.aggression >= 1.15 && dist > 6) {
          moveToward(bot, targetPos.x, targetPos.z, dt, ENGAGE_SPEED * 0.55);
        }
        // Fire in bursts; aggression stretches the burst.
        const w = BOT_WEAPONS[bot.weapon];
        bot.burstPause -= dt;
        if (bot.burstLeft > 0) {
          bot.shootTimer -= dt;
          if (bot.shootTimer <= 0) {
            bot.shootTimer = w.gap;
            bot.burstLeft -= 1;
            botShoot(bot, bot.target, time);
            if (bot.burstLeft === 0) bot.burstPause = 1.0 + random() * 0.8;
          }
        } else if (bot.burstPause <= 0) {
          const extra = Math.round((bot.aggression - 1) * 4);
          bot.burstLeft = w.burstMin + Math.floor(random() * (w.burstMax - w.burstMin + 1)) + extra;
          bot.shootTimer = 0;
        }
      }
    } else {
      bot.waypointTimer += dt;
      // The holder waits at each waypoint, watching the angle, before moving on.
      if (bot.role === 'holder' && time < bot.dwellUntil) {
        bot.group.position.copy(bot.position);
        bot.group.rotation.y = bot.yaw;
        return;
      }
      const patrolSpeed = PATROL_SPEED * bot.aggression * (bot.role === 'rusher' ? 1.3 : bot.role === 'holder' ? 0.8 : 1);
      const arrived = moveToward(bot, bot.waypoint.x, bot.waypoint.z, dt, patrolSpeed);
      const dx = bot.waypoint.x - bot.position.x;
      const dz = bot.waypoint.z - bot.position.z;
      if (Math.hypot(dx, dz) > 0.3) {
        const wantYaw = Math.atan2(-dx, -dz);
        let diff = wantYaw - bot.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        bot.yaw += diff * Math.min(1, dt * 6);
      }
      if (arrived || bot.waypointTimer > 14) {
        if (bot.role === 'holder' && arrived) bot.dwellUntil = time + 1.5 + random() * 1.5;
        pickWaypoint(bot);
      }
    }
    bot.group.position.copy(bot.position);
    bot.group.rotation.y = bot.yaw;
  }

  return {
    bots,
    get hitMeshes() {
      const out = [];
      for (const b of bots) if (b.alive) out.push(b.torso, b.head);
      return out;
    },
    step(dt, time, playerState) {
      for (const bot of bots) stepBot(bot, dt, time, playerState);
    },
    damage(bot, amount, part, killer) {
      return damageBot(bot, amount, part, killer);
    },
    resetRound(round, lastWinner) {
      for (const bot of bots) {
        // Payday: last round's result, then buy the best weapon the money allows.
        if (round > 1) bot.money += lastWinner === bot.team ? 1000 : 500;
        if (bot.money >= 2500) { bot.weapon = 'rifle'; bot.money -= 2500; }
        else if (bot.money >= 1500) { bot.weapon = 'smg'; bot.money -= 1500; }
        else bot.weapon = 'pistol';
        bot.armor = false;
        if (bot.money >= 1000) { bot.armor = true; bot.money -= 1000; }
        bot.health = HEALTH;
        bot.alive = true;
        bot.state = 'patrol';
        bot.target = null;
        bot.burstLeft = 0;
        bot.burstPause = 0.5 + random();
        bot.fall = 0;
        bot.retreatUntil = -10;
        bot.dwellUntil = 0;
        bot.position.copy(bot.home);
        bot.group.position.copy(bot.position);
        bot.group.rotation.set(0, bot.yaw, 0);
        bot.yaw = bot.team === 'blue' ? Math.PI : 0;
        bot.group.rotation.y = bot.yaw;
        pickWaypoint(bot);
      }
    },
    aliveCount(team) {
      return bots.filter((b) => b.team === team && b.alive).length;
    },
    setPositionsForShot() {
      // Deterministic spread for screenshots: friendlies mid-map, enemies near Site A.
      const spots = {
        Ghost: [-2, 2], Viper: [3, 3],
        Rook: [-12, -8], Havoc: [-4, -6], Blitz: [5, -6],
      };
      for (const bot of bots) {
        const s = spots[bot.name];
        if (!s) continue;
        bot.position.set(s[0], 0, s[1]);
        bot.yaw = bot.team === 'blue' ? Math.PI : 0;
        bot.group.position.copy(bot.position);
        bot.group.rotation.y = bot.yaw;
      }
    },
  };
}
