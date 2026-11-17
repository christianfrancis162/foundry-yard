// The DOM HUD: crosshair, hit marker, health, ammo, money, round timer, round score,
// team alive counts, kill feed, buy menu, round banner, damage vignette, damage
// direction, round history and the bomb status. It never touches the simulation;
// main.js pushes numbers in and reads callbacks out.
const COPY = {
  start: {
    title: 'Foundry Yard — Tactical FPS',
    copy: 'You and two teammates against three enemy bots. Red attacks a bombsite — stop the plant, or defuse the bomb. First to 5 round wins takes the match.',
    action: 'Deploy — fight!',
  },
  paused: {
    title: 'Tactical FPS',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  end: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
  dead: {
    title: 'You are down',
    copy: 'Spectating — your teammates are still fighting.',
    action: 'Keep watching',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammo = $('ammo');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const scoreValue = $('score-value');
  const hitmarker = $('hitmarker');
  const healthFill = $('health-fill');
  const healthValue = $('health-value');
  const moneyValue = $('money-value');
  const timerValue = $('timer');
  const roundScore = $('round-score');
  const teamBlue = $('team-blue');
  const teamRed = $('team-red');
  const killfeed = $('killfeed');
  const buyMenu = $('buy-menu');
  const buyItems = $('buy-items');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const vignette = $('vignette');
  const buyHint = $('buy-hint');
  const roundHistory = $('round-history');
  const bombStatus = $('bomb-status');
  const damageDir = $('damage-dir');
  const grenadeCount = $('grenade-count');

  let hitTimer = 0;
  let bannerTimer = 0;
  let damageTimer = 0;
  let lastMag = -1;
  let lastReserve = -1;
  let lastWeapon = '';
  let lastHealth = -1;
  let lastMoney = -1;
  let lastTimer = -1;
  let lastRoundScore = '';
  let lastTeams = '';
  let lastHistory = '';
  let lastBomb = '';
  let lastGrenades = -1;

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  return {
    setAmmo(mag, reserve, name) {
      if (mag === lastMag && reserve === lastReserve && name === lastWeapon) return;
      lastMag = mag; lastReserve = reserve; lastWeapon = name;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      weaponName.textContent = name;
      ammo.classList.toggle('empty', mag === 0);
    },
    setHealth(hp) {
      const v = Math.max(0, Math.round(hp));
      if (v === lastHealth) return;
      lastHealth = v;
      healthFill.style.width = `${v}%`;
      healthValue.textContent = String(v);
      healthFill.classList.toggle('low', v <= 30);
    },
    setMoney(n) {
      if (n === lastMoney) return;
      lastMoney = n;
      moneyValue.textContent = `$${n}`;
    },
    setTimer(seconds) {
      const v = Math.max(0, Math.ceil(seconds));
      if (v === lastTimer) return;
      lastTimer = v;
      const m = Math.floor(v / 60);
      const s = String(v % 60).padStart(2, '0');
      timerValue.textContent = `${m}:${s}`;
      timerValue.classList.toggle('low', v <= 10);
    },
    setRoundScore(blue, red, round) {
      const text = `${blue} — ${red}`;
      if (text === lastRoundScore) return;
      lastRoundScore = text;
      roundScore.textContent = text;
      roundScore.title = `Round ${round}`;
    },
    setTeams(blueAlive, redAlive) {
      const text = `${blueAlive}|${redAlive}`;
      if (text === lastTeams) return;
      lastTeams = text;
      teamBlue.textContent = '●'.repeat(Math.max(0, blueAlive)) + '○'.repeat(Math.max(0, 3 - blueAlive));
      teamRed.textContent = '●'.repeat(Math.max(0, redAlive)) + '○'.repeat(Math.max(0, 3 - redAlive));
    },
    setScore(value) {
      scoreValue.textContent = String(value);
    },
    setRoundHistory(history) {
      const text = history.join('');
      if (text === lastHistory) return;
      lastHistory = text;
      roundHistory.innerHTML = '';
      for (const result of history) {
        roundHistory.appendChild(el('span', result === 'W' ? 'rh-w' : result === 'L' ? 'rh-l' : 'rh-d', result));
      }
    },
    setBombStatus(text, urgent) {
      if (text === lastBomb) return;
      lastBomb = text;
      bombStatus.textContent = text;
      bombStatus.hidden = text === '';
      bombStatus.classList.toggle('urgent', !!urgent);
    },
    setGrenades(n) {
      if (n === lastGrenades) return;
      lastGrenades = n;
      grenadeCount.textContent = n > 0 ? `◉ Grenade ×${n} — press G` : '';
      grenadeCount.hidden = n <= 0;
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.style.transform = killed ? 'translate(-50%, -50%) rotate(45deg) scale(1.25)' : '';
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        hitmarker.classList.remove('on');
        hitmarker.style.transform = '';
      }, holdMs);
    },
    damageFlash() {
      vignette.classList.add('on');
      setTimeout(() => vignette.classList.remove('on'), 140);
    },
    // A red wedge at the screen edge pointing at whoever shot the player.
    // angle is radians clockwise from straight ahead, in the player's view.
    damageDirection(angle) {
      damageDir.style.transform = `translate(-50%, -50%) rotate(${angle}rad) translateY(-110px)`;
      damageDir.classList.add('on');
      clearTimeout(damageTimer);
      damageTimer = setTimeout(() => damageDir.classList.remove('on'), 700);
    },
    killFeed(text, killerTeam) {
      const item = el('div', `feed-item ${killerTeam === 'blue' ? 'feed-blue' : 'feed-red'}`, text);
      killfeed.prepend(item);
      while (killfeed.children.length > 5) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => { if (item.parentNode) item.remove(); }, 5000);
    },
    showBanner(titleText, subText, holdMs = 2600) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = subText || '';
      banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => { banner.hidden = true; }, holdMs);
    },
    hideBanner() {
      clearTimeout(bannerTimer);
      banner.hidden = true;
    },
    showBuyMenu(items, money, onBuy) {
      buyItems.innerHTML = '';
      for (const item of items) {
        const row = el('button', 'buy-item');
        row.type = 'button';
        row.disabled = item.owned || money < item.price;
        const name = el('span', 'buy-name', item.name);
        const desc = el('span', 'buy-desc', item.desc);
        const price = el('span', 'buy-price', item.owned ? 'OWNED' : `$${item.price}`);
        row.append(name, desc, price);
        row.addEventListener('click', () => onBuy(item.id));
        buyItems.appendChild(row);
      }
      buyMenu.hidden = false;
    },
    hideBuyMenu() {
      buyMenu.hidden = true;
    },
    showBuyHint(text) {
      buyHint.textContent = text;
      buyHint.hidden = false;
      setTimeout(() => { buyHint.hidden = true; }, 2200);
    },
    showOverlay(mode, score, extra) {
      const text = COPY[mode];
      title.textContent = text.title;
      if (mode === 'end') copy.textContent = `${extra || ''} You scored ${score}.`;
      else copy.textContent = text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
    setPlayLabel(label) {
      play.textContent = label;
    },
  };
}
