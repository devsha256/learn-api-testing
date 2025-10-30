// ========================================================================
// [SETUP] Clear Previous Reports - Post-request Script (Functional Style)
// Cleans up test environment with Material Design 3 visualization.
// ========================================================================

// ========================================================================
// Constants
// ========================================================================
const SYSTEM_VARS = [
    "mule_base_url", "boomi_base_url", "exempted_xml_paths", "boomi_auth_type",
    "boomi_username", "boomi_password", "boomi_bearer_token", "boomi_api_key",
    "boomi_api_key_header", "variables"
];

const TEMP_VARS = [
    "report_request_count", "current_report_index", "temp_request_name",
    "temp_request_curl", "boomi_response", "boomi_status", "boomi_error",
    "csv_full_report", "csv_summary_report", "regression_mode",
    "regression_curl", "regression_request_name"
];

// ========================================================================
// Utility Functions
// ========================================================================
const getCollectionVar = (key) => pm.collectionVariables.get(key);
const setCollectionVar = (key, value) => pm.collectionVariables.set(key, value);
const unsetCollectionVar = (key) => pm.collectionVariables.unset(key);
const getPreviousReportCount = () => parseInt(getCollectionVar("report_request_count") || "0");

const safeParseJSON = (jsonString, fallback = []) => {
    if (!jsonString) return fallback;
    try {
        return JSON.parse(jsonString);
    } catch (e) {
        console.error("Could not parse 'variables' collection variable. It should be a JSON array of strings.");
        return fallback;
    }
};

// ========================================================================
// Variable Management
// ========================================================================
const getUserPreserveVars = () => {
    const preserveVarsStr = getCollectionVar("variables");
    return safeParseJSON(preserveVarsStr);
};

const getAllPreservedVars = () => {
    // Fetches all active variable keys to ensure we only preserve variables that actually exist.
    const activeVarKeys = pm.collectionVariables.values.map(v => v.key);
    const userVars = getUserPreserveVars();
    const allPreserveRequests = [...new Set(SYSTEM_VARS.concat(userVars))];
    
    return allPreserveRequests.filter(key => activeVarKeys.includes(key));
};

// ========================================================================
// Cleanup Operations
// ========================================================================
const generateReportVarName = (index) => `report_data_${String(index).padStart(3, '0')}`;

const clearReportData = (previousCount) => {
    let clearedCount = 0;
    for (let i = 1; i <= previousCount; i++) {
        unsetCollectionVar(generateReportVarName(i));
        clearedCount++;
    }
    return clearedCount;
};

const clearTempVariables = (preservedVars) => {
    const activeVarKeys = pm.collectionVariables.values.map(v => v.key);
    let clearedCount = 0;

    for (const varName of TEMP_VARS) {
        // Only unset the variable if it exists and is not in the preserved list.
        if (activeVarKeys.includes(varName) && !preservedVars.includes(varName)) {
            unsetCollectionVar(varName);
            clearedCount++;
        }
    }
    return clearedCount;
};

const resetReportCounter = () => setCollectionVar("report_request_count", "0");

const performCleanup = (previousCount, preservedVars) => {
    const clearedReports = clearReportData(previousCount);
    const clearedTemp = clearTempVariables(preservedVars);
    resetReportCounter();
    console.log(`Cleanup done: Cleared ${clearedReports} reports and ${clearedTemp} temp vars.`);
    return { clearedReports, clearedTemp };
};

// ========================================================================
// HTML Generation
// ========================================================================
const generateVariableList = (vars) => {
    if (!vars || vars.length === 0) {
        return '<li>No variables were preserved.</li>';
    }
    return vars.map(v => `<li>${v}</li>`).join('');
};

const getCSS = () => `
    :root {
        --md-sys-color-primary: #6750A4;
        --md-sys-color-surface: #FFFBFE;
        --md-sys-color-surface-variant: #F0F0F0;
        --md-sys-color-on-surface: #1C1B1F;
        --md-sys-color-on-surface-variant: #49454F;
        --md-sys-color-outline: #CCCCCC;
        --border-radius: 12px;
        --spacing-small: 8px;
        --spacing-medium: 16px;
        --spacing-large: 24px;
    }
    body {
        background-color: var(--md-sys-color-surface);
        font-family: 'Roboto', Arial, sans-serif;
        font-size: 14px;
        color: var(--md-sys-color-on-surface);
        padding: var(--spacing-large);
        margin: 0;
        box-sizing: border-box;
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 100vh;
        text-align: center;
    }
    .container { max-width: 560px; width: 100%; padding: var(--spacing-large); background: transparent; box-shadow: none; }
    h2 { color: var(--md-sys-color-primary); font-size: 22px; font-weight: 500; margin-bottom: var(--spacing-medium); }
    .stats, .preserved { background-color: var(--md-sys-color-surface-variant); padding: var(--spacing-medium); border-radius: var(--border-radius); color: var(--md-sys-color-on-surface-variant); margin-top: var(--spacing-medium); }
    .stats p { margin: var(--spacing-small) 0; }
    .preserved { text-align: left; max-height: 250px; overflow-y: auto; }
    .preserved h3 { font-size: 16px; font-weight: 500; margin-bottom: var(--spacing-medium); color: var(--md-sys-color-on-surface-variant); }
    .preserved ul { list-style: none; padding: 0; }
    .preserved li { padding: 8px; border-bottom: 1px solid var(--md-sys-color-outline); font-size: 13px; }
    .preserved li:last-child { border-bottom: none; }
    .signature { font-size: 12px; color: var(--md-sys-color-on-surface-variant); font-style: italic; margin-top: var(--spacing-large); }
    svg#bubble-animation { width: 100%; height: 180px; margin-top: var(--spacing-medium); background-color: var(--md-sys-color-surface-variant); border-radius: var(--border-radius); }
`;

const generateHTML = (clearedReports, clearedTemp, preservedVars) => {
    const varList = generateVariableList(preservedVars);
    const style = getCSS();
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500&display=swap" rel="stylesheet">
        <style>${style}</style>
        <script src="https://d3js.org/d3.v7.min.js"></script>
        <title>Setup Complete</title>
    </head>
    <body>
        <div class="container">
            <h2>Setup Complete</h2>
            <svg id="bubble-animation"></svg>
            <div class="stats">
                <p>Cleared <strong>${clearedReports}</strong> previous report entries.</p>
                <p>Cleared <strong>${clearedTemp}</strong> temporary variables.</p>
            </div>
            <div class="preserved">
                <h3>Preserved Variables (${preservedVars.length})</h3>
                <ul>${varList}</ul>
            </div>
            <div class="signature">S. 2025</div>
        </div>
        <script>
            const svg = d3.select('#bubble-animation');
            const width = svg.node().getBoundingClientRect().width;
            const height = svg.node().getBoundingClientRect().height;
            const numBubbles = Math.min(${clearedTemp}, 20);
            if (numBubbles > 0) {
                const bubbles = d3.range(numBubbles).map(() => ({}));
                const bubbleElements = svg.selectAll('circle').data(bubbles).join('circle')
                    .attr('cx', width / 2).attr('cy', height / 2).attr('r', 0)
                    .attr('fill', 'var(--md-sys-color-primary)').style('opacity', 0.7);
                function animate(selection) {
                    selection.transition()
                        .delay((d, i) => i * 200)
                        .duration(3000)
                        .attr('r', Math.min(width, height) / 2)
                        .style('opacity', 0)
                        .on('end', function() {
                            d3.select(this).attr('r', 0).style('opacity', 0.7);
                            animate(d3.select(this));
                        });
                }
                animate(bubbleElements);
            }
        </script>
    </body>
    </html>`;
};

// ========================================================================
// Main Execution
// ========================================================================
const previousCount = getPreviousReportCount();
const finalPreservedVars = getAllPreservedVars();
const { clearedReports, clearedTemp } = performCleanup(previousCount, finalPreservedVars);
const html = generateHTML(clearedReports, clearedTemp, finalPreservedVars);

pm.visualizer.set(html);
