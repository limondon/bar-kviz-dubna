$ErrorActionPreference = 'Stop'
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$toolRoot = Join-Path $workspaceRoot '.local-tools\evotor'
New-Item -ItemType Directory -Path $toolRoot -Force | Out-Null

function Get-VerifiedArchive($Url, $Name, $ExpectedHash, $Algorithm = 'SHA256') {
    $target = Join-Path $toolRoot $Name
    if ((Test-Path -LiteralPath $target) -and (Get-FileHash -LiteralPath $target -Algorithm $Algorithm).Hash -eq $ExpectedHash) { return $target }
    Write-Host "Downloading $Name"
    & curl.exe --location --fail --retry 2 --connect-timeout 20 --max-time 300 --silent --show-error --output $target $Url
    if ($LASTEXITCODE -ne 0) { throw "Download failed: $Name" }
    if ((Get-FileHash -LiteralPath $target -Algorithm $Algorithm).Hash -ne $ExpectedHash) { throw "Checksum mismatch: $Name" }
    return $target
}

$jdkArchive = Get-VerifiedArchive 'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.21%2B9/OpenJDK17U-jdk_x64_windows_hotspot_17.0.21_9.zip' 'jdk17.zip' '98518ecf554465057ee5509462631deeee374bc368c12a411d225cd29381f84b'
if (-not (Test-Path -LiteralPath (Join-Path $toolRoot 'jdk-17.0.21+9\bin\javac.exe'))) {
    Expand-Archive -LiteralPath $jdkArchive -DestinationPath $toolRoot -Force
}

[xml]$repository = Get-Content -LiteralPath (Join-Path $toolRoot 'repository.xml') -Raw
$cmdPackage = $repository.SelectSingleNode("//*[local-name()='remotePackage'][@path='cmdline-tools;19.0']")
if (-not $cmdPackage) { throw 'Pinned Android command-line tools 19.0 not found in official repository manifest' }
$cmdArchiveInfo = ($cmdPackage.archives.archive | Where-Object { $_.'host-os' -eq 'windows' }).complete
$sdkArchive = Get-VerifiedArchive ('https://dl.google.com/android/repository/' + $cmdArchiveInfo.SelectSingleNode('url').InnerText) 'android-commandline.zip' $cmdArchiveInfo.SelectSingleNode('checksum').InnerText 'SHA1'
if (-not (Test-Path -LiteralPath (Join-Path $toolRoot 'cmdline-tools\bin\sdkmanager.bat'))) {
    Expand-Archive -LiteralPath $sdkArchive -DestinationPath $toolRoot -Force
}

$hashResponse = (Invoke-WebRequest -Uri 'https://downloads.gradle.org/distributions/gradle-8.9-bin.zip.sha256' -UseBasicParsing -TimeoutSec 30).Content
$gradleHash = if ($hashResponse -is [byte[]]) { [Text.Encoding]::UTF8.GetString($hashResponse).Trim() } else { $hashResponse.Trim() }
$gradleArchive = Get-VerifiedArchive 'https://downloads.gradle.org/distributions/gradle-8.9-bin.zip' 'gradle-8.9.zip' $gradleHash
if (-not (Test-Path -LiteralPath (Join-Path $toolRoot 'gradle-8.9\bin\gradle.bat'))) {
    Expand-Archive -LiteralPath $gradleArchive -DestinationPath $toolRoot -Force
}
Write-Host 'Verified portable Java, Gradle and Android command-line tools are ready.'
