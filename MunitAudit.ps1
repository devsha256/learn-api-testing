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

if (!(Test-Path $LogDir)) {
New-Item -ItemType Directory -Path $LogDir | Out-Null
}

if (!(Test-Path $Log4jConfig)) {
Write-Error "log4j2 audit config not found at: $Log4jConfig"
exit 1
}

Write-Host "[*] Using log4j2 audit config: $Log4jConfig" -ForegroundColor Cyan

[string[]]$Projects = Get-Content $ProjectList |
Where-Object { -not [string]::IsNullOrWhiteSpace($*) } |
ForEach-Object { $*.Trim() }

if ($Projects.Count -eq 0) {
Write-Error "No projects found in $ProjectList"
exit 1
}

# =========================================================

# 2. LEAK DETECTION PATTERNS

# =========================================================

$LeakPatterns = @(
[PSCustomObject]@{ Connector = "HTTP"         ; Pattern = "DEBUG.*HttpRequestOperations.*"  },
[PSCustomObject]@{ Connector = "JMS-PUBLISH"  ; Pattern = "DEBUG.*JmsPublish.*"             },
[PSCustomObject]@{ Connector = "JMS-CONSUME"  ; Pattern = "DEBUG.*JmsConsume.*"             },
[PSCustomObject]@{ Connector = "DATABASE"     ; Pattern = "DEBUG.*extension.db.*"          },
[PSCustomObject]@{ Connector = "SFTP"         ; Pattern = "DEBUG.*extension.sftp.*"        },
[PSCustomObject]@{ Connector = "VM"           ; Pattern = "DEBUG.*extensions.vm.*"         },
[PSCustomObject]@{ Connector = "OBJECT-STORE" ; Pattern = "DEBUG.*extension.objectstore.*" },
[PSCustomObject]@{ Connector = "SALESFORCE"   ; Pattern = "DEBUG.*extension.salesforce.*"  }
)

# =========================================================

# 3. CLEAN OLD STATE

# =========================================================

Get-ChildItem $LogDir -Filter "*.done" -ErrorAction SilentlyContinue |
Remove-Item -Force -ErrorAction SilentlyContinue

# =========================================================

# 4. LAUNCH PROJECT WINDOWS

# =========================================================

Write-Host "`n[*] Launching audit windows..." -ForegroundColor Cyan

$StartTime = Get-Date
$RunningProjects = [System.Collections.Generic.List[PSCustomObject]]::new()
$Counter = 0

foreach ($ProjName in $Projects) {

```
$JobPort     = $BasePort + $Counter
$Counter++

$FullPath    = Join-Path $RootFolder $ProjName
$CurrentLog  = Join-Path $LogDir "$($ProjName)_audit.log"
$DoneMarker  = Join-Path $LogDir "$($ProjName)_audit.done"

if (!(Test-Path $FullPath)) {
    Write-Host "  [!] SKIP: $ProjName path not found" -ForegroundColor Red
    continue
}

# =====================================================
# THROTTLE
# =====================================================
do {

    $active = $RunningProjects | Where-Object {
        -not (Test-Path $_.DoneMarker)
    }

    if ($active.Count -ge $MaxThreads) {
        Write-Host "    [~] MaxThreads reached ($($active.Count)). Waiting..." -ForegroundColor DarkCyan
        Start-Sleep -Seconds 5
    }

} while ($active.Count -ge $MaxThreads)

# =====================================================
# CHILD SCRIPT
# =====================================================
$ChildScript = @"
```

`$Host.UI.RawUI.WindowTitle = 'AUDIT: $ProjName'

Write-Host ''
Write-Host '========================================' -ForegroundColor Cyan
Write-Host 'PROJECT : $ProjName' -ForegroundColor Cyan
Write-Host 'PORT    : $JobPort' -ForegroundColor Cyan
Write-Host 'LOG     : $CurrentLog' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan
Write-Host ''

Set-Location '$FullPath'

Write-Host '--- GIT SYNC ---' -ForegroundColor Gray

git reset --hard
git checkout dev
git pull origin dev

Write-Host ''
Write-Host '--- RUNNING MUNIT ---' -ForegroundColor Yellow
Write-Host ''

`$env:JAVA_TOOL_OPTIONS='-Dlog4j.configurationFile="$Log4jConfig"'

try {

```
# ============================================
# IMPORTANT:
# Use Start-Process + -Wait
# instead of pipeline + Tee-Object
# ============================================

`$mvnArgs = @(
    'clean',
    'test',
    '-Denv=dev',
    '-Dhttp.port=$JobPort',
    '-Dmunit.dynamic.port=$JobPort',
    '-Dmaven.clean.failOnError=false',
    '--no-transfer-progress'
)

`$mvn = Start-Process `
    -FilePath 'mvn' `
    -ArgumentList `$mvnArgs `
    -WorkingDirectory '$FullPath' `
    -NoNewWindow `
    -RedirectStandardOutput '$CurrentLog' `
    -RedirectStandardError '$CurrentLog' `
    -PassThru `
    -Wait

Write-Host ''
Write-Host 'Maven Exit Code:' `$mvn.ExitCode -ForegroundColor Cyan
```

}
catch {
Write-Host ''
Write-Host 'ERROR RUNNING MAVEN:' -ForegroundColor Red
Write-Host `$_
}
finally {

```
`$env:JAVA_TOOL_OPTIONS=''

# ============================================
# IMPORTANT:
# Write completion marker ONLY after
# Maven + stdout flush complete
# ============================================

Set-Content '$DoneMarker' 'DONE'

Write-Host ''
Write-Host '========================================' -ForegroundColor Green
Write-Host 'DONE: $ProjName' -ForegroundColor Green
Write-Host '========================================' -ForegroundColor Green
Write-Host ''

Read-Host 'Press ENTER to close this window'
```

}
"@

```
Start-Process powershell.exe `
    -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $ChildScript `
    | Out-Null

$RunningProjects.Add([PSCustomObject]@{
    Name       = $ProjName
    DoneMarker = $DoneMarker
    LogFile    = $CurrentLog
})

Write-Host "  [>] Started: $ProjName" -ForegroundColor Green
```

}

# =========================================================

# 5. WAIT FOR ALL PROJECTS

# =========================================================

Write-Host "`n[*] Waiting for all Maven executions to finish..." -ForegroundColor Cyan

do {

```
Start-Sleep -Seconds 5

$running = $RunningProjects | Where-Object {
    -not (Test-Path $_.DoneMarker)
}

$done = $RunningProjects | Where-Object {
    (Test-Path $_.DoneMarker)
}

Write-Host "    Running: $($running.Count) | Completed: $($done.Count) | Total: $($RunningProjects.Count)" -ForegroundColor DarkCyan

if ($running.Count -gt 0) {
    $names = ($running | Select-Object -ExpandProperty Name) -join ", "
    Write-Host "    Still running: $names" -ForegroundColor DarkGray
}
```

} while ($running.Count -gt 0)

$Duration = (Get-Date) - $StartTime

Write-Host ''
Write-Host '[*] ALL PROJECTS FINISHED' -ForegroundColor Green
Write-Host ''

# =========================================================

# 6. PARSE LOGS

# =========================================================

Write-Host "[*] Parsing logs..." -ForegroundColor Cyan

$FinalReport = [System.Collections.Generic.List[PSCustomObject]]::new()

foreach ($ProjName in $Projects) {

```
$LogFile = Join-Path $LogDir "$($ProjName)_audit.log"

if (!(Test-Path $LogFile)) {

    $FinalReport.Add([PSCustomObject]@{
        Application     = $ProjName
        Status          = "NO_LOG"
        Connector       = ""
        LeakCount       = 0
        FirstOccurrence = ""
        Details         = "Log file missing"
    })

    continue
}

$LogLines = Get-Content $LogFile

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

}
else {

    $testRan = $LogLines | Select-String -Pattern "BUILD SUCCESS|BUILD FAILURE|Tests run:"

    $status = if ($testRan) {
        "CLEAN"
    }
    else {
        "NO_TESTS_RAN"
    }

    $FinalReport.Add([PSCustomObject]@{
        Application     = $ProjName
        Status          = $status
        Connector       = ""
        LeakCount       = 0
        FirstOccurrence = ""
        Details         = if ($status -eq "CLEAN") {
            "No leak patterns detected"
        } else {
            "Maven execution not confirmed"
        }
    })
}
```

}

# =========================================================

# 7. EXPORT REPORT

# =========================================================

$FinalReport | Export-Csv `    -Path $CSVReportPath`
-NoTypeInformation `
-Encoding UTF8

# =========================================================

# 8. FINAL SUMMARY

# =========================================================

$leakProjects = $FinalReport |
Where-Object { $_.Status -eq "LEAK_DETECTED" } |
Select-Object -ExpandProperty Application -Unique

$cleanProjects = $FinalReport |
Where-Object { $_.Status -eq "CLEAN" } |
Select-Object -ExpandProperty Application -Unique

$noLogProjects = $FinalReport |
Where-Object { $_.Status -in @("NO_LOG", "NO_TESTS_RAN") } |
Select-Object -ExpandProperty Application -Unique

Write-Host ''
Write-Host '============================================' -ForegroundColor White
Write-Host ' MUNIT OUTBOUND LEAK AUDIT - FINAL SUMMARY ' -ForegroundColor White
Write-Host '============================================' -ForegroundColor White
Write-Host " Total Projects : $($Projects.Count)"
Write-Host " CLEAN           : $($cleanProjects.Count)" -ForegroundColor Green
Write-Host " LEAK DETECTED   : $($leakProjects.Count)" -ForegroundColor Red
Write-Host " NO LOG/SKIPPED  : $($noLogProjects.Count)" -ForegroundColor Yellow
Write-Host " Duration        : $([math]::Round($Duration.TotalMinutes,2)) mins"
Write-Host '============================================' -ForegroundColor White

if ($leakProjects.Count -gt 0) {

```
Write-Host ''
Write-Host 'Projects with leaks:' -ForegroundColor Red

foreach ($p in $leakProjects) {

    $connectors = (
        $FinalReport |
        Where-Object {
            $_.Application -eq $p -and
            $_.Status -eq "LEAK_DETECTED"
        } |
        Select-Object -ExpandProperty Connector -Unique
    ) -join ", "

    Write-Host " - $p [$connectors]" -ForegroundColor Red
}
```

}

Write-Host ''
Write-Host "[*] CSV report saved to: $CSVReportPath" -ForegroundColor Green
