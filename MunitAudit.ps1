# =========================================================
# CONFIGURATION - UPDATE THESE PATHS
# =========================================================
$RootFolder    = "C:/Users/Saddam/Projects"
$ProjectList   = "C:/path/to/projects.csv"
$LogDir        = "$PSScriptRoot/audit_logs"
$CSVReportPath = "$PSScriptRoot/Audit_Summary.csv"
$Log4jConfig   = "$RootFolder/log4j2-munit-audit.xml"
$MaxThreads    = 4
$BasePort      = 9000
# =========================================================

# =========================================================
# 1. PRE-FLIGHT
# =========================================================
if (!(Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }

if (!(Test-Path $Log4jConfig)) {
    Write-Error "log4j2 audit config not found at: $Log4jConfig. Please place log4j2-munit-audit.xml in $RootFolder before running."
    exit 1
}
Write-Host "[*] Using log4j2 audit config: $Log4jConfig" -ForegroundColor Cyan

[string[]]$Projects = Get-Content $ProjectList |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
    ForEach-Object { $_.Trim() }

if ($Projects.Count -eq 0) { Write-Error "No projects found in $ProjectList"; exit 1 }

# =========================================================
# 2. LEAK DETECTION PATTERNS
# =========================================================
$LeakPatterns = @(
    [PSCustomObject]@{ Connector = "HTTP"         ; Pattern = "DEBUG.*HttpRequestOperations.*"  },
    [PSCustomObject]@{ Connector = "JMS-PUBLISH"  ; Pattern = "DEBUG.*JmsPublish.*"             },
    [PSCustomObject]@{ Connector = "JMS-CONSUME"  ; Pattern = "DEBUG.*JmsConsume.*"             },
    [PSCustomObject]@{ Connector = "DATABASE"     ; Pattern = "DEBUG.*extension\.db.*"          },
    [PSCustomObject]@{ Connector = "SFTP"         ; Pattern = "DEBUG.*extension\.sftp.*"        },
    [PSCustomObject]@{ Connector = "VM"           ; Pattern = "DEBUG.*extensions\.vm.*"         },
    [PSCustomObject]@{ Connector = "OBJECT-STORE" ; Pattern = "DEBUG.*extension\.objectstore.*" },
    [PSCustomObject]@{ Connector = "SALESFORCE"   ; Pattern = "DEBUG.*extension\.salesforce.*"  }
)

# =========================================================
# 3. LAUNCH ONE POWERSHELL WINDOW PER PROJECT
#    Each window:
#      - shows full live Maven output
#      - tees output to its own log file
#      - prompts "Press ENTER to close" when done
#    Parent throttles to $MaxThreads active windows.
# =========================================================
Write-Host "`n[*] Launching audit windows for $($Projects.Count) projects (MaxThreads=$MaxThreads)..." -ForegroundColor Cyan
$StartTime   = Get-Date

# Tracks [PSCustomObject]@{ Name; Process } for all launched windows
$RunningProcs = [System.Collections.Generic.List[PSCustomObject]]::new()
$Counter      = 0

foreach ($ProjName in $Projects) {
    $JobPort    = $BasePort + $Counter
    $FullPath   = Join-Path $RootFolder $ProjName
    $CurrentLog = Join-Path $LogDir "$($ProjName)_audit.log"
    $Counter++

    if (!(Test-Path $FullPath)) {
        Write-Host "  [!] SKIP: $ProjName - path not found ($FullPath)" -ForegroundColor Red
        continue
    }

    # ── Throttle: wait until a slot is free ──────────────────────────────
    do {
        $activeProcs = $RunningProcs | Where-Object {
            -not $_.Process.HasExited
        }
        if ($activeProcs.Count -ge $MaxThreads) {
            $active    = $activeProcs.Count
            $completed = $RunningProcs.Count - $active
            Write-Host "    [~] Slots full ($active running / $completed done). Waiting..." -ForegroundColor DarkCyan
            Start-Sleep -Seconds 3
        }
    } while ($activeProcs.Count -ge $MaxThreads)

    # ── Build the child script that runs inside the new window ────────────
    $ChildScript = @"
`$Host.UI.RawUI.WindowTitle = 'AUDIT: $ProjName'

Write-Host '========================================' -ForegroundColor Cyan
Write-Host '  PROJECT : $ProjName' -ForegroundColor Cyan
Write-Host '  PORT    : $JobPort'  -ForegroundColor Cyan
Write-Host '  LOG     : $CurrentLog' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan

# ── GIT SYNC ──────────────────────────────────────────
Write-Host '--- SYNCING GIT ---' -ForegroundColor Gray
Set-Location '$FullPath'
git reset --hard
git checkout dev
git pull origin dev

# ── SET LOG4J OVERRIDE ────────────────────────────────
# Points the JVM at the shared external log4j2 audit config.
# No Byteman. No agent. No classloader issues.
`$env:JAVA_TOOL_OPTIONS = '-Dlog4j.configurationFile="$Log4jConfig"'

# ── RUN MUNIT ─────────────────────────────────────────
Write-Host '--- RUNNING MUNIT ---' -ForegroundColor Yellow
mvn clean test ``
    "-Denv=dev" ``
    "-Dhttp.port=$JobPort" ``
    "-Dmunit.dynamic.port=$JobPort" ``
    "-Dmaven.clean.failOnError=false" ``
    "--no-transfer-progress" | Tee-Object -FilePath '$CurrentLog'

`$env:JAVA_TOOL_OPTIONS = ''

Write-Host ''
Write-Host '========================================' -ForegroundColor Cyan
Write-Host "  DONE: $ProjName" -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan
Read-Host 'Press ENTER to close this window'
"@

    $proc = Start-Process powershell.exe `
        -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $ChildScript `
        -PassThru

    $RunningProcs.Add([PSCustomObject]@{
        Name    = $ProjName
        Process = $proc
    })

    Write-Host "  [>] Launched window: $ProjName (PID $($proc.Id), port $JobPort)" -ForegroundColor Green
}

# =========================================================
# 4. LIVE PROGRESS MONITOR
#    Continuously prints running / completed counts until
#    every window process has exited.
# =========================================================
Write-Host "`n[*] All windows launched. Monitoring progress..." -ForegroundColor Cyan
Write-Host "    (Each window will prompt 'Press ENTER' when its Maven run finishes)`n" -ForegroundColor DarkCyan

do {
    Start-Sleep -Seconds 5

    $stillRunning = $RunningProcs | Where-Object { -not $_.Process.HasExited }
    $done         = $RunningProcs | Where-Object {       $_.Process.HasExited }

    Write-Host "    Running: $($stillRunning.Count) | Completed: $($done.Count) | Total: $($RunningProcs.Count)" -ForegroundColor DarkCyan

    if ($stillRunning.Count -gt 0) {
        $names = ($stillRunning | Select-Object -ExpandProperty Name) -join ", "
        Write-Host "    Still running: $names" -ForegroundColor DarkGray
    }

} while ($stillRunning.Count -gt 0)

$Duration = (Get-Date) - $StartTime
Write-Host "`n[*] All windows have completed in $([math]::Round($Duration.TotalSeconds, 1))s" -ForegroundColor Cyan

# =========================================================
# 5. PARSE LOGS AND BUILD REPORT
# =========================================================
Write-Host "[*] Parsing logs for leak signals..." -ForegroundColor Cyan

$FinalReport = [System.Collections.Generic.List[PSCustomObject]]::new()

foreach ($ProjName in $Projects) {
    $LogFile = Join-Path $LogDir "$($ProjName)_audit.log"

    if (!(Test-Path $LogFile)) {
        $FinalReport.Add([PSCustomObject]@{
            Application     = $ProjName
            Status          = "NO_LOG"
            Connector       = ""
            LeakCount       = 0
            FirstOccurrence = ""
            Details         = "Log file not produced - project may have been skipped"
        })
        continue
    }

    $LogLines   = Get-Content $LogFile
    $foundLeaks = [System.Collections.Generic.List[PSCustomObject]]::new()

    foreach ($pattern in $LeakPatterns) {
        $hits = $LogLines | Select-String -Pattern $pattern.Pattern
        if ($hits) {
            foreach ($hit in $hits) {
                $foundLeaks.Add([PSCustomObject]@{
                    Application     = $ProjName
                    Status          = "LEAK_DETECTED"
                    Connector       = $pattern.Connector
                    LeakCount       = $hits.Count
                    FirstOccurrence = $hit.LineNumber
                    Details         = $hit.Line.Trim()
                })
            }
        }
    }

    if ($foundLeaks.Count -gt 0) {
        $FinalReport.AddRange($foundLeaks)
    } else {
        $testRan = $LogLines | Select-String -Pattern "BUILD SUCCESS|BUILD FAILURE|Tests run:"
        $status  = if ($testRan) { "CLEAN" } else { "NO_TESTS_RAN" }
        $FinalReport.Add([PSCustomObject]@{
            Application     = $ProjName
            Status          = $status
            Connector       = ""
            LeakCount       = 0
            FirstOccurrence = ""
            Details         = if ($status -eq "CLEAN") {
                                  "No connector DEBUG logs detected - all mocks applied correctly"
                              } else {
                                  "Maven output did not confirm test execution - check log"
                              }
        })
    }
}

# =========================================================
# 6. EXPORT CSV + PRINT CONSOLE SUMMARY
# =========================================================
$FinalReport | Export-Csv -Path $CSVReportPath -NoTypeInformation -Encoding UTF8

$leakProjects  = $FinalReport | Where-Object { $_.Status -eq "LEAK_DETECTED"          } | Select-Object -ExpandProperty Application -Unique
$cleanProjects = $FinalReport | Where-Object { $_.Status -eq "CLEAN"                  } | Select-Object -ExpandProperty Application -Unique
$noLog         = $FinalReport | Where-Object { $_.Status -in "NO_LOG","NO_TESTS_RAN"  } | Select-Object -ExpandProperty Application -Unique

Write-Host "`n============================================" -ForegroundColor White
Write-Host "  MUNIT OUTBOUND LEAK AUDIT - FINAL SUMMARY"  -ForegroundColor White
Write-Host "============================================"  -ForegroundColor White
Write-Host "  Total projects   : $($Projects.Count)"
Write-Host "  CLEAN            : $($cleanProjects.Count)"  -ForegroundColor Green
Write-Host "  LEAK DETECTED    : $($leakProjects.Count)"   -ForegroundColor Red
Write-Host "  NO LOG / SKIPPED : $($noLog.Count)"          -ForegroundColor Yellow
Write-Host "  Duration         : $([math]::Round($Duration.TotalSeconds, 1))s"
Write-Host "============================================"  -ForegroundColor White

if ($leakProjects.Count -gt 0) {
    Write-Host "`n  Projects with leaks:" -ForegroundColor Red
    foreach ($p in $leakProjects) {
        $connectors = (
            $FinalReport |
            Where-Object { $_.Application -eq $p -and $_.Status -eq "LEAK_DETECTED" } |
            Select-Object -ExpandProperty Connector -Unique
        ) -join ", "
        Write-Host "    - $p  [$connectors]" -ForegroundColor Red
    }
}

Write-Host "`n[*] Full report saved to: $CSVReportPath" -ForegroundColor Green
