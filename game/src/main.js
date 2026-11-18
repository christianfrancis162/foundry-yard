// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's rate.
// Foundry Yard: you plus two friendly bots against three enemy bots, rounds, money,
// buy menu, a bomb to plant and defuse, and grenades.
// ?shot=start|play|end with &seed=N sets up a deterministic frame for a capture, renders it
// twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapon } from './weapon.js';
import { createBots } from './bots.js';
import { createRounds, WEAPONS, ARMOR_PRICE, GRENADE_PRICE, BUY_SECONDS } from './rounds.js';
import { createHud } from './hud.js';
import { createSounds } from './sounds.js';
import { createEffects } from './effects.js';
import { createGrenades } from './grenades.js';
import { createBomb } from './bomb.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.skyHorizon);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.skyHorizon), 26, 70);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 200);
scene.add(camera);

const sounds = createSounds();
const world = createWorld(scene);
const effects = createEffects(scene);
const weapon = createWeapon(camera);
const hud = createHud();
const player = createPlayer(world.colliders);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 80;
const direction = new THREE.Vector3();
const muzzle = new THREE.Vector3();
const hitPoint = new THREE.Vector3();
const toAttacker = new THREE.Vector3();

const body = player.state;
const markerHoldMs = shot ? 4000 : 90;
let kills = 0;
let playerHealth = 100;
let playerArmor = false;
let playerAlive = true;
let spectateBot = null;
let elapsed = 0;
let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let wasFiring = false;
const WEAPON_KEYS = { Digit1: 'pistol', Digit2: 'smg', Digit3: 'rifle', Digit4: 'shotgun' };
let buyMenuVisible = false;
let targetSite = 'A';

function aliveCounts() {
  return {
    blue: bots.aliveCount('blue') + (playerAlive ? 1 : 0),
    red: bots.aliveCount('red'),
  };
}

// Damage to the player from any source: armor halves it, the vignette flashes,
// and the direction wedge points at the shooter when there is one.
function damagePlayer(amount, attacker) {
  if (shot || !playerAlive) return;
  const final = playerArmor ? Math.ceil(amount / 2) : amount;
  playerHealth -= final;
  hud.setHealth(playerHealth);
  hud.damageFlash();
  sounds.hurt();
  if (attacker) {
    const dx = attacker.position.x - body.position.x;
    const dz = attacker.position.z - body.position.z;
    const fx = -Math.sin(body.yaw);
    const fz = -Math.cos(body.yaw);
    const len = Math.hypot(dx, dz) || 1;
    const nx = dx / len;
    const nz = dz / len;
    const angle = Math.atan2(fx * nz - fz * nx, fx * nx + fz * nz);
    hud.damageDirection(angle);
  }
  if (playerHealth <= 0) {
    playerHealth = 0;
    hud.setHealth(0);
    onPlayerDeath(attacker);
  }
}

const bomb = createBomb(scene, world, {
  sounds,
  onPlanted(site) {
    hud.showBanner('BOMB PLANTED', `At Site ${site} — defuse it or it detonates.`, 3200);
    hud.setBombStatus(`BOMB AT SITE ${site}`, true);
    sounds.roundStart();
  },
  onDefused() {
    hud.setBombStatus('', false);
    rounds.endRound('blue', 'Bomb defused.');
  },
  onExploded(pos) {
    effects.explode(pos);
    sounds.explosion();
    hud.setBombStatus('', false);
    rounds.endRound('red', 'The bomb detonated.');
  },
});

const bots = createBots(scene, world, {
  random,
  effects,
  getPlayerPos() { return player.state.position; },
  getTargetSite() { return targetSite; },
  getBombSite() { return bomb.state.site; },
  bombPlanted() { return bomb.isPlanted(); },
  isPlanter(bot) { return bomb.state.phase === 'planting' && bomb.state.planter === bot; },
  isDefuser(bot) { return bomb.state.phase === 'planted' && bomb.state.defuser === bot; },
  onDamagePlayer(amount, bot) {
    damagePlayer(amount, bot);
  },
  onKill(killer, victim) {
    const killerName = killer === 'player' ? 'You' : killer.name;
    const killerTeam = killer === 'player' ? 'blue' : killer.team;
    hud.killFeed(`${killerName} ✕ ${victim.name}`, killerTeam);
    if (killer === 'player') {
      kills += 1;
      rounds.addKillReward();
      hud.setScore(kills);
      hud.setMoney(rounds.state.money);
      sounds.kill();
    }
  },
  onBotShotFired(bot) {
    if (shot) return;
    const d = bot.position.distanceTo(player.state.position);
    if (d < 28) sounds.enemyShoot();
  },
});

const grenades = createGrenades(scene, world, {
  effects,
  sounds,
  bots: bots.bots,
  playerPos() { return player.state.position; },
  playerAlive() { return playerAlive; },
  damageBot(bot, amount, part, killer) { return bots.damage(bot, amount, part, killer); },
  damagePlayer(amount) { damagePlayer(amount, null); },
});

const rounds = createRounds({
  bombPlanted() { return bomb.isPlanted(); },
  onBuyPhase(round, money) {
    targetSite = random() > 0.5 ? 'A' : 'B';
    bomb.resetRound(targetSite);
    grenades.resetRound();
    playerAlive = true;
    spectateBot = null;
    playerHealth = 100;
    playerArmor = rounds.state.armor;
    player.state.position.set(0, 0, 12.5);
    player.state.velocity.set(0, 0, 0);
    player.state.yaw = 0;
    player.state.pitch = 0;
    weapon.refill();
    bots.resetRound(round, rounds.state.lastWinner);
    hud.setHealth(100);
    hud.setMoney(money);
    hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.stats.name);
    hud.setTimer(BUY_SECONDS);
    hud.setRoundScore(rounds.state.wins.blue, rounds.state.wins.red, round);
    hud.setTeams(3, 3);
    hud.setRoundHistory(rounds.state.history);
    hud.setBombStatus('', false);
    hud.setGrenades(rounds.state.grenades);
    if (!shot) {
      hud.showOverlay('start', kills);
      hud.setPlayLabel(`Deploy — Round ${round}`);
      renderBuyMenu(money);
      buyMenuVisible = true;
      if (document.pointerLockElement) document.exitPointerLock();
    }
  },
  onCombatStart(round) {
    hud.showBanner(`ROUND ${round}`, 'Eliminate the enemy team — stop the plant', 2000);
    hud.hideBuyMenu();
    buyMenuVisible = false;
    sounds.roundStart();
  },
  onRoundEnd(winner, reason, wins, round) {
    if (winner === 'blue') {
      hud.showBanner('ROUND WON', reason, 3200);
      sounds.roundWin();
    } else if (winner === 'red') {
      hud.showBanner('ROUND LOST', reason, 3200);
      sounds.roundLose();
    } else {
      hud.showBanner('ROUND DRAW', reason, 3200);
      sounds.roundLose();
    }
    hud.setRoundHistory(rounds.state.history);
    if (document.pointerLockElement) document.exitPointerLock();
  },
  onMatchEnd(winner, wins) {
    const result = winner === 'blue' ? 'VICTORY!' : winner === 'red' ? 'DEFEAT.' : 'DRAW.';
    const score = `Final score ${wins.blue} — ${wins.red}.`;
    hud.showOverlay('end', kills, `${result} ${score}`);
    if (document.pointerLockElement) document.exitPointerLock();
    if (winner === 'blue') sounds.roundWin();
    else sounds.roundLose();
  },
  onBuy(type, money) {
    hud.setMoney(money);
    hud.setGrenades(rounds.state.grenades);
  },
});

function renderBuyMenu(money) {
  const items = [
    { id: 'pistol', name: 'Pistol', desc: 'Standard sidearm. 25 damage, 12-round mag.', price: WEAPONS.pistol.price, owned: rounds.state.owned.includes('pistol') },
    { id: 'smg', name: 'SMG', desc: 'Fast fire, 22 damage, 30-round mag. Close quarters.', price: WEAPONS.smg.price, owned: rounds.state.owned.includes('smg') },
    { id: 'rifle', name: 'Rifle', desc: 'High damage, 34 damage, accurate at range.', price: WEAPONS.rifle.price, owned: rounds.state.owned.includes('rifle') },
    { id: 'shotgun', name: 'Shotgun', desc: '8 pellets a shell, devastating up close.', price: WEAPONS.shotgun.price, owned: rounds.state.owned.includes('shotgun') },
    { id: 'armor', name: 'Armor', desc: 'Halves incoming damage until you die.', price: ARMOR_PRICE, owned: rounds.state.armor },
    { id: 'grenade', name: 'Grenade', desc: 'Frag grenade — throw with G. Blast damage, halved through walls.', price: GRENADE_PRICE, owned: rounds.state.grenades > 0 },
  ];
  const buyMoneyEl = document.getElementById('buy-money');
  if (buyMoneyEl) buyMoneyEl.textContent = `Your money: $${money} — kills pay $300, round win $1000, loss $500.`;
  hud.showBuyMenu(items, money, (id) => {
    let res;
    if (id === 'armor') res = rounds.buyArmor();
    else if (id === 'grenade') res = rounds.buyGrenade();
    else res = rounds.buyWeapon(id);
    if (!res.ok) {
      hud.showBuyHint(res.reason);
      sounds.deny();
      return;
    }
    if (id !== 'armor' && id !== 'grenade') weapon.equip(id);
    playerArmor = rounds.state.armor;
    hud.setMoney(rounds.state.money);
    hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.stats.name);
    hud.setGrenades(rounds.state.grenades);
    sounds.buy();
    renderBuyMenu(rounds.state.money);
  });
}

function onPlayerDeath(killer) {
  playerAlive = false;
  spectateBot = null;
  // Dying loses the loadout: back to the pistol, no armor, next round.
  rounds.loseLoadout();
  weapon.equip('pistol');
  if (!shot) {
    hud.showOverlay('dead', kills);
    if (document.pointerLockElement) document.exitPointerLock();
  }
}

function resetMatch() {
  kills = 0;
  playerHealth = 100;
  playerArmor = false;
  playerAlive = true;
  player.state.position.set(0, 0, 12.5);
  player.state.velocity.set(0, 0, 0);
  player.state.yaw = 0;
  player.state.pitch = 0;
  weapon.refill();
  weapon.equip('pistol');
  hud.setScore(0);
  hud.setHealth(100);
  rounds.resetMatch();
}

hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.stats.name);
hud.setHealth(100);
hud.setMoney(800);
hud.setScore(0);
hud.setTimer(BUY_SECONDS);
hud.setRoundScore(0, 0, 1);
hud.setTeams(3, 3);
hud.setRoundHistory([]);
hud.setGrenades(0);

hud.onPlay(() => {
  if (shot) return;
  sounds.unlock();
  const phase = rounds.state.phase;
  if (phase === 'matchEnd') {
    resetMatch();
    return;
  }
  if (phase === 'buy') {
    rounds.startCombat();
    hud.hideOverlay();
    hud.hideBuyMenu();
    buyMenuVisible = false;
    input.requestLock();
    return;
  }
  if (phase === 'combat') {
    if (playerAlive) input.requestLock();
    else hud.hideOverlay();
    return;
  }
  hud.hideOverlay();
});

renderer.domElement.addEventListener('click', () => {
  if (shot) return;
  if (rounds.state.phase === 'combat' && playerAlive && !input.state.locked) input.requestLock();
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
    sounds.unlock();
  } else if (rounds.state.phase === 'combat' && playerAlive) {
    hud.showOverlay('paused', kills);
  }
}

function syncCamera() {
  // Dead and spectating: follow a living teammate instead of the death spot.
  if (!playerAlive && rounds.state.phase === 'combat') {
    if (!spectateBot || !spectateBot.alive) {
      spectateBot = bots.bots.find((b) => b.team === 'blue' && b.alive) || null;
    }
    if (spectateBot) {
      camera.position.set(spectateBot.position.x, spectateBot.position.y + 1.6, spectateBot.position.z);
      camera.rotation.set(0, spectateBot.yaw, 0, 'YXZ');
      return;
    }
  }
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function shoot(spread) {
  if (!weapon.takeRound()) return false;
  const stats = weapon.stats;
  const pellets = stats.pellets || 1;
  camera.getWorldDirection(direction);
  // Muzzle flash, tracer and sparks: one ray per pellet. The shootable list and
  // the matrix world are built once per shot, not once per pellet.
  muzzle.copy(camera.position).addScaledVector(direction, 0.55);
  muzzle.y -= 0.14;
  muzzle.x += Math.cos(body.yaw) * 0.2;
  scene.updateMatrixWorld(true);
  const shootables = world.shootables.concat(bots.hitMeshes);
  for (let p = 0; p < pellets; p += 1) {
    const px = direction.x + (random() * 2 - 1) * spread;
    const py = direction.y + (random() * 2 - 1) * spread;
    const pz = direction.z + (random() * 2 - 1) * spread;
    const len = Math.hypot(px, py, pz) || 1;
    toAttacker.set(px / len, py / len, pz / len);
    raycaster.set(camera.position, toAttacker);
    const hit = raycaster.intersectObjects(shootables, false)[0];
    const end = hit ? hit.point : hitPoint.copy(camera.position).addScaledVector(toAttacker, 60);
    effects.fireTracer(muzzle, end, stats.tracer);
    if (hit) {
      hitPoint.copy(hit.point);
      const bot = hit.object.userData.bot;
      if (bot) {
        const part = hit.object.userData.part;
        const dmg = part === 'head' ? stats.headDamage : stats.damage;
        const killed = bots.damage(bot, dmg, part, 'player');
        hud.hitMarker(killed, markerHoldMs);
        effects.burstSparks(hitPoint, 5, PALETTE.accent);
        if (!killed) sounds.hit();
      } else {
        effects.burstSparks(hitPoint, 3, PALETTE.muted);
      }
    }
  }
  weapon.pullTrigger();
  sounds.shoot(weapon.type);
  const kick = weapon.type === 'shotgun' ? 0.02 : 0.009 + random() * 0.004;
  player.recoil(kick, (random() * 2 - 1) * 0.004);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.stats.name);
  return true;
}

function step(dt) {
  elapsed += dt;
  const phase = rounds.state.phase;
  if (phase === 'combat') {
    if (playerAlive) player.step(dt, input.state.keys);
    weapon.step(dt);
    bots.step(dt, elapsed, { position: player.state.position, alive: playerAlive });
    grenades.step(dt);
    bomb.step(dt, {
      redBots: bots.bots.filter((b) => b.team === 'red'),
      blueBots: bots.bots.filter((b) => b.team === 'blue'),
      playerPos: player.state.position,
      playerAlive,
    });
    // While the bomb ticks, its countdown is the round timer.
    if (bomb.isPlanted()) rounds.state.phaseTime = bomb.state.bombTimer;
  } else {
    weapon.step(dt);
  }
  effects.step(dt);
  const alive = aliveCounts();
  rounds.step(dt, alive);
  hud.setTimer(rounds.state.phaseTime);
  hud.setRoundScore(rounds.state.wins.blue, rounds.state.wins.red, rounds.state.round);
  hud.setTeams(alive.blue, alive.red);
  hud.setMoney(rounds.state.money);
  hud.setRoundHistory(rounds.state.history);
  hud.setGrenades(rounds.state.grenades);
  // Bomb status line: planting progress, planted countdown, or defuse progress.
  const bs = bomb.state;
  if (bs.phase === 'planting') {
    hud.setBombStatus(`ENEMY PLANTING AT SITE ${bs.site} — ${Math.round(bs.plantProgress * 100)}%`, true);
  } else if (bs.phase === 'planted') {
    const t = Math.max(0, Math.ceil(bs.bombTimer));
    const defusing = bs.defuseProgress > 0 ? ` — DEFUSING ${Math.round(bs.defuseProgress * 100)}%` : '';
    hud.setBombStatus(`BOMB AT SITE ${bs.site} — 0:${String(t).padStart(2, '0')}${defusing}`, t <= 10);
  } else if (phase === 'combat' && bs.phase === 'idle') {
    hud.setBombStatus('', false);
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    if (playerAlive && input.state.locked) player.look(look.x, look.y);
    if (playerAlive && input.state.locked && rounds.state.phase === 'combat') {
      const firing = input.state.firing;
      const auto = weapon.stats.auto;
      if (firing && (auto || !wasFiring) && weapon.ready()) shoot(weapon.spread(player.groundSpeed()));
      wasFiring = firing;
      if (input.state.keys.has('KeyR')) weapon.reload();
    } else {
      wasFiring = false;
    }
    // Edge-triggered actions read the fresh-press queue: a press is never
    // swallowed when frames are slow, and a held key never repeats.
    const pressed = input.takePressed();
    if (pressed.has('KeyB')) {
      if (rounds.state.phase === 'buy') {
        if (buyMenuVisible) { hud.hideBuyMenu(); buyMenuVisible = false; }
        else { renderBuyMenu(rounds.state.money); buyMenuVisible = true; }
      } else if (rounds.state.phase === 'combat') {
        hud.showBuyHint('Buy menu is only available between rounds.');
      }
    }
    if (pressed.has('KeyG')) {
      if (rounds.state.phase === 'combat' && playerAlive) {
        if (rounds.useGrenade()) {
          camera.getWorldDirection(direction);
          grenades.throwGrenade(camera.position, direction);
          hud.setGrenades(rounds.state.grenades);
        } else {
          hud.showBuyHint('No grenade — buy one between rounds.');
        }
      }
    }
    // Number keys switch between weapons the player owns (1 pistol, 2 SMG,
    // 3 rifle, 4 shotgun); switching is free, buying is not.
    for (const digitKey of ['Digit1', 'Digit2', 'Digit3', 'Digit4']) {
      if (!pressed.has(digitKey)) continue;
      const type = WEAPON_KEYS[digitKey];
      if (playerAlive && rounds.state.phase !== 'matchEnd') {
        const res = rounds.equipWeapon(type);
        if (res.ok) {
          weapon.equip(type);
          hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.stats.name);
          sounds.click();
        } else if (!res.reason.startsWith('Already carrying')) {
          hud.showBuyHint(res.reason);
          sounds.deny();
        }
      }
    }
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBuyMenu();
  body.pitch = 0;
  body.yaw = 0;
  bots.setPositionsForShot();
  if (name === 'start') {
    body.position.set(0.6, 0, 11.5);
    settle(20);
    aimAt(new THREE.Vector3(0, 1.5, -6));
    hud.setHealth(100);
    hud.setMoney(800);
    hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.stats.name);
    hud.setTimer(BUY_SECONDS);
    hud.setRoundScore(0, 0, 1);
    hud.setTeams(3, 3);
    hud.setScore(0);
    hud.setRoundHistory([]);
    hud.setGrenades(0);
    hud.showOverlay('start', 0);
    hud.setPlayLabel('Deploy — Round 1');
    renderBuyMenu(800);
    buyMenuVisible = true;
  } else if (name === 'play') {
    weapon.equip('rifle');
    rounds.state.phase = 'combat';
    rounds.state.phaseTime = 87;
    rounds.state.round = 2;
    rounds.state.wins = { blue: 1, red: 0 };
    rounds.state.money = 1800;
    rounds.state.history = ['W'];
    rounds.state.grenades = 1;
    body.position.set(0, 0, -1);
    settle(20);
    const target = bots.bots.find((b) => b.name === 'Blitz');
    if (target) {
      // Re-aim before every shot: the bot moves between steps, so a stale aim point misses.
      for (let r = 0; r < 3; r += 1) {
        aimAt(new THREE.Vector3(target.position.x, 1.2, target.position.z));
        shoot(0);
      }
    }
    settle(12);
    const other = bots.bots.find((b) => b.name === 'Havoc' && b.alive);
    if (other) aimAt(new THREE.Vector3(other.position.x, 1.2, other.position.z));
    // The bomb is planted at Site A: the objective reads in the frame.
    bomb.debugPlant('A', -13, -9.5, 28);
    playerHealth = 82;
    hud.setHealth(82);
    hud.setMoney(rounds.state.money);
    hud.setTimer(87);
    hud.setRoundScore(1, 0, 2);
    hud.setTeams(3, 2);
    hud.setScore(kills);
    hud.setRoundHistory(['W']);
    hud.setGrenades(1);
    hud.setBombStatus('BOMB AT SITE A — 0:28', false);
    hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.stats.name);
  } else {
    // Match end: blue takes the match 5 — 2. The overlay shows the result, the
    // player's score and the restart button — the whole loop in one frame.
    rounds.state.phase = 'roundEnd';
    rounds.state.wins = { blue: 5, red: 2 };
    rounds.state.round = 7;
    rounds.state.history = ['W', 'L', 'W', 'W', 'L', 'W', 'W'];
    rounds.state.money = 4600;
    kills = 7;
    const rook = bots.bots.find((b) => b.name === 'Rook');
    const havoc = bots.bots.find((b) => b.name === 'Havoc');
    for (const b of [rook, havoc]) {
      if (!b) continue;
      b.alive = false;
      b.fall = 1;
      b.group.rotation.x = -1.45;
      b.group.position.y = -0.08;
    }
    body.position.set(0, 0, 2);
    settle(20);
    aimAt(new THREE.Vector3(0, 1.2, -6));
    playerHealth = 64;
    hud.setHealth(64);
    hud.setMoney(4600);
    hud.setTimer(0);
    hud.setRoundScore(5, 2, 7);
    hud.setTeams(2, 1);
    hud.setScore(7);
    hud.setRoundHistory(['W', 'L', 'W', 'W', 'L', 'W', 'W']);
    hud.setGrenades(0);
    hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.stats.name);
    rounds.state.phase = 'matchEnd';
    hud.showOverlay('end', kills, 'VICTORY! Final score 5 — 2.');
  }
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Read-only snapshot for live verification (headless play-tests poll this).
window.__game = {
  get state() {
    return {
      phase: rounds.state.phase,
      round: rounds.state.round,
      wins: { ...rounds.state.wins },
      money: rounds.state.money,
      history: [...rounds.state.history],
      weapon: weapon.type,
      ammo: weapon.state.mag,
      reserve: weapon.state.reserve,
      owned: [...rounds.state.owned],
      armor: rounds.state.armor,
      playerAlive,
      playerHealth: Math.round(playerHealth),
      playerPos: [Number(body.position.x.toFixed(1)), Number(body.position.y.toFixed(1)), Number(body.position.z.toFixed(1))],
      aliveBlue: bots.aliveCount('blue') + (playerAlive ? 1 : 0),
      aliveRed: bots.aliveCount('red'),
      bomb: { phase: bomb.state.phase, site: bomb.state.site, timer: Math.round(bomb.state.bombTimer), plant: Math.round(bomb.state.plantProgress * 100), defuse: Math.round(bomb.state.defuseProgress * 100) },
      grenades: rounds.state.grenades,
      bots: bots.bots.map((b) => ({ name: b.name, team: b.team, alive: b.alive, health: Math.round(b.health), weapon: b.weapon, x: Number(b.position.x.toFixed(1)), z: Number(b.position.z.toFixed(1)) })),
    };
  },
};

// Debug hooks for headless verification only, gated on ?debug=1. The shipped game
// never reads them; they let a test drive the simulation (fast-forward steps,
// force round outcomes, place bots) without pointer lock or wall-clock waits.
if (params.get('debug') === '1') {
  window.__debug = {
    state: () => window.__game.state,
    cameraPos: () => [camera.position.x, camera.position.y, camera.position.z],
    step(n) { for (let i = 0; i < n; i += 1) step(FIXED_STEP); },
    startCombat() { if (rounds.state.phase === 'buy') rounds.startCombat(); },
    winRound(team) { if (rounds.state.phase === 'combat') rounds.endRound(team, 'debug win'); },
    setWins(b, r) { rounds.state.wins.blue = b; rounds.state.wins.red = r; },
    setRound(n) { rounds.state.round = n; },
    setPhaseTime(s) { rounds.state.phaseTime = s; },
    killBot(name) { const b = bots.bots.find((x) => x.name === name); if (b && b.alive) bots.damage(b, 9999, 'torso', 'player'); },
    killTeam(team) { for (const b of bots.bots) if (b.team === team && b.alive) bots.damage(b, 9999, 'torso', 'player'); },
    killPlayer() { damagePlayer(9999, null); },
    teleportBot(name, x, z) { const b = bots.bots.find((x2) => x2.name === name); if (b) { b.position.set(x, 0, z); b.group.position.copy(b.position); } },
    teleportPlayer(x, z) { body.position.set(x, 0, z); body.velocity.set(0, 0, 0); },
    aimAt(x, y, z) { aimAt(new THREE.Vector3(x, y, z)); },
    shootAt(x, y, z) { aimAt(new THREE.Vector3(x, y, z)); return shoot(0); },
    reload() { weapon.reload(); },
    giveGrenade() { rounds.state.grenades = 1; },
    throwGrenade() { if (rounds.useGrenade()) { camera.getWorldDirection(direction); grenades.throwGrenade(camera.position, direction); return true; } return false; },
    giveMoney(n) { rounds.state.money = n; },
    buy(id) {
      let res;
      if (id === 'armor') res = rounds.buyArmor();
      else if (id === 'grenade') res = rounds.buyGrenade();
      else res = rounds.buyWeapon(id);
      if (res.ok && id !== 'armor' && id !== 'grenade') weapon.equip(id);
      return res.ok;
    },
    plantBomb(site, x, z, timer) { bomb.debugPlant(site, x, z, timer); },
    hideOverlay() { hud.hideOverlay(); },
  };
}

syncCamera();
if (shot) runShot(shot);
else {
  hud.showOverlay('start', 0);
  hud.setPlayLabel('Deploy — Round 1');
  renderBuyMenu(800);
  buyMenuVisible = true;
  requestAnimationFrame(frame);
}
