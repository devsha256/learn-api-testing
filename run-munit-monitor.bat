@echo off
SETLOCAL EnableDelayedExpansion

:: --- CONFIGURATION ---
SET BYTEMAN_HOME=C:\tools\byteman-download-4.0.20
SET AGENT_JAR=%BYTEMAN_HOME%\lib\byteman.jar
SET RULES_FILE=%CD%\munit-leak-detector.btm
SET PROJECT_LIST=projects.csv
SET LOG_DIR=%CD%\audit_logs

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

:: Verify Byteman exists
if not exist "%AGENT_JAR%" (
    echo [ERROR] Byteman agent not found.
    exit /b 1
)

:: --- BYTEMAN & MULE OPTIONS ---
SET BYTEMAN_OPTS=-javaagent:"%AGENT_JAR%"=script:"%RULES_FILE%"
SET MULE_OPTS=-Dcom.ning.http.client.AsyncHttpClientConfig.useProxyProperties=true -Dmunit.strict.mode=true
SET JAVA_TOOL_OPTIONS=%BYTEMAN_OPTS% %MULE_OPTS%

echo =========================================================
echo STARTING MUNIT LEAK AUDIT
echo =========================================================

for /f "tokens=*" %%P in (%PROJECT_LIST%) do (
    SET REPO_NAME=%%P
    SET CURRENT_LOG=%LOG_DIR%\!REPO_NAME!_audit.log
    
    echo [!REPO_NAME!] - STEP 1: Syncing Git...
    if exist "!REPO_NAME!" (
        cd "!REPO_NAME!"
        git reset --hard >nul 2>&1
        git checkout dev >nul 2>&1
        git pull origin dev >nul 2>&1
        
        echo [!REPO_NAME!] - STEP 2: Running MUnit (Please wait)...
        :: Run Maven and redirect to log file
        call mvn clean test com.mulesoft.munit.tools:munit-maven-plugin:coverage-report "-Denv=dev" -Dmaven.clean.failOnError=false > "!CURRENT_LOG!" 2>&1
        
        :: Capture the exit code
        SET MAVEN_EXIT=!ERRORLEVEL!

        :: --- TERMINAL REPORTING ---
        if !MAVEN_EXIT! EQU 0 (
            echo [!REPO_NAME!] - RESULT: BUILD SUCCESS
        ) else (
            echo [!REPO_NAME!] - RESULT: BUILD FAILURE (Exit Code: !MAVEN_EXIT!)
        )

        :: --- INSTANT LEAK DETECTION IN TERMINAL ---
        echo [!REPO_NAME!] - SCANNING FOR LEAKS...
        findstr /C:"[OUTBOUND-LEAK]" "!CURRENT_LOG!"
        if !ERRORLEVEL! EQU 0 (
            echo [!] ALERT: Outbound leaks detected in !REPO_NAME!. See logs for details.
        ) else (
            echo [OK] No outbound leaks found in !REPO_NAME!.
        )
        
        cd ..
    ) else (
        echo [!REPO_NAME!] - ERROR: Directory not found.
    )
    echo ---------------------------------------------------------
)

echo AUDIT FINISHED.
ENDLOCAL
