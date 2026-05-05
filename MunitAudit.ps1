# =========================================================
# CONFIGURATION
# =========================================================
$RootFolder    = "C:/Users/Saddam/Projects"
$ProjectList   = "C:/path/to/projects.csv"
$LogDir        = "$PSScriptRoot/audit_logs"
$CSVReportPath = "$PSScriptRoot/Audit_Summary.csv"
$Log4jConfig   = "$RootFolder/log4j2-munit-audit.xml"
$BytemanJar    = "C:/tools/byteman/lib/byteman.jar"
$BytemanScript = "C:/audit/leak_detector.btm"
$MaxThreads    = 4
$BasePort      = 9000

# =========================================================
# 1. PRE-FLIGHT
# =========================================================
if (!(Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
[string[]]$Projects = Get-Content $ProjectList | Where-Object { ![string]::IsNullOrWhiteSpace($_) } | ForEach-Object { $_.Trim() }

# FIXED: Now we look for the Byteman tag for 100% accuracy
$LeakPatterns = @(
    @{ Connector = "BYTEMAN-DETECTOR"; Pattern = "\[OUTBOUND-LEAK\]" }
)

Get-ChildItem $LogDir -Filter "*.done" | Remove-Item -Force -ErrorAction SilentlyContinue

# =========================================================
# 2. EXECUTION DASHBOARD (PID TRACKING)
# =========================================================
$LiveProcesses = @{} 
$Counter = 0

foreach ($ProjName in $Projects) {
    $JobPort    = $BasePort + $Counter
    $Counter++
    $FullPath   = Join-Path $RootFolder $ProjName
    $CurrentLog = Join-Path $LogDir "$($ProjName)_audit.log"
    $DoneMarker = Join-Path $LogDir "$($ProjName)_audit.done"

    while ($LiveProcesses.Count -ge $MaxThreads) {
        $FinishedIds = @()
        foreach ($id in $LiveProcesses.Keys) {
            if (!(Get-Process -Id $id -ErrorAction SilentlyContinue)) { $FinishedIds += $id }
        }
        foreach ($id in $FinishedIds) { $LiveProcesses.Remove($id) }
        Start-Sleep -Seconds 2
    }

    $ChildScript = @"
        `$Host.UI.RawUI.WindowTitle = 'AUDIT: $ProjName'
        `$ErrorActionPreference = 'SilentlyContinue'
        Set-Location '$FullPath'
        
        Write-Host '--- GIT SYNC ---' -ForegroundColor Gray
        git reset --hard; git checkout dev; git pull origin dev
        
        Write-Host '--- RUNNING MUNIT ---' -ForegroundColor Yellow
        
        # INJECTING BYTEMAN + LOG4J2
        `$env:JAVA_TOOL_OPTIONS="-javaagent:'$BytemanJar'=script:'$BytemanScript' -Xbootclasspath/a:'$BytemanJar' -Dlog4j.configurationFile='$Log4jConfig'"
        
        mvn clean test -Denv=dev -Dhttp.port=$JobPort -Dmunit.dynamic.port=$JobPort -Dmaven.clean.failOnError=false --no-transfer-progress 2>&1 | Tee-Object -FilePath '$CurrentLog'
        
        Set-Content '$DoneMarker' 'DONE'
        Write-Host '------------------------------------------------'
        Write-Host 'WORK COMPLETE. Press ENTER to signal completion.' -ForegroundColor Cyan
        Read-Host
"@

    $p = Start-Process powershell.exe -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $ChildScript -PassThru
    $LiveProcesses.Add($p.Id, $ProjName)
    Write-Host "[>] Launched: $ProjName" -ForegroundColor Green
}

# =========================================================
# 3. THE UNBREAKABLE WAIT
# =========================================================
Write-Host "`n[*] Waiting for windows to be closed..." -ForegroundColor Cyan
while ($LiveProcesses.Count -gt 0) {
    $FinishedIds = @()
    foreach ($id in $LiveProcesses.Keys) {
        if (!(Get-Process -Id $id -ErrorAction SilentlyContinue)) { $FinishedIds += $id }
    }
    foreach ($id in $FinishedIds) { $LiveProcesses.Remove($id) }
    Start-Sleep -Seconds 3
}

# =========================================================
# 4. CSV GENERATION
# =========================================================
Write-Host "[*] All processes finished. Parsing logs..." -ForegroundColor Green
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
                        Connector   = $h.Line.Split(" ")[1] # Captures PROTOCOL=...
                        Details     = $h.Line.Trim()
                    })
                }
            }
        }
        if (!$leaksFound) {
            $status = if ($LogLines -match "BUILD SUCCESS") { "CLEAN" } else { "INCOMPLETE" }
            $FinalReport.Add([PSCustomObject]@{ Application = $ProjName; Status = $status; Details = "No leaks found" })
        }
    }
}

$FinalReport | Export-Csv -Path $CSVReportPath -NoTypeInformation -Encoding UTF8
Write-Host "`nAUDIT COMPLETE. Report: $CSVReportPath" -ForegroundColor Green
