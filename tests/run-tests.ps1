# Runs "Install Entity Compactor.bat" /quiet against fake launcher profiles on a
# throwaway Windows runner and checks which files end up in each mods folder.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Default = 'allawi habib galbi abou husein'
$results = New-Object System.Collections.ArrayList
$failed = 0

function Check([string]$case, [string]$what, [bool]$ok) {
    $line = "{0} [{1}] {2}" -f ($(if ($ok) { 'PASS' } else { 'FAIL' })), $case, $what
    Write-Host $line
    [void]$results.Add(@{ case = $case; check = $what; ok = $ok })
    if (-not $ok) { $script:failed++ }
}

function Jars([string]$dir) {
    if (-not (Test-Path -LiteralPath $dir)) { return @() }
    return @(Get-ChildItem -LiteralPath $dir -File | ForEach-Object { $_.Name })
}

function Write-Json([string]$path, $obj) {
    New-Item -ItemType Directory -Force -Path (Split-Path $path) | Out-Null
    # No byte-order mark, like the real launchers write (Java's JSON readers reject one).
    [IO.File]::WriteAllText($path, ($obj | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding $false))
}

# Run from a folder with spaces, the way a user's Downloads path might look.
$batDir = 'C:\EC Test Folder (with spaces)'
New-Item -ItemType Directory -Force -Path $batDir | Out-Null
$bat = Join-Path $batDir 'Install Entity Compactor.bat'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\Install Entity Compactor.bat') -Destination $bat -Force

function Run-Installer([string]$case, [string[]]$arguments) {
    Write-Host ""
    Write-Host "===== $case : Install Entity Compactor.bat $($arguments -join ' ')"
    & $bat @arguments | ForEach-Object { Write-Host "  | $_" }
    $code = $LASTEXITCODE
    Write-Host "===== $case exit code $code"
    return $code
}

# The PowerShell part must parse cleanly on Windows PowerShell 5.1.
$errs = $null
[void][System.Management.Automation.Language.Parser]::ParseInput([IO.File]::ReadAllText($bat), [ref]$null, [ref]$errs)
Check 'parse' 'PowerShell part has no syntax errors' ($errs.Count -eq 0)
$errs | ForEach-Object { Write-Host "  $($_.Extent.StartLineNumber): $($_.Message)" }
$raw = [IO.File]::ReadAllBytes($bat)
Check 'parse' 'batch file uses CRLF line endings' ([Text.Encoding]::ASCII.GetString($raw).Contains("`r`n@echo off"))

# Fabric API's Modrinth project, as the installer looks it up.
$p = Invoke-RestMethod 'https://api.modrinth.com/v2/project/fabric-api' -UseBasicParsing
Write-Host "Modrinth fabric-api: id=$($p.id) slug=$($p.slug) title=$($p.title)"
Check 'modrinth' 'fabric-api project exists on Modrinth' ($p.slug -eq 'fabric-api')

# ---- Case 1: Modrinth App profile, default name, 26.2 + Fabric ----
$mr = Join-Path $env:APPDATA "ModrinthApp\profiles\$Default"
Write-Json "$mr\profile.json" @{ path = $Default; metadata = @{ name = $Default; game_version = '26.2'; loader = 'fabric'; loader_version = @{ id = '0.17.2' } } }
New-Item -ItemType Directory -Force "$mr\mods" | Out-Null
Set-Content "$mr\mods\entity-compactor-0.9.jar" 'old'
Set-Content "$mr\mods\sodium-fabric-0.6.0+26.2.jar" 'not ours'
$code = Run-Installer 'modrinth-26.2' @('/quiet')
$j = Jars "$mr\mods"; Write-Host "  mods: $($j -join ', ')"
Check 'modrinth-26.2' 'exit code 0' ($code -eq 0)
Check 'modrinth-26.2' 'entity-compactor-*+26.2.jar installed' (@($j -match '^entity-compactor-\d+(\.\d+)*\+26\.2\.jar$').Count -eq 1)
Check 'modrinth-26.2' 'fabric-api-*+26.2.jar installed' (@($j -match '^fabric-api-.*\+26\.2\.jar$').Count -eq 1)
Check 'modrinth-26.2' 'old entity-compactor-0.9.jar removed' (-not ($j -contains 'entity-compactor-0.9.jar'))
Check 'modrinth-26.2' 'other mod kept' ($j -contains 'sodium-fabric-0.6.0+26.2.jar')
$ec = @($j -match '^entity-compactor-.*\.jar$')
Check 'modrinth-26.2' 'installed jar is a real zip (not an error page)' ($ec.Count -eq 1 -and ([IO.File]::ReadAllBytes("$mr\mods\$($ec[0])")[0..1] -join ',') -eq '80,75')

# ---- Case 2: CurseForge instance, named by argument, 1.21.4 + Fabric ----
$cfName = 'CF Test 1.21.4'
$cf = Join-Path $env:USERPROFILE "curseforge\minecraft\Instances\$cfName"
Write-Json "$cf\minecraftinstance.json" @{ name = $cfName; gameVersion = '1.21.4'; baseModLoader = @{ name = 'fabric-0.16.10-1.21.4'; minecraftVersion = '1.21.4' } }
New-Item -ItemType Directory -Force "$cf\mods" | Out-Null
Set-Content "$cf\mods\entity-compactor-0.9.jar" 'old'
Set-Content "$cf\mods\journeymap-1.21.4-6.0.0-fabric.jar" 'not ours'
$code = Run-Installer 'curseforge-1.21.4' @('/quiet', '/profile', $cfName)
$j = Jars "$cf\mods"; Write-Host "  mods: $($j -join ', ')"
Check 'curseforge-1.21.4' 'exit code 0' ($code -eq 0)
Check 'curseforge-1.21.4' 'entity-compactor jar for 1.21.4 installed' (@($j -match '^entity-compactor-(\d+(\.\d+)*\+1\.21\.4|1\.0\.0)\.jar$').Count -eq 1)
Check 'curseforge-1.21.4' 'no 26.2 jar installed' (@($j -match '26\.2').Count -eq 0)
Check 'curseforge-1.21.4' 'fabric-api-*+1.21.4.jar installed' (@($j -match '^fabric-api-.*\+1\.21\.4\.jar$').Count -eq 1)
Check 'curseforge-1.21.4' 'old entity-compactor-0.9.jar removed' (-not ($j -contains 'entity-compactor-0.9.jar'))
Check 'curseforge-1.21.4' 'other mod kept' ($j -contains 'journeymap-1.21.4-6.0.0-fabric.jar')

# ---- Case 3: Prism instance on NeoForge: warn, install nothing ----
$prName = 'Prism NeoForge'
$pr = Join-Path $env:APPDATA "PrismLauncher\instances\$prName"
Write-Json "$pr\mmc-pack.json" @{ formatVersion = 1; components = @(@{ uid = 'net.minecraft'; version = '1.21.4' }, @{ uid = 'net.neoforged'; version = '21.4.1' }) }
New-Item -ItemType Directory -Force "$pr\minecraft\mods" | Out-Null
Set-Content "$pr\minecraft\mods\entity-compactor-0.9.jar" 'old'
$code = Run-Installer 'prism-neoforge' @('/quiet', $prName)
$j = Jars "$pr\minecraft\mods"; Write-Host "  mods: $($j -join ', ')"
Check 'prism-neoforge' 'exit code 2 (not Fabric)' ($code -eq 2)
Check 'prism-neoforge' 'nothing installed or removed' (($j -join ',') -eq 'entity-compactor-0.9.jar')

# ---- Case 4: official launcher profile on vanilla 1.21.4: installs Fabric too ----
$mc = Join-Path $env:APPDATA '.minecraft'
Write-Json "$mc\launcher_profiles.json" @{ profiles = @{ abc123 = @{ name = 'EC Official Test'; type = 'custom'; lastVersionId = '1.21.4'; icon = 'Grass' } }; version = 3 }
New-Item -ItemType Directory -Force "$mc\mods" | Out-Null
Set-Content "$mc\mods\entity-compactor-0.9.jar" 'old'
Set-Content "$mc\mods\modmenu-13.0.0.jar" 'not ours'
$code = Run-Installer 'official-1.21.4' @('/quiet', '/profile', 'EC Official Test')
$j = Jars "$mc\mods"; Write-Host "  mods: $($j -join ', ')"
$fv = @(Get-ChildItem "$mc\versions" -Directory -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
Write-Host "  versions: $($fv -join ', ')"
$lp = Get-Content "$mc\launcher_profiles.json" -Raw | ConvertFrom-Json
Write-Host "  profile now uses: $($lp.profiles.abc123.lastVersionId)"
Check 'official-1.21.4' 'exit code 0' ($code -eq 0)
Check 'official-1.21.4' 'entity-compactor jar for 1.21.4 installed' (@($j -match '^entity-compactor-(\d+(\.\d+)*\+1\.21\.4|1\.0\.0)\.jar$').Count -eq 1)
Check 'official-1.21.4' 'fabric-api-*+1.21.4.jar installed' (@($j -match '^fabric-api-.*\+1\.21\.4\.jar$').Count -eq 1)
Check 'official-1.21.4' 'old jar removed, other jar kept' ((-not ($j -contains 'entity-compactor-0.9.jar')) -and ($j -contains 'modmenu-13.0.0.jar'))
Check 'official-1.21.4' 'Fabric Loader installed (versions\fabric-loader-*-1.21.4)' (@($fv -match '^fabric-loader-.+-1\.21\.4$').Count -ge 1)
Check 'official-1.21.4' 'launcher profile switched to Fabric' ("$($lp.profiles.abc123.lastVersionId)" -match '^fabric-loader-.+-1\.21\.4$')
Check 'official-1.21.4' 'launcher_profiles.json backup kept' (Test-Path "$mc\launcher_profiles.json.before-entity-compactor")

# ---- Case 5: profile not found -> official .minecraft, switch to 26.2 ----
$code = Run-Installer 'official-fallback-26.2' @('/quiet', '/profile', 'Nobody Has This Profile', '/version', '26.2')
$j = Jars "$mc\mods"; Write-Host "  mods: $($j -join ', ')"
$fv = @(Get-ChildItem "$mc\versions" -Directory | ForEach-Object { $_.Name })
Write-Host "  versions: $($fv -join ', ')"
Check 'official-fallback-26.2' 'exit code 0' ($code -eq 0)
Check 'official-fallback-26.2' 'only the 26.2 entity-compactor jar is left' ((@($j -match '^entity-compactor-.*\.jar$') -join ',') -match '^entity-compactor-\d+(\.\d+)*\+26\.2\.jar$')
Check 'official-fallback-26.2' 'fabric-api-*+26.2.jar installed' (@($j -match '^fabric-api-.*\+26\.2\.jar$').Count -eq 1)
Check 'official-fallback-26.2' '1.21.4 Fabric API turned off, not deleted' (@($j -match '^fabric-api-.*\+1\.21\.4\.jar\.disabled$').Count -eq 1)
Check 'official-fallback-26.2' 'other jar kept' ($j -contains 'modmenu-13.0.0.jar')
Check 'official-fallback-26.2' 'Fabric Loader installed for 26.2' (@($fv -match '^fabric-loader-.+-26\.2$').Count -ge 1)

$passed = @($results | Where-Object { $_.ok }).Count
Write-Host ""
Write-Host ("EC_RESULT " + (@{ passed = $passed; failed = $failed; total = $results.Count } | ConvertTo-Json -Compress))
exit ([int]($failed -gt 0))
