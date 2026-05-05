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
if (!(Test-Path $Log4jConfig)) { Write-Error "Config not found"; exit 1 }

[string[]]$Projects = Get-Content $ProjectList | 
    Where-Object { ![string]::IsNullOrWhiteSpace($_) } | 
    ForEach-Object { $_.Trim() }

# =========================================================
# 2. LEAK PATTERNS
# =========================================================
$LeakPatterns = @(
    @{ Connector = "HTTP"; Pattern = "DEBUG.HttpRequestOperations." },
    @{ Connector = "JMS-PUBLISH"; Pattern = "DEBUG.JmsPublish." },
    @{ Connector = "JMS-CONSUME"; Pattern = "DEBUG.JmsConsume." },
    @{ Connector = "DATABASE"; Pattern = "DEBUG.extension.db." },
    @{ Connector = "SFTP"; Pattern = "DEBUG.extension.sftp." },
    @{ Connector = "SALESFORCE"; Pattern = "DEBUG.extension.salesforce." }
)

# Clean old markers
Get-ChildItem $LogDir -Filter "*.done" | Remove-Item -Force -ErrorAction SilentlyContinue

# =========================================================
# 4. LAUNCH PROJECT WINDOWS
# =========================================================
$RunningProjects = [System.Collections.Generic.List[PSObject]]::new()
$Counter = 0

foreach ($ProjName in $Projects) {
    $JobPort    = $BasePort + $Counter
    $Counter++
    $FullPath   = Join-Path $RootFolder $ProjName
    $CurrentLog = Join-Path $LogDir "$($ProjName)_audit.log"
    $DoneMarker = Join-Path $LogDir "$($ProjName)_audit.done"

    # Throttle
    while (($RunningProjects | Where-Object { !(Test-Path $_.DoneMarker) }).Count -ge $MaxThreads) {
        Start-Sleep -Seconds 3
    }

    $ChildScript = @"
        `$Host.UI.RawUI.WindowTitle = 'AUDIT: $ProjName'
        Set-Location '$FullPath'
        
        Write-Host '--- GIT SYNC ---' -ForegroundColor Gray
        git reset --hard
        git checkout dev
        git pull origin dev
        
        Write-Host '--- RUNNING MUNIT ---' -ForegroundColor Yellow
        `$env:JAVA_TOOL_OPTIONS='-Dlog4j.configurationFile="$Log4jConfig"'
        
        # FIXED: Using cmd /c with redirection to allow stdout and stderr to hit the same file
        cmd /c "mvn clean test -Denv=dev -Dhttp.port=$JobPort -Dmunit.dynamic.port=$JobPort -Dmaven.clean.failOnError=false --no-transfer-progress > `"$CurrentLog`" 2>&1"
        
        Write-Host 'Maven Execution Finished.' -ForegroundColor Cyan
        
        # Mandatory delay for I/O flush
        Start-Sleep -Seconds 2
        Set-Content '$DoneMarker' 'DONE'
        
        Write-Host '----------------------------------------'
        Write-Host 'Audit Finished. Press ENTER to close.' -ForegroundColor Green
        Read-Host
"@

    $p = Start-Process powershell.exe -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $ChildScript -PassThru
    $RunningProjects.Add([PSCustomObject]@{ Name = $ProjName; DoneMarker = $DoneMarker; LogFile = $CurrentLog })
    
    Write-Host "[>] Started: $ProjName" -ForegroundColor Green
}

# =========================================================
# 5. WAIT FOR COMPLETION
# =========================================================
Write-Host "`n[*] Waiting for all projects to finish..." -ForegroundColor Cyan
while (($RunningProjects | Where-Object { !(Test-Path $_.DoneMarker) }).Count -gt 0) {
    Start-Sleep -Seconds 5
}

# Final cooling period to ensure file locks are released
Write-Host "[*] Finalizing logs..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# =========================================================
# 6. PARSE LOGS & GENERATE REPORT
# =========================================================
$FinalReport = New-Object System.Collections.Generic.List[PSObject]

foreach ($item in $RunningProjects) {
    if (!(Test-Path $item.LogFile)) {
        $FinalReport.Add([PSCustomObject]@{ Application = $item.Name; Status = "NO_LOG"; Connector = ""; Details = "Log missing" })
        continue
    }

    $LogLines = Get-Content $item.LogFile
    $leaksFound = $false

    foreach ($p in $LeakPatterns) {
        $hits = $LogLines | Select-String -Pattern $p.Pattern
        if ($hits) {
            $leaksFound = $true
            foreach ($h in $hits) {
                $FinalReport.Add([PSCustomObject]@{
                    Application = $item.Name
                    Status      = "LEAK_DETECTED"
                    Connector   = $p.Connector
                    Details     = $h.Line.Trim()
                })
            }
        }
    }

    if (!$leaksFound) {
        $status = if ($LogLines -match "BUILD SUCCESS|BUILD FAILURE") { "CLEAN" } else { "INCOMPLETE" }
        $FinalReport.Add([PSCustomObject]@{ Application = $item.Name; Status = $status; Connector = ""; Details = "No leaks" })
    }
}

$FinalReport | Export-Csv -Path $CSVReportPath -NoTypeInformation -Encoding UTF8
Write-Host "Summary generated: $CSVReportPath" -ForegroundColor Green
