// The bomb: red attacks a site and plants; blue defuses or the blast ends the round.
// States: idle -> planting -> planted -> defused | exploded. The planting bot stands
// still while it plants; a defusing bot or the player stands still by the bomb.
// main.js owns the round end — this module owns the bomb's timers and its mesh.
import * as THREE from 'three';
import { inSite } from './world.js';
import { PLANT_SECONDS, DEFUSE_SECONDS, BOMB_SECONDS } from './rounds.js';

const DEFUSE_RADIUS = 2.5;

export function createBomb(scene, world, hooks) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#1a1d20'), roughness: 0.5, metalness: 0.5 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.2, 0.26), bodyMat);
  body.position.y = 0.1;
  body.castShadow = true;
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#f0a830') });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), lampMat);
  lamp.position.y = 0.26;
  const light = new THREE.PointLight(new THREE.Color('#f0a830'), 0, 8);
  light.position.y = 0.4;
  group.add(body, lamp, light);
  group.visible = false;
  scene.add(group);

  const bombPos = new THREE.Vector3();
  const state = {
    phase: 'idle', // 'idle' | 'planting' | 'planted' | 'defused' | 'exploded'
    site: 'A',
    plantProgress: 0,
    defuseProgress: 0,
    bombTimer: BOMB_SECONDS,
    planter: null,
    defuser: null,
  };
  let blinkTime = 0;
  let beepIn = 0;

  function siteRect() {
    return world.sites[state.site];
  }

  return {
    state,
    get bombPosition() { return bombPos; },
    resetRound(site) {
      state.phase = 'idle';
      state.site = site;
      state.plantProgress = 0;
      state.defuseProgress = 0;
      state.bombTimer = BOMB_SECONDS;
      state.planter = null;
      state.defuser = null;
      beepIn = 0;
      group.visible = false;
    },
    isPlanted() {
      return state.phase === 'planted';
    },
    // Screenshot setup only: force a planted bomb at a site with a set timer.
    debugPlant(site, x, z, timer) {
      state.phase = 'planted';
      state.site = site;
      state.plantProgress = 1;
      state.defuseProgress = 0;
      state.bombTimer = timer;
      state.planter = null;
      state.defuser = null;
      bombPos.set(x, 0, z);
      group.position.copy(bombPos);
      group.visible = true;
    },
    step(dt, ctx) {
      // ctx: { redBots, blueBots, playerPos, playerAlive }
      blinkTime += dt;
      if (state.phase === 'idle' || state.phase === 'planting') {
        // A red bot inside the target site plants. It must stay put; if it leaves
        // or dies, the plant stalls and progress resets.
        const site = siteRect();
        const planter = ctx.redBots.find((b) => b.alive && inSite(site, b.position.x, b.position.z));
        if (planter) {
          state.phase = 'planting';
          state.planter = planter;
          state.plantProgress = Math.min(1, state.plantProgress + dt / PLANT_SECONDS);
          if (Math.floor(state.plantProgress * 6) !== Math.floor((state.plantProgress - dt / PLANT_SECONDS) * 6)) {
            hooks.sounds.plantBeep();
          }
          if (state.plantProgress >= 1) {
            state.phase = 'planted';
            state.bombTimer = BOMB_SECONDS;
            state.planter = null;
            bombPos.copy(planter.position);
            group.position.copy(bombPos);
            group.visible = true;
            hooks.onPlanted?.(state.site);
          }
        } else {
          state.phase = 'idle';
          state.planter = null;
          state.plantProgress = 0;
        }
        return;
      }
      if (state.phase === 'planted') {
        state.bombTimer -= dt;
        // Blink faster as the timer runs down; the beep speeds up and rises in
        // pitch with it — one beep a second above 10 s, four a second under 5 s.
        const rate = state.bombTimer < 5 ? 12 : state.bombTimer < 10 ? 7 : 3.5;
        const on = Math.sin(blinkTime * rate) > 0;
        lampMat.color.set(on ? '#d95f4a' : '#f0a830');
        light.intensity = on ? 2.5 : 0.3;
        beepIn -= dt;
        if (beepIn <= 0) {
          const interval = state.bombTimer < 5 ? 0.25 : state.bombTimer < 10 ? 0.5 : 1;
          beepIn = interval;
          const pitch = 1100 + (1 - Math.max(0, state.bombTimer) / BOMB_SECONDS) * 600;
          hooks.sounds.bombBeep(pitch);
        }
        // Defuse: a blue bot or the player standing by the bomb, unmoving.
        let defuser = null;
        for (const b of ctx.blueBots) {
          if (b.alive && b.position.distanceTo(bombPos) < DEFUSE_RADIUS) { defuser = b; break; }
        }
        if (!defuser && ctx.playerAlive && ctx.playerPos.distanceTo(bombPos) < DEFUSE_RADIUS) {
          defuser = 'player';
        }
        if (defuser) {
          state.defuser = defuser;
          state.defuseProgress = Math.min(1, state.defuseProgress + dt / DEFUSE_SECONDS);
          if (Math.floor(state.defuseProgress * 8) !== Math.floor((state.defuseProgress - dt / DEFUSE_SECONDS) * 8)) {
            hooks.sounds.defuseTick();
          }
          if (state.defuseProgress >= 1) {
            state.phase = 'defused';
            state.defuser = null;
            group.visible = false;
            hooks.onDefused?.();
          }
        } else {
          state.defuser = null;
          state.defuseProgress = Math.max(0, state.defuseProgress - dt / DEFUSE_SECONDS);
        }
        if (state.bombTimer <= 0) {
          state.phase = 'exploded';
          group.visible = false;
          hooks.onExploded?.(bombPos);
        }
      }
    },
  };
}
