@echo off
SETLOCAL EnableDelayedExpansion

:: --- CONFIGURATION ---
SET BYTEMAN_HOME=C:\tools\byteman-download-4.0.20
SET AGENT_JAR=%BYTEMAN_HOME%\lib\byteman.jar
SET RULES_FILE=%CD%\munit-leak-detector.btm
SET PROJECT_LIST=projects.csv
SET LOG_DIR=%CD%\audit_logs

:: Create log directory if it doesn't exist
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

:: Verify Byteman exists
if not exist "%AGENT_JAR%" (
    echo [ERROR] Byteman agent not found at %AGENT_JAR%. Please check BYTEMAN_HOME.
    exit /b 1
)

:: --- BYTEMAN & MULE OPTIONS ---
:: These flags force the forked MUnit JVM to use the agent and honor proxy properties
SET BYTEMAN_OPTS=-javaagent:"%AGENT_JAR%"=script:"%RULES_FILE%"
SET MULE_OPTS=-Dcom.ning.http.client.AsyncHttpClientConfig.useProxyProperties=true -Dmunit.strict.mode=true
SET JAVA_TOOL_OPTIONS=%BYTEMAN_OPTS% %MULE_OPTS%

echo [START] Starting batch audit for projects in %PROJECT_LIST%
echo ---------------------------------------------------------

:: --- ITERATE THROUGH PROJECTS ---
for /f "tokens=*" %%P in (%PROJECT_LIST%) do (
    SET REPO_NAME=%%P
    echo [PROCESS] Processing Repository: !REPO_NAME!
    
    if exist "!REPO_NAME!" (
        cd "!REPO_NAME!"
        
        :: --- GIT OPERATIONS ---
        echo [GIT] Resetting and updating !REPO_NAME! on branch dev...
        git reset --hard >nul 2>&1
        git checkout dev >nul 2>&1
        git fetch origin >nul 2>&1
        git pull origin dev >nul 2>&1
        
        :: --- MAVEN EXECUTION ---
        echo [MUNIT] Running tests and monitoring for leaks...
        call mvn clean test com.mulesoft.munit.tools:munit-maven-plugin:coverage-report "-Denv=dev" -Dmaven.clean.failOnError=false > "%LOG_DIR%\!REPO_NAME!_audit.log" 2>&1
        
        if !ERRORLEVEL! EQU 0 (
            echo [SUCCESS] Tests passed for !REPO_NAME!
        ) else (
            echo [WARNING] Tests failed or Leaks detected in !REPO_NAME!. Check log: %LOG_DIR%\!REPO_NAME!_audit.log
        )
        
        :: Return to root directory for next iteration
        cd ..
    ) else (
        echo [ERROR] Directory !REPO_NAME! not found. Skipping.
    )
    echo ---------------------------------------------------------
)

echo [FINISH] All projects processed.
ENDLOCAL
