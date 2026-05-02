# =========================================================
# CONFIGURATION BLOCK - ONLY EDIT THESE PATHS
# =========================================================
$BytemanHome = "C:/tools/byteman-download-4.0.20"
$RulesFile   = "C:/path/to/munit-leak-detector.btm"
$RootFolder  = "C:/Users/Saddam/Projects"
$ProjectList = "C:/path/to/projects.csv"
$LogDir      = "$PSScriptRoot/audit_logs"
# =========================================================

# --- INTERNAL SETUP ---
$AgentJar = "$BytemanHome/lib/byteman.jar"

# Ensure Log Directory exists
if (!(Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }

# --- JVM INSTRUMENTATION SETUP ---
# We use backticks (`) to escape quotes inside the string for PowerShell
$BytemanOpts = "-javaagent:`"$AgentJar`"=script:`"$RulesFile`""
$BootPath    = "-Xbootclasspath/a:`"$AgentJar`""
$MuleOpts    = "-Dorg.jboss.byteman.transform.all -Dcom.ning.http.client.AsyncHttpClientConfig.useProxyProperties=true"

# Set environment variable for the forked MUnit process
$env:JAVA_TOOL_OPTIONS = "$BytemanOpts $BootPath $MuleOpts"

Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host "STARTING MUNIT LEAK AUDIT" -ForegroundColor Cyan
Write-Host "=========================================================" -ForegroundColor Cyan

# Read the project names from CSV
$Projects = Get-Content $ProjectList

foreach ($ProjName in $Projects) {
    $ProjName = $ProjName.Trim()
    if ([string]::IsNullOrWhiteSpace($ProjName)) { continue }

    $FullProjectPath = Join-Path $RootFolder $ProjName
    $CurrentLog = Join-Path $LogDir "$($ProjName)_audit.log"

    Write-Host "[*] Processing: $ProjName" -ForegroundColor Yellow

    if (Test-Path $FullProjectPath) {
        Push-Location $FullProjectPath

        # Step 1: Git Sync
        Write-Host "    - Updating Git (dev)..."
        git reset --hard | Out-Null
        git checkout dev | Out-Null
        git pull origin dev | Out-Null

        # Step 2: Maven Execution with Live Output via Tee-Object
        Write-Host "    - Executing MUnit..."
        Write-Host "---------------------------------------------------------"
        
        # Calling mvn via powershell ensures the pipe (|) is handled correctly
        mvn clean test com.mulesoft.munit.tools:munit-maven-plugin:coverage-report "-Denv=dev" "-Dmaven.clean.failOnError=false" | Tee-Object -FilePath $CurrentLog
        
        $MavenExit = $LASTEXITCODE
        Write-Host "---------------------------------------------------------"

        # Step 3: Result & Leak Scan
        if ($MavenExit -eq 0) {
            Write-Host "    - Result: BUILD SUCCESS" -ForegroundColor Green
        } else {
            Write-Host "    - Result: BUILD FAILURE" -ForegroundColor Red
        }

        # Scanning the log we just saved
        $Leaks = Select-String -Path $CurrentLog -Pattern "\[OUTBOUND-LEAK\]"
        if ($Leaks) {
            Write-Host "    [!] ALERT: Outbound Leaks Detected!" -ForegroundColor Magenta
            $Leaks | ForEach-Object { Write-Host "        $($_.Line)" }
        } else {
            Write-Host "    [OK] No outbound leaks found." -ForegroundColor Green
        }

        Pop-Location
    } else {
        Write-Host "[ERROR] Directory not found: $FullProjectPath" -ForegroundColor Red
    }
    Write-Host "========================================================="
}

# Cleanup
$env:JAVA_TOOL_OPTIONS = ""
Write-Host "AUDIT COMPLETE. ALL LOGS SAVED TO: $LogDir" -ForegroundColor Cyan
