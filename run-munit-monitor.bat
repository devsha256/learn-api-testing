@echo off
SETLOCAL EnableDelayedExpansion

:: --- CONFIGURATION ---
SET "BYTEMAN_HOME=C:\tools\byteman-download-4.0.20"
SET "AGENT_JAR=%BYTEMAN_HOME%\lib\byteman.jar"
SET "RULES_FILE=%CD%\munit-leak-detector.btm"
SET "PROJECT_LIST=projects.csv"
SET "LOG_DIR=%CD%\audit_logs"

:: Create log directory if missing
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

:: Verify Byteman exists
if not exist "%AGENT_JAR%" (
    echo [ERROR] Byteman agent not found at %AGENT_JAR%
    exit /b 1
)

:: --- BYTEMAN & MULE OPTIONS ---
SET "BYTEMAN_OPTS=-javaagent:"%AGENT_JAR%"=script:"%RULES_FILE%""
SET "MULE_OPTS=-Dcom.ning.http.client.AsyncHttpClientConfig.useProxyProperties=true -Dmunit.strict.mode=true"
SET "JAVA_TOOL_OPTIONS=%BYTEMAN_OPTS% %MULE_OPTS%"

echo =========================================================
echo STARTING MUNIT LEAK AUDIT
echo =========================================================

:: Iterate through the CSV
for /f "usebackq tokens=*" %%P in ("%PROJECT_LIST%") do (
    SET "REPO_NAME=%%P"
    SET "CURRENT_LOG=%LOG_DIR%\%%P_audit.log"
    
    echo [*] Project: !REPO_NAME!
    
    if exist "!REPO_NAME!" (
        pushd "!REPO_NAME!"
        
        echo     - Step 1: Updating Git...
        git reset --hard >nul 2>&1
        git checkout dev >nul 2>&1
        git pull origin dev >nul 2>&1
        
        echo     - Step 2: Running MUnit...
        :: Run Maven and capture output
        call mvn clean test com.mulesoft.munit.tools:munit-maven-plugin:coverage-report "-Denv=dev" -Dmaven.clean.failOnError=false > "!CURRENT_LOG!" 2>&1
        
        SET "MAVEN_EXIT=!ERRORLEVEL!"

        :: Report Result
        if !MAVEN_EXIT! EQU 0 (
            echo     - Result: BUILD SUCCESS
        ) else (
            echo     - Result: BUILD FAILURE
        )

        :: Scan for Leaks
        echo     - Scanning for Leaks...
        findstr /C:"[OUTBOUND-LEAK]" "!CURRENT_LOG!"
        if !ERRORLEVEL! EQU 0 (
            echo     [!] ALERT: Leaks detected.
        ) else (
            echo     [OK] No leaks found.
        )
        
        popd
    ) else (
        echo [ERROR] Directory !REPO_NAME! not found.
    )
    echo ---------------------------------------------------------
)

echo AUDIT FINISHED.
ENDLOCAL
