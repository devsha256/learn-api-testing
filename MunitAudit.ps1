# =========================================================
# CONFIGURATION
# =========================================================
$BytemanHome   = "C:/tools/byteman-download-4.0.20"
$RulesFile     = "C:/path/to/munit-leak-detector.btm"
$RootFolder    = "C:/Users/Saddam/Projects"
$ProjectList   = "C:/path/to/projects.csv"
$LogDir        = "$PSScriptRoot/audit_logs"
$MaxThreads    = 4  
$BasePort      = 9000
# =========================================================

if (!(Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$AgentJar = "$BytemanHome/lib/byteman.jar"
$Projects = Get-Content $ProjectList | Where-Object { ![string]::IsNullOrWhiteSpace($_) }

Write-Host "Launching Parallel Audit Windows (Max: $MaxThreads)..." -ForegroundColor Cyan

$RunningJobs = @()

foreach ($index in 0..($Projects.Count - 1)) {
    $ProjName = $Projects[$index].Trim()
    $JobPort  = $BasePort + $index
    $FullProjectPath = Join-Path $RootFolder $ProjName
    $CurrentLog = Join-Path $LogDir "$($ProjName)_audit.log"

    # Throttle: Wait until a slot opens up
    while ($RunningJobs.Count -ge $MaxThreads) {
        $RunningJobs = $RunningJobs | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }
        Start-Sleep -Seconds 2
    }

    Write-Host "[>] Launching window for: $ProjName on Port $JobPort" -ForegroundColor Green

    # Construct the command for the new window
    # We use 'Tee-Object' so it shows in the window AND writes to the log file for our final CSV scan.
    $ScriptBlock = @"
        `$Host.UI.RawUI.WindowTitle = 'AUDIT: $ProjName (Port $JobPort)'
        `$env:JAVA_TOOL_OPTIONS = '-javaagent:"$AgentJar"=script:"$RulesFile" -Xbootclasspath/a:"$AgentJar" -Dorg.jboss.byteman.transform.all'
        Set-Location '$FullProjectPath'
        git reset --hard; git checkout dev; git pull origin dev
        mvn clean test "-Denv=dev" "-Dhttp.port=$JobPort" "-Dmunit.dynamic.port=$JobPort" "-Dmaven.clean.failOnError=false" | Tee-Object -FilePath '$CurrentLog'
        Write-Host 'Audit Finished for $ProjName. Closing in 5 seconds...' -ForegroundColor Cyan
        Start-Sleep -Seconds 5
"@

    # Start the new PowerShell process
    $proc = Start-Process powershell.exe -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $ScriptBlock -PassThru
    $RunningJobs += $proc.Id
}

Write-Host "`nAll projects launched. Waiting for windows to close..." -ForegroundColor Cyan

# Final check for Leaks once windows are done
while ($RunningJobs.Count -gt 0) {
    $RunningJobs = $RunningJobs | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 5
}

Write-Host "Generating Final Report..." -ForegroundColor Green
# [The same CSV Generation logic from the previous script goes here...]
