# =========================================================
# CONFIGURATION - UPDATE THESE PATHS
# =========================================================
$BytemanHome   = "C:/tools/byteman-download-4.0.20"
$RulesFile     = "C:/path/to/munit-leak-detector.btm"
$RootFolder    = "C:/Users/Saddam/Projects"
$ProjectList   = "C:/path/to/projects.csv"
$LogDir        = "$PSScriptRoot/audit_logs"
$CSVReportPath = "$PSScriptRoot/Audit_Summary.csv"
$MaxThreads    = 4  
$BasePort      = 9000
# =========================================================

# --- 1. PRE-FLIGHT VALIDATION ---
if (!(Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$AgentJar = "$BytemanHome/lib/byteman.jar"

if (!(Test-Path $AgentJar)) { Write-Error "Byteman JAR not found at $AgentJar"; exit }
if (!(Test-Path $RulesFile)) { Write-Error "BTM Rules file not found at $RulesFile"; exit }

# Load projects as a clean array of strings
[string[]]$Projects = Get-Content $ProjectList | Where-Object { ![string]::IsNullOrWhiteSpace($_) }

Write-Host "Launching Hardened Audit Dashboard..." -ForegroundColor Cyan
$RunningJobs = @()
$Counter = 0

# --- 2. EXECUTION LOOP ---
foreach ($RawName in $Projects) {
    # Force clean string handling to prevent [System.Char] errors
    $ProjName = $RawName.Trim()
    $JobPort  = $BasePort + $Counter
    $FullProjectPath = Join-Path $RootFolder $ProjName
    $CurrentLog = Join-Path $LogDir "$($ProjName)_audit.log"
    $Counter++

    # Throttle logic
    while ($RunningJobs.Count -ge $MaxThreads) {
        $RunningJobs = $RunningJobs | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }
        Start-Sleep -Seconds 2
    }

    if (Test-Path $FullProjectPath) {
        Write-Host "[>] Starting: $ProjName (Port $JobPort)" -ForegroundColor Green

        # Command block for child windows
        $ScriptBlock = @"
            `$Host.UI.RawUI.WindowTitle = 'AUDIT: $ProjName'
            `$env:JAVA_TOOL_OPTIONS = '-javaagent:"$AgentJar"=script:"$RulesFile" -Xbootclasspath/a:"$AgentJar" -Dorg.jboss.byteman.transform.all'
            cd '$FullProjectPath'
            Write-Host '--- SYNCING GIT ---' -ForegroundColor Gray
            git reset --hard; git checkout dev; git pull origin dev
            Write-Host '--- RUNNING MUNIT ---' -ForegroundColor Yellow
            mvn clean test "-Denv=dev" "-Dhttp.port=$JobPort" "-Dmunit.dynamic.port=$JobPort" "-Dmaven.clean.failOnError=false" | Tee-Object -FilePath '$CurrentLog'
            Write-Host '------------------------------------------------'
            Write-Host 'WORK COMPLETE. Press ENTER to close window.' -ForegroundColor Cyan
            Read-Host
"@

        $proc = Start-Process powershell.exe -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $ScriptBlock -PassThru
        $RunningJobs += $proc.Id
    } else {
        Write-Host "[!] Skipping: $ProjName (Path not found at $FullProjectPath)" -ForegroundColor Red
    }
}

# --- 3. WAITING & REPORTING ---
Write-Host "`nAll windows launched. Waiting for completions..." -ForegroundColor Cyan
while ($RunningJobs.Count -gt 0) {
    $RunningJobs = $RunningJobs | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 5
}

Write-Host "Generating Final CSV Report..." -ForegroundColor Green
$FinalReport = New-Object System.Collections.Generic.List[PSObject]

foreach ($Proj in $Projects) {
    $CleanProj = $Proj.Trim()
    $LogFile = Join-Path $LogDir "$($CleanProj)_audit.log"
    if (Test-Path $LogFile) {
        $leaks = Select-String -Path $LogFile -Pattern "\[OUTBOUND-LEAK\]"
        if ($leaks) {
            foreach ($l in $leaks) {
                # Safeguard string split to prevent indexing errors
                $detail = if ($l.Line.Contains("] ")) { $l.Line.Split("] ")[1] } else { $l.Line }
                $FinalReport.Add([PSCustomObject]@{ Application = $CleanProj; Status = "LEAK DETECTED"; Details = $detail.Trim() })
            }
        } else {
            $FinalReport.Add([PSCustomObject]@{ Application = $CleanProj; Status = "CLEAN"; Details = "No leaks found" })
        }
    }
}

$FinalReport | Export-Csv -Path $CSVReportPath -NoTypeInformation -Encoding UTF8
Write-Host "DONE! Summary saved to: $CSVReportPath" -ForegroundColor Green
