# =========================================================
# CONFIGURATION
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

if (!(Test-Path $BytemanJar))    { Write-Error "Byteman JAR not found: $BytemanJar";       exit 1 }
if (!(Test-Path $BytemanScript)) { Write-Error "BTM rules file not found: $BytemanScript"; exit 1 }
if (!(Test-Path $Log4jConfig))   { Write-Error "log4j2 config not found: $Log4jConfig";    exit 1 }
if (!(Test-Path $ProjectList))   { Write-Error "Project list not found: $ProjectList";      exit 1 }

[string[]]$Projects = Get-Content $ProjectList |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
    ForEach-Object { $_.Trim() }

if ($Projects.Count -eq 0) { Write-Error "No projects found in $ProjectList"; exit 1 }

Get-ChildItem $LogDir -Filter "*.done" | Remove-Item -Force -ErrorAction SilentlyContinue

# =========================================================
# LEAK PATTERNS — one per connector matching BTM output
# =========================================================
$LeakPatterns = @(
    [PSCustomObject]@{ Connector = "HTTP"         ; Pattern = "\[OUTBOUND-LEAK\] CONNECTOR=HTTP\b"                },
    [PSCustomObject]@{ Connector = "HTTP-SDK"     ; Pattern = "\[OUTBOUND-LEAK\] CONNECTOR=HTTP-SDK-OPERATION"   },
    [PSCustomObject]@{ Connector = "JMS-PUBLISH"  ; Pattern = "\[OUTBOUND-LEAK\] CONNECTOR=JMS-PUBLISH"          },
    [PSCustomObject]@{ Connector = "JMS-CONSUME"  ; Pattern = "\[OUTBOUND-LEAK\] CONNECTOR=JMS-CONSUME"          },
    [PSCustomObject]@{ Connector = "JMS-BROKER"   ; Pattern = "\[OUTBOUND-LEAK\] CONNECTOR=JMS-BROKER-SEND"      },
    [PSCustomObject]@{ Connector = "ACTIVEMQ"     ; Pattern = "\[OUTBOUND-LEAK\] CONNECTOR=ACTIVEMQ-SESSION-SEND"},
    [PSCustomObject]@{ Connector = "DATABASE"     ; Pattern = "\[OUTBOUND-LEAK\] CONNECTOR=DB-"                  },
    [PSCustomObject]@{ Connector = "SALESFORCE"   ; Pattern = "\[OUTBOUND-LEAK\] CONNECTOR=SALESFORCE-WSC"       },
    [PSCustomObject]@{ Connector = "SAP"          ; Pattern = "\[OUTBOUND-LEAK\] CONNECTOR=SAP-RFC-BAPI"         },
    [PSCustomObject]@{ Connector = "EMAIL"        ; Pattern = "\[OUTBOUND-LEAK\] CONNECTOR=EMAIL-SMTP"           },
    [PSCustomObject]@{ Connector = "VM"           ; Pattern = "\[OUTBOUND-LEAK\] CONNECTOR=VM-PUBLISH"           },
    [PSCustomObject]@{ Connector = "OBJECT-STORE" ; Pattern = "\[OUTBOUND-LEAK\] CONNECTOR=OBJECTSTORE-"         }
)

# =========================================================
# 2. BUILD JAVA_TOOL_OPTIONS ONCE
#    FIX 1: boot: and sys: replace -Xbootclasspath/a:
#    FIX 2: listener:true removed — it binds port 9091
#            which causes BindException when multiple
#            child windows run in parallel
# =========================================================
$JavaToolOptions = (
    "-javaagent:`"$BytemanJar`"=" +
    "script:`"$BytemanScript`"," +
    "boot:`"$BytemanJar`"," +
    "sys:`"$BytemanJar`"" +
    " -Dorg.jboss.byteman.transform.all=true" +
    " -Dlog4j.configurationFile=`"$Log4jConfig`""
)

# =========================================================
# 3. LAUNCH ONE WINDOW PER PROJECT
# =========================================================
$LiveProcesses = @{}
$Counter = 0

foreach ($ProjName in $Projects) {
    $JobPort    = $BasePort + $Counter
    $Counter++
    $FullPath   = Join-Path $RootFolder $ProjName
    $CurrentLog = Join-Path $LogDir "$($ProjName)_audit.log"
    $DoneMarker = Join-Path $LogDir "$($ProjName)_audit.done"

    if (!(Test-Path $FullPath)) {
        Write-Host "[!] SKIP: $ProjName — not found at $FullPath" -ForegroundColor Red
        continue
    }

    # Throttle — wait until a slot is free
    while ($LiveProcesses.Count -ge $MaxThreads) {
        $FinishedIds = @()
        foreach ($id in $LiveProcesses.Keys) {
            if (!(Get-Process -Id $id -ErrorAction SilentlyContinue)) { $FinishedIds += $id }
        }
        foreach ($id in $FinishedIds) { $LiveProcesses.Remove($id) }
        Start-Sleep -Seconds 2
    }

    # FIX 3: mvn command on a single line inside the heredoc.
    #         Backtick continuations do not work inside @" "@ and
    #         caused the NativeCommandError in the previous run.
        $ChildScript = @"
`$Host.UI.RawUI.WindowTitle = 'AUDIT: $ProjName'
Write-Host '========================================' -ForegroundColor Cyan
Write-Host '  PROJECT : $ProjName' -ForegroundColor Cyan
Write-Host '  PORT    : $JobPort'  -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan

Write-Host '--- GIT SYNC ---' -ForegroundColor Gray
Set-Location '$FullPath'
git reset --hard
git checkout dev
git pull origin dev

`$env:JAVA_TOOL_OPTIONS = '$JavaToolOptions'

Write-Host '--- RUNNING MUNIT ---' -ForegroundColor Yellow
mvn clean test com.mulesoft.munit.tools:munit-maven-plugin:coverage-report "-Dsecurekey=pass@2025" "-Denv=dev" "--no-transfer-progress" 2>&1 | Tee-Object -FilePath '$CurrentLog'

`$env:JAVA_TOOL_OPTIONS = ''
Set-Content '$DoneMarker' 'DONE'

Write-Host '========================================' -ForegroundColor Cyan
Write-Host '  DONE: $ProjName' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan
Read-Host 'Press ENTER to close this window'
"@


    $p = Start-Process powershell.exe `
        -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $ChildScript `
        -PassThru

    $LiveProcesses.Add($p.Id, $ProjName)
    Write-Host "[>] Launched: $ProjName (PID $($p.Id), port $JobPort)" -ForegroundColor Green
}

# =========================================================
# 4. WAIT FOR ALL WINDOWS TO CLOSE
# =========================================================
Write-Host "`n[*] Waiting for all windows to complete..." -ForegroundColor Cyan
while ($LiveProcesses.Count -gt 0) {
    $FinishedIds = @()
    foreach ($id in $LiveProcesses.Keys) {
        if (!(Get-Process -Id $id -ErrorAction SilentlyContinue)) { $FinishedIds += $id }
    }
    foreach ($id in $FinishedIds) { $LiveProcesses.Remove($id) }
    Start-Sleep -Seconds 3
}

# =========================================================
# 5. PARSE LOGS AND BUILD CSV
# =========================================================
Write-Host "[*] All windows closed. Parsing logs..." -ForegroundColor Green
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
        $status = if ($LogLines | Select-String -Pattern "BUILD SUCCESS|Tests run:") { "CLEAN" } else { "INCOMPLETE" }
        $FinalReport.Add([PSCustomObject]@{
            Application = $ProjName
            Status      = $status
            Connector   = ""
            LeakCount   = 0
            Details     = if ($status -eq "CLEAN") { "No leaks detected" } else { "Check log manually" }
        })
    }
}

$FinalReport | Export-Csv -Path $CSVReportPath -NoTypeInformation -Encoding UTF8

# =========================================================
# 6. CONSOLE SUMMARY
# =========================================================
$leakProjects  = $FinalReport | Where-Object { $_.Status -eq "LEAK_DETECTED" } | Select-Object -ExpandProperty Application -Unique
$cleanProjects = $FinalReport | Where-Object { $_.Status -eq "CLEAN"         } | Select-Object -ExpandProperty Application -Unique

Write-Host ""
Write-Host "============================================" -ForegroundColor White
Write-Host "  MUNIT OUTBOUND LEAK AUDIT - FINAL SUMMARY" -ForegroundColor White
Write-Host "============================================" -ForegroundColor White
Write-Host "  Total    : $($Projects.Count)"
Write-Host "  CLEAN    : $($cleanProjects.Count)" -ForegroundColor Green
Write-Host "  LEAKS    : $($leakProjects.Count)"  -ForegroundColor Red
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
Write-Host "[*] Report saved to: $CSVReportPath" -ForegroundColor Green
