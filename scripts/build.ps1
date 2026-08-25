$projectPath = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectPath
node (Join-Path $projectPath 'node_modules\vinext\dist\cli.js') build
