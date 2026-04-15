// --- 1. DETECT SESSION STATUS ---
if (pm.response.code === 401 || pm.response.code === 403) {
    
    // Replace with vanity domain if needed
    const ssoUrl = "https://anypoint.mulesoft.com/accounts/login";

    const template = `
    <div style="text-align:center; padding:40px; font-family: 'Roboto', sans-serif; background: #FEF7FF; height:100vh;">
        <span class="material-icons" style="font-size:64px; color:#6750A4;">security</span>
        <h2 style="color:#1C1B1F; margin:16px 0;">SSO Authentication</h2>
        <p style="color:#49454F; font-size:14px;">Postman Sandbox blocks automatic redirects.</p>
        
        <div style="background:white; border:1px solid #CAC4D0; border-radius:12px; padding:20px; margin-top:10px;">
            <p style="font-size:12px; color:#666; margin-bottom:12px;">Click to copy the login URL, then paste in Chrome:</p>
            <button id="copyBtn" onclick="copyToClipboard()" 
               style="background:#6750A4; color:white; padding:12px 24px; border-radius:12px; border:none; font-weight:500; width:100%; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px;">
               <span class="material-icons" style="font-size:18px;">content_copy</span>
               COPY LOGIN URL
            </button>
            <p id="feedback" style="font-size:11px; color:#2E7D32; font-weight:bold; margin-top:8px; visibility:hidden;">COPIED TO CLIPBOARD!</p>
        </div>
        
        <div style="margin-top:20px; font-size:12px; color:#49454F;">
            1. Paste in <b>Chrome</b> & Log in.<br>
            2. Return to Postman and click <b>SEND</b>.
        </div>
    </div>
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
    
    <script>
        function copyToClipboard() {
            const url = "${ssoUrl}";
            // The modern way to copy in a sandbox
            navigator.clipboard.writeText(url).then(() => {
                const btn = document.getElementById('copyBtn');
                const feedback = document.getElementById('feedback');
                
                feedback.style.visibility = 'visible';
                btn.style.background = '#2E7D32';
                btn.innerHTML = '<span class="material-icons" style="font-size:18px;">check</span> COPIED';
                
                setTimeout(() => {
                    feedback.style.visibility = 'hidden';
                    btn.style.background = '#6750A4';
                    btn.innerHTML = '<span class="material-icons" style="font-size:18px;">content_copy</span> COPY LOGIN URL';
                }, 3000);
            });
        }
    </script>
    `;
    pm.visualizer.set(template);

} else {
    // --- 2. SESSION IS ALIVE - EXCHANGE COOKIE FOR BEARER ---
    pm.sendRequest({
        url: 'https://anypoint.mulesoft.com/accounts/login',
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        body: { mode: 'raw', raw: JSON.stringify({}) }
    }, (err, res) => {
        if (!err && res.code === 200) {
            const token = res.json().access_token;
            pm.collectionVariables.set("token", token);
            
            pm.visualizer.set(\`
                <div style="text-align:center; padding:40px; font-family: 'Roboto', sans-serif;">
                    <span class="material-icons" style="font-size:64px; color:#2E7D32;">check_circle</span>
                    <h2 style="color:#1C1B1F;">Bridge Connected</h2>
                    <p>Token successfully captured into collection variables.</p>
                    <div style="background:#eee; padding:10px; border-radius:8px; font-family:monospace; font-size:11px;">
                        Bearer \${token.substring(0,20)}...
                    </div>
                </div>
                <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
            \`);
        } else {
            pm.visualizer.set("<h3>Ensure 'mulesoft.com' is allowed in Cookie Settings.</h3>");
        }
    });
}
