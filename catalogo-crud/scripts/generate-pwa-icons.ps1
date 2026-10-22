# Compatibility entry point for the existing Windows regeneration command.
$ErrorActionPreference = 'Stop'
node (Join-Path $PSScriptRoot 'generate-pwa-icons.mjs')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
