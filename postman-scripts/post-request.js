// Skip if this is the Boomi fetcher
if (pm.info.requestName === "_Boomi_Fetcher") {
    return;
}

// Skip if request name starts with underscore (utility requests)
if (pm.info.requestName.startsWith("_")) {
    return;
}

console.log(`\n=== Comparing Responses for: ${pm.info.requestName} ===`);

// Add a small delay to ensure Boomi response is stored (async handling)
setTimeout(() => {}, 100);

// Retrieve Boomi response
const boomiResponse = pm.collectionVariables.get("boomi_response");
const boomiStatus = pm.collectionVariables.get("boomi_status");
const mulesoftResponse = pm.response.text();

// Validation
if (!boomiResponse || boomiResponse.startsWith("ERROR:")) {
    console.error("Boomi response unavailable or failed");
    console.error("Boomi response:", boomiResponse);
    
    pm.test("Boomi API call succeeded", function() {
        pm.expect(boomiResponse).to.not.include("ERROR:");
    });
    
    const errorTemplate = `
        <div style="padding: 40px; text-align: center; font-family: Arial; background: #fff3cd; border-radius: 8px;">
            <h2 style="color: #856404;">Boomi Response Not Available</h2>
            <p style="color: #856404;">The Boomi API call failed or did not complete in time.</p>
            <p style="color: #856404; font-size: 14px; margin-top: 20px;">Error: ${boomiResponse}</p>
        </div>
    `;
    pm.visualizer.set(errorTemplate);
    return;
}

console.log("Boomi Status:", boomiStatus);
console.log("MuleSoft Status:", pm.response.code);
console.log("Boomi Length:", boomiResponse.length);
console.log("MuleSoft Length:", mulesoftResponse.length);

// Split into lines
function splitIntoLines(text) {
    if (!text) return [];
    return text.split(/\r?\n/);
}

const boomiLines = splitIntoLines(boomiResponse);
const mulesoftLines = splitIntoLines(mulesoftResponse);

// Compare line by line
function compareLineByLine(lines1, lines2) {
    const maxLines = Math.max(lines1.length, lines2.length);
    const comparisonResults = [];
    let mismatchCount = 0;
    
    for (let i = 0; i < maxLines; i++) {
        const boomiLine = lines1[i] !== undefined ? lines1[i] : '';
        const mulesoftLine = lines2[i] !== undefined ? lines2[i] : '';
        const isMatch = boomiLine === mulesoftLine;
        
        if (!isMatch) {
            mismatchCount++;
        }
        
        comparisonResults.push({
            lineNumber: i + 1,
            boomiLine: boomiLine,
            mulesoftLine: mulesoftLine,
            isMatch: isMatch
        });
    }
    
    return {
        results: comparisonResults,
        totalMismatches: mismatchCount,
        totalLines: maxLines
    };
}

const comparison = compareLineByLine(boomiLines, mulesoftLines);

console.log(`Comparison: ${comparison.totalMismatches} mismatches in ${comparison.totalLines} lines`);

// Test assertions
pm.test("Boomi API responded successfully", function() {
    pm.expect(boomiStatus).to.equal(200);
});

pm.test("MuleSoft API responded successfully", function() {
    pm.expect(pm.response.code).to.equal(200);
});

pm.test("Response line counts match", function() {
    pm.expect(boomiLines.length).to.equal(mulesoftLines.length);
});

pm.test("All lines match exactly", function() {
    pm.expect(comparison.totalMismatches).to.equal(0);
});

// Visualizer
const matchPercentage = comparison.totalLines > 0 
    ? Math.round(((comparison.totalLines - comparison.totalMismatches) / comparison.totalLines) * 100)
    : 100;

const template = `
<!DOCTYPE html>
<html>
<head>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Arial, sans-serif; padding: 20px; background: #f5f5f5; }
        .header {
            background: linear-gradient(135deg, {{#if totalMismatches}}#dc3545{{else}}#28a745{{/if}}, {{#if totalMismatches}}#c82333{{else}}#218838{{/if}});
            color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .header h2 { margin: 0 0 10px 0; font-size: 24px; }
        .header-stats { display: flex; gap: 30px; margin-top: 15px; font-size: 14px; flex-wrap: wrap; }
        .stat-item { display: flex; align-items: center; gap: 8px; }
        .stat-value { font-weight: bold; font-size: 16px; }
        .legend { background: white; padding: 15px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); display: flex; gap: 30px; align-items: center; flex-wrap: wrap; }
        .legend-title { font-weight: bold; color: #333; }
        .legend-item { display: flex; align-items: center; gap: 10px; }
        .legend-box { width: 30px; height: 20px; border: 1px solid #ddd; border-radius: 3px; }
        .legend-box.match { background-color: #ffffff; }
        .legend-box.mismatch { background-color: #ffe6e6; }
        .comparison-container { background: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); overflow: hidden; }
        table { width: 100%; border-collapse: collapse; }
        thead { position: sticky; top: 0; z-index: 10; }
        th { background-color: #2c3e50; color: white; padding: 15px 10px; text-align: left; font-weight: 600; border-right: 2px solid #34495e; }
        th:last-child { border-right: none; }
        th.line-num { width: 80px; text-align: center; }
        th.response-column { width: 45%; }
        td { padding: 8px 10px; vertical-align: top; border-bottom: 1px solid #e0e0e0; border-right: 1px solid #e0e0e0; font-family: 'Courier New', monospace; font-size: 13px; white-space: pre-wrap; word-break: break-all; }
        td:last-child { border-right: none; }
        td.line-num { text-align: center; font-weight: bold; color: #666; background-color: #f8f9fa; font-family: 'Segoe UI', sans-serif; }
        tr.match-row { background-color: #ffffff; }
        tr.mismatch-row { background-color: #ffe6e6; }
        tr.mismatch-row td.line-num { background-color: #ffcccc; color: #c0392b; font-weight: bold; }
        tr:hover td { background-color: #f0f0f0; }
        tr.mismatch-row:hover td { background-color: #ffd6d6; }
        .empty-line { color: #999; font-style: italic; }
    </style>
</head>
<body>
    <div class="header">
        <h2>🔍 Boomi vs MuleSoft Comparison</h2>
        <div class="header-stats">
            <div class="stat-item"><span>Request:</span><span class="stat-value">{{requestName}}</span></div>
            <div class="stat-item"><span>Total Lines:</span><span class="stat-value">{{totalLines}}</span></div>
            <div class="stat-item"><span>Mismatched:</span><span class="stat-value">{{totalMismatches}}</span></div>
            <div class="stat-item"><span>Match Rate:</span><span class="stat-value">{{matchPercentage}}%</span></div>
            <div class="stat-item"><span>Status:</span><span class="stat-value">{{#if totalMismatches}}❌ FAILED{{else}}✅ PASSED{{/if}}</span></div>
        </div>
    </div>
    <div class="legend">
        <span class="legend-title">Legend:</span>
        <div class="legend-item"><div class="legend-box match"></div><span>Matching Lines</span></div>
        <div class="legend-item"><div class="legend-box mismatch"></div><span>Mismatched Lines</span></div>
    </div>
    <div class="comparison-container">
        <table>
            <thead>
                <tr>
                    <th class="line-num">Line #</th>
                    <th class="response-column">Boomi Response</th>
                    <th class="response-column">MuleSoft Response</th>
                </tr>
            </thead>
            <tbody>
                {{#each results}}
                <tr class="{{#if isMatch}}match-row{{else}}mismatch-row{{/if}}">
                    <td class="line-num">{{lineNumber}}</td>
                    <td>{{#if boomiLine}}{{boomiLine}}{{else}}<span class="empty-line">(empty)</span>{{/if}}</td>
                    <td>{{#if mulesoftLine}}{{mulesoftLine}}{{else}}<span class="empty-line">(empty)</span>{{/if}}</td>
                </tr>
                {{/each}}
            </tbody>
        </table>
    </div>
</body>
</html>
`;

pm.visualizer.set(template, {
    requestName: pm.info.requestName,
    results: comparison.results,
    totalMismatches: comparison.totalMismatches,
    totalLines: comparison.totalLines,
    matchPercentage: matchPercentage
});
