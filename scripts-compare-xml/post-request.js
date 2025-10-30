// ========================================================================
// Utility Functions - Must be defined FIRST
// ========================================================================
const getCollectionVar = (key) => pm.collectionVariables.get(key);
const setCollectionVar = (key, value) => pm.collectionVariables.set(key, value);
const getRegressionMode = () => getCollectionVar("regression_mode");
const getBoomiResponse = () => getCollectionVar("boomi_response");

const shouldSkipRequest = (requestName, regressionMode) => 
    requestName.startsWith("[") && regressionMode !== "true";

const logRegression = (regressionMode) => {
    if (regressionMode === "true") {
        console.log("=== REGRESSION POST-REQUEST: Processing comparison ===");
    }
};

const isValidResponse = (response) => 
    response && response !== "" && response !== "undefined" && response !== null;

const parseExemptedFields = () => {
    const exemptedFieldsStr = getCollectionVar("exempted_fields");
    return exemptedFieldsStr ? JSON.parse(exemptedFieldsStr) : [];
};

// ========================================================================
// XML Parsing Utilities
// ========================================================================
const removeXMLComments = (xml) => xml.replace(/<!--[\s\S]*?-->/g, '');
const removeXMLDeclaration = (xml) => xml.replace(/<\?xml[^?]*\?>/g, '');
const normalizeWhitespace = (xml) => xml.replace(/>\s+</g, '><').trim();

const tokenizeXML = (xml) => {
    const tokens = [];
    const regex = /<\/?[^>]+>|[^<>]+/g;
    let match;
    while ((match = regex.exec(xml)) !== null) {
        const token = match[0].trim();
        if (token) tokens.push(token);
    }
    return tokens;
};

const isOpeningTag = (token) => 
    token.startsWith('<') && !token.startsWith('</') && !token.endsWith('/>');

const isClosingTag = (token) => token.startsWith('</');
const isSelfClosingTag = (token) => token.endsWith('/>');
const isTextContent = (token) => !token.startsWith('<');

const extractTagName = (token) => {
    const match = token.match(/<\/?([^\s>]+)/);
    return match ? match[1] : '';
};

const buildXMLLineStructure = (tokens) => {
    const lines = [];
    let indent = 0;
    let i = 0;
    
    while (i < tokens.length) {
        const token = tokens[i];
        
        if (isOpeningTag(token)) {
            const tagName = extractTagName(token);
            const nextToken = tokens[i + 1];
            const closingToken = tokens[i + 2];
            
            if (nextToken && isTextContent(nextToken) && 
                closingToken && isClosingTag(closingToken) &&
                extractTagName(closingToken) === tagName) {
                
                lines.push({
                    text: `${token}${nextToken}${closingToken}`,
                    indent: indent,
                    path: tagName,
                    type: 'simple-element'
                });
                i += 3;
            } else {
                lines.push({
                    text: token,
                    indent: indent,
                    path: tagName,
                    type: 'open-tag'
                });
                indent++;
                i++;
            }
        } else if (isClosingTag(token)) {
            indent = Math.max(0, indent - 1);
            lines.push({
                text: token,
                indent: indent,
                path: extractTagName(token),
                type: 'close-tag'
            });
            i++;
        } else if (isSelfClosingTag(token)) {
            lines.push({
                text: token,
                indent: indent,
                path: extractTagName(token),
                type: 'self-closing'
            });
            i++;
        } else {
            lines.push({
                text: token,
                indent: indent,
                path: '',
                type: 'text'
            });
            i++;
        }
    }
    
    return lines;
};

// ========================================================================
// Regex Pattern Matching Utilities
// ========================================================================
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isWildcardPattern = (field) => field.includes('*') || field.includes('?');
const isFullRegexPattern = (field) => field.startsWith('/') && field.lastIndexOf('/') > 0;

const convertWildcardToRegex = (pattern) => {
    let regexPattern = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    regexPattern = regexPattern.replace(/\*/g, '.*');
    regexPattern = regexPattern.replace(/\?/g, '.');
    return regexPattern;
};

const parseFullRegex = (regexString) => {
    const lastSlashIndex = regexString.lastIndexOf('/');
    const pattern = regexString.slice(1, lastSlashIndex);
    const flags = regexString.slice(lastSlashIndex + 1);
    
    try {
        return new RegExp(pattern, flags);
    } catch (e) {
        console.warn(`Invalid regex pattern: ${regexString}`, e.message);
        return null;
    }
};

const extractFieldName = (path) => {
    if (!path) return '';
    const withoutNamespace = path.replace(/^[^:]+:/, '');
    return withoutNamespace;
};

const isFieldExempted = (path, exemptedField) => {
    if (!path || !exemptedField) return { isExempted: false, matchedField: null };
    
    const fieldName = extractFieldName(path);
    
    // Mode 1: Full Regex Pattern (wrapped in slashes)
    if (isFullRegexPattern(exemptedField)) {
        const regex = parseFullRegex(exemptedField);
        if (regex && (regex.test(path) || regex.test(fieldName))) {
            return { isExempted: true, matchedField: path };
        }
        return { isExempted: false, matchedField: null };
    }
    
    // Mode 2: Wildcard Pattern (contains * or ?)
    if (isWildcardPattern(exemptedField)) {
        const regexPattern = convertWildcardToRegex(exemptedField);
        const pattern = new RegExp(`^${regexPattern}$`);
        
        if (pattern.test(fieldName) || pattern.test(path)) {
            return { isExempted: true, matchedField: path };
        }
        return { isExempted: false, matchedField: null };
    }
    
    // Mode 3: Simple String (exact field name match)
    if (fieldName === exemptedField || path === exemptedField) {
        return { isExempted: true, matchedField: path };
    }
    
    return { isExempted: false, matchedField: null };
};

// ========================================================================
// Alignment Utilities
// ========================================================================
const createEmptyLine = (referenceLine) => ({
    text: '',
    indent: referenceLine.indent,
    isEmpty: true,
    path: referenceLine.path
});

const createAlignedPair = (boomi, mule, status) => ({ boomi, mule, status });

const determineAlignmentStatus = (leftLine, rightLine) => {
    if (leftLine.path === rightLine.path && leftLine.type === rightLine.type) {
        return (leftLine.text !== rightLine.text) ? 'mismatch' : 'match';
    }
    return null;
};

const lookAhead = (lines, startIdx, targetPath, targetType, range = 30) => {
    const endIdx = Math.min(startIdx + range, lines.length);
    for (let i = startIdx + 1; i < endIdx; i++) {
        if (lines[i].path === targetPath && lines[i].type === targetType) {
            return true;
        }
    }
    return false;
};

const alignLinesWithXML = (leftLines, rightLines) => {
    const aligned = [];
    let leftIdx = 0;
    let rightIdx = 0;
    
    while (leftIdx < leftLines.length || rightIdx < rightLines.length) {
        const leftLine = leftLines[leftIdx];
        const rightLine = rightLines[rightIdx];
        
        if (!leftLine) {
            aligned.push(createAlignedPair(createEmptyLine(rightLine), rightLine, 'only_mule'));
            rightIdx++;
        } else if (!rightLine) {
            aligned.push(createAlignedPair(leftLine, createEmptyLine(leftLine), 'only_boomi'));
            leftIdx++;
        } else {
            const status = determineAlignmentStatus(leftLine, rightLine);
            
            if (status) {
                aligned.push(createAlignedPair(leftLine, rightLine, status));
                leftIdx++;
                rightIdx++;
            } else {
                const rightHasPath = lookAhead(rightLines, rightIdx, leftLine.path, leftLine.type);
                const leftHasPath = lookAhead(leftLines, leftIdx, rightLine.path, rightLine.type);
                
                if (!rightHasPath) {
                    aligned.push(createAlignedPair(leftLine, createEmptyLine(leftLine), 'only_boomi'));
                    leftIdx++;
                } else if (!leftHasPath) {
                    aligned.push(createAlignedPair(createEmptyLine(rightLine), rightLine, 'only_mule'));
                    rightIdx++;
                } else {
                    if (leftLine.path < rightLine.path) {
                        aligned.push(createAlignedPair(leftLine, createEmptyLine(leftLine), 'only_boomi'));
                        leftIdx++;
                    } else {
                        aligned.push(createAlignedPair(createEmptyLine(rightLine), rightLine, 'only_mule'));
                        rightIdx++;
                    }
                }
            }
        }
    }
    
    return aligned;
};

// ========================================================================
// Statistics Utilities
// ========================================================================
const initializeStats = () => ({
    totalMismatches: 0,
    totalExempted: 0,
    totalMatched: 0,
    totalOnlyMule: 0,
    exemptedFieldsFound: []
});

const checkExemption = (path, exemptedFields) => {
    for (const field of exemptedFields) {
        const result = isFieldExempted(path, field);
        if (result.isExempted) {
            return { isExempted: true, matchedField: result.matchedField };
        }
    }
    return { isExempted: false, matchedField: null };
};

const updateStats = (stats, status, isExempted, matchedField) => {
    if (isExempted) {
        stats.totalExempted++;
        if (!stats.exemptedFieldsFound.includes(matchedField)) {
            stats.exemptedFieldsFound.push(matchedField);
        }
    } else {
        switch (status) {
            case 'match':
                stats.totalMatched++;
                break;
            case 'mismatch':
            case 'only_boomi':
                stats.totalMismatches++;
                break;
            case 'only_mule':
                stats.totalOnlyMule++;
                break;
        }
    }
};

const calculateStats = (aligned, exemptedFields) => {
    const stats = initializeStats();
    
    aligned.forEach(pair => {
        const path = pair.boomi.path || pair.mule.path;
        const { isExempted, matchedField } = checkExemption(path, exemptedFields);
        
        if (isExempted) {
            pair.status = 'exempted';
        }
        
        updateStats(stats, pair.status, isExempted, matchedField);
    });
    
    const exemptedFieldsList = stats.exemptedFieldsFound.join(', ');
    const totalComparedLines = stats.totalMatched + stats.totalMismatches + stats.totalExempted;
    const matchPercentage = totalComparedLines > 0 
        ? Math.round((stats.totalMatched / totalComparedLines) * 10000) / 100 
        : 0;
    const statusText = stats.totalMismatches === 0 ? "PASSED" : "FAILED";
    
    return {
        ...stats,
        totalLines: aligned.length,
        exemptedFieldsList,
        matchPercentage,
        statusText
    };
};

// ========================================================================
// Testing & Logging
// ========================================================================
const runTests = (stats, context) => {
    pm.test("Boomi API responded", () => 
        pm.expect(context.boomiStatus).to.be.oneOf([200, 201, 202, 204])
    );
    
    pm.test("MuleSoft API responded", () => 
        pm.expect(pm.response.code).to.be.oneOf([200, 201, 202, 204])
    );
    
    pm.test("Boomi & Mule Status code match", () => 
        pm.expect(context.boomiStatus).to.equal(pm.response.code)
    );
    
    pm.test("All non-exempted fields match", () => 
        pm.expect(stats.totalMismatches).to.equal(0)
    );
};

const logStatistics = (stats) => {
    console.log("=== COMPARISON BREAKDOWN ===");
    console.log(`Exempted fields: ${stats.exemptedFieldsList || "None"}`);
    console.log(`Total matched: ${stats.totalMatched}`);
    console.log(`Total mismatches: ${stats.totalMismatches} (includes only_boomi)`);
    console.log(`Total exempted: ${stats.totalExempted}`);
    console.log(`Only in Mule (ignored): ${stats.totalOnlyMule}`);
    console.log("=== STATISTICS ===");
    console.log(`Total aligned lines: ${stats.totalLines}`);
    console.log(`Match percentage: ${stats.matchPercentage}%`);
    console.log(`Overall status: ${stats.statusText}`);
};

// ========================================================================
// Report Storage - CORRECTED CSV ESCAPING
// ========================================================================
const minifyResponse = (text) => {
    if (!text) return "";
    
    try {
        // Remove all newlines and extra whitespace from XML
        const cleaned = text.replace(/\r?\n|\r/g, ' ').replace(/\s+/g, ' ').trim();
        // Escape backslashes first, then quotes
        return cleaned.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    } catch (e) {
        return text.replace(/\r?\n|\r/g, ' ').replace(/\s+/g, ' ').trim()
                   .replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }
};

const escapeCurlCommand = (curlCommand) => 
    curlCommand.replace(/\r?\n|\r/g, ' ')
               .replace(/\s+/g, ' ')
               .trim()
               .replace(/\\/g, '\\\\')
               .replace(/"/g, '\\"');

const createStatsObject = (stats, context) => ({
    totalLines: stats.totalLines,
    matchedLines: stats.totalMatched,
    mismatchedLines: stats.totalMismatches,
    exemptedLines: stats.totalExempted,
    exemptedFields: stats.exemptedFieldsList,
    matchPercentage: stats.matchPercentage,
    status: stats.statusText,
    boomiStatus: context.boomiStatus,
    mulesoftStatus: pm.response.code,
    timestamp: new Date().toISOString()
});

const createReportEntry = (context, stats) => ({
    serialNumber: parseInt(context.reportIndex),
    requestName: context.requestName,
    curlCommand: escapeCurlCommand(context.curlCommand),
    boomiResponse: context.skipPayloadLogging 
        ? "[PAYLOAD_SKIPPED]" 
        : minifyResponse(context.boomiResponseRaw),
    mulesoftResponse: context.skipPayloadLogging 
        ? "[PAYLOAD_SKIPPED]" 
        : minifyResponse(context.mulesoftResponseRaw),
    statistics: createStatsObject(stats, context)
});

const storeReport = (context, stats) => {
    const reportEntry = createReportEntry(context, stats);
    const paddedIndex = context.reportIndex.padStart(3, '0');
    
    setCollectionVar(`report_data_${paddedIndex}`, JSON.stringify(reportEntry));
    console.log(`Report stored with cURL length: ${context.curlCommand.length}`);
    
    setCollectionVar("temp_request_name", "");
    setCollectionVar("temp_request_curl", "");
};


// ========================================================================
// Visualization
// ========================================================================
const escapeHtml = (text) => {
    if (!text) return '';
    // Correctly escape the single quote character
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;'); 
};

const createTableRow = (pair) => {
    const { boomi: bLine, mule: mLine, status } = pair;
    // Use the MD3 spacing scale for indentation
    const basePadding = 16; 
    const indentStep = 16;
    const bIndent = basePadding + (bLine.indent * indentStep);
    const mIndent = basePadding + (mLine.indent * indentStep);
    
    const bText = bLine.isEmpty ? '' : escapeHtml(bLine.text);
    const mText = mLine.isEmpty ? '' : escapeHtml(mLine.text);
    
    const pointerMap = {
        'mismatch': '↔',
        'only_boomi': '→',
        'only_mule': '←'
    };
    const pointer = pointerMap[status] || '';
    const emptySpan = '<span class="empty">&nbsp;</span>';
    
    // The class on the <tr> will now control the left border color
    return `<tr class="${status || 'match'}">
        <td style="padding-left:${bIndent}px">${bText || emptySpan}</td>
        <td class="pointer">${pointer}</td>
        <td style="padding-left:${mIndent}px">${mText || emptySpan}</td>
    </tr>`;
};

const generateVisualizerHTML = (aligned, stats, requestName) => {
    const escapeHtml = (text) => {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };

    const createTableRow = (pair) => {
        const { boomi: bLine, mule: mLine, status } = pair;
        const basePadding = 16;
        const indentStep = 16;
        const bIndent = basePadding + (bLine.indent * indentStep);
        const mIndent = basePadding + (mLine.indent * indentStep);
        
        const bText = bLine.isEmpty ? '' : escapeHtml(bLine.text);
        const mText = mLine.isEmpty ? '' : escapeHtml(mLine.text);
        
        const pointerMap = {
            'mismatch': '↔',
            'only_boomi': '→',
            'only_mule': '←'
        };
        const pointer = pointerMap[status] || '';
        const emptySpan = '<span class="empty">&nbsp;</span>';
        
        return `<tr class="${status || 'match'}">
            <td style="padding-left:${bIndent}px">${bText || emptySpan}</td>
            <td class="pointer">${pointer}</td>
            <td style="padding-left:${mIndent}px">${mText || emptySpan}</td>
        </tr>`;
    };

    const tableRows = aligned.map(createTableRow).join("");

    const statusColor = stats.totalMismatches > 0 ? 'var(--md-sys-color-error-container)' : 'var(--md-sys-color-primary-container)';
    const statusTextColor = stats.totalMismatches > 0 ? 'var(--md-sys-color-on-error-container)' : 'var(--md-sys-color-on-primary-container)';

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
        <style>
            :root {
                --md-sys-color-primary: #6750A4;
                --md-sys-color-on-primary: #FFFFFF;
                --md-sys-color-primary-container: #EADDFF;
                --md-sys-color-on-primary-container: #21005D;
                --md-sys-color-surface: #FFFBFE;
                --md-sys-color-surface-variant: #E7E0EC;
                --md-sys-color-on-surface: #1C1B1F;
                --md-sys-color-on-surface-variant: #49454F;
                --md-sys-color-outline: #79747E;
                --md-sys-color-error: #B3261E;
                --md-sys-color-error-container: #F9DEDC;
                --md-sys-color-on-error-container: #410E0B;

                --status-mismatch: #B3261E;
                --status-exempted: #79747E;
                --status-only-boomi: #6750A4;
                --status-only-mule: #0061A4;
                
                --border-radius: 16px;
                --spacing-small: 8px;
                --spacing-medium: 16px;
                --spacing-large: 24px;
            }

            body { margin: 0; padding: var(--spacing-large); box-sizing: border-box; font-family: 'Roboto', 'Arial', sans-serif; font-size: 14px; background-color: #F7F2FA; color: var(--md-sys-color-on-surface); }
            .main-container { display: flex; flex-direction: column; gap: var(--spacing-large); }
            .card { background-color: var(--md-sys-color-surface); border-radius: var(--border-radius); padding: var(--spacing-medium); box-shadow: 0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06); overflow: hidden; }
            .header-card { padding: 0; }
            .header-title { padding: var(--spacing-medium); }
            .header-title h2 { font-size: 22px; font-weight: 500; margin: 0; color: var(--md-sys-color-on-surface); }
            .header-stats-container { display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--md-sys-color-surface-variant); padding: var(--spacing-medium); flex-wrap: wrap; gap: var(--spacing-medium); }
            .stats-group { display: flex; gap: var(--spacing-large); flex-wrap: wrap; }
            .stat-item { display: flex; flex-direction: column; }
            .stat-item .label { font-size: 12px; color: var(--md-sys-color-on-surface-variant); }
            .stat-item .value { font-size: 18px; font-weight: 500; }
            .status-badge { padding: var(--spacing-small) var(--spacing-medium); border-radius: 8px; font-weight: 500; background-color: ${statusColor}; color: ${statusTextColor}; }
            
            /* Corrected Legend Styling */
            .legend-card { display: flex; align-items: center; gap: var(--spacing-large); font-size: 12px; flex-wrap: wrap; }
            .legend-title { font-weight: 700; color: var(--md-sys-color-on-surface-variant); }
            .legend-item { display: flex; align-items: center; gap: var(--spacing-small); }
            .legend-box { width: 14px; height: 14px; border-radius: 4px; border: 4px solid; }
            .legend-box.match { border-color: transparent; }
            .legend-box.mismatch { border-color: var(--status-mismatch); }
            .legend-box.exempted { border-color: var(--status-exempted); }
            .legend-box.only_boomi { border-color: var(--status-only-boomi); }
            .legend-box.only_mule { border-color: var(--status-only-mule); }

            .table-container { max-height: 70vh; overflow: auto; border: 1px solid var(--md-sys-color-surface-variant); border-radius: var(--border-radius); }
            table { width: 100%; border-collapse: collapse; font-size: 12px; table-layout: fixed; }
            thead { position: sticky; top: 0; background: var(--md-sys-color-surface); z-index: 10; }
            th { padding: var(--spacing-medium); text-align: left; font-weight: 700; font-size: 12px; color: var(--md-sys-color-on-surface-variant); border-bottom: 1px solid var(--md-sys-color-outline); }
            th:first-child { width: 47%; }
            th:nth-child(2) { width: 6%; text-align: center; }
            th:last-child { width: 47%; }
            tbody tr { transition: background-color 0.15s ease-in-out; border-left: 4px solid transparent; }
            tbody tr:hover { background-color: var(--md-sys-color-primary-container); }
            tbody tr.mismatch { border-left-color: var(--status-mismatch); }
            tbody tr.exempted { border-left-color: var(--status-exempted); }
            tbody tr.only_boomi { border-left-color: var(--status-only-boomi); }
            tbody tr.only_mule { border-left-color: var(--status-only-mule); }
            td { padding: var(--spacing-small) var(--spacing-medium); border-bottom: 1px solid var(--md-sys-color-surface-variant); font-family: 'Consolas', 'Monaco', monospace; vertical-align: top; word-wrap: break-word; white-space: pre-wrap; line-height: 1.5; }
            td.pointer { text-align: center; font-family: 'Roboto', sans-serif; font-size: 18px; vertical-align: middle; color: var(--status-mismatch); }
            .empty { color: #BDBDBD; }
            .signature { text-align: right; margin-top: var(--spacing-medium); font-size: 10px; color: var(--md-sys-color-on-surface-variant); font-style: italic; }
        </style>
    </head>
    <body>
        <div class="main-container">
            <div class="card header-card">
                <div class="header-title">
                    <h2>XML/SOAP Response Comparison: ${escapeHtml(requestName)}</h2>
                </div>
                <div class="header-stats-container">
                    <div class="stats-group">
                        <div class="stat-item"><span class="label">Lines</span><span class="value">${stats.totalLines}</span></div>
                        <div class="stat-item"><span class="label">Mismatched</span><span class="value">${stats.totalMismatches}</span></div>
                        <div class="stat-item"><span class="label">Exempted</span><span class="value">${stats.totalExempted}</span></div>
                        <div class="stat-item"><span class="label">Match %</span><span class="value">${stats.matchPercentage}%</span></div>
                    </div>
                    <div class="status-badge">${stats.statusText}</div>
                </div>
            </div>

            <!-- Corrected Legend HTML Structure -->
            <div class="card legend-card">
                <span class="legend-title">Legend:</span>
                <div class="legend-item"><div class="legend-box match"></div><span>Match</span></div>
                <div class="legend-item"><div class="legend-box mismatch"></div><span>Mismatch</span></div>
                <div class="legend-item"><div class="legend-box exempted"></div><span>Exempted</span></div>
                <div class="legend-item"><div class="legend-box only_boomi"></div><span>Only Boomi</span></div>
                <div class="legend-item"><div class="legend-box only_mule"></div><span>Only Mule</span></div>
            </div>

            <div class="card table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Boomi XML</th>
                            <th></th>
                            <th>MuleSoft XML</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tableRows}
                    </tbody>
                </table>
            </div>
        </div>
        <div class="signature">S. 2025</div>
    </body>
    </html>
    `;
};


const renderVisualizer = (aligned, stats, requestName) => {
    console.log("Rendering XML visualizer");
    const html = generateVisualizerHTML(aligned, stats, requestName);
    pm.visualizer.set(html);
    console.log(`XML Visualizer rendered with ${aligned.length} rows`);
};


// ========================================================================
// Context Building - NOW after all utilities are defined
// ========================================================================
const buildComparisonContext = () => {
    // REGRESSION FIX: Support both normal and regression modes
    const isRegressionActive = getRegressionMode() === "true";
    return {
        boomiResponseRaw: getCollectionVar("boomi_response"),
        boomiStatus: parseInt(getCollectionVar("boomi_status") || 0),
        mulesoftResponseRaw: pm.response.text(),
        reportIndex: getCollectionVar("current_report_index"),
        requestName: isRegressionActive 
            ? getCollectionVar("temp_request_name") || pm.info.requestName
            : getCollectionVar("temp_request_name") || pm.info.requestName,
        curlCommand: isRegressionActive 
            ? getCollectionVar("temp_request_curl") || ""
            : getCollectionVar("temp_request_curl") || "",
        skipPayloadLogging: getCollectionVar("skip_payload_logging") === "true",
        exemptedFields: parseExemptedFields()
    };
};


const validateContext = (context) => 
    context.boomiResponseRaw && 
    context.boomiResponseRaw !== "" && 
    !context.boomiResponseRaw.startsWith("ERROR:");

const parseAndNormalizeXML = (context) => {
    const cleanBoomi = normalizeWhitespace(
        removeXMLDeclaration(
            removeXMLComments(context.boomiResponseRaw)
        )
    );
    
    const cleanMule = normalizeWhitespace(
        removeXMLDeclaration(
            removeXMLComments(context.mulesoftResponseRaw)
        )
    );
    
    return {
        boomiTokens: tokenizeXML(cleanBoomi),
        muleTokens: tokenizeXML(cleanMule)
    };
};

const buildXMLLines = (normalizedXML) => ({
    boomiLines: buildXMLLineStructure(normalizedXML.boomiTokens),
    muleLines: buildXMLLineStructure(normalizedXML.muleTokens)
});

const alignLines = (lines) => 
    alignLinesWithXML(lines.boomiLines, lines.muleLines);

// ========================================================================
// Main Comparison Function - DEFINED AFTER all dependencies
// ========================================================================
function executeComparison() {
    const context = buildComparisonContext();
    
    if (!validateContext(context)) {
        console.error("Boomi response invalid");
        return;
    }
    
    const normalizedXML = parseAndNormalizeXML(context);
    const lines = buildXMLLines(normalizedXML);
    const aligned = alignLines(lines);
    const stats = calculateStats(aligned, context.exemptedFields);
    
    runTests(stats, context);
    logStatistics(stats);
    storeReport(context, stats);
    
    // Only render visualizer in individual mode, NOT in regression mode
    const isRegressionActive = getRegressionMode() === "true";
    if (isIndividualExecution && !isRegressionActive) {
        renderVisualizer(aligned, stats, context.requestName);
    }

}

// ========================================================================
// Response Polling - DEFINED AFTER executeComparison
// ========================================================================
const handleTimeout = () => {
    console.error("Boomi response timeout");
    pm.test("Boomi response received", () => {
        pm.expect.fail("Timeout waiting for Boomi response");
    });
    
    if (isIndividualExecution) {
        pm.visualizer.set(
            `<div style="padding:40px;text-align:center;font-family:Arial;background:#fff3cd">
                <h2>Timeout</h2>
                <p>Boomi response not received</p>
            </div>`
        );
    }
};

const waitForBoomiResponse = () => {
    attempts++;
    const boomiResponse = getBoomiResponse();
    
    if (isValidResponse(boomiResponse)) {
        executeComparison();
    } else if (attempts >= POLL_CONFIG.maxAttempts) {
        handleTimeout();
    } else {
        setTimeout(waitForBoomiResponse, POLL_CONFIG.interval);
    }
};

// ========================================================================
// Entry Point - LAST
// ========================================================================
const regressionMode = getRegressionMode();

if (shouldSkipRequest(pm.info.requestName, regressionMode)) {
    console.log(`Skipping utility request: ${pm.info.requestName}`);
    return;
}

logRegression(regressionMode);

const isCollectionRunner = pm.info.iteration > 0;
const isIndividualExecution = !isCollectionRunner;

console.log(`Request: ${pm.info.requestName}, Individual: ${isIndividualExecution}`);

const POLL_CONFIG = {
    maxAttempts: 20,
    interval: 500
};

let attempts = 0;

waitForBoomiResponse();
