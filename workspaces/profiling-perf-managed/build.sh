#!/bin/sh
# Build the shared managed fixture using installed tools and no package downloads.
set -eu
fixture_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
fixture_output=${1:?Usage: build.sh /absolute/fresh/output}
case "$fixture_output" in /*) ;; *) echo 'Use an absolute output path' >&2; exit 2;; esac
if [ -e "$fixture_output" ]; then echo 'Output must not exist' >&2; exit 2; fi
mkdir -p "$fixture_output/empty-feed" "$fixture_output/cli"
DOTNET_CLI_HOME="$fixture_output/cli" DOTNET_CLI_TELEMETRY_OPTOUT=1 \
  dotnet build "$fixture_root/ManagedPerfFixture.csproj" -c Release -o "$fixture_output/dotnet" \
    -p:BaseIntermediateOutputPath="$fixture_output/obj/" \
    -p:EnableTargetingPackDownload=false -p:RestoreEnablePackagePruning=false \
    -p:RestoreSources="$fixture_output/empty-feed" -p:NuGetAudit=false
if command -v mcs >/dev/null 2>&1; then
  mcs -optimize+ -debug -out:"$fixture_output/ManagedPerfFixture.exe" "$fixture_root/Program.cs"
else
  echo 'Mono compiler unavailable; no Mono fixture was built.'
fi
