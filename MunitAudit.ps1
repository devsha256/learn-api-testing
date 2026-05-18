# =========================================================
# CONFIGURATION - UPDATE THESE PATHS
# =========================================================
$RootFolder    = "C:/Users/Saddam/Projects"
$ProjectList   = "C:/path/to/projects.csv"
$LogDir        = "$PSScriptRoot/audit_logs"
$CSVReportPath = "$PSScriptRoot/Audit_Summary.csv"
$Log4jConfig   = "$RootFolder/log4j2-munit-audit.xml"
$BytemanJar    = "C:/tools/byteman/lib/byteman.jar"
$BytemanScript = "C:/audit/munit-leak-detector.btm"
$MaxThreads    = 4
$BasePort      = 9000
# =========================================================

# =========================================================
# 1. PRE-FLIGHT
# =========================================================
if (!(Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }

# FIX 3: Verify Byteman jar and BTM script exist before launching anything.
# A missing file would silently corrupt every child window run.
if (!(Test-Path $BytemanJar)) {
    Write-Error "Byteman JAR not found: $BytemanJar"
    exit 1
}
if (!(Test-Path $BytemanScript)) {
    Write-Error "BTM rules file not found: $BytemanScript"
    exit 1
}
if (!(Test-Path $Log4jConfig)) {
    Write-Error "log4j2 config not found: $Log4jConfig"
    exit 1
}
if (!(Test-Path $ProjectList)) {
    Write-Error "Project list not found: $ProjectList"
    exit 1
}

Write-Host "[*] Byteman JAR    : $BytemanJar"    -ForegroundColor Cyan
Write-Host "[*] BTM Rules      : $BytemanScript"  -ForegroundColor Cyan
Write-Host "[*] log4j2 Config  : $Log4jConfig"    -ForegroundColor Cyan

[string[]]$Projects = Get-Content $ProjectList |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
    ForEach-Object { $_.Trim() }

if ($Projects.Count -eq 0) {
    Write-Error "No projects found in $ProjectList"
    exit 1
}

# Clean up stale .done markers from a previous run
Get-ChildItem $LogDir -Filter "*.done" | Remove-Item -Force -ErrorAction SilentlyContinue

# =========================================================
# FIX 2: Per-connector leak patterns aligned to the new BTM
# output format:  [OUTBOUND-LEAK] CONNECTOR=<NAME> ...
# Uses regex named group to extract connector name reliably,
# regardless of any prefix Byteman may add.
# =========================================================
$LeakPatterns = @(
    [PSCustomObject]@{ Connector = "HTTP"           ; Pattern = "\[OUTBOUND-LEAK\] CONNECTOR=HTTP\b"                  },
    [PSCustomObject]@{ Connector = "HTTP-SDK"       ; Pattern = "\[OUTBOUND-LEAK\] CONNECTOR=HTTP-SDK-OPERATION"      },
    [PSCustomObject]@{ Connector = "JMS-PUBLISH"    ; Pattern = "\[OUTBOUND-LEAK\] CONNECTOR=JMS-PUBLISH"             },
    [PSCustomObject]@{ Connector = "JMS-CONSUME"    ; Pattern = "\[OUTBOUND-LEAK\] CONNECTOR=JMS-CONSUME"             },
    [PSCustomObject]@{ Connector = "JMS-BROKER"     ; Pattern = "\[OUTBOUND-LEAK\] CONNECTOR=JMS-BROKER-SEND"         },
    [PSCustomObject]@{ Connector = "ACTIVEMQ"       ; Pattern = "\[OUTBOUND-LEAK\] CONNECTOR=ACTIVEMQ-SESSION-SEND"   },
    [PSCustomObject]@{ Connector = "DATABASE"       ; Pattern = "\[OUTBOUND-LEAK\] CONNECTOR=DB-"                     },
    [PSCustomObject]@{ Connector = "SALESFORCE"     ; Pattern = "\[OUTBOUND-LEAK\] CONNECTOR=SALESFORCE-WSC"          },
    [PSCustomObject]@{ Connector = "SAP"            ; Pattern = "\[OUTBOUND-LEAK\] CONNECTOR=SAP-RFC-BAPI"            },
    [PSCustomObject]@{ Connector = "EMAIL"          ; Pattern = "\[OUTBOUND-LEAK\] CONNECTOR=EMAIL-SMTP"              },
    [PSCustomObject]@{ Connector = "VM"             ; Pattern = "\[OUTBOUND-LEAK\] CONNECTOR=VM-PUBLISH"              },
    [PSCustomObject]@{ Connector = "OBJECT-STORE"   ; Pattern = "\[OUTBOUND-LEAK\] CONNECTOR=OBJECTSTORE-"            }
)

# =========================================================
# 2. EXECUTION DASHBOARD (PID TRACKING)
# =========================================================
$LiveProcesses = @{}
$Counter = 0

foreach ($ProjName in $Projects) {
    $JobPort     = $BasePort + $Counter
    $Counter++
    $FullPath    = Join-Path $RootFolder $ProjName
    $CurrentLog  = Join-Path $LogDir "$($ProjName)_audit.log"
    $DoneMarker  = Join-Path $LogDir "$($ProjName)_audit.done"

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

    if (!(Test-Path $FullPath)) {
        Write-Host "  [!] SKIP: $ProjName — path not found ($FullPath)" -ForegroundColor Red
        continue
    }

    # ----------------------------------------------------------
    # FIX 1: Corrected JAVA_TOOL_OPTIONS
    #
    # Changes from the original:
    #   OLD: -Xbootclasspath/a:'$BytemanJar'
    #   NEW: boot: and sys: options inside the javaagent string
    #        — this is the documented Byteman way to install its
    #          classes into the bootstrap AND system classloaders,
    #          which is what prevents the ClassRealm conflict.
    #
    #   OLD: missing -Dorg.jboss.byteman.transform.all=true
    #   NEW: added — required for Mule plugin classloader classes
    #        (connector jars loaded by Mule's plugin classloader
    #         are invisible to Byteman without this flag)
    #
    #   OLD: single quotes around paths broke Windows path handling
    #   NEW: escaped double quotes via backtick — safe for spaces
    #
    #   KEPT: -Dlog4j.configurationFile for connector DEBUG logging
    #         as the secondary / belt-and-suspenders detection layer
    # ----------------------------------------------------------
    $JavaAgentArg = (
        "-javaagent:`"$BytemanJar`"=" +
        "script:`"$BytemanScript`"," +
        "boot:`"$BytemanJar`"," +
        "sys:`"$BytemanJar`"," +
        "listener:true"
    )
    $Log4jArg     = "-Dlog4j.configurationFile=`"$Log4jConfig`""
    $TransformArg = "-Dorg.jboss.byteman.transform.all=true"

    $ChildScript = @"
`$Host.UI.RawUI.WindowTitle = 'AUDIT: $ProjName'

Write-Host '========================================' -ForegroundColor Cyan
Write-Host '  PROJECT : $ProjName'                   -ForegroundColor Cyan
Write-Host '  PORT    : $JobPort'                    -ForegroundColor Cyan
Write-Host '  LOG     : $CurrentLog'                 -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan

# FIX 4: ErrorActionPreference removed — errors must be visible
# so that JVM startup failures are not silently swallowed.

Write-Host '--- SYNCING GIT ---' -ForegroundColor Gray
Set-Location '$FullPath'
git reset --hard
git checkout dev
git pull origin dev

Write-Host '--- INJECTING BYTEMAN + LOG4J2 ---' -ForegroundColor Gray
`$env:JAVA_TOOL_OPTIONS = '$JavaAgentArg $Log4jArg $TransformArg'

Write-Host "  JAVA_TOOL_OPTIONS = `$env:JAVA_TOOL_OPTIONS" -ForegroundColor DarkGray

Write-Host '--- RUNNING MUNIT ---' -ForegroundColor Yellow
mvn clean test ``
    "-Denv=dev" ``
    "-Dhttp.port=$JobPort" ``
    "-Dmunit.dynamic.port=$JobPort" ``
    "-Dmaven.clean.failOnError=false" ``
    "--no-transfer-progress" 2>&1 | Tee-Object -FilePath '$CurrentLog'

`$env:JAVA_TOOL_OPTIONS = ''
Set-Content '$DoneMarker' 'DONE'

Write-Host ''
Write-Host '========================================' -ForegroundColor Cyan
Write-Host "  DONE: $ProjName"                        -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan
Read-Host 'Press ENTER to close this window'
"@

    $p = Start-Process powershell.exe `
        -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $ChildScript `
        -PassThru

    $LiveProcesses.Add($p.Id, $ProjName)
    Write-Host "  [>] Launched: $ProjName (PID $($p.Id), port $JobPort)" -ForegroundColor Green
}

# =========================================================
# 3. THE UNBREAKABLE WAIT — with live progress printing
# =========================================================
Write-Host "`n[*] Waiting for all windows to complete..." -ForegroundColor Cyan

do {
    Start-Sleep -Seconds 5
    $FinishedIds = @()
    foreach ($id in $LiveProcesses.Keys) {
        if (!(Get-Process -Id $id -ErrorAction SilentlyContinue)) {
            $FinishedIds += $id
        }
    }
    foreach ($id in $FinishedIds) { $LiveProcesses.Remove($id) }

    $running   = $LiveProcesses.Count
    $completed = $Projects.Count - $running
    Write-Host "    Running: $running | Completed: $completed | Total: $($Projects.Count)" -ForegroundColor DarkCyan

    if ($running -gt 0) {
        $names = ($LiveProcesses.Values) -join ", "
        Write-Host "    Still running: $names" -ForegroundColor DarkGray
    }

} while ($LiveProcesses.Count -gt 0)

Write-Host "`n[*] All windows completed." -ForegroundColor Cyan

# =========================================================
# 4. CSV GENERATION
#    FIX 2: Per-connector pattern matching.
#    Extracts connector name, destination/URI, and full detail
#    line from each [OUTBOUND-LEAK] hit.
# =========================================================
Write-Host "[*] Parsing logs for outbound leaks..." -ForegroundColor Cyan
$FinalReport = New-Object System.Collections.Generic.List[PSObject]

foreach ($ProjName in $Projects) {
    $LogFile = Join-Path $LogDir "$($ProjName)_audit.log"

    if (!(Test-Path $LogFile)) {
        $FinalReport.Add([PSCustomObject]@{
            Application = $ProjName
            Status      = "NO_LOG"
            Connector   = ""
            LeakCount   = 0
            Details     = "Log file not produced — project may have been skipped"
        })
        continue
    }

    $LogLines   = Get-Content $LogFile
    $leaksFound = $false

    foreach ($lp in $LeakPatterns) {
        $hits = $LogLines | Select-String -Pattern $lp.Pattern
        if ($hits) {
            $leaksFound = $true
            foreach ($h in $hits) {
                # Extract the most useful detail token from the line.
                # BTM format: [OUTBOUND-LEAK] CONNECTOR=X KEY=value KEY=value ...
                # We skip STACKTRACE lines — they are noise in the CSV.
                if ($h.Line -match "STACKTRACE=") { continue }

                $FinalReport.Add([PSCustomObject]@{
                    Application = $ProjName
                    Status      = "LEAK_DETECTED"
                    Connector   = $lp.Connector
                    LeakCount   = $hits.Count
                    Details     = $h.Line.Trim()
                })
            }
        }
    }

    if (-not $leaksFound) {
        $testRan = $LogLines | Select-String -Pattern "BUILD SUCCESS|BUILD FAILURE|Tests run:"
        $status  = if ($testRan) { "CLEAN" } else { "INCOMPLETE" }
        $FinalReport.Add([PSCustomObject]@{
            Application = $ProjName
            Status      = $status
            Connector   = ""
            LeakCount   = 0
            Details     = if ($status -eq "CLEAN") {
                              "No outbound leaks detected — all mocks applied correctly"
                          } else {
                              "Maven did not confirm test execution — check log manually"
                          }
        })
    }
}

$FinalReport | Export-Csv -Path $CSVReportPath -NoTypeInformation -Encoding UTF8

# =========================================================
# 5. CONSOLE SUMMARY
# =========================================================
$leakProjects = $FinalReport |
    Where-Object { $_.Status -eq "LEAK_DETECTED" } |
    Select-Object -ExpandProperty Application -Unique

$cleanProjects = $FinalReport |
    Where-Object { $_.Status -eq "CLEAN" } |
    Select-Object -ExpandProperty Application -Unique

$noLog = $FinalReport |
    Where-Object { $_.Status -in "NO_LOG", "INCOMPLETE" } |
    Select-Object -ExpandProperty Application -Unique

Write-Host ""
Write-Host "============================================" -ForegroundColor White
Write-Host "  MUNIT OUTBOUND LEAK AUDIT — FINAL SUMMARY" -ForegroundColor White
Write-Host "============================================" -ForegroundColor White
Write-Host "  Total projects   : $($Projects.Count)"
Write-Host "  CLEAN            : $($cleanProjects.Count)"  -ForegroundColor Green
Write-Host "  LEAK DETECTED    : $($leakProjects.Count)"   -ForegroundColor Red
Write-Host "  NO LOG/INCOMPLETE: $($noLog.Count)"          -ForegroundColor Yellow
Write-Host "============================================" -ForegroundColor White

if ($leakProjects.Count -gt 0) {
    Write-Host ""
    Write-Host "  Projects with leaks:" -ForegroundColor Red
    foreach ($p in $leakProjects) {
        $connectors = (
            $FinalReport |
            Where-Object { $_.Application -eq $p -and $_.Status -eq "LEAK_DETECTED" } |
            Select-Object -ExpandProperty Connector -Unique
        ) -join ", "
        Write-Host "    - $p  [$connectors]" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "[*] Full report saved to: $CSVReportPath" -ForegroundColor Green
