$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot
$buildRoot = Join-Path $repoRoot ".build-windows"
$venvPython = Join-Path $buildRoot "venv\Scripts\python.exe"
$distRoot = Join-Path $repoRoot "dist"
$appRoot = Join-Path $distRoot "NfseFiller"
$downloadRoot = Join-Path $buildRoot "downloads"

if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
    throw "Python 3.11+ é necessário apenas para gerar o pacote."
}

New-Item -ItemType Directory -Force -Path $buildRoot, $downloadRoot | Out-Null
if (-not (Test-Path $venvPython)) {
    & py -3 -m venv (Join-Path $buildRoot "venv")
    if ($LASTEXITCODE -ne 0) { throw "Não foi possível criar o ambiente temporário de build." }
}

& $venvPython -m pip install --upgrade pip pyinstaller
if ($LASTEXITCODE -ne 0) { throw "Não foi possível instalar o empacotador no ambiente de build." }

$metadata = Invoke-RestMethod "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json"
$stable = $metadata.channels.Stable
$chromeUrl = ($stable.downloads.chrome | Where-Object { $_.platform -eq "win64" }).url
$driverUrl = ($stable.downloads.chromedriver | Where-Object { $_.platform -eq "win64" }).url
if (-not $chromeUrl -or -not $driverUrl) { throw "Downloads Windows x64 não encontrados para Chrome for Testing." }

$chromeZip = Join-Path $downloadRoot "chrome-win64.zip"
$driverZip = Join-Path $downloadRoot "chromedriver-win64.zip"
Invoke-WebRequest -Uri $chromeUrl -OutFile $chromeZip
Invoke-WebRequest -Uri $driverUrl -OutFile $driverZip

if (Test-Path $appRoot) { Remove-Item -Recurse -Force $appRoot }
if (Test-Path $distRoot) { Remove-Item -Recurse -Force $distRoot }
$staticPath = Join-Path $repoRoot "src\nfse_filler\static"
& $venvPython -m PyInstaller --noconfirm --clean --onedir --name NfseFiller `
    --paths (Join-Path $repoRoot "src") `
    --add-data "${staticPath};nfse_filler/static" `
    (Join-Path $repoRoot "run.py")
if ($LASTEXITCODE -ne 0) { throw "PyInstaller não conseguiu gerar o aplicativo." }

$browserDir = Join-Path $appRoot "Browser"
$driverDir = Join-Path $appRoot "ChromeDriver"
New-Item -ItemType Directory -Force -Path $browserDir, $driverDir | Out-Null
Expand-Archive -Path $chromeZip -DestinationPath $browserDir -Force
Expand-Archive -Path $driverZip -DestinationPath $driverDir -Force

$versionFile = Join-Path $appRoot "VERSIONS.txt"
$versionLine = (Get-Content (Join-Path $repoRoot "pyproject.toml") | Select-String '^version = ').Line
$appVersion = ($versionLine -split '"')[1]
@("NFSe Filler: $appVersion", "Chrome for Testing: $($stable.version)", "ChromeDriver: $($stable.version)") |
    Set-Content -Encoding utf8 $versionFile

$archive = Join-Path $distRoot "NfseFiller-Windows-x64.zip"
Compress-Archive -Path (Join-Path $appRoot "*") -DestinationPath $archive -Force
Write-Host "Pacote pronto: $archive"
Write-Host "Extraia o ZIP e execute NfseFiller.exe."
