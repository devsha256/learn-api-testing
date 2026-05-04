# =========================================================
# CONFIGURATION
# =========================================================
$BytemanHome   = "C:/tools/byteman-download-4.0.20"
$RulesFile     = "C:/path/to/munit-leak-detector.btm"
$RootFolder    = "C:/Users/Saddam/Projects"
$ProjectList   = "C:/path/to/projects.csv"
$LogDir        = "$PSScriptRoot/audit_logs"
$CSVReportPath = "$PSScriptRoot/Audit_Summary.csv"
$MaxThreads    = 4  # Running more than 4 Mule instances may spike CPU/RAM
$BasePort      = 9000
# =========================================================

if (!(Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$AgentJar = "$BytemanHome/lib/byteman.jar"

# Read Projects
$Projects = Get-Content $ProjectList | Where-Object { ![string]::IsNullOrWhiteSpace($_) }

Write-Host "Starting Parallel Audit using Native Jobs..." -ForegroundColor Cyan

$Jobs = @()

foreach ($index in 0..($Projects.Count - 1)) {
    $ProjName = $Projects[$index].Trim()
    
    # Throttle: Wait if too many jobs are running
    while ((Get-Job -State Running).Count -ge $MaxThreads) {
        Start-Sleep -Seconds 2
    }

    $JobPort = $BasePort + $index
    $FullProjectPath = Join-Path $RootFolder $ProjName
    $CurrentLog = Join-Path $LogDir "$($ProjName)_audit.log"

    # Start-Job is the native, built-in way to parallelize
    $Jobs += Start-Job -ArgumentList $ProjName, $FullProjectPath, $CurrentLog, $AgentJar, $RulesFile, $JobPort -ScriptBlock {
        param($Name, $Path, $Log, $Jar, $Rules, $Port)
        
        # We must set the Env Var inside the job scope
        $env:JAVA_TOOL_OPTIONS = "-javaagent:`"$Jar`"=script:`"$Rules`" -Xbootclasspath/a:`"$Jar`" -Dorg.jboss.byteman.transform.all"

        if (Test-Path $Path) {
            try {
                Set-Location $Path
                # Maven execution in Batch Mode (-B) for cleaner logs
                mvn clean test -B "-Denv=dev" "-Dhttp.port=$Port" "-Dmunit.dynamic.port=$Port" "-Dmaven.clean.failOnError=false" > $Log 2>&1
                
                return [PSCustomObject]@{ Project = $Name; LogPath = $Log; Success = $true }
            } catch {
                return [PSCustomObject]@{ Project = $Name; LogPath = $Log; Success = $false }
            }
        }
        return [PSCustomObject]@{ Project = $Name; LogPath = $Log; Success = $false }
    }
    Write-Host "[+] Started Job for: $ProjName (Port $JobPort)" -ForegroundColor Gray
}

Write-Host "Waiting for all audits to finish..." -ForegroundColor Yellow
$JobResults = $Jobs | Wait-Job | Receive-Job

# =========================================================
# PHASE: GENERATE CSV REPORT
# =========================================================
Write-Host "Compiling CSV Summary Report..." -ForegroundColor Cyan
$FinalReport = New-Object System.Collections.Generic.List[PSObject]

foreach ($result in $JobResults) {
    if ($result.Success -and (Test-Path $result.LogPath)) {
        $leakLines = Select-String -Path $result.LogPath -Pattern "\[OUTBOUND-LEAK\]"
        
        if ($leakLines) {
            foreach ($line in $leakLines) {
                # Extract the leak info after the bracket
                $detail = if($line.Line.Contains("] ")) { $line.Line.Split("] ")[1] } else { $line.Line }
                
                $FinalReport.Add([PSCustomObject]@{
                    Application = $result.Project
                    Status      = "LEAK DETECTED"
                    Details     = $detail.Trim()
                    Timestamp   = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
                })
            }
        } else {
            $FinalReport.Add([PSCustomObject]@{
                Application = $result.Project
                Status      = "CLEAN"
                Details     = "No unmocked outbound calls."
                Timestamp   = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
            })
        }
    } else {
        $FinalReport.Add([PSCustomObject]@{
            Application = $result.Project
            Status      = "ERROR"
            Details     = "Build failed or path missing. Check log for details."
            Timestamp   = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
        })
    }
}

$FinalReport | Export-Csv -Path $CSVReportPath -NoTypeInformation -Encoding UTF8

# Cleanup Jobs from memory
Get-Job | Remove-Job

Write-Host "`nAUDIT COMPLETE. Report generated at: $CSVReportPath" -ForegroundColor Green
