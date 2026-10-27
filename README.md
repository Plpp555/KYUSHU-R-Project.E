# KYUSHU-R Project.E — 福岡都市高速 NIGHT BATTLE

画質に全振りした、アーケード風の福岡都市高速レーシングゲーム（Android APK）。

- 自車: **Porsche 911 Turbo (930)** — 黒の「ブラックバード」
- ライバル: **Lamborghini Countach LPI 800-4** — 『白い亡霊』
- 一般車(NPC): **Honda Integra Type R (DB8)** / **Toyota RAV4 Hybrid** / **Toyota TownAce GL**

コース: 環状線（外回りイメージ）百道 → 福岡タワー・ドーム → 西公園トンネル → 荒津大橋 → 天神北・築港 → 千鳥橋JCT → 博多 → 月隈（約10km）。
実際の地図を忠実に再現したものではなく、アーケード向けに再構成したコースです。

## 遊び方

| モード | 内容 |
| --- | --- |
| BATTLE | カウンタックとの一騎打ち。先にゴールするか、**500m 引き離せば勝ち**。制限時間あり（チェックポイントで延長） |
| TIME ATTACK | 制限時間内にゴールを目指す |
| FREE RUN | 時間制限なし |

操作（Android）: 左下 ◀ ▶ でステアリング、右下 ACCEL / BRAKE。設定で **傾きステアリング (TILT)**、**運転支援 (ASSIST)**、**オートアクセル**、視点、天候・路面（WET 雨上がり / RAIN 雨 / DAMP / DRY）、BGM、画質、解像度自動調整を変更できます。
戻るボタンでポーズ。ゲームパッド（標準マッピング）にも対応。

キーボード（ブラウザ実行時）: ↑ アクセル / ↓ ブレーキ / ←→ ステア / Space ドリフト / C 視点 / Esc ポーズ / Enter 決定。

## 車の挙動（リアル寄りの物理）

演出はアーケード、挙動はシミュレーション寄りです。

- 2軸の車両運動モデル（前後輪それぞれのスリップ角 → Pacejka 型タイヤ特性）。前後・左右の荷重移動、タイヤの荷重感度、空力ダウンフォース、摩擦円（ブレーキ・駆動とコーナリングの奪い合い）
- 930 ターボらしさ: リアエンジン（前39:後61）、ターボラグのあるトルクカーブ（約600PS仕様）、アクセルオンでのパワーオーバー、アクセルオフでのタックイン。6速自動変速、発進時のクラッチ滑り、ホイールスピン、エンジンブレーキ、ABS
- 路面: WET / RAIN / DAMP / DRY でグリップが変化（ライバルも同じ条件）
- 壁: 剛体の衝突として計算（当たった角度と位置でクルマが回転し、擦ると減速）
- 運転支援 ASSIST: **FULL**（TCS + 強めの横滑り防止）/ **SPORT**（既定。テールスライドを少し許容、高速域では抑制）/ **OFF**（支援なし。全開でスピンします — 上級者・ゲームパッド向け）。介入中は HUD の TCS / ESC ランプが点滅
- タッチの ◀ ▶ でも扱えるよう、舵角は速度に応じた上限（タイヤの限界付近まで）とハンドルを切る速さを自動調整
- スピンして逆向きに止まった場合は自動で向きを戻します（RECOVERY）

参考値（DRY, SPORT）: 0-100km/h 約3.7秒 / 0-200km/h 約8.9秒 / 最高速 約335km/h / 100→0km/h 制動 約35m / 定常旋回 約1.0G

アーケード要素: タイトルのアトラクトデモ、ライバル紹介カード、カウントダウン（ロケットスタート）、チェックポイントでの TIME EXTEND、スリップストリーム、ニアミスボーナス、区間名バナー、リザルト（グレード）、CONTINUE カウントダウン。

## グラフィックス（既定 ULTRA）

- 濡れた路面: 路面直下の平面で毎フレーム鏡面反射を描画し、粗さに応じたミップぼかしと縦方向の光の滲みでサンプリング。水たまり・轍・雨の波紋（ノイズ生成）
- 街灯: 中央分離帯のツインアーム灯を路面シェーダで解析的に計算（全街灯のライトプール）、自車周辺は実ライトとしても配置して車体に光が流れる
- 西公園トンネル: 上下線それぞれのチューブ、坑門（2連アーチのヘッドウォール、ウイングウォール、投光器、トンネル名板）、入口照明（入口付近ほど明るく）。遠くからでも坑口とトンネル内の照明列が見えます
- 車体: クリアコート塗装、動的キューブ環境マップ（街灯や看板の映り込みが走行に合わせて流れる）、ヘッドライトのスポット照射、テールランプの路面への赤い映り込み
- 福岡の夜景: 1万棟超のインスタンシング建物（オフィス/マンション外廊下灯/店舗をシェーダで手続き生成）、博多湾の反射、福岡タワー（ハロウィン配色のLED演出）、ドーム、シーホーク風ホテル、博多ポートタワー、博多駅ビル、着陸進入中の旅客機、ネオン看板、案内標識・LED情報板
- ポストエフェクト: N8AO (SSAO)、HDR ブルーム、速度連動の放射ブラー＋色収差、ACES トーンマッピング、カラーグレーディング、フィルムグレイン、MSAA/SMAA
- 雨天 (RAIN): GPU で動かす数千本の雨筋（ワールド固定なので走行中は正しい視差で流れる）、路面の雨紋、濃いもや
- 画質プリセット: ULTRA / HIGH / MEDIUM / LOW（設定から変更、再起動で反映）
- 解像度自動調整 (DYNAMIC RES): エフェクトはすべて維持したまま、40fps を割る端末では描画解像度のみ自動で下げます（設定でオフ可）
- 描画負荷対策: NPC 車両は部品ごとの GPU インスタンシング（台数に関係なく描画コール一定）、遠景はプロキシ、環境キューブは数面ずつ更新

効果音・BGM は WebAudio によるリアルタイム合成（水平対向6気筒＋ターボ／ブローオフ、V12、風切り、タイヤ、衝突、ユーロビート風BGM）。

## ビルド

必要なもの: Node.js 20+、JDK 17+、Ubuntu の Android ビルドツール

```bash
sudo apt-get install android-sdk-build-tools android-sdk-platform-23 dalvik-exchange apksigner zipalign
./build.sh            # → dist/KYUSHU-R_Fukuoka.apk
```

`build.sh` は Vite で Web バンドルを作り、`tools/build-apk.sh` で aapt2 → javac → dx → zipalign → apksigner の順に APK を作成します（Gradle / Android Studio 不要）。
APK は WebView で `https://appassets.androidplatform.net/` から同梱アセットを配信する構成です（minSdk 24 / targetSdk 34、WebGL2 必須）。

車両モデルを差し替える場合:

```bash
cd game && node tools/optimize-models.mjs <モデルのあるフォルダ>
```

（ホイールの自動検出と中心ピボット化、前向き+Z・実寸スケール化、テクスチャの WebP 化、NPC のポリゴン削減を行います）

開発時: `cd game && npm install && npm run dev` でブラウザ実行できます。

署名には `android/keystore/kyushur-debug.jks`（パスワード `kyushur`）を使用します。配布用のリリース鍵ではありません。

## クレジット / ライセンス

3D モデル（Sketchfab）— 改変（スケール・向き・簡略化・テクスチャ再圧縮）して使用:

- "Porsche 911 (930) Turbo 1975" by [Lexyc16](https://sketchfab.com/Lexyc16) — CC BY 4.0 — https://sketchfab.com/3d-models/porsche-911-930-turbo-1975-de1ffd344c41481892511f7fd332c136
- "2021 Lamborghini Countach LPI 800-4" by [Lexyc16](https://sketchfab.com/Lexyc16) — CC BY-NC 4.0 — https://sketchfab.com/3d-models/2021-lamborghini-countach-lpi-800-4-d76b94884432422b966d1a7f8815afb5
- "Honda Integra (DB8) Type-R" by [Myedsu](https://sketchfab.com/myedsu) — CC BY 4.0 — https://sketchfab.com/3d-models/honda-integra-db8-type-r-06f0eba84e9745e9aec41a985ccac915
- "2023 Toyota RAV4 Hybrid" by [Ddiaz Design](https://sketchfab.com/ddiaz-design) — CC BY-NC-SA 4.0 — https://sketchfab.com/3d-models/2023-toyota-rav4-hybrid-ed155ad0cb7d447085a519eaff9aa2df
- "2005 Toyota TownAce GL" by [OUTPISTON](https://sketchfab.com/outpiston) — CC BY-NC-SA 4.0 — https://sketchfab.com/3d-models/2005-toyota-townace-gl-addecc78c3674fc4985b5f92fab46f91

非営利（NC）ライセンスのモデルを含むため、本プロジェクトは**非営利のファンメイド作品**です。各メーカー・道路事業者とは無関係です。

フォント: Orbitron / Russo One / Dela Gothic One（SIL OFL）。ライブラリ: three.js (MIT)、postprocessing (Zlib)、N8AO (CC0)。
