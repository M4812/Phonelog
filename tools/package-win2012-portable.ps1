$ErrorActionPreference = 'Stop'

$nodeVersion = '16.20.2'
$nodeArchiveName = "node-v$nodeVersion-win-x64.zip"
$nodeFolderName = "node-v$nodeVersion-win-x64"
$nodeUrl = "https://nodejs.org/dist/v$nodeVersion/$nodeArchiveName"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$distRoot = Join-Path $projectRoot 'dist'
$cacheRoot = Join-Path $projectRoot '.cache'
$nodeZip = Join-Path $cacheRoot $nodeArchiveName
$nodeExtractRoot = Join-Path $cacheRoot 'node-runtime'
$nodeSourceDir = Join-Path $nodeExtractRoot $nodeFolderName
$packageName = 'phone-record-app-win2012r-portable'
$packageDir = Join-Path $distRoot $packageName
$zipPath = Join-Path $distRoot "$packageName.zip"

function Assert-PathInside {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Parent
  )

  $resolvedParent = (Resolve-Path $Parent).Path.TrimEnd('\')
  $resolvedPath = if (Test-Path $Path) {
    (Resolve-Path $Path).Path
  } else {
    $Path
  }

  if (-not $resolvedPath.StartsWith($resolvedParent, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify path outside ${resolvedParent}: $resolvedPath"
  }
}

New-Item -ItemType Directory -Force -Path $distRoot, $cacheRoot | Out-Null

if (-not (Test-Path $nodeZip)) {
  Write-Host "Downloading Node.js $nodeVersion win-x64..."
  Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeZip
}

if (-not (Test-Path (Join-Path $nodeSourceDir 'node.exe'))) {
  if (Test-Path $nodeExtractRoot) {
    Assert-PathInside -Path $nodeExtractRoot -Parent $cacheRoot
    Remove-Item -LiteralPath $nodeExtractRoot -Recurse -Force
  }

  New-Item -ItemType Directory -Force -Path $nodeExtractRoot | Out-Null
  Expand-Archive -LiteralPath $nodeZip -DestinationPath $nodeExtractRoot -Force
}

if (Test-Path $packageDir) {
  Assert-PathInside -Path $packageDir -Parent $distRoot
  $stalePackageDir = Join-Path $distRoot (".stale-$packageName-" + (Get-Date -Format 'yyyyMMddHHmmss'))
  Move-Item -LiteralPath $packageDir -Destination $stalePackageDir
  try {
    Remove-Item -LiteralPath $stalePackageDir -Recurse -Force
  } catch {
    Write-Warning "Old package directory is still locked and was left at: $stalePackageDir"
  }
}

if (Test-Path $zipPath) {
  Assert-PathInside -Path $zipPath -Parent $distRoot
  Remove-Item -LiteralPath $zipPath -Force
}

New-Item -ItemType Directory -Force -Path $packageDir | Out-Null

Copy-Item -LiteralPath (Join-Path $projectRoot 'server.js') -Destination $packageDir
Copy-Item -LiteralPath (Join-Path $projectRoot 'package.json') -Destination $packageDir
Copy-Item -LiteralPath (Join-Path $projectRoot 'package-lock.json') -Destination $packageDir
Copy-Item -LiteralPath (Join-Path $projectRoot 'public') -Destination $packageDir -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'data') -Destination $packageDir -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'node_modules') -Destination $packageDir -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'deploy\start-windows.bat') -Destination $packageDir
Copy-Item -LiteralPath (Join-Path $projectRoot 'deploy\allow-firewall-port-3000-admin.bat') -Destination $packageDir
Copy-Item -LiteralPath (Join-Path $projectRoot 'deploy\README-deploy.txt') -Destination $packageDir
Copy-Item -LiteralPath $nodeSourceDir -Destination (Join-Path $packageDir 'runtime') -Recurse

$buildInfo = @"
Phone Record App portable package
BuiltAt: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
NodeRuntime: Node.js $nodeVersion win-x64
TargetOS: Windows Server 2012 R2 x64 or newer
Entry: start-windows.bat
DefaultPort: 3000
"@

Set-Content -LiteralPath (Join-Path $packageDir 'BUILD-INFO.txt') -Value $buildInfo -Encoding UTF8

Compress-Archive -LiteralPath $packageDir -DestinationPath $zipPath -Force

Write-Host "Portable package directory: $packageDir"
Write-Host "Portable package zip: $zipPath"
