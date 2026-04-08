# --- Configuration ---
$rootWorkDir = "C:\MuleProjects\munit-runner" # The script home
$appListFile = Join-Path $rootWorkDir "app-list.txt"
$tempWorkDir = Join-Path $rootWorkDir "MuleTempBuilds" # Where apps are cloned

$baseSshUrl = 'git@ssh.dev.azure.com:v3/YourOrg/YourProject/' 
$consolidatedCsv = Join-Path $rootWorkDir "Consolidated_Coverage_Report.csv"
$apiReportsFolder = Join-Path $rootWorkDir "All_API_Reports"

# --- Initialization ---
if (!(Test-Path $tempWorkDir)) { New-Item -ItemType Directory -Path $tempWorkDir -Force | Out-Null }
if (!(Test-Path $apiReportsFolder)) { New-Item -ItemType Directory -Path $apiReportsFolder -Force | Out-Null }

# Set Headers and Clear Old Report
"Repository,Component,Status,Coverage,Details,Timestamp" | Out-File $consolidatedCsv -Encoding utf8 -Force

if (!(Test-Path $appListFile)) {
    Write-Host "Error: $appListFile not found in $rootWorkDir" -ForegroundColor Red
    return
}

$repos = Get-Content $appListFile | Where-Object { ![string]::IsNullOrWhiteSpace($_) }

foreach ($repoName in $repos) {
    $repoName = $repoName.Trim()
    $targetPath = Join-Path $tempWorkDir $repoName # Apps go into the temp subfolder
    Write-Host "`n>>> Processing: $repoName" -ForegroundColor Cyan

    try {
        # 1. Git Sync Logic
        if (Test-Path $targetPath) {
            Write-Host "Syncing existing code..." -ForegroundColor Gray
            Set-Location $targetPath
            git reset --hard; git checkout dev; git fetch --all; git pull origin dev --quiet
        } else {
            Write-Host "Cloning into temp workspace..." -ForegroundColor Gray
            Set-Location $tempWorkDir
            git clone --branch dev --single-branch "$baseSshUrl$repoName" $repoName --quiet
            Set-Location $targetPath
        }

        # 2. Run Maven
        Write-Host "Executing MUnit & Coverage Report..." -ForegroundColor Blue
        $mvnOutput = mvn clean test com.mulesoft.munit.tools`:munit-maven-plugin`:coverage-report `
            "-DsecureKey=s3cr3t" `
            "-Denv=dev" `
            "-DargLine=-DsecureKey=s3cr3t -Denv=dev" `
            "-Dmaven.test.failure.ignore=true" 2>&1

        # 3. Extract Coverage %
        $summaryPath = "$targetPath\target\site\munit\coverage\summary.html"
        $overallCoverage = "N/A"
        if (Test-Path $summaryPath) {
            $html = Get-Content $summaryPath -Raw
            if ($html -match '<span>(\d+(?:\.\d+)?)%</span>') { $overallCoverage = $matches[1] + "%" }
        }

        # 4. Collect API Reports to rootWorkDir subfolder
        $apiReportSource = "$targetPath\target\site\munit\coverage\api-reports.html"
        if (Test-Path $apiReportSource) {
            $destFile = Join-Path $apiReportsFolder "$repoName-api-reports.html"
            Copy-Item -Path $apiReportSource -Destination $destFile -Force
        }

        # 5. Parse Test Failures
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

        # 6. Success/Build Error Logging
        if ($mvnOutput -match "BUILD FAILURE" -and $failureCount -eq 0) {
            $buildErr = ($mvnOutput -match "\[ERROR\]" | Select-Object -First 1) -replace '[,"]',' '
            "$repoName,BuildSystem,BUILD_ERROR,$overallCoverage,$buildErr,$(Get-Date)" | Out-File $consolidatedCsv -Append
        } elseif ($failureCount -eq 0) {
            "$repoName,All Suites,PASSED,$overallCoverage,Success,$(Get-Date)" | Out-File $consolidatedCsv -Append
        }

    } catch {
        "$repoName,System,SCRIPT_ERROR,N/A,$($_.Exception.Message -replace '[,"]',' '),$(Get-Date)" | Out-File $consolidatedCsv -Append
    }
}

# Return to script root
Set-Location $rootWorkDir
Write-Host "`nAll tasks finished. Check your reports in: $rootWorkDir" -ForegroundColor Green
