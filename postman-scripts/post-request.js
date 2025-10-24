// Store MuleSoft response
const mulesoftResponse = pm.response.text();
pm.collectionVariables.set("mule_response", mulesoftResponse);

// Retrieve Boomi response
const boomiResponse = pm.collectionVariables.get("boomi_response");

// Split responses into lines (handle different line break types)
function splitIntoLines(text) {
    // Split by \r\n, \n, or \r
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

// Perform line-by-line comparison
const comparison = compareLineByLine(boomiLines, mulesoftLines);

// Store comparison results
pm.collectionVariables.set("comparison_results", JSON.stringify(comparison));

console.log(`Comparison complete: ${comparison.totalMismatches} mismatched lines out of ${comparison.totalLines}`);

// Test assertions
pm.test("Boomi response received successfully", function() {
    pm.expect(boomiResponse).to.not.include("ERROR:");
});

pm.test("MuleSoft response received successfully", function() {
    pm.expect(pm.response.code).to.be.oneOf([200, 201, 204]);
});

pm.test("Both responses have same number of lines", function() {
    pm.expect(boomiLines.length).to.equal(mulesoftLines.length);
});

pm.test("All lines match between Boomi and MuleSoft", function() {
    pm.expect(comparison.totalMismatches).to.equal(0);
});

// Visualizer Template - Side-by-side line comparison
const template = `
<!DOCTYPE html>
<html>
<head>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            padding: 20px;
            background-color: #f5f5f5;
        }
        
        .header {
            background: linear-gradient(135deg, {{#if totalMismatches}}#dc3545{{else}}#28a745{{/if}}, {{#if totalMismatches}}#c82333{{else}}#218838{{/if}});
            color: white;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 20px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        .header h2 {
            margin: 0 0 10px 0;
            font-size: 24px;
        }
        
        .header-stats {
            display: flex;
            gap: 30px;
            margin-top: 15px;
            font-size: 14px;
        }
        
        .stat-item {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .stat-label {
            opacity: 0.9;
        }
        
        .stat-value {
            font-weight: bold;
            font-size: 16px;
        }
        
        .comparison-container {
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        
        table { 
            width: 100%;
            border-collapse: collapse;
        }
        
        thead {
            position: sticky;
            top: 0;
            z-index: 10;
        }
        
        th { 
            background-color: #2c3e50; 
            color: white; 
            padding: 15px 10px;
            text-align: left;
            font-weight: 600;
            border-right: 2px solid #34495e;
        }
        
        th:last-child {
            border-right: none;
        }
        
        th.line-num {
            width: 80px;
            text-align: center;
        }
        
        th.response-column {
            width: 45%;
        }
        
        td { 
            padding: 8px 10px;
            vertical-align: top;
            border-bottom: 1px solid #e0e0e0;
            border-right: 1px solid #e0e0e0;
            font-family: 'Courier New', Consolas, monospace;
            font-size: 13px;
            white-space: pre-wrap;
            word-break: break-all;
        }
        
        td:last-child {
            border-right: none;
        }
        
        td.line-num {
            text-align: center;
            font-weight: bold;
            color: #666;
            background-color: #f8f9fa;
            font-family: 'Segoe UI', sans-serif;
        }
        
        /* Match row - white background */
        tr.match-row {
            background-color: #ffffff;
        }
        
        /* Mismatch row - light red/pink background */
        tr.mismatch-row {
            background-color: #ffe6e6;
        }
        
        tr.mismatch-row td.line-num {
            background-color: #ffcccc;
            color: #c0392b;
            font-weight: bold;
        }
        
        tr:hover td {
            background-color: #f0f0f0;
        }
        
        tr.mismatch-row:hover td {
            background-color: #ffd6d6;
        }
        
        tr.mismatch-row:hover td.line-num {
            background-color: #ffb3b3;
        }
        
        .empty-line {
            color: #999;
            font-style: italic;
        }
        
        .success-message {
            text-align: center;
            padding: 40px;
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            margin-top: 20px;
        }
        
        .success-icon {
            font-size: 64px;
            color: #28a745;
            margin-bottom: 20px;
        }
        
        .legend {
            background: white;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            display: flex;
            gap: 30px;
            align-items: center;
        }
        
        .legend-title {
            font-weight: bold;
            color: #333;
        }
        
        .legend-item {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .legend-box {
            width: 30px;
            height: 20px;
            border: 1px solid #ddd;
            border-radius: 3px;
        }
        
        .legend-box.match {
            background-color: #ffffff;
        }
        
        .legend-box.mismatch {
            background-color: #ffe6e6;
        }
    </style>
</head>
<body>
    <div class="header">
        <h2>🔍 Line-by-Line Response Comparison</h2>
        <div class="header-stats">
            <div class="stat-item">
                <span class="stat-label">Total Lines:</span>
                <span class="stat-value">{{totalLines}}</span>
            </div>
            <div class="stat-item">
                <span class="stat-label">Mismatched Lines:</span>
                <span class="stat-value">{{totalMismatches}}</span>
            </div>
            <div class="stat-item">
                <span class="stat-label">Match Rate:</span>
                <span class="stat-value">{{matchPercentage}}%</span>
            </div>
            <div class="stat-item">
                <span class="stat-label">Status:</span>
                <span class="stat-value">{{#if totalMismatches}}FAILED{{else}}PASSED{{/if}}</span>
            </div>
        </div>
    </div>
    
    <div class="legend">
        <span class="legend-title">Legend:</span>
        <div class="legend-item">
            <div class="legend-box match"></div>
            <span>Matching Lines</span>
        </div>
        <div class="legend-item">
            <div class="legend-box mismatch"></div>
            <span>Mismatched Lines</span>
        </div>
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
                    <td>{{#if boomiLine}}{{boomiLine}}{{else}}<span class="empty-line">(empty line)</span>{{/if}}</td>
                    <td>{{#if mulesoftLine}}{{mulesoftLine}}{{else}}<span class="empty-line">(empty line)</span>{{/if}}</td>
                </tr>
                {{/each}}
            </tbody>
        </table>
    </div>
    
    {{#unless totalMismatches}}
    <div class="success-message">
        <div class="success-icon">✓</div>
        <h3 style="color: #28a745; margin-bottom: 10px;">Perfect Match!</h3>
        <p style="color: #666; font-size: 16px;">
            All {{totalLines}} lines match exactly between Boomi and MuleSoft responses
        </p>
    </div>
    {{/unless}}
</body>
</html>
`;

// Calculate match percentage
const matchPercentage = comparison.totalLines > 0 
    ? Math.round(((comparison.totalLines - comparison.totalMismatches) / comparison.totalLines) * 100)
    : 100;

// Set visualizer with comparison data
pm.visualizer.set(template, {
    results: comparison.results,
    totalMismatches: comparison.totalMismatches,
    totalLines: comparison.totalLines,
    matchPercentage: matchPercentage
});
