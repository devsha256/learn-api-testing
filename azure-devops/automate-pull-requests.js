/**
 * Repository Extractor & Pattern Matcher
 * Logic: Filters repo list and generates CSV-ready data
 */

// 1. Filtering Configuration
const SEARCH_PREFIX = pm.collectionVariables.get("repoPrefix") || "service-";
const FROM_BRANCH = "develop"; // Default source
const TO_BRANCH = "main";      // Default target

const response = pm.response.json();
const allRepos = response.value || [];

// 2. Apply Pattern Matching
const filteredRepos = allRepos
    .filter(repo => repo.name.startsWith(SEARCH_PREFIX))
    .map(repo => ({
        repository: repo.name,
        fromBranch: FROM_BRANCH,
        toBranch: TO_BRANCH
    }));

// 3. Visualizer Template (Material 3 Table)
const template = `
<!DOCTYPE html>
<html>
<head>
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500&display=swap" rel="stylesheet">
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
    <style>
        :root {
            --primary: #6750A4;
            --surface: #FEF7FF;
            --outline: #79747E;
        }
        body { 
            font-family: 'Roboto', sans-serif; 
            background-color: var(--surface); 
            padding: 24px; margin: 0; 
        }
        .header-actions {
            display: flex; justify-content: space-between; align-items: center;
            margin-bottom: 16px;
        }
        table {
            width: 100%; border-collapse: collapse;
            background: white; border-radius: 8px; overflow: hidden;
            box-shadow: 0 1px 2px rgba(0,0,0,0.1);
        }
        th { 
            background: #F3EDF7; text-align: left; padding: 12px 16px;
            font-weight: 500; color: #1D1B20; border-bottom: 1px solid var(--outline);
        }
        td { padding: 12px 16px; border-bottom: 1px solid #E7E0EC; font-size: 14px; }
        
        .m3-btn {
            background: var(--primary); color: white; border: none;
            padding: 10px 24px; border-radius: 20px; font-weight: 500;
            display: flex; align-items: center; cursor: pointer; gap: 8px;
        }
        .m3-btn:hover { opacity: 0.9; }
        #clipboard-shim { position: absolute; left: -9999px; }
    </style>
</head>
<body>
    <div class="header-actions">
        <div>
            <h2 style="margin:0">Discovery Results</h2>
            <p style="margin:4px 0; color: #49454F;">Pattern: "<strong>${SEARCH_PREFIX}*</strong>"</p>
        </div>
        <button id="copyCsvBtn" class="m3-btn">
            <i class="material-icons">content_copy</i>
            Copy CSV Data
        </button>
    </div>

    <table>
        <thead>
            <tr>
                <th>Repository Name</th>
                <th>Source Branch</th>
                <th>Target Branch</th>
            </tr>
        </thead>
        <tbody>
            ${filteredRepos.map(r => `
                <tr>
                    <td>${r.repository}</td>
                    <td>${r.fromBranch}</td>
                    <td>${r.toBranch}</td>
                </tr>
            `).join('')}
        </tbody>
    </table>

    <textarea id="clipboard-shim"></textarea>

    <script>
        const data = ${JSON.stringify(filteredRepos)};
        
        document.getElementById('copyCsvBtn').addEventListener('click', () => {
            // Generate CSV content with headers
            const header = "repository,fromBranch,toBranch";
            const rows = data.map(r => \`\${r.repository},\${r.fromBranch},\${r.toBranch}\`);
            const csvContent = [header, ...rows].join('\\n');
            
            const shim = document.getElementById('clipboard-shim');
            shim.value = csvContent;
            shim.select();
            document.execCommand('copy');
            
            const btn = document.getElementById('copyCsvBtn');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="material-icons">done</i> Copied to Clipboard';
            setTimeout(() => btn.innerHTML = originalText, 2000);
        });
    </script>
</body>
</html>
`;

pm.visualizer.set(template);

// Optional: Store the result for the next request in the collection
pm.collectionVariables.set("extractedRepos", JSON.stringify(filteredRepos));
