// DOM-based arcade screens with keyboard / gamepad / touch navigation.
export class UI {
  constructor(root, audio) {
    this.root = root;
    this.audio = audio;
    this.items = [];
    this.sel = 0;
    this.onBack = null;
    this.current = null;
  }

  clear() { this.root.innerHTML = ''; this.items = []; this.current = null; this.onBack = null; }

  screen(html, cls = '') {
    this.root.innerHTML = `<div class="screen ${cls}">${html}</div>`;
    return this.root.firstElementChild;
  }

  title() {
    this.clear();
    this.current = 'title';
    this.screen(`
      <div class="title-wrap">
        <div class="logo">KYUSHU-R</div>
        <div class="logo-sub">福岡都市高速 NIGHT BATTLE<small>FUKUOKA URBAN EXPRESSWAY</small></div>
      </div>
      <div class="press">${'ontouchstart' in window ? 'TAP TO START' : 'PRESS START'}</div>
      <div class="credit">FREE PLAY</div>
      <div class="copyright">KYUSHU-R PROJECT.E — fan-made arcade racer</div>`);
  }

  /** items: [{label, jp, value, action(dir), back}] */
  menu(title, items, { hint = '↑↓ SELECT   ENTER/TAP OK', onBack = null, cls = '' } = {}) {
    this.clear();
    this.current = 'menu';
    const el = this.screen(`<div class="menu ${cls}"><h2>${title}</h2><div class="items"></div><div class="hint">${hint}</div></div>`);
    const box = el.querySelector('.items');
    this.items = items.map((it, i) => {
      const b = document.createElement('div');
      b.className = 'btn';
      b.innerHTML = `<span>${it.label}${it.jp ? ` <span class="jp">${it.jp}</span>` : ''}</span>${it.value !== undefined ? `<span class="val">${it.value}</span>` : ''}`;
      b.addEventListener('pointerdown', e => { e.preventDefault(); this.sel = i; this.highlight(); this.activate(1); });
      box.appendChild(b);
      return { ...it, el: b };
    });
    this.sel = 0;
    this.onBack = onBack;
    this.highlight();
  }

  setValue(i, v) {
    const it = this.items[i];
    it.value = v;
    const val = it.el.querySelector('.val');
    if (val) val.textContent = v;
  }

  highlight() { this.items.forEach((it, i) => it.el.classList.toggle('sel', i === this.sel)); }

  activate(dir) {
    const it = this.items[this.sel];
    if (!it) return;
    this.audio.confirm();
    it.action && it.action(dir, this.sel);
  }

  /** Handles navigation edges for menus. Returns true if consumed. */
  handle(input) {
    if (this.current !== 'menu') return false;
    if (input.pressed('ArrowUp', 'KeyW')) { this.sel = (this.sel + this.items.length - 1) % this.items.length; this.highlight(); this.audio.select(); return true; }
    if (input.pressed('ArrowDown', 'KeyS')) { this.sel = (this.sel + 1) % this.items.length; this.highlight(); this.audio.select(); return true; }
    if (input.pressed('ArrowRight', 'KeyD')) { const it = this.items[this.sel]; if (it.value !== undefined) { this.activate(1); return true; } }
    if (input.pressed('ArrowLeft', 'KeyA')) { const it = this.items[this.sel]; if (it.value !== undefined) { this.activate(-1); return true; } }
    if (input.pressed('Enter', 'NumpadEnter')) { this.activate(1); return true; }
    if (input.pressed('Escape', 'Backspace') && this.onBack) { this.audio.select(); this.onBack(); return true; }
    return false;
  }

  rivalCard(r) {
    this.clear();
    this.current = 'rival';
    this.screen(`<div class="rival-card"><div class="box">
      <div class="vs">VS</div>
      <div class="tt">『${r.title}』</div>
      <div class="car">${r.name}</div>
      <div class="line">${r.lines[0]}</div>
      <div class="line">${r.lines[1]}</div>
    </div></div>`);
  }

  result(res) {
    this.clear();
    this.current = 'result';
    const big = res.outcome === 'win' ? '<div class="big win">YOU WIN</div>' :
      res.outcome === 'lose' ? '<div class="big lose">YOU LOSE</div>' :
      res.outcome === 'timeup' ? '<div class="big lose">TIME UP</div>' : '<div class="big win">GOAL!!</div>';
    const fmt = t => { const m = Math.floor(t / 60), s = Math.floor(t % 60), c = Math.floor((t * 100) % 100); return `${String(m).padStart(2, '0')}'${String(s).padStart(2, '0')}"${String(c).padStart(2, '0')}`; };
    this.screen(`<div class="result">${big}
      ${res.reason ? `<div class="hint" style="font-family:var(--font-jp);font-size:min(3vw,22px);opacity:.9">${res.reason}</div>` : ''}
      <table>
        <tr><td>タイム TIME</td><td>${fmt(res.time)}</td></tr>
        ${res.best !== undefined ? `<tr><td>ベスト BEST</td><td>${res.best ? fmt(res.best) : '--'}</td></tr>` : ''}
        <tr><td>最高速 TOP SPEED</td><td>${res.top.toFixed(0)} km/h</td></tr>
        <tr><td>ニアミス NEAR MISS</td><td>${res.nearMiss}</td></tr>
        <tr><td>クラッシュ CRASH</td><td>${res.crashes}</td></tr>
        ${res.gap !== null ? `<tr><td>差 GAP</td><td>${res.gap >= 0 ? '+' : '−'}${Math.abs(res.gap).toFixed(0)} m</td></tr>` : ''}
      </table>
      <div class="grade">${res.grade}</div>
      <div class="press" style="bottom:6%">${'ontouchstart' in window ? 'TAP' : 'PRESS START'}</div>
    </div>`);
  }

  continueScreen(n) {
    if (this.current !== 'continue') {
      this.clear();
      this.current = 'continue';
      this.screen(`<div class="continue"><div class="c1">CONTINUE?</div><div class="c2">9</div><div class="hint">TAP / ENTER = RETRY</div></div>`);
    }
    const c = this.root.querySelector('.c2');
    if (c) c.textContent = String(n);
  }

  credits(onBack) {
    this.clear();
    this.current = 'credits';
    this.onBack = onBack;
    this.screen(`<div class="menu"><h2>CREDITS</h2>
      <div style="max-width:84vw;font-size:min(2.2vw,15px);line-height:1.7;font-family:sans-serif;opacity:.92;max-height:62vh;overflow:auto;pointer-events:auto">
      <b>3D MODELS</b> (Sketchfab)<br>
      “Porsche 911 930 Turbo 1975” by Lexyc16 — CC BY 4.0<br>
      “2021 Lamborghini Countach LPI 800-4” by Lexyc16 — CC BY-NC 4.0<br>
      “Honda Integra (DB8) Type-R” by Myedsu — CC BY 4.0<br>
      “2023 Toyota RAV4 Hybrid” by Ddiaz Design — CC BY-NC-SA 4.0<br>
      “2005 Toyota TownAce GL” by OUTPISTON — CC BY-NC-SA 4.0<br>
      Models were scaled, re-oriented, simplified and re-textured for real-time use.<br><br>
      <b>FONTS</b> Orbitron, Russo One, Dela Gothic One — SIL Open Font License<br>
      <b>ENGINE</b> three.js (MIT), postprocessing (Zlib), N8AO (CC0)<br><br>
      Fan-made, non-commercial. Course, city and landmarks are stylised interpretations of the
      Fukuoka Urban Expressway. Not affiliated with any manufacturer or the expressway operator.
      </div><div class="hint">BACK: ESC / TAP</div></div>`);
    this.root.firstElementChild.addEventListener('pointerdown', () => onBack());
  }

  pauseMenu(actions) {
    this.menu('PAUSE', [
      { label: 'RESUME', jp: '再開', action: actions.resume },
      { label: 'RETRY', jp: 'リトライ', action: actions.retry },
      { label: 'SETTINGS', jp: '設定', action: actions.settings },
      { label: 'QUIT', jp: 'タイトルへ', action: actions.quit },
    ], { onBack: actions.resume });
  }
}
