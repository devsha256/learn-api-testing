@echo off
SETLOCAL EnableDelayedExpansion

:: --- CONFIGURATION ---
SET "BYTEMAN_HOME=C:\tools\byteman-download-4.0.20"
SET "AGENT_JAR=%BYTEMAN_HOME%\lib\byteman.jar"
SET "RULES_FILE=%CD%\munit-leak-detector.btm"
SET "PROJECT_LIST=projects.csv"
SET "LOG_DIR=%CD%\audit_logs"

:: Ensure directories exist
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

:: Verify Byteman presence
if not exist "%AGENT_JAR%" (
    echo [ERROR] Byteman agent not found at %AGENT_JAR%
    echo Please ensure BYTEMAN_HOME is correct.
    exit /b 1
)

:: --- INSTRUMENTATION SETUP ---
:: These options are passed to the forked MUnit JVM
SET "BYTEMAN_OPTS=-javaagent:"%AGENT_JAR%"=script:"%RULES_FILE%""
SET "MULE_OPTS=-Dcom.ning.http.client.AsyncHttpClientConfig.useProxyProperties=true -Dmunit.strict.mode=true"
SET "JAVA_TOOL_OPTIONS=%BYTEMAN_OPTS% %MULE_OPTS%"

echo =========================================================
echo STARTING MUNIT LEAK AUDIT (STABLE VERSION)
echo =========================================================

:: Iterate through the CSV using a label-call to keep the parser clean
for /f "usebackq tokens=*" %%P in ("%PROJECT_LIST%") do (
    call :ProcessProject "%%P"
)

echo =========================================================
echo AUDIT FINISHED.
echo =========================================================
exit /b

:: --- SUBROUTINE: PROCESS EACH PROJECT ---
:ProcessProject
SET "REPO_NAME=%~1"
SET "CURRENT_LOG=%LOG_DIR%\%~1_audit.log"

echo [*] Project: %REPO_NAME%

if exist "%REPO_NAME%" (
    pushd "%REPO_NAME%"
    
    :: Step 1: Git Sync
    echo     - Syncing Git (dev)...
    git reset --hard >nul 2>&1
    git checkout dev >nul 2>&1
    git pull origin dev >nul 2>&1
    
    :: Step 2: Maven Execution via PowerShell (for live Tee-Object output)
    echo     - Executing MUnit...
    echo ---------------------------------------------------------
    
    :: This specific line is protected by being outside the main FOR loop
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
        "mvn clean test com.mulesoft.munit.tools:munit-maven-plugin:coverage-report '-Denv=dev' -Dmaven.clean.failOnError=false | Tee-Object -FilePath '%CURRENT_LOG%'"
    
    SET "MAVEN_EXIT=%ERRORLEVEL%"
    echo ---------------------------------------------------------

    :: Result Reporting
    if !MAVEN_EXIT! EQU 0 (
        echo     - Result: BUILD SUCCESS
    ) else (
        echo     - Result: BUILD FAILURE
    )

    :: Leak Detection
    echo     - Scanning Log for Outbound Leaks...
    findstr /C:"[OUTBOUND-LEAK]" "%CURRENT_LOG%"
    if %ERRORLEVEL% EQU 0 (
        echo     [!] ALERT: Leak detected.
    ) else (
        echo     [OK] No leaks found.
    )
    
    popd
) else (
    echo [ERROR] Folder "%REPO_NAME%" not found.
)
echo ---------------------------------------------------------
goto :eof
