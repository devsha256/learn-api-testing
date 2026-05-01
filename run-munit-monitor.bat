@echo off
SETLOCAL EnableDelayedExpansion

:: --- CONFIGURATION ---
SET "BYTEMAN_HOME=C:\tools\byteman-download-4.0.20"
SET "AGENT_JAR=%BYTEMAN_HOME%\lib\byteman.jar"
SET "RULES_FILE=%CD%\munit-leak-detector.btm"
SET "PROJECT_LIST=projects.csv"
SET "LOG_DIR=%CD%\audit_logs"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

:: --- BYTEMAN & MULE OPTIONS ---
SET "BYTEMAN_OPTS=-javaagent:"%AGENT_JAR%"=script:"%RULES_FILE%""
SET "MULE_OPTS=-Dcom.ning.http.client.AsyncHttpClientConfig.useProxyProperties=true -Dmunit.strict.mode=true"
SET "JAVA_TOOL_OPTIONS=%BYTEMAN_OPTS% %MULE_OPTS%"

echo =========================================================
echo STARTING MUNIT LEAK AUDIT WITH LIVE MONITORING
echo =========================================================

:: Iterate through the CSV
for /f "usebackq tokens=*" %%P in ("%PROJECT_LIST%") do (
    SET "REPO_NAME=%%P"
    SET "CURRENT_LOG=%LOG_DIR%\%%P_audit.log"
    
    echo [*] Project: !REPO_NAME!
    
    if exist "!REPO_NAME!" (
        pushd "!REPO_NAME!"
        
        echo     - Step 1: Syncing Git...
        git reset --hard >nul 2>&1
        git checkout dev >nul 2>&1
        git pull origin dev >nul 2>&1
        
        echo     - Step 2: Running MUnit (Live Output)...
        echo ---------------------------------------------------------
        
        :: CRITICAL FIX: The pipe character is escaped with ^| to prevent CMD parsing errors
        powershell -Command "mvn clean test com.mulesoft.munit.tools:munit-maven-plugin:coverage-report '-Denv=dev' -Dmaven.clean.failOnError=false ^| Tee-Object -FilePath '!CURRENT_LOG!'"
        
        SET "MAVEN_EXIT=!ERRORLEVEL!"
        echo ---------------------------------------------------------

        if !MAVEN_EXIT! EQU 0 (
            echo     - Result: BUILD SUCCESS
        ) else (
            echo     - Result: BUILD FAILURE
        )

        echo     - Final Leak Scan...
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
    echo =========================================================
)

echo AUDIT FINISHED.
ENDLOCAL
