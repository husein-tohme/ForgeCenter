<# : This first part is the Windows batch launcher. PowerShell skips it as a comment.
@echo off
setlocal
title Entity Compactor installer
rem Hand the rest of this file to PowerShell. Paths and arguments travel in
rem environment variables so spaces and "&" in folder names stay intact.
set "EC_SELF=%~f0"
set "EC_ARGS=%*"
set "EC_PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%EC_PS%" set "EC_PS=powershell.exe"
"%EC_PS%" -NoProfile -ExecutionPolicy Bypass -Command "Invoke-Expression ([IO.File]::ReadAllText($env:EC_SELF))"
exit /b %errorlevel%
#>

# ---------------------------------------------------------------------------
# Entity Compactor installer (PowerShell 5.1+, stock Windows 10/11).
# Usage:  "Install Entity Compactor.bat" [profile name] [/profile "name"]
#         [/version 26.2] [/mods "C:\path\to\mods"] [/quiet]
# It only ever deletes older entity-compactor-*.jar files in the mods folder.
# ---------------------------------------------------------------------------

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # the progress bar makes downloads very slow on 5.1
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Repo = 'husein-tohme/ForgeCenter'
$DefaultProfile = 'allawi habib galbi abou husein'
$DefaultVersion = '26.2'
$UserAgent = 'EntityCompactorInstaller/1.0 (+https://github.com/husein-tohme/ForgeCenter)'
# Used only when the GitHub API can't be reached (for example its hourly limit).
$KnownJars = @{
    '26.2'   = @{ Tag = 'entity-compactor-v1.0.0-26.2'; Name = 'entity-compactor-1.0.0+26.2.jar' }
    '1.21.4' = @{ Tag = 'entity-compactor-v1.0.0'; Name = 'entity-compactor-1.0.0.jar' }
}
$Summary = New-Object System.Collections.ArrayList
$Quiet = $false

# ---------- small helpers ----------

function Say([string]$msg, [string]$color = 'Gray') { Write-Host $msg -ForegroundColor $color }
function Note([string]$msg) { [void]$Summary.Add($msg) }

function Ask([string]$question, [string]$default) {
    if ($script:Quiet) { return $default }
    $a = Read-Host "$question [$default]"
    if ([string]::IsNullOrWhiteSpace($a)) { return $default }
    return $a.Trim()
}

function AskYes([string]$question, [bool]$default) {
    if ($script:Quiet) { return $default }
    $hint = if ($default) { 'Y/n' } else { 'y/N' }
    $a = Read-Host "$question ($hint)"
    if ([string]::IsNullOrWhiteSpace($a)) { return $default }
    return $a.Trim().ToLower().StartsWith('y')
}

# Folder names are compared loosely so "Allawi  Habib" still matches.
function Normalize([string]$s) { return ($s.ToLowerInvariant() -replace '[^a-z0-9]', '') }

function Read-Json([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    try { $j = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json; return $j } catch { return $null }
}

function Get-Web([string]$url) {
    $headers = @{}
    if ($env:GITHUB_TOKEN -and $url -like 'https://api.github.com/*') { $headers['Authorization'] = "Bearer $env:GITHUB_TOKEN" }
    # Assigning first unrolls JSON arrays, which Windows PowerShell 5.1 returns as one object.
    $r = Invoke-RestMethod -Uri $url -UseBasicParsing -UserAgent $UserAgent -Headers $headers -TimeoutSec 60
    return $r
}

# Download next to the target first so a broken download never replaces a good file.
function Save-Web([string]$url, [string]$target) {
    $part = "$target.part"
    Invoke-WebRequest -Uri $url -OutFile $part -UseBasicParsing -UserAgent $UserAgent -TimeoutSec 300
    Move-Item -LiteralPath $part -Destination $target -Force
}

function Read-Arguments([string]$raw) {
    $o = @{ Profile = $null; Version = $null; Mods = $null }
    $tokens = @([regex]::Matches($raw, '"([^"]*)"|(\S+)') | ForEach-Object {
        if ($_.Groups[1].Success) { $_.Groups[1].Value } else { $_.Groups[2].Value } })
    $rest = @()
    for ($i = 0; $i -lt $tokens.Count; $i++) {
        $t = $tokens[$i]
        if ($t -match '^[/-]{1,2}(quiet|q|silent)$') { $script:Quiet = $true }
        elseif ($t -match '^[/-]{1,2}profile$') { $i++; $o.Profile = $tokens[$i] }
        elseif ($t -match '^[/-]{1,2}version$') { $i++; $o.Version = $tokens[$i] }
        elseif ($t -match '^[/-]{1,2}mods$') { $i++; $o.Mods = $tokens[$i] }
        else { $rest += $t }
    }
    if (-not $o.Profile -and $rest.Count) { $o.Profile = ($rest -join ' ') }
    return $o
}

# ---------- where launchers keep their profiles ----------

function Get-ProfileRoots {
    $A = $env:APPDATA; $U = $env:USERPROFILE
    $desktop = [Environment]::GetFolderPath('Desktop')
    $docs = [Environment]::GetFolderPath('MyDocuments')
    $downloads = Join-Path $U 'Downloads'
    $roots = @(
        @{ Launcher = 'Modrinth App';   Kind = 'modrinth';   Root = "$A\ModrinthApp\profiles" }
        @{ Launcher = 'Modrinth App';   Kind = 'modrinth';   Root = "$A\com.modrinth.theseus\profiles" }
        @{ Launcher = 'CurseForge';     Kind = 'curseforge'; Root = "$U\curseforge\minecraft\Instances" }
        @{ Launcher = 'CurseForge';     Kind = 'curseforge'; Root = "$docs\Curseforge\Minecraft\Instances" }
        @{ Launcher = 'CurseForge';     Kind = 'curseforge'; Root = "$docs\Curse\Minecraft\Instances" }
        @{ Launcher = 'Prism Launcher'; Kind = 'mmc';        Root = "$A\PrismLauncher\instances" }
        @{ Launcher = 'PolyMC';         Kind = 'mmc';        Root = "$A\PolyMC\instances" }
        @{ Launcher = 'MultiMC';        Kind = 'mmc';        Root = "$U\MultiMC\instances" }
        @{ Launcher = 'MultiMC';        Kind = 'mmc';        Root = "$desktop\MultiMC\instances" }
        @{ Launcher = 'MultiMC';        Kind = 'mmc';        Root = "$downloads\MultiMC\instances" }
        @{ Launcher = 'MultiMC';        Kind = 'mmc';        Root = "$env:SystemDrive\MultiMC\instances" }
        @{ Launcher = 'ATLauncher';     Kind = 'atl';        Root = "$A\ATLauncher\instances" }
        @{ Launcher = 'GDLauncher';     Kind = 'gdl';        Root = "$A\gdlauncher_next\instances" }
        @{ Launcher = 'GDLauncher';     Kind = 'gdlc';       Root = "$A\gdlauncher_carbon\data\instances" }
        @{ Launcher = 'a folder on your Desktop';   Kind = 'folder'; Root = $desktop }
        @{ Launcher = 'a folder in Documents';      Kind = 'folder'; Root = $docs }
        @{ Launcher = 'a folder in Downloads';      Kind = 'folder'; Root = $downloads }
    )
    return $roots
}

function Get-ModsDir($kind, [string]$dir) {
    switch ($kind) {
        'mmc' {
            if (Test-Path -LiteralPath "$dir\.minecraft") { return "$dir\.minecraft\mods" }
            return "$dir\minecraft\mods"
        }
        'gdlc' { return "$dir\instance\mods" }
        'folder' {
            if (Test-Path -LiteralPath "$dir\.minecraft") { return "$dir\.minecraft\mods" }
            if (Test-Path -LiteralPath "$dir\minecraft") { return "$dir\minecraft\mods" }
            return "$dir\mods"
        }
        default { return "$dir\mods" }
    }
}

function Get-LoaderFromId([string]$id) {
    $id = "$id".ToLower()
    if ($id -match 'neoforge') { return 'neoforge' }
    if ($id -match 'forge') { return 'forge' }
    if ($id -match 'quilt') { return 'quilt' }
    if ($id -match 'fabric') { return 'fabric' }
    if ($id) { return 'vanilla' }
    return $null
}

# Reads the launcher's own files to learn the Minecraft version and mod loader.
function Get-ProfileInfo($kind, [string]$dir) {
    $info = @{ Version = $null; Loader = $null }
    switch ($kind) {
        'modrinth' {
            $j = Read-Json "$dir\profile.json"
            if ($j) {
                $m = if ($j.metadata) { $j.metadata } else { $j }
                $info.Version = $m.game_version
                if ($m.loader) { $info.Loader = Get-LoaderFromId $m.loader }
            }
        }
        'curseforge' {
            $j = Read-Json "$dir\minecraftinstance.json"
            if ($j) {
                $info.Version = $j.gameVersion
                if ($j.baseModLoader) {
                    $info.Loader = Get-LoaderFromId $j.baseModLoader.name
                    if (-not $info.Version) { $info.Version = $j.baseModLoader.minecraftVersion }
                } else { $info.Loader = 'vanilla' }
            }
        }
        'mmc' {
            $j = Read-Json "$dir\mmc-pack.json"
            if ($j) {
                $info.Loader = 'vanilla'
                foreach ($c in $j.components) {
                    switch ($c.uid) {
                        'net.minecraft' { $info.Version = $c.version }
                        'net.fabricmc.fabric-loader' { $info.Loader = 'fabric' }
                        'org.quiltmc.quilt-loader' { $info.Loader = 'quilt' }
                        'net.minecraftforge' { $info.Loader = 'forge' }
                        'net.neoforged' { $info.Loader = 'neoforge' }
                    }
                }
            }
        }
        'atl' {
            $j = Read-Json "$dir\instance.json"
            if ($j) {
                $info.Version = $j.id
                if ($j.launcher -and $j.launcher.loaderVersion) { $info.Loader = Get-LoaderFromId $j.launcher.loaderVersion.type }
                elseif ($j.launcher) { $info.Loader = 'vanilla' }
            }
        }
        'gdl' {
            $j = Read-Json "$dir\config.json"
            if ($j -and $j.loader) { $info.Version = $j.loader.mcVersion; $info.Loader = Get-LoaderFromId $j.loader.loaderType }
        }
        'gdlc' {
            $j = Read-Json "$dir\instance.json"
            if ($j -and $j.game_configuration -and $j.game_configuration.version) {
                $v = $j.game_configuration.version
                $info.Version = $v.release
                $ml = @($v.modloaders)
                $info.Loader = if ($ml.Count -and $ml[0]) { Get-LoaderFromId $ml[0].type } else { 'vanilla' }
            }
        }
    }
    return $info
}

# Last resort: a Fabric API jar's name says which Minecraft version it is for.
function Get-InfoFromMods([string]$mods, $info) {
    if (-not (Test-Path -LiteralPath $mods)) { return $info }
    foreach ($f in Get-ChildItem -LiteralPath $mods -File) {
        if ($f.Name -match '^fabric-api-.*\+(.+)\.jar$') {
            if (-not $info.Version) { $info.Version = $Matches[1] }
            if (-not $info.Loader) { $info.Loader = 'fabric' }
        }
    }
    return $info
}

function Get-OfficialDir { return (Join-Path $env:APPDATA '.minecraft') }

# The official launcher keeps named profiles in launcher_profiles.json.
function Find-OfficialProfiles([string]$name) {
    $found = @()
    $file = Join-Path (Get-OfficialDir) 'launcher_profiles.json'
    $j = Read-Json $file
    if (-not $j -or -not $j.profiles) { return $found }
    foreach ($p in $j.profiles.PSObject.Properties) {
        $prof = $p.Value
        if ((Normalize $prof.name) -ne (Normalize $name)) { continue }
        $gameDir = if ($prof.gameDir) { $prof.gameDir } else { Get-OfficialDir }
        $id = "$($prof.lastVersionId)"
        $ver = $null
        if ($id -match '^fabric-loader-[^-]+-(.+)$' -or $id -match '^quilt-loader-[^-]+-(.+)$') { $ver = $Matches[1] }
        elseif ($id -match '^[0-9][0-9.]*$') { $ver = $id }
        $found += @{ Launcher = 'Minecraft Launcher'; Kind = 'official'; Dir = $gameDir; Mods = "$gameDir\mods"
                     ProfileKey = $p.Name; Version = $ver; Loader = (Get-LoaderFromId $id) }
    }
    return $found
}

function Find-Profiles([string]$name) {
    $want = Normalize $name
    $found = @()
    foreach ($r in Get-ProfileRoots) {
        if (-not $r.Root -or -not (Test-Path -LiteralPath $r.Root)) { continue }
        foreach ($d in Get-ChildItem -LiteralPath $r.Root -Directory -ErrorAction SilentlyContinue) {
            if ((Normalize $d.Name) -ne $want) { continue }
            if ($found | Where-Object { $_.Dir -eq $d.FullName }) { continue }
            $info = Get-ProfileInfo $r.Kind $d.FullName
            $mods = Get-ModsDir $r.Kind $d.FullName
            $info = Get-InfoFromMods $mods $info
            $found += @{ Launcher = $r.Launcher; Kind = $r.Kind; Dir = $d.FullName; Mods = $mods
                         Version = $info.Version; Loader = $info.Loader }
        }
    }
    $found += @(Find-OfficialProfiles $name)
    return $found
}

# ---------- downloads ----------

# All Entity Compactor jars published as GitHub releases, newest mod version first.
function Get-ModJars {
    $jars = @()
    try {
        $releases = Get-Web "https://api.github.com/repos/$Repo/releases?per_page=100"
        foreach ($rel in $releases) {
            if ($rel.draft -or $rel.prerelease) { continue }
            foreach ($a in $rel.assets) {
                if ($a.name -match '^entity-compactor-(\d+(\.\d+)*)\+(.+)\.jar$') {
                    $jars += @{ Mc = $Matches[3]; ModVersion = [version]$Matches[1]; Name = $a.name; Url = $a.browser_download_url }
                } elseif ($a.name -eq 'entity-compactor-1.0.0.jar') {
                    $jars += @{ Mc = '1.21.4'; ModVersion = [version]'1.0.0'; Name = $a.name; Url = $a.browser_download_url }
                }
            }
        }
    } catch {
        Say "Could not ask GitHub for the newest version ($($_.Exception.Message)). Using version 1.0.0." 'Yellow'
    }
    if (-not $jars.Count) {
        foreach ($k in $KnownJars.Keys) {
            $j = $KnownJars[$k]
            $jars += @{ Mc = $k; ModVersion = [version]'1.0.0'; Name = $j.Name
                        Url = "https://github.com/$Repo/releases/download/$($j.Tag)/$([uri]::EscapeDataString($j.Name))" }
        }
    }
    return @($jars | Sort-Object -Property @{ Expression = { $_.ModVersion }; Descending = $true })
}

function Get-FabricApiFile([string]$mc) {
    $q = [uri]::EscapeDataString('["fabric"]')
    $g = [uri]::EscapeDataString("[`"$mc`"]")
    $versions = @(Get-Web "https://api.modrinth.com/v2/project/fabric-api/version?loaders=$q&game_versions=$g")
    if (-not $versions.Count) { return $null }
    $sorted = @($versions | Sort-Object -Property @{ Expression = { [datetime]$_.date_published }; Descending = $true })
    $pick = @($sorted | Where-Object { $_.version_type -eq 'release' })
    $v = if ($pick.Count) { $pick[0] } else { $sorted[0] }
    $file = @($v.files | Where-Object { $_.primary })
    if (-not $file.Count) { $file = @($v.files) }
    return @{ Name = $file[0].filename; Url = $file[0].url; Version = $v.version_number }
}

# ---------- Fabric for the official launcher ----------

function Test-FabricInstalled([string]$mc) {
    $versions = Join-Path (Get-OfficialDir) 'versions'
    if (-not (Test-Path -LiteralPath $versions)) { return $null }
    $hit = Get-ChildItem -LiteralPath $versions -Directory |
        Where-Object { $_.Name -match "^fabric-loader-.+-$([regex]::Escape($mc))$" } |
        Sort-Object Name -Descending | Select-Object -First 1
    if ($hit) { return $hit.Name }
    return $null
}

function Find-Java {
    $list = @()
    if ($env:JAVA_HOME) { $list += Join-Path $env:JAVA_HOME 'bin\java.exe' }
    $cmd = Get-Command java.exe -ErrorAction SilentlyContinue
    if ($cmd) { $list += $cmd.Source }
    # The Minecraft Launcher ships its own Java; use it when nothing else is installed.
    $runtimes = @(
        "$env:LOCALAPPDATA\Packages\Microsoft.4297127D64EC6_8wekyb3d8bbwe\LocalCache\Local\runtime"
        "${env:ProgramFiles(x86)}\Minecraft Launcher\runtime"
        "$env:ProgramFiles\Minecraft Launcher\runtime"
        (Join-Path (Get-OfficialDir) 'runtime')
    )
    foreach ($r in $runtimes) {
        if ($r -and (Test-Path -LiteralPath $r)) {
            $list += @(Get-ChildItem -LiteralPath $r -Recurse -Filter java.exe -ErrorAction SilentlyContinue |
                Sort-Object FullName -Descending | ForEach-Object { $_.FullName })
        }
    }
    foreach ($j in $list) { if ($j -and (Test-Path -LiteralPath $j)) { return $j } }
    return $null
}

function Install-Fabric([string]$mc) {
    $java = Find-Java
    if (-not $java) { Say 'Java was not found, so Fabric cannot be installed automatically.' 'Yellow'; return $false }
    try {
        $installers = @(Get-Web 'https://meta.fabricmc.net/v2/versions/installer')
        $stable = @($installers | Where-Object { $_.stable })
        $inst = if ($stable.Count) { $stable[0] } else { $installers[0] }
        $jar = Join-Path $env:TEMP "fabric-installer-$($inst.version).jar"
        Say "Downloading the Fabric installer $($inst.version)..."
        Save-Web $inst.url $jar
        $mcDir = Get-OfficialDir
        $argLine = "-jar `"$jar`" client -dir `"$mcDir`" -mcversion $mc"
        if (-not (Test-Path -LiteralPath (Join-Path $mcDir 'launcher_profiles.json'))) { $argLine += ' -noprofile' }
        Say "Installing Fabric Loader for Minecraft $mc (using $java)..."
        $log = Join-Path $env:TEMP 'fabric-installer-output.txt'
        $p = Start-Process -FilePath $java -ArgumentList $argLine -Wait -PassThru -NoNewWindow -RedirectStandardOutput $log -RedirectStandardError "$log.err"
        Get-Content -LiteralPath $log, "$log.err" -ErrorAction SilentlyContinue | ForEach-Object { Say "  $_" 'DarkGray' }
        return ($p.ExitCode -eq 0)
    } catch {
        Say "The Fabric installer did not work: $($_.Exception.Message)" 'Yellow'
        return $false
    }
}

# Point the user's named launcher profile at the Fabric version (backup kept).
function Set-OfficialProfileVersion([string]$profileKey, [string]$versionId) {
    $file = Join-Path (Get-OfficialDir) 'launcher_profiles.json'
    $j = Read-Json $file
    if (-not $j) { return $false }
    $prof = $j.profiles.$profileKey
    if (-not $prof) { return $false }
    Copy-Item -LiteralPath $file -Destination "$file.before-entity-compactor" -Force
    $prof | Add-Member -NotePropertyName lastVersionId -NotePropertyValue $versionId -Force
    $text = $j | ConvertTo-Json -Depth 64
    [IO.File]::WriteAllText($file, $text, (New-Object System.Text.UTF8Encoding $false))
    return $true
}

function Show-LoaderHelp($launcher) {
    switch -wildcard ($launcher) {
        'Modrinth*'   { Say '  Modrinth App: open the profile, click the three dots > Edit > Installation, and change the loader to Fabric.' }
        'CurseForge'  { Say '  CurseForge: click Create Custom Profile, pick Fabric and the same Minecraft version, then run this installer again for that profile.' }
        'Prism*'      { Say '  Prism Launcher: right-click the instance > Edit > Version > Install Fabric.' }
        'MultiMC'     { Say '  MultiMC: right-click the instance > Edit Instance > Version > Install Fabric.' }
        'PolyMC'      { Say '  PolyMC: right-click the instance > Edit > Version > Install Fabric.' }
        default       { Say '  Make a new profile that uses Fabric (not Forge or NeoForge) for the same Minecraft version.' }
    }
}

# ---------- main ----------

function Main {
    $opt = Read-Arguments $env:EC_ARGS
    Say ''
    Say '  Entity Compactor installer' 'Green'
    Say '  --------------------------' 'Green'
    Say ''

    # 1. Find the profile.
    $target = $null
    if ($opt.Mods) {
        $target = @{ Launcher = 'the folder you chose'; Kind = 'custom'; Dir = $opt.Mods; Mods = $opt.Mods; Version = $null; Loader = $null }
        $i = Get-InfoFromMods $opt.Mods @{ Version = $null; Loader = $null }
        $target.Version = $i.Version; $target.Loader = $i.Loader
    } else {
        $name = $opt.Profile
        if (-not $name) { $name = Ask 'Which Minecraft profile should get the mod?' $DefaultProfile }
        Say "Looking for the profile `"$name`"..."
        $found = @(Find-Profiles $name)
        if ($found.Count -eq 1) {
            $target = $found[0]
        } elseif ($found.Count -gt 1) {
            Say "Found `"$name`" in more than one place:"
            for ($n = 0; $n -lt $found.Count; $n++) { Say "  $($n + 1). $($found[$n].Launcher): $($found[$n].Dir)" }
            $pick = Ask 'Which one? Type the number' '1'
            $idx = 0
            if ([int]::TryParse($pick, [ref]$idx) -and $idx -ge 1 -and $idx -le $found.Count) { $target = $found[$idx - 1] }
            else { $target = $found[0] }
        } else {
            Say "No launcher profile called `"$name`" was found." 'Yellow'
            $off = Get-OfficialDir
            if (-not (AskYes "Install into the normal Minecraft Launcher instead ($off\mods)?" $true)) {
                Say 'Nothing was changed.'
                return 1
            }
            $target = @{ Launcher = 'Minecraft Launcher'; Kind = 'official'; Dir = $off; Mods = "$off\mods"; Version = $null; Loader = $null }
            $i = Get-InfoFromMods $target.Mods @{ Version = $null; Loader = $null }
            $target.Version = $i.Version; $target.Loader = $i.Loader
        }
    }
    Say "Using $($target.Launcher): $($target.Dir)" 'Cyan'
    Note "Profile: $($target.Launcher) - $($target.Dir)"

    # 2. Work out the Minecraft version.
    $mc = $opt.Version
    if (-not $mc -and $target.Version) { $mc = $target.Version; Say "This profile is Minecraft $mc." }
    if (-not $mc) { $mc = Ask 'Which Minecraft version do you play? (26.2 or 1.21.4)' $DefaultVersion }
    $mc = "$mc".Trim()

    # 3. Pick the newest Entity Compactor jar for that version.
    Say 'Checking for the newest Entity Compactor...'
    $jars = @(Get-ModJars)
    $jar = @($jars | Where-Object { $_.Mc -eq $mc }) | Select-Object -First 1
    if (-not $jar) {
        $have = ($jars | ForEach-Object { $_.Mc } | Sort-Object -Unique) -join ', '
        Say "Entity Compactor is not made for Minecraft $mc. It is available for: $have." 'Red'
        Say 'Make a profile with one of those versions, then run this installer again.'
        Note "Not installed: no Entity Compactor for Minecraft $mc (available: $have)."
        return 1
    }

    # 4. The mod only runs on Fabric.
    $loader = $target.Loader
    $official = $target.Kind -eq 'official'
    if (-not $official -and $loader -and $loader -ne 'fabric') {
        if ($loader -eq 'quilt') {
            Say 'This profile uses Quilt. Quilt can usually run Fabric mods, so the install will continue.' 'Yellow'
            Note 'Loader: Quilt (usually runs Fabric mods).'
        } else {
            Say "This profile uses $loader, but Entity Compactor needs Fabric." 'Red'
            Show-LoaderHelp $target.Launcher
            if (-not (AskYes 'Install the files anyway?' $false)) {
                Note "Not installed: the profile uses $loader. Switch it to Fabric and run this again."
                return 2
            }
            Note "Warning: the profile uses $loader; the mod will not load until it uses Fabric."
        }
    }

    # 5. Put our jar in place and remove older copies of it (nothing else is deleted).
    $mods = $target.Mods
    New-Item -ItemType Directory -Path $mods -Force | Out-Null
    $dest = Join-Path $mods $jar.Name
    Say "Downloading $($jar.Name)..."
    try { Save-Web $jar.Url $dest } catch {
        Say "The download failed: $($_.Exception.Message)" 'Red'
        Say 'Check your internet connection and try again.'
        Note 'Not installed: the Entity Compactor download failed.'
        return 1
    }
    Note "Installed $($jar.Name)"
    foreach ($old in Get-ChildItem -LiteralPath $mods -File | Where-Object { $_.Name -match '^entity-compactor-.*\.jar$' -and $_.Name -ne $jar.Name }) {
        try {
            Remove-Item -LiteralPath $old.FullName -Force
            Say "Removed the older $($old.Name)"
            Note "Removed older $($old.Name)"
        } catch {
            Say "Could not remove $($old.Name). Close Minecraft and run this again." 'Yellow'
            Note "Could not remove $($old.Name) (close Minecraft and run again)."
        }
    }

    # 6. Fabric API, unless the right one is already there.
    $apis = @(Get-ChildItem -LiteralPath $mods -File | Where-Object { $_.Name -match '^fabric-api-.*\.jar$' })
    $rightApi = @($apis | Where-Object { $_.Name -like "*+$mc.jar" })
    if ($rightApi.Count) {
        Say "Fabric API is already there ($($rightApi[0].Name))."
        Note "Fabric API already present: $($rightApi[0].Name)"
    } elseif ($apis.Count -and -not ($apis | Where-Object { $_.Name -match '\+' })) {
        # Name doesn't say its version; trust it rather than risk two copies.
        Say "Fabric API is already there ($($apis[0].Name))."
        Note "Fabric API already present: $($apis[0].Name)"
    } else {
        try {
            $api = Get-FabricApiFile $mc
            if (-not $api) { throw "Modrinth has no Fabric API for Minecraft $mc yet" }
            Say "Downloading Fabric API $($api.Version)..."
            Save-Web $api.Url (Join-Path $mods $api.Name)
            Note "Installed Fabric API: $($api.Name)"
            # A Fabric API for another version would stop the game, so switch it off (renamed, not deleted).
            foreach ($wrong in $apis) {
                $off = "$($wrong.FullName).disabled"
                Move-Item -LiteralPath $wrong.FullName -Destination $off -Force
                Say "Turned off $($wrong.Name) (it is for another Minecraft version)." 'Yellow'
                Note "Turned off $($wrong.Name) (renamed to .disabled)"
            }
        } catch {
            Say "Could not download Fabric API: $($_.Exception.Message)" 'Yellow'
            Say "Get it here and put it in the mods folder: https://modrinth.com/mod/fabric-api/versions?g=$mc"
            Note "Fabric API NOT installed - download it from https://modrinth.com/mod/fabric-api/versions?g=$mc"
        }
    }

    # 7. The official launcher needs Fabric Loader installed separately.
    $exitCode = 0
    if ($official) {
        $fabric = Test-FabricInstalled $mc
        if ($fabric) {
            Say "Fabric Loader is installed ($fabric)."
        } elseif (AskYes "Fabric Loader for Minecraft $mc is not installed. Install it now?" $true) {
            if (Install-Fabric $mc) { $fabric = Test-FabricInstalled $mc }
        }
        if ($fabric) {
            Note "Fabric Loader: $fabric"
            # Only a vanilla profile is switched; a Forge one keeps its own mods and setup.
            if ($target.ProfileKey -and (-not $target.Loader -or $target.Loader -eq 'vanilla')) {
                if (Set-OfficialProfileVersion $target.ProfileKey $fabric) {
                    Say "Set the launcher profile to use $fabric (old settings saved as launcher_profiles.json.before-entity-compactor)."
                    Note "Launcher profile now uses $fabric"
                }
            }
        } else {
            Say 'Fabric Loader is still needed:' 'Yellow'
            Say '  1. Get the installer from https://fabricmc.net/use/installer/'
            Say "  2. Open it, choose Client, Minecraft version $mc, and click Install."
            Note "Fabric Loader NOT installed - get it from https://fabricmc.net/use/installer/ (choose $mc)."
            $exitCode = 3
        }
    }

    # 8. Plain-English summary.
    Say ''
    Say '  Summary' 'Green'
    foreach ($s in $Summary) { Say "  - $s" }
    Say "  Mods folder: $mods"
    Say ''
    if ($exitCode -eq 0) {
        Say "All done. Open $($target.Launcher -replace '^a folder.*$', 'your launcher'), start the profile, and play Minecraft $mc." 'Green'
        if ($official) { Say "  In the Minecraft Launcher, pick the 'fabric-loader' installation (or your profile) before pressing Play." }
        Say '  In game, press K to turn Entity Compactor on or off (change it in Options > Controls).'
    }
    Write-Host "EC_INSTALL_RESULT {`"mods`":`"$($mods -replace '\\', '/')`",`"mc`":`"$mc`",`"jar`":`"$($jar.Name)`",`"code`":$exitCode}"
    return $exitCode
}

$code = 1
try { $code = [int](@(Main)[-1]) } catch {
    Say ''
    Say "Something went wrong: $($_.Exception.Message)" 'Red'
    Say 'Take a screenshot of this window and send it to whoever gave you this installer.'
}
if (-not $Quiet) { Say ''; Read-Host 'Press Enter to close this window' | Out-Null }
exit $code
