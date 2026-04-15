// --- 1. DETECT SESSION STATUS ---
if (pm.response.code === 401 || pm.response.code === 403) {
    
    // Replace with your vanity domain if needed
    const ssoUrl = "https://anypoint.mulesoft.com/accounts/login";

    const template = `
    <div style="text-align:center; padding:40px; font-family: 'Roboto', sans-serif; background: #FEF7FF; height:100vh;">
        <span class="material-icons" style="font-size:64px; color:#6750A4;">security</span>
        <h2 style="color:#1C1B1F; margin:16px 0;">SSO Authentication</h2>
        <p style="color:#49454F; font-size:14px;">Your local session is missing or expired.</p>
        
        <button onclick="openSSO()" 
           style="background:#6750A4; color:white; padding:12px 24px; border-radius:12px; border:none; font-weight:500; display:inline-block; margin:20px 0; cursor:pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
           LOG IN VIA BROWSER
        </button>
        
        <div style="background:#F3EDF7; padding:16px; border-radius:12px; font-size:12px; color:#49454F; text-align:left; max-width:320px; margin:0 auto;">
            <strong>If the button fails:</strong><br>
            1. Ensure the <b>Postman Desktop Agent</b> is running.<br>
            2. Manually open <b>anypoint.mulesoft.com</b> in Chrome.<br>
            3. Log in, then come back and click <b>SEND</b> in Postman.
        </div>
    </div>
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
    
    <script>
        function openSSO() {
            // Force a new window/tab via JavaScript
            const win = window.open("${ssoUrl}", "_blank", "noopener,noreferrer");
            if (!win) {
                alert("Popup blocked! Please allow popups for Postman or open the URL manually in Chrome.");
            }
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
                    <h2 style="color:#1C1B1F;">Success!</h2>
                    <p>Token captured and saved to 'token' variable.</p>
                    <div style="background:#eee; padding:8px; border-radius:8px; font-family:monospace; font-size:11px; word-break:break-all;">
                        Bearer \${token.substring(0,20)}...
                    </div>
                    <p style="font-size:12px; margin-top:20px; color:#666;">You can now run the Deployment Auditor.</p>
                </div>
                <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
            \`);
        } else {
            console.error("Cookie Exchange Failed", res.json());
            pm.visualizer.set("<h3>Cookie found, but exchange failed. Ensure 'mulesoft.com' is allowed in Cookie Settings.</h3>");
        }
    });
}
