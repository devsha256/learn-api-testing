# --- Configuration ---
$appListFile = "app-list.txt"  # File containing one repo name per line
$baseSshUrl = "git@ssh.dev.azure.com:v3/YourOrg/YourProject/" # Adjust your Azure path
$tempWorkDir = "C:\MuleTempBuilds"
$reportCsv = "CoverageSummary.csv"

# Ensure temp directory exists
if (!(Test-Path $tempWorkDir)) { New-Item -ItemType Directory -Path $tempWorkDir }

# Initialize CSV header
"Repository,Status,CoveragePercentage" | Out-File -FilePath $reportCsv -Encoding utf8

# Read the app list
$repos = Get-Content $appListFile

foreach ($repoName in $repos) {
    if ([string]::IsNullOrWhiteSpace($repoName)) { continue }
    
    $repoUrl = "$baseSshUrl$repoName"
    $targetPath = Join-Path $tempWorkDir $repoName
    Write-Host "`n--- Processing $repoName ---" -ForegroundColor Cyan

    try {
        # 1. Clone only the dev branch
        Write-Host "Cloning dev branch..." -ForegroundColor Gray
        git clone --branch dev --single-branch $repoUrl $targetPath --quiet

        if ($LASTEXITCODE -ne 0) {
            Write-Host "Clone failed for $repoName" -ForegroundColor Red
            "$repoName,Clone Failed,N/A" | Out-File $reportCsv -Append
            continue
        }

        Set-Location $targetPath

        # 2. Run Maven Test
        Write-Host "Executing MUnit..." -ForegroundColor Blue
        # Note: We ensure the munit-maven-plugin generates the report
        mvn clean test -DruntimeVersion=4.4.0 -Dmaven.test.failure.ignore=true

        # 3. Extract Coverage Percentage
        # MUnit typically stores this in target/site/munit/coverage/summary.html
        $reportPath = "$targetPath\target\site\munit\coverage\summary.html"
        $coverage = "Not Found"

        if (Test-Path $reportPath) {
            $htmlContent = Get-Content $reportPath -Raw
            # Regex to find the percentage value in the MUnit summary HTML
            if ($htmlContent -match '<span>(\d+(?:\.\d+)?)%</span>') {
                $coverage = $matches[1] + "%"
            }
        }

        Write-Host "Result: $repoName - Coverage: $coverage" -ForegroundColor Green
        "$repoName,Success,$coverage" | Out-File $reportCsv -Append

    }
    catch {
        Write-Host "Error processing $repoName: $_" -ForegroundColor Red
        "$repoName,Error,N/A" | Out-File $reportCsv -Append
    }
    finally {
        # Optional: Clean up the cloned folder to save space
        Set-Location $tempWorkDir
        # Remove-Item -Recurse -Force $targetPath -ErrorAction SilentlyContinue
    }
}

Write-Host "`nFinished! Summary saved to $reportCsv" -ForegroundColor Green
