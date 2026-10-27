#!/usr/bin/env bash
# Builds the Android APK without Gradle/AGP:
#   aapt2 (resources + assets) -> javac -> dx -> zipalign -> apksigner
# Requires (Ubuntu): android-sdk-build-tools android-sdk-platform-23 dalvik-exchange apksigner zipalign
# Usage: tools/build-apk.sh [web-dist-dir] [output.apk]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_DIST="${1:-$ROOT/game/dist}"
OUT_APK="${2:-$ROOT/dist/KYUSHU-R_Fukuoka.apk}"
SDK="${ANDROID_SDK:-/usr/lib/android-sdk}"
ANDROID_JAR="$SDK/platforms/android-23/android.jar"
VERSION_CODE="${VERSION_CODE:-1}"
VERSION_NAME="${VERSION_NAME:-1.0.0}"
KEYSTORE="$ROOT/android/keystore/kyushur-debug.jks"
KS_PASS="${KS_PASS:-kyushur}"

[ -f "$ANDROID_JAR" ] || { echo "android.jar not found: $ANDROID_JAR" >&2; exit 1; }
[ -f "$WEB_DIST/index.html" ] || { echo "web build not found in $WEB_DIST (run: cd game && npm run build)" >&2; exit 1; }

B="$ROOT/android/build"
rm -rf "$B"
mkdir -p "$B/gen" "$B/classes" "$B/assets/www" "$(dirname "$OUT_APK")"

echo "[1/6] assets"
cp -r "$WEB_DIST"/. "$B/assets/www/"

echo "[2/6] aapt2 compile/link"
aapt2 compile --dir "$ROOT/android/res" -o "$B/res.zip"
# Media/models are stored uncompressed: they are already compressed and AssetManager can stream them directly.
aapt2 link -o "$B/unsigned.apk" \
  -I "$ANDROID_JAR" \
  --manifest "$ROOT/android/AndroidManifest.xml" \
  -R "$B/res.zip" \
  -A "$B/assets" \
  --java "$B/gen" \
  --min-sdk-version 24 --target-sdk-version 34 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  -0 glb -0 png -0 jpg -0 webp -0 woff2 -0 ktx2 \
  --auto-add-overlay

echo "[3/6] javac"
javac -nowarn -Xlint:-options -source 8 -target 8 -encoding UTF-8 \
  -bootclasspath "$ANDROID_JAR" -d "$B/classes" \
  $(find "$ROOT/android/src" "$B/gen" -name '*.java')

echo "[4/6] dx"
dalvik-exchange --dex --min-sdk-version=24 --output="$B/classes.dex" "$B/classes"
(cd "$B" && zip -q -j unsigned.apk classes.dex)

echo "[5/6] zipalign"
zipalign -f -p 4 "$B/unsigned.apk" "$B/aligned.apk"

echo "[6/6] sign"
if [ ! -f "$KEYSTORE" ]; then
  mkdir -p "$(dirname "$KEYSTORE")"
  keytool -genkeypair -keystore "$KEYSTORE" -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -alias kyushur -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=KYUSHU-R Project.E, O=KYUSHU-R, C=JP" 2>/dev/null
fi
apksigner sign --ks "$KEYSTORE" --ks-pass "pass:$KS_PASS" --ks-key-alias kyushur \
  --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true \
  --out "$OUT_APK" "$B/aligned.apk"
apksigner verify "$OUT_APK"
echo "APK: $OUT_APK ($(du -h "$OUT_APK" | cut -f1))"
