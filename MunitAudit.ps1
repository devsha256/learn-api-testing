# =========================================================
# CONFIGURATION
# =========================================================
$RootFolder    = "C:/VistrCorp/AzureRepos"
$ProjectList   = "C:/VistrCorp/AzureRepos/projects.csv"
$LogDir        = "$PSScriptRoot/audit_logs"
$LeakDir       = "$PSScriptRoot/leak_reports"
$CSVReportPath = "$PSScriptRoot/Audit_Summary.csv"
$SnifferScript = "C:/VistrCorp/AzureRepos/munit_sniffer.py"
$MaxThreads    = 4
# =========================================================

# =========================================================
# 1. PRE-FLIGHT
# =========================================================
if (!(Test-Path $LogDir))  { New-Item -ItemType Directory -Path $LogDir  | Out-Null }
if (!(Test-Path $LeakDir)) { New-Item -ItemType Directory -Path $LeakDir | Out-Null }

if (!(Test-Path $ProjectList)) {
    Write-Error "Project list not found: $ProjectList"
    exit 1
}
if (!(Test-Path $SnifferScript)) {
    Write-Error "Sniffer script not found: $SnifferScript"
    exit 1
}

[string[]]$Projects = Get-Content $ProjectList |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
    ForEach-Object { $_.Trim() }

if ($Projects.Count -eq 0) {
    Write-Error "No projects found in $ProjectList"
    exit 1
}

Get-ChildItem $LogDir  -Filter "*.done" | Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem $LeakDir -Filter "*_leaks.json" | Remove-Item -Force -ErrorAction SilentlyContinue

Write-Host "[*] Projects loaded : $($Projects.Count)" -ForegroundColor Cyan
Write-Host "[*] Log directory   : $LogDir"            -ForegroundColor Cyan
Write-Host "[*] Leak directory  : $LeakDir"           -ForegroundColor Cyan

# =========================================================
# 2. LAUNCH ONE WINDOW PER PROJECT
# =========================================================
$LiveProcesses = @{}
$Counter = 0

foreach ($ProjName in $Projects) {
    $Counter++
    $FullPath    = Join-Path $RootFolder $ProjName
    $CurrentLog  = Join-Path $LogDir "$($ProjName)_audit.log"
    $DoneMarker  = Join-Path $LogDir "$($ProjName)_audit.done"

    if (!(Test-Path $FullPath)) {
        Write-Host "[!] SKIP: $ProjName not found at $FullPath" -ForegroundColor Red
        continue
    }

    # Throttle: wait until a slot opens
    while ($LiveProcesses.Count -ge $MaxThreads) {
        $FinishedIds = @()
        foreach ($id in $LiveProcesses.Keys) {
            if (!(Get-Process -Id $id -ErrorAction SilentlyContinue)) {
                $FinishedIds += $id
            }
        }
        foreach ($id in $FinishedIds) { $LiveProcesses.Remove($id) }
        Start-Sleep -Seconds 2
    }

    # Build child script as a plain string.
    # No backtick line continuations inside the heredoc.
    # No special characters.
    # mvn command is one single line.
    # Sniffer is launched against the mvn PID immediately after mvn starts.
    $ChildScript = @"
`$Host.UI.RawUI.WindowTitle = 'AUDIT: $ProjName'

Write-Host '======================================' -ForegroundColor Cyan
Write-Host '  PROJECT : $ProjName'                 -ForegroundColor Cyan
Write-Host '======================================' -ForegroundColor Cyan

Write-Host '--- GIT SYNC ---' -ForegroundColor Gray
Set-Location '$FullPath'
git reset --hard
git checkout dev
git pull origin dev

Write-Host '--- STARTING MUNIT ---' -ForegroundColor Yellow

`$mvnProc = Start-Process "mvn" -ArgumentList "clean","test","com.mulesoft.munit.tools:munit-maven-plugin:coverage-report","-Dsecurekey=pass@2025","-Denv=dev","--no-transfer-progress" -PassThru -NoNewWindow -RedirectStandardOutput '$CurrentLog' -RedirectStandardError '$CurrentLog'

Write-Host "  mvn started with PID `$(`$mvnProc.Id)" -ForegroundColor DarkGray

`$snifferProc = Start-Process "python" -ArgumentList "$SnifferScript","--pid","`$(`$mvnProc.Id)","--project","$ProjName","--out","$LeakDir" -PassThru -NoNewWindow

Write-Host "  sniffer started with PID `$(`$snifferProc.Id)" -ForegroundColor DarkGray

`$mvnProc.WaitForExit()
Write-Host "  mvn finished with exit code `$(`$mvnProc.ExitCode)" -ForegroundColor DarkGray

`$snifferProc.WaitForExit(15000) | Out-Null

Set-Content '$DoneMarker' 'DONE'

Write-Host '======================================' -ForegroundColor Cyan
Write-Host '  DONE: $ProjName'                     -ForegroundColor Cyan
Write-Host '======================================' -ForegroundColor Cyan
Read-Host 'Press ENTER to close this window'
"@

    $p = Start-Process powershell.exe `
        -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $ChildScript `
        -PassThru

    $LiveProcesses.Add($p.Id, $ProjName)
    Write-Host "[>] Launched: $ProjName (PID $($p.Id))" -ForegroundColor Green
}

# =========================================================
# 3. WAIT FOR ALL WINDOWS TO CLOSE
# =========================================================
Write-Host ""
Write-Host "[*] Waiting for all windows to complete..." -ForegroundColor Cyan

while ($LiveProcesses.Count -gt 0) {
    $FinishedIds = @()
    foreach ($id in $LiveProcesses.Keys) {
        if (!(Get-Process -Id $id -ErrorAction SilentlyContinue)) {
            $FinishedIds += $id
        }
    }
    foreach ($id in $FinishedIds) { $LiveProcesses.Remove($id) }
    Start-Sleep -Seconds 3
}

Write-Host "[*] All windows closed." -ForegroundColor Cyan

# =========================================================
# 4. PARSE LEAK JSON REPORTS AND BUILD CSV
# =========================================================
Write-Host "[*] Parsing leak reports..." -ForegroundColor Cyan

$FinalReport = New-Object System.Collections.Generic.List[PSObject]

foreach ($ProjName in $Projects) {
    $LeakFile = Join-Path $LeakDir "$($ProjName)_leaks.json"
    $LogFile  = Join-Path $LogDir  "$($ProjName)_audit.log"

    if (!(Test-Path $LeakFile)) {
        $FinalReport.Add([PSCustomObject]@{
            Application = $ProjName
            Status      = "NO_REPORT"
            Connector   = ""
            RemoteHost  = ""
            RemotePort  = ""
            Timestamp   = ""
            Details     = "Leak report not produced"
        })
        continue
    }

    $json      = Get-Content $LeakFile -Raw | ConvertFrom-Json
    $leakCount = $json.leak_count

    if ($leakCount -eq 0) {
        $logLines = if (Test-Path $LogFile) { Get-Content $LogFile } else { @() }
        $status   = if ($logLines | Select-String -Pattern "BUILD SUCCESS|Tests run:") { "CLEAN" } else { "INCOMPLETE" }
        $FinalReport.Add([PSCustomObject]@{
            Application = $ProjName
            Status      = $status
            Connector   = ""
            RemoteHost  = ""
            RemotePort  = ""
            Timestamp   = ""
            Details     = "No outbound connections detected"
        })
    } else {
        foreach ($leak in $json.leaks) {
            $FinalReport.Add([PSCustomObject]@{
                Application = $ProjName
                Status      = "LEAK_DETECTED"
                Connector   = $leak.connector
                RemoteHost  = $leak.hostname
                RemotePort  = $leak.remote_port
                Timestamp   = $leak.timestamp
                Details     = "$($leak.connector) -> $($leak.hostname):$($leak.remote_port)"
            })
        }
    }
}

$FinalReport | Export-Csv -Path $CSVReportPath -NoTypeInformation -Encoding UTF8

# =========================================================
# 5. CONSOLE SUMMARY
# =========================================================
$leakProjects  = $FinalReport | Where-Object { $_.Status -eq "LEAK_DETECTED" } | Select-Object -ExpandProperty Application -Unique
$cleanProjects = $FinalReport | Where-Object { $_.Status -eq "CLEAN"         } | Select-Object -ExpandProperty Application -Unique
$noReport      = $FinalReport | Where-Object { $_.Status -in "NO_REPORT","INCOMPLETE" } | Select-Object -ExpandProperty Application -Unique

Write-Host ""
Write-Host "==========================================" -ForegroundColor White
Write-Host "  MUNIT OUTBOUND LEAK AUDIT FINAL SUMMARY" -ForegroundColor White
Write-Host "==========================================" -ForegroundColor White
Write-Host "  Total    : $($Projects.Count)"
Write-Host "  CLEAN    : $($cleanProjects.Count)" -ForegroundColor Green
Write-Host "  LEAKS    : $($leakProjects.Count)"  -ForegroundColor Red
Write-Host "  NO DATA  : $($noReport.Count)"      -ForegroundColor Yellow
Write-Host "==========================================" -ForegroundColor White

if ($leakProjects.Count -gt 0) {
    Write-Host ""
    Write-Host "  Projects with leaks:" -ForegroundColor Red
    foreach ($p in $leakProjects) {
        $connectors = (
            $FinalReport |
            Where-Object { $_.Application -eq $p -and $_.Status -eq "LEAK_DETECTED" } |
            Select-Object -ExpandProperty Connector -Unique
        ) -join ", "
        Write-Host "    - $p [$connectors]" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "[*] Report saved to: $CSVReportPath" -ForegroundColor Green
