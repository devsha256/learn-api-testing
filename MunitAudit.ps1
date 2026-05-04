# =========================================================
# CONFIGURATION
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

if (!(Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$AgentJar = "$BytemanHome/lib/byteman.jar"

# Read Projects
$Projects = Get-Content $ProjectList | Where-Object { ![string]::IsNullOrWhiteSpace($_) }

Write-Host "Starting Parallel Audit with CSV Reporting..." -ForegroundColor Cyan

$Jobs = @()

foreach ($index in 0..($Projects.Count - 1)) {
    $ProjName = $Projects[$index].Trim()
    
    while (($Jobs | Where-Object { $_.State -eq 'Running' }).Count -ge $MaxThreads) {
        Start-Sleep -Seconds 2
    }

    $JobPort = $BasePort + $index
    $FullProjectPath = Join-Path $RootFolder $ProjName
    $CurrentLog = Join-Path $LogDir "$($ProjName)_audit.log"

    $Jobs += Start-ThreadJob -ArgumentList $ProjName, $FullProjectPath, $CurrentLog, $AgentJar, $RulesFile, $JobPort -ScriptBlock {
        param($Name, $Path, $Log, $Jar, $Rules, $Port)
        
        $env:JAVA_TOOL_OPTIONS = "-javaagent:`"$Jar`"=script:`"$Rules`" -Xbootclasspath/a:`"$Jar`" -Dorg.jboss.byteman.transform.all"

        if (Test-Path $Path) {
            try {
                Push-Location $Path
                git reset --hard | Out-Null
                git checkout dev | Out-Null
                git pull origin dev | Out-Null

                # -B for batch mode avoids progress bar noise in logs
                mvn clean test -B "-Denv=dev" "-Dhttp.port=$Port" "-Dmunit.dynamic.port=$Port" "-Dmaven.clean.failOnError=false" > $Log 2>&1
                
                return [PSCustomObject]@{ Project = $Name; LogPath = $Log; Success = $true }
            } catch {
                return [PSCustomObject]@{ Project = $Name; LogPath = $Log; Success = $false }
            } finally {
                Pop-Location
            }
        }
    }
    Write-Host "[+] Queued: $ProjName" -ForegroundColor Gray
}

Write-Host "Waiting for all jobs to finish..." -ForegroundColor Yellow
$JobResults = $Jobs | Wait-Job | Receive-Job

# =========================================================
# PHASE: GENERATE CSV REPORT
# =========================================================
Write-Host "Generating CSV Summary Report..." -ForegroundColor Cyan

$FinalReport = New-Object System.Collections.Generic.List[PSObject]

foreach ($result in $JobResults) {
    if ($result.Success -and (Test-Path $result.LogPath)) {
        # Find all lines containing the leak tag
        $leakLines = Select-String -Path $result.LogPath -Pattern "\[OUTBOUND-LEAK\]"
        
        if ($leakLines) {
            foreach ($line in $leakLines) {
                # Clean up the log line to extract just the Protocol/Dest info
                $cleanDetail = $line.Line.Substring($line.Line.IndexOf("] ") + 2).Trim()
                
                $FinalReport.Add([PSCustomObject]@{
                    Application = $result.Project
                    Status      = "LEAK DETECTED"
                    Details     = $cleanDetail
                    Timestamp   = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
                })
            }
        } else {
            $FinalReport.Add([PSCustomObject]@{
                Application = $result.Project
                Status      = "CLEAN"
                Details     = "No unmocked outbound calls found."
                Timestamp   = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
            })
        }
    } else {
        $FinalReport.Add([PSCustomObject]@{
            Application = $result.Project
            Status      = "ERROR"
            Details     = "Maven build failed or project path invalid."
            Timestamp   = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
        })
    }
}

# Export to CSV
$FinalReport | Export-Csv -Path $CSVReportPath -NoTypeInformation -Encoding UTF8

Write-Host "`nAUDIT COMPLETE." -ForegroundColor Cyan
Write-Host "Summary Report saved to: $CSVReportPath" -ForegroundColor Green
