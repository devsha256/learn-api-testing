# =========================================================
# CONFIGURATION
# =========================================================
$RootFolder    = "C:/Users/Saddam/Projects"
$ProjectList   = "C:/path/to/projects.csv"
$LogDir        = "$PSScriptRoot/audit_logs"
$CSVReportPath = "$PSScriptRoot/Audit_Summary.csv"
$Log4jConfig   = "$RootFolder/log4j2-munit-audit.xml"
$MaxThreads    = 4
$BasePort      = 9000

# =========================================================
# 1. PRE-FLIGHT
# =========================================================
if (!(Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
[string[]]$Projects = Get-Content $ProjectList | Where-Object { ![string]::IsNullOrWhiteSpace($_) } | ForEach-Object { $_.Trim() }

$LeakPatterns = @(
    @{ Connector = "HTTP"; Pattern = "DEBUG.HttpRequestOperations." },
    @{ Connector = "JMS-PUBLISH"; Pattern = "DEBUG.JmsPublish." },
    @{ Connector = "JMS-CONSUME"; Pattern = "DEBUG.JmsConsume." },
    @{ Connector = "DATABASE"; Pattern = "DEBUG.extension.db." },
    @{ Connector = "SFTP"; Pattern = "DEBUG.extension.sftp." },
    @{ Connector = "SALESFORCE"; Pattern = "DEBUG.extension.salesforce." }
)

# --- CLEANUP ---
Get-ChildItem $LogDir -Filter "*.done" | Remove-Item -Force -ErrorAction SilentlyContinue

# =========================================================
# 4. LAUNCH & TRACK BY PROCESS ID
# =========================================================
$LiveProcesses = @{} # Using a Hashtable to track PID -> ProjectName
$Counter = 0

foreach ($ProjName in $Projects) {
    $JobPort    = $BasePort + $Counter
    $Counter++
    $FullPath   = Join-Path $RootFolder $ProjName
    $CurrentLog = Join-Path $LogDir "$($ProjName)_audit.log"
    $DoneMarker = Join-Path $LogDir "$($ProjName)_audit.done"

    # THROTTLE: Wait until a window is closed manually or finishes
    while ($LiveProcesses.Count -ge $MaxThreads) {
        $FinishedIds = @()
        foreach ($id in $LiveProcesses.Keys) {
            if (!(Get-Process -Id $id -ErrorAction SilentlyContinue)) { $FinishedIds += $id }
        }
        foreach ($id in $FinishedIds) { $LiveProcesses.Remove($id) }
        
        if ($LiveProcesses.Count -ge $MaxThreads) { Start-Sleep -Seconds 3 }
    }

    $ChildScript = @"
        `$Host.UI.RawUI.WindowTitle = 'AUDIT: $ProjName'
        Set-Location '$FullPath'
        Write-Host '--- GIT SYNC ---' -ForegroundColor Gray
        git reset --hard; git checkout dev; git pull origin dev
        Write-Host '--- RUNNING MUNIT ---' -ForegroundColor Yellow
        `$env:JAVA_TOOL_OPTIONS='-Dlog4j.configurationFile="$Log4jConfig"'
        cmd /c "mvn clean test -Denv=dev -Dhttp.port=$JobPort -Dmunit.dynamic.port=$JobPort -Dmaven.clean.failOnError=false --no-transfer-progress > `"$CurrentLog`" 2>&1"
        Set-Content '$DoneMarker' 'DONE'
        Write-Host 'Audit Finished. Window will stay open for inspection.' -ForegroundColor Cyan
        Read-Host 'Press ENTER to signal completion to master script...'
"@

    $p = Start-Process powershell.exe -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $ChildScript -PassThru
    $LiveProcesses.Add($p.Id, $ProjName)
    Write-Host "[>] Launched: $ProjName (PID: $($p.Id))" -ForegroundColor Green
}

# =========================================================
# 5. THE FAIL-SAFE WAIT
# =========================================================
Write-Host "`n[*] ALL PROJECTS QUEUED. Waiting for ALL windows to be closed..." -ForegroundColor Cyan

while ($LiveProcesses.Count -gt 0) {
    $FinishedIds = @()
    foreach ($id in $LiveProcesses.Keys) {
        if (!(Get-Process -Id $id -ErrorAction SilentlyContinue)) { $FinishedIds += $id }
    }
    foreach ($id in $FinishedIds) { 
        Write-Host "    [X] Process $($id) ($($LiveProcesses[$id])) closed." -ForegroundColor Gray
        $LiveProcesses.Remove($id) 
    }
    if ($LiveProcesses.Count -gt 0) { Start-Sleep -Seconds 5 }
}

Write-Host "[*] All child processes exited. Finalizing CSV..." -ForegroundColor Green
Start-Sleep -Seconds 2 # Safety buffer for file system sync

# =========================================================
# 6. PARSE LOGS
# =========================================================
$FinalReport = New-Object System.Collections.Generic.List[PSObject]

foreach ($ProjName in $Projects) {
    $LogFile = Join-Path $LogDir "$($ProjName)_audit.log"
    if (Test-Path $LogFile) {
        $LogLines = Get-Content $LogFile
        $leaksFound = $false
        foreach ($p in $LeakPatterns) {
            $hits = $LogLines | Select-String -Pattern $p.Pattern
            if ($hits) {
                $leaksFound = $true
                foreach ($h in $hits) {
                    $FinalReport.Add([PSCustomObject]@{
                        Application = $ProjName
                        Status      = "LEAK_DETECTED"
                        Connector   = $p.Connector
                        Details     = $h.Line.Trim()
                    })
                }
            }
        }
        if (!$leaksFound) {
            $status = if ($LogLines -match "BUILD SUCCESS") { "CLEAN" } else { "BUILD_FAILED_OR_INCOMPLETE" }
            $FinalReport.Add([PSCustomObject]@{ Application = $ProjName; Status = $status; Details = "Checked" })
        }
    }
}

$FinalReport | Export-Csv -Path $CSVReportPath -NoTypeInformation -Encoding UTF8
Write-Host "Summary generated at: $CSVReportPath" -ForegroundColor Green
