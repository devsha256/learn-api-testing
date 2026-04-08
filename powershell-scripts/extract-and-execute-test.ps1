# --- Configuration ---
$rootWorkDir = "C:\MuleProjects\munit-runner"
$appListFile = Join-Path $rootWorkDir "app-list.txt"
$tempWorkDir = Join-Path $rootWorkDir "MuleTempBuilds"

$baseSshUrl = 'git@ssh.dev.azure.com:v3/YourOrg/YourProject/' 
$consolidatedCsv = Join-Path $rootWorkDir "Consolidated_Coverage_Report.csv"
$apiReportsFolder = Join-Path $rootWorkDir "All_API_Reports"

# --- Initialization ---
if (!(Test-Path $tempWorkDir)) { New-Item -ItemType Directory -Path $tempWorkDir -Force | Out-Null }
if (!(Test-Path $apiReportsFolder)) { New-Item -ItemType Directory -Path $apiReportsFolder -Force | Out-Null }

"Repository,Component,Status,Coverage,Details,Timestamp" | Out-File $consolidatedCsv -Encoding utf8 -Force

if (!(Test-Path $appListFile)) {
    Write-Host "Error: $appListFile not found!" -ForegroundColor Red
    return
}

$repos = Get-Content $appListFile | Where-Object { ![string]::IsNullOrWhiteSpace($_) }

foreach ($repoName in $repos) {
    $repoName = $repoName.Trim()
    $targetPath = Join-Path $tempWorkDir $repoName
    Write-Host "`n====================================================" -ForegroundColor White
    Write-Host " PROCESSING: $repoName" -ForegroundColor Cyan
    Write-Host "====================================================" -ForegroundColor White

    try {
        # 1. Git Sync Logic
        if (Test-Path $targetPath) {
            Set-Location $targetPath
            git reset --hard; git checkout dev; git fetch --all; git pull origin dev --quiet
        } else {
            Set-Location $tempWorkDir
            git clone --branch dev --single-branch "$baseSshUrl$repoName" $repoName --quiet
            Set-Location $targetPath
        }

        # 2. Execute Maven with Visibility
        $mvnCmd = "mvn clean test com.mulesoft.munit.tools:munit-maven-plugin:coverage-report --batch-mode -DsecureKey=s3cr3t -Denv=dev -DargLine='-DsecureKey=s3cr3t -Denv=dev' -Dmaven.test.failure.ignore=true"
        Write-Host "Executing: $mvnCmd" -ForegroundColor DarkGray
        
        # Run Maven and capture output while filtering for the "MUnit Summary" block
        $mvnOutput = Invoke-Expression $mvnCmd 2>&1 | ForEach-Object {
            $line = $_.ToString()
            # Only show lines containing the MUnit Summary or Errors
            if ($line -match "MUnit Summary" -or $line -match "\[ERROR\]" -or $line -match "Coverage:") {
                Write-Host "  $line" -ForegroundColor Yellow
            }
            return $line
        }

        # 3. Extract Coverage and ARCHIVE SUMMARY.HTML
        $summarySource = "$targetPath\target\site\munit\coverage\summary.html"
        $overallCoverage = "N/A"
        
        if (Test-Path $summarySource) {
            # Copy to archive folder for evidence
            $destFile = Join-Path $apiReportsFolder "$repoName-summary.html"
            Copy-Item -Path $summarySource -Destination $destFile -Force
            
            # Scrape percentage
            $html = Get-Content $summarySource -Raw
            if ($html -match '<span>(\d+(?:\.\d+)?)%</span>') { $overallCoverage = $matches[1] + "%" }
            Write-Host "SUCCESS: Report archived and coverage captured ($overallCoverage)." -ForegroundColor Green
        } else {
            Write-Host "WARNING: summary.html not found for $repoName." -ForegroundColor Red
        }

        # 4. Parse Test Failures for CSV
        $testReportDir = "$targetPath\target\munit-reports"
        $failureCount = 0
        if (Test-Path $testReportDir) {
            Get-ChildItem "$testReportDir\*.xml" | ForEach-Object {
                [xml]$xmlData = Get-Content $_.FullName
                foreach ($testCase in $xmlData.testsuite.testcase) {
                    if ($testCase.failure -or $testCase.error) {
                        $failureCount++
                        $tName = $testCase.name
                        $errMsg = ($testCase.failure.Message -replace '[,"]',' ')
                        "$repoName,$tName,FAILED,$overallCoverage,$errMsg,$(Get-Date)" | Out-File $consolidatedCsv -Append
                    }
                }
            }
        }

        # 5. Global Result Logging
        if ($mvnOutput -match "BUILD FAILURE" -and $failureCount -eq 0) {
            $buildErr = ($mvnOutput -match "\[ERROR\]" | Select-Object -First 1) -replace '[,"]',' '
            "$repoName,BuildSystem,BUILD_ERROR,$overallCoverage,$buildErr,$(Get-Date)" | Out-File $consolidatedCsv -Append
        } elseif ($failureCount -eq 0) {
            "$repoName,All Suites,PASSED,$overallCoverage,Success,$(Get-Date)" | Out-File $consolidatedCsv -Append
        }

    } catch {
        Write-Host "SCRIPT ERROR: $($_.Exception.Message)" -ForegroundColor Red
        "$repoName,System,SCRIPT_ERROR,N/A,$($_.Exception.Message -replace '[,"]',' '),$(Get-Date)" | Out-File $consolidatedCsv -Append
    }
}

Set-Location $rootWorkDir
Write-Host "`nDone! Summaries are in All_API_Reports folder." -ForegroundColor Green
