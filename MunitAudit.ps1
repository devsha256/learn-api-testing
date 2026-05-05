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

if (!(Get-Module -ListAvailable -Name ThreadJob)) {
    Write-Host "[*] Installing ThreadJob module (one-time)..." -ForegroundColor Yellow
    Install-Module -Name ThreadJob -Scope CurrentUser -Force -ErrorAction Stop
}
Import-Module ThreadJob

[string[]]$Projects = Get-Content $ProjectList |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
    ForEach-Object { $_.Trim() }

if ($Projects.Count -eq 0) { Write-Error "No projects found in $ProjectList"; exit 1 }

# =========================================================
# 2. LEAK DETECTION PATTERNS
#    Match what Mule connectors actually log at DEBUG
#    when a real outbound call is made.
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
# 3. CONCURRENT EXECUTION VIA Start-ThreadJob
#    Runs inside the same PowerShell process.
#    No new windows. Throttled to $MaxThreads.
# =========================================================
Write-Host "`n[*] Starting audit across $($Projects.Count) projects (MaxThreads=$MaxThreads)..." -ForegroundColor Cyan
$StartTime = Get-Date
$Jobs      = [System.Collections.Generic.List[object]]::new()
$Counter   = 0

foreach ($ProjName in $Projects) {
    $JobPort     = $BasePort + $Counter
    $FullPath    = Join-Path $RootFolder $ProjName
    $CurrentLog  = Join-Path $LogDir "$($ProjName)_audit.log"
    $Counter++

    if (!(Test-Path $FullPath)) {
        Write-Host "  [!] SKIP: $ProjName - path not found ($FullPath)" -ForegroundColor Red
        continue
    }

    $job = Start-ThreadJob -ThrottleLimit $MaxThreads -ScriptBlock {
        param($projName, $fullPath, $jobPort, $currentLog, $log4jConfig)

        $stepLog = [System.Collections.Generic.List[string]]::new()
        $stepLog.Add("=== AUDIT START: $projName at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===")

        try {
            # --- GIT SYNC ---
            $stepLog.Add("[GIT] Syncing $projName...")
            Push-Location $fullPath
            git reset --hard  2>&1 | Out-Null
            git checkout dev  2>&1 | Out-Null
            git pull origin dev 2>&1 | Out-Null
            $stepLog.Add("[GIT] Sync complete.")

            # --- SET JAVA_TOOL_OPTIONS ---
            # Points JVM at the external log4j2 config in the root folder.
            # No Byteman, no agent, no classloader issues.
            $env:JAVA_TOOL_OPTIONS = "-Dlog4j.configurationFile=`"$log4jConfig`""

            # --- RUN MUNIT ---
            $stepLog.Add("[MVN] Running: mvn clean test -Denv=dev -Dhttp.port=$jobPort")
            $mvnOutput = mvn clean test `
                "-Denv=dev" `
                "-Dhttp.port=$jobPort" `
                "-Dmunit.dynamic.port=$jobPort" `
                "-Dmaven.clean.failOnError=false" `
                "--no-transfer-progress" `
                2>&1

            $stepLog.Add("[MVN] Maven exit code: $LASTEXITCODE")
            $stepLog.AddRange([string[]]$mvnOutput)

        } catch {
            $stepLog.Add("[ERROR] Exception: $_")
        } finally {
            Pop-Location
            $env:JAVA_TOOL_OPTIONS = ""
        }

        $stepLog.Add("=== AUDIT END: $projName at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===")
        $stepLog | Set-Content -Path $currentLog -Encoding UTF8
        return $projName

    } -ArgumentList $ProjName, $FullPath, $JobPort, $CurrentLog, $Log4jConfig

    $Jobs.Add($job)
    Write-Host "  [>] Queued: $ProjName (port $JobPort, job $($job.Id))" -ForegroundColor Green
}

# =========================================================
# 4. LIVE PROGRESS MONITOR
# =========================================================
Write-Host "`n[*] Waiting for all jobs to complete..." -ForegroundColor Cyan

do {
    Start-Sleep -Seconds 3
    $running   = ($Jobs | Where-Object { $_.State -eq 'Running'   }).Count
    $completed = ($Jobs | Where-Object { $_.State -eq 'Completed' }).Count
    $failed    = ($Jobs | Where-Object { $_.State -eq 'Failed'    }).Count
    Write-Host "    Running: $running | Completed: $completed | Failed: $failed" -ForegroundColor DarkCyan
} while (($Jobs | Where-Object { $_.State -in 'Running', 'NotStarted' }).Count -gt 0)

foreach ($job in $Jobs) {
    if ($job.State -eq 'Failed') {
        Write-Host "  [!] Job $($job.Id) failed: $($job.JobStateInfo.Reason)" -ForegroundColor Red
    }
}
$Jobs | Remove-Job -Force

$Duration = (Get-Date) - $StartTime
Write-Host "`n[*] All jobs finished in $([math]::Round($Duration.TotalSeconds, 1))s" -ForegroundColor Cyan

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

    $LogLines    = Get-Content $LogFile
    $foundLeaks  = [System.Collections.Generic.List[PSCustomObject]]::new()

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

$leakProjects  = $FinalReport | Where-Object { $_.Status -eq "LEAK_DETECTED"             } | Select-Object -ExpandProperty Application -Unique
$cleanProjects = $FinalReport | Where-Object { $_.Status -eq "CLEAN"                     } | Select-Object -ExpandProperty Application -Unique
$noLog         = $FinalReport | Where-Object { $_.Status -in "NO_LOG", "NO_TESTS_RAN"    } | Select-Object -ExpandProperty Application -Unique

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
