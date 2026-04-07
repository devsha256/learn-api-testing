# --- Configuration ---
$appListFile = "app-list.txt"
$baseSshUrl = 'git@ssh.dev.azure.com:v3/YourOrg/YourProject/' 
$rootWorkDir = "C:\MuleTempBuilds" # Parent directory for all apps
$consolidatedCsv = Join-Path $rootWorkDir "Consolidated_Coverage_Report.csv"

# --- Initialization ---
if (!(Test-Path $rootWorkDir)) { 
    New-Item -ItemType Directory -Path $rootWorkDir | Out-Null 
}

# Initialize the CSV with headers
"Repository,Status,CoveragePercentage,LastUpdated" | Out-File -FilePath $consolidatedCsv -Encoding utf8

if (!(Test-Path $appListFile)) {
    Write-Host "Error: $appListFile not found!" -ForegroundColor Red
    return
}

$repos = Get-Content $appListFile

foreach ($repoName in $repos) {
    if ([string]::IsNullOrWhiteSpace($repoName)) { continue }
    
    $repoUrl = "$baseSshUrl$repoName"
    $targetPath = Join-Path $rootWorkDir $repoName
    Write-Host "`n>>> Processing: $repoName" -ForegroundColor Cyan

    try {
        if (Test-Path $targetPath) {
            # 1. Update Existing Repo
            Write-Host "Existing folder found. Resetting and pulling latest..." -ForegroundColor Gray
            Set-Location $targetPath
            git reset --hard origin/dev
            git checkout dev
            git fetch --all
            git pull origin dev
        } else {
            # 2. Clone New Repo
            Write-Host "Cloning fresh dev branch..." -ForegroundColor Gray
            Set-Location $rootWorkDir
            git clone --branch dev --single-branch $repoUrl $repoName --quiet
            Set-Location $targetPath
        }

        # 3. Execute Maven
        Write-Host "Running MUnit..." -ForegroundColor Blue
        # Using backticks to escape colons for PowerShell
        mvn clean com.mulesoft.munit.tools`:munit-maven-plugin`:test "-DruntimeVersion=4.4.0" "-Dmaven.test.failure.ignore=true"

        # 4. Extract Coverage from HTML
        $reportPath = "$targetPath\target\site\munit\coverage\summary.html"
        $coverage = "0%"
        $status = "Success"

        if (Test-Path $reportPath) {
            $htmlContent = Get-Content $reportPath -Raw
            if ($htmlContent -match '<span>(\d+(?:\.\d+)?)%</span>') {
                $coverage = $matches[1] + "%"
            } else {
                $coverage = "Data Missing"
            }
        } else {
            $status = "No Report Generated"
            $coverage = "N/A"
        }

        # 5. Append to Consolidated CSV
        "$repoName,$status,$coverage,$(Get-Date -Format 'yyyy-MM-dd HH:mm')" | Out-File $consolidatedCsv -Append

    }
    catch {
        Write-Host "Error on $repoName : $($_.Exception.Message)" -ForegroundColor Red
        "$repoName,Error,N/A,$(Get-Date -Format 'yyyy-MM-dd HH:mm')" | Out-File $consolidatedCsv -Append
    }
}

Write-Host "`nFinished! Consolidated report available at: $consolidatedCsv" -ForegroundColor Green
Set-Location $rootWorkDir
