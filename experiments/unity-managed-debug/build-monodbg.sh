#!/usr/bin/env bash
# Build DotRush's Unity Mono debug adapter (monodbg.dll) from pinned source,
# for testing Craidd's experimental Unity Editor C# attach route.
#
#   experiments/unity-managed-debug/build-monodbg.sh                          # DotRush 2026.10 as released
#   experiments/unity-managed-debug/build-monodbg.sh --with-upstream-patches  # plus Craidd's drafted patches
#
# Source and output stay in the ignored .local-tools/ beside this script.
# Craidd never selects this build automatically: choose the printed path in
# Preferences → Toolchain → C# → Unity debugger. Safe to re-run; each run
# resets the cached source to the pinned commits and replaces only its output.
# Needs git, network access (GitHub and NuGet) and a .NET 10+ SDK.
set -euo pipefail

# ──────── 1. Pins and paths ────────
DOTRUSH_URL=https://github.com/JaneySprings/DotRush.git
DOTRUSH_TAG=2026.10
DOTRUSH_COMMIT=4b87e96584b1f0e4e81fde5ed8f1aa665a03228d
MONOLIB_PATH=src/DotRush.Debugging.MonoLib
MONOLIB_COMMIT=9edc6120533e818e593cb73b0910e9c7990cffb2

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$HERE/../.." && pwd)
PATCHES="$REPO_ROOT/tests/fixtures/unity-managed-debug/upstream"
TOOLS="$HERE/.local-tools"
SRC="$TOOLS/dotrush-source"

PATCHED=0
case "${1:-}" in
  "") ;;
  --with-upstream-patches) PATCHED=1 ;;
  -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
  *) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
esac
OUT="$TOOLS/monodbg"
if [ "$PATCHED" = 1 ]; then OUT="$TOOLS/monodbg-patched"; fi

# ──────── 2. Prerequisites ────────
command -v git >/dev/null || { echo "git is required" >&2; exit 1; }
command -v dotnet >/dev/null || { echo "dotnet (.NET 10+ SDK) is required" >&2; exit 1; }
SDK_MAJOR=$(dotnet --list-sdks | sed -n 's/^\([0-9]*\)\..*/\1/p' | sort -n | tail -1)
if [ -z "$SDK_MAJOR" ] || [ "$SDK_MAJOR" -lt 10 ]; then
  echo "A .NET 10 or later SDK is required to build monodbg (found: ${SDK_MAJOR:-none})" >&2; exit 1
fi

# ──────── 3. Pinned source ────────
mkdir -p "$TOOLS"
if [ ! -d "$SRC/.git" ]; then
  echo "Cloning DotRush $DOTRUSH_TAG…"
  git clone --quiet --branch "$DOTRUSH_TAG" --depth 1 "$DOTRUSH_URL" "$SRC"
fi
# The cache belongs to this script: discard any earlier patch or build state.
git -C "$SRC" fetch --quiet --depth 1 origin "refs/tags/$DOTRUSH_TAG:refs/tags/$DOTRUSH_TAG"
git -C "$SRC" checkout --quiet --force --detach "$DOTRUSH_COMMIT"
git -C "$SRC" clean --quiet -fdx
git -C "$SRC" submodule update --quiet --init --force "$MONOLIB_PATH"
git -C "$SRC/$MONOLIB_PATH" clean --quiet -fdx
[ "$(git -C "$SRC" rev-parse HEAD)" = "$DOTRUSH_COMMIT" ] || { echo "DotRush is not at the pinned commit" >&2; exit 1; }
[ "$(git -C "$SRC/$MONOLIB_PATH" rev-parse HEAD)" = "$MONOLIB_COMMIT" ] || { echo "Mono.Debugger submodule is not at the pinned commit" >&2; exit 1; }

# ──────── 4. Optional drafted upstream patches ────────
APPLIED="none"
if [ "$PATCHED" = 1 ]; then
  for patch in "$PATCHES"/*.patch; do
    git -C "$SRC" apply --whitespace=nowarn "$patch"
    echo "Applied $(basename "$patch")"
  done
  APPLIED=$(cd "$PATCHES" && ls -1 *.patch | paste -sd, -)
fi

# ──────── 5. Build ────────
echo "Building monodbg.dll…"
rm -rf "$OUT.tmp"
DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 dotnet publish \
  "$SRC/src/DotRush.Debugging.Mono/DotRush.Debugging.Mono.csproj" -c Release -o "$OUT.tmp" -v quiet -nologo
[ -f "$OUT.tmp/monodbg.dll" ] || { echo "Build did not produce monodbg.dll" >&2; exit 1; }
rm -rf "$OUT"
mv "$OUT.tmp" "$OUT"

# ──────── 6. Record the build ────────
SHA=$(sha256sum "$OUT/monodbg.dll" | cut -d' ' -f1)
cat > "$OUT/BUILD-INFO.txt" <<EOF
DotRush $DOTRUSH_TAG $DOTRUSH_COMMIT ($DOTRUSH_URL)
Mono.Debugger submodule $MONOLIB_COMMIT
Craidd upstream patches applied: $APPLIED
.NET SDK $(dotnet --version)
monodbg.dll sha256 $SHA
Built $(date -u +%Y-%m-%dT%H:%M:%SZ) by experiments/unity-managed-debug/build-monodbg.sh
Licences: DotRush and Mono.Debugger are MIT. Microsoft.VisualStudio.Shared.VSCodeDebugProtocol.dll
is under Microsoft Software License Terms; do not commit or redistribute this folder.
EOF

# ──────── 7. Next steps ────────
echo
echo "Built: $OUT/monodbg.dll"
echo "sha256: $SHA   (patches: $APPLIED)"
echo
echo "Next:"
echo "  1. npm run tauri dev   (from $REPO_ROOT)"
echo "  2. Preferences → Toolchain → C# → Unity debugger → Choose Path… → the monodbg.dll above"
echo "  3. Unity: set Code Optimization to Debug; Craidd: Run → Attach to Process →"
echo "     select the Unity Editor → Unity C# · DotRush Mono (Editor)"
echo
echo "Limits: Unity Editor only (players need the patched build and are not routed by Craidd yet);"
echo "IL2CPP and Unity LDI are unsupported. This folder is ignored by git; never commit it."
