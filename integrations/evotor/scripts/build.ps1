$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot '..\..'))
$toolRoot = Join-Path $workspaceRoot '.local-tools\evotor'
$env:JAVA_HOME = Join-Path $toolRoot 'jdk-17.0.21+9'
$env:ANDROID_HOME = Join-Path $toolRoot 'sdk'
$env:ANDROID_USER_HOME = Join-Path $toolRoot 'android-user'
$env:GRADLE_USER_HOME = Join-Path $toolRoot 'gradle-cache'
$env:PATH = (Join-Path $env:JAVA_HOME 'bin') + ';' + $env:PATH
& (Join-Path $toolRoot 'gradle-8.9\bin\gradle.bat') -p $projectRoot --no-daemon testDebugUnitTest lintDebug assembleDebug
if ($LASTEXITCODE -ne 0) { throw 'APK build or verification failed' }
$outputDir = Join-Path $workspaceRoot '.release\evotor'
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
$apkName = '1708-kassa-test-0.7.apk'
Copy-Item -LiteralPath (Join-Path $projectRoot 'app\build\outputs\apk\debug\app-debug.apk') -Destination (Join-Path $outputDir $apkName) -Force
Get-FileHash -LiteralPath (Join-Path $outputDir $apkName) -Algorithm SHA256
