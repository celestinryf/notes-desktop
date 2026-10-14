# Creates a Start Menu shortcut for Notes, launches the app, and confirms the
# login-time autostart entry the app writes for itself.
# Run: npm run install:shortcuts

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
$icon = Join-Path $root 'assets\icon.ico'

if (-not (Test-Path $electron)) { throw "Electron not installed. Run 'npm install' in $root first." }
if (-not (Test-Path $icon)) { & $electron (Join-Path $root 'scripts\make-icon.js') | Out-Null }

$programs = [Environment]::GetFolderPath('Programs')
$lnk = Join-Path $programs 'Notes.lnk'
$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($lnk)
$s.TargetPath = $electron
$s.Arguments = '"' + $root + '"'
$s.WorkingDirectory = $root
$s.IconLocation = $icon
$s.Description = 'Notes (toggle with the global hotkey)'
$s.Save()
Write-Host "Start Menu shortcut: $lnk"

$desktopLnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Notes.lnk'
$d = $shell.CreateShortcut($desktopLnk)
$d.TargetPath = $electron
$d.Arguments = '"' + $root + '"'
$d.WorkingDirectory = $root
$d.IconLocation = "$icon,0"
$d.Description = 'Notes (Ctrl+Alt+N toggles it from anywhere)'
$d.Save()
Write-Host "Desktop shortcut: $desktopLnk"

# Launch (or focus) the app now. The app registers its own autostart entry.
$running = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'electron.exe' -and $_.CommandLine -like "*$root*" }
if (-not $running) {
  Start-Process -FilePath $electron -ArgumentList ('"' + $root + '"') -WorkingDirectory $root
  Write-Host 'Launched Notes.'
} else {
  Write-Host 'Notes is already running.'
}

Start-Sleep -Seconds 4
$run = Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue
$entry = $run.PSObject.Properties | Where-Object { $_.Value -like "*$root*" } | Select-Object -First 1
if ($entry) { Write-Host "Autostart entry: $($entry.Name) = $($entry.Value)" }
else { Write-Warning 'No autostart entry found yet. Open Settings in the app and tick "Start Notes when I log in".' }

$rt = Join-Path $env:APPDATA 'notes-app\runtime.json'
if (Test-Path $rt) {
  $j = Get-Content $rt -Raw | ConvertFrom-Json
  if ($j.registered) { Write-Host "Global hotkey active: $($j.hotkey -replace 'CommandOrControl','Ctrl' -replace 'Control','Ctrl')" }
  else { Write-Warning 'Hotkey could not be registered. Change it in Settings (Ctrl+,).' }
}
