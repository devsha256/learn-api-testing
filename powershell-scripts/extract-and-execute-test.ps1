# --- Configuration ---
$appListFile = "app-list.txt"
# Use single quotes for the URL to avoid any variable expansion issues
$baseSshUrl = 'git@ssh.dev.azure.com:v3/YourOrg/YourProject/' 
$tempWorkDir = "C:\MuleTempBuilds"
$reportCsv = "CoverageSummary.csv"

# --- Initialization ---
if (!(Test-Path $tempWorkDir)) { 
    New-Item -ItemType Directory -Path $tempWorkDir | Out-Null 
}

# Initialize CSV with UTF8 encoding for Excel compatibility
"Repository,Status,CoveragePercentage" | Out-File -FilePath $reportCsv -Encoding utf8

if (!(Test-Path $appListFile)) {
    Write-Host "Error: $appListFile not found!" -ForegroundColor Red
    return
}

$repos = Get-Content $appListFile

foreach ($repoName in $repos) {
    if ([string]::IsNullOrWhiteSpace($repoName)) { continue }
    
    $repoUrl = "$baseSshUrl$repoName"
    $targetPath = Join-Path $tempWorkDir $repoName
    Write-Host "`n>>> Processing: $repoName" -ForegroundColor Cyan

    try {
        # 1. Cleanup old folder if it exists
        if (Test-Path $targetPath) { Remove-Item -Recurse -Force $targetPath }

        # 2. Clone dev branch
        Write-Host "Cloning dev branch..." -ForegroundColor Gray
        git clone --branch dev --single-branch $repoUrl $targetPath --quiet

        if ($LASTEXITCODE -ne 0) {
            Write-Host "Clone failed for $repoName. Check SSH keys or Repo Name." -ForegroundColor Red
            "$repoName,Clone Failed,N/A" | Out-File $reportCsv -Append
            continue
        }

        Set-Location $targetPath

        # 3. Run Maven Test with Escaped Colons
        Write-Host "Executing MUnit..." -ForegroundColor Blue
        # The backtick (`) escapes the colon for the PowerShell parser
        mvn clean com.mulesoft.munit.tools`:munit-maven-plugin`:test "-DruntimeVersion=4.4.0" "-Dmaven.test.failure.ignore=true"

        # 4. Extract Coverage Percentage
        $reportPath = "$targetPath\target\site\munit\coverage\summary.html"
        $coverage = "0%"

        if (Test-Path $reportPath) {
            $htmlContent = Get-Content $reportPath -Raw
            # Regex captures the digits inside the span tag followed by %
            if ($htmlContent -match '<span>(\d+(?:\.\d+)?)%</span>') {
                $coverage = $matches[1] + "%"
                Write-Host "Coverage Found: $coverage" -ForegroundColor Green
            } else {
                Write-Host "Coverage tag not found in HTML report." -ForegroundColor Yellow
                $coverage = "Report Found/No Data"
            }
        } else {
            Write-Host "MUnit report not generated. Check pom.xml configuration." -ForegroundColor Red
            $coverage = "No Report"
        }

        "$repoName,Success,$coverage" | Out-File $reportCsv -Append

    }
    catch {
        Write-Host "Critical error on $repoName : $($_.Exception.Message)" -ForegroundColor Red
        "$repoName,Error,N/A" | Out-File $reportCsv -Append
    }
    finally {
        # Return to temp dir so we can delete the folder in the next iteration
        Set-Location $tempWorkDir
    }
}

Write-Host "`nDone! Results written to: $reportCsv" -ForegroundColor Green
