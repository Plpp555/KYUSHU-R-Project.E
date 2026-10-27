// Course definition: 福岡都市高速 環状線 (outer loop) inspired run, 百道 → 月隈.
// The layout is a stylised arcade interpretation, not a survey-accurate map.
// World axes: +X = east, -Z = north. The sea (博多湾) lies to the north of the start.

// [length m, turn degrees (+ = left), deck height at segment end (m)]
export const SEGMENTS = [
  [320, 0, 15],      // 百道ランプ スタート
  [420, 7, 15],
  [520, -18, 16],
  [420, 0, 16],      // 福岡タワー / ドーム
  [560, 14, 14],
  [300, 0, 9],       // 西公園 アプローチ
  [700, -32, 8],     // 西公園トンネル
  [320, 0, 18],
  [900, 9, 33],      // 荒津大橋
  [360, -70, 21],
  [260, 30, 18],     // 天神北
  [260, -36, 18],
  [420, 22, 20],     // 築港
  [640, -46, 25],    // 千鳥橋JCT
  [320, 10, 21],
  [1500, -8, 18],    // 博多
  [440, 44, 16],
  [700, -26, 19],    // 月隈
  [900, 0, 16],      // GOAL → 退避
];

export const START_S = 60;
export const GOAL_S = 9960;

// Scenery zones (s ranges). Names are shown on the HUD when entering a zone.
export const ZONES = [
  { s0: 0, s1: 1200, type: 'coast', name: '百道', en: 'MOMOCHI' },
  { s0: 1200, s1: 2500, type: 'coast', name: '福岡タワー・ドーム', en: 'FUKUOKA TOWER' },
  { s0: 2500, s1: 3240, type: 'tunnel', name: '西公園トンネル', en: 'NISHI-KOEN TUNNEL' },
  { s0: 3240, s1: 4600, type: 'bridge', name: '荒津大橋', en: 'ARATSU BRIDGE' },
  { s0: 4600, s1: 5760, type: 'city', name: '天神北・築港', en: 'TENJIN-KITA' },
  { s0: 5760, s1: 6450, type: 'jct', name: '千鳥橋JCT', en: 'CHIDORIBASHI JCT' },
  { s0: 6450, s1: 8400, type: 'hakata', name: '博多', en: 'HAKATA' },
  { s0: 8400, s1: 11000, type: 'suburb', name: '月隈', en: 'TSUKIGUMA' },
];

export const TUNNEL = { s0: 2560, s1: 3200 };
export const BRIDGE = { s0: 3420, s1: 4420, pylons: [3720, 4120], mainSpan: [3520, 4320] };

// Checkpoints add time in TIME ATTACK / BATTLE (arcade time extension).
export const CHECKPOINTS = [2500, 4600, 6450, 8400];
export const TIME_START = 75;
export const TIME_EXTEND = [32, 32, 32, 30];

// Overhead guide signs (green) and LED boards.
export const SIGNS = [
  { s: 420, kind: 'guide', lines: [['天神', 'Tenjin', '4km'], ['博多', 'Hakata', '8km']], route: '環状' },
  { s: 1500, kind: 'led', text: 'この先 トンネル  速度注意' },
  { s: 2380, kind: 'guide', lines: [['西公園', 'Nishi-koen', '出口 EXIT'], ['荒津大橋', 'Aratsu Bridge', '1km']], route: '環状', exit: true },
  { s: 3300, kind: 'led', text: '強風注意  荒津大橋' },
  { s: 4700, kind: 'guide', lines: [['天神北', 'Tenjin-kita', '出口 EXIT'], ['千鳥橋JCT', 'Chidoribashi', '2km']], route: '環状', exit: true },
  { s: 5560, kind: 'guide', lines: [['香椎・空港', 'Kashii/Airport', '1号線'], ['博多・太宰府', 'Hakata/Dazaifu', '環状線']], route: 'JCT' },
  { s: 7000, kind: 'led', text: '福岡IC  12分  順調' },
  { s: 7600, kind: 'guide', lines: [['博多駅', 'Hakata Sta.', '出口 EXIT'], ['月隈JCT', 'Tsukiguma', '3km']], route: '環状', exit: true },
  { s: 9200, kind: 'guide', lines: [['月隈JCT', 'Tsukiguma JCT', '1km'], ['太宰府', 'Dazaifu', '2号線']], route: '環状' },
];

export const RIVAL = {
  name: 'LAMBORGHINI COUNTACH LPI 800-4',
  title: '白い亡霊',
  lines: ['環状線に現れる 白いカウンタック…', '「ついてこれるか？ ブラックバード」'],
};
