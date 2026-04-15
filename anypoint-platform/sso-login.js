// --- 1. DETECT SESSION STATUS ---
if (pm.response.code === 401 || pm.response.code === 403) {
    // Session is dead. Show the "Bridge" UI.
    // TIP: If your company uses a vanity URL, use: 
    // https://anypoint.mulesoft.com/accounts/login/{org-domain}
    const ssoUrl = "https://anypoint.mulesoft.com/accounts/login";

    const template = `
    <div style="text-align:center; padding:40px; font-family: 'Roboto', sans-serif; background: #FEF7FF; height:100vh;">
        <span class="material-icons" style="font-size:64px; color:#6750A4;">security</span>
        <h2 style="color:#1C1B1F; margin:16px 0;">SSO Authentication</h2>
        <p style="color:#49454F; font-size:14px;">Your local session is missing or expired.</p>
        
        <a href="${ssoUrl}" target="_blank" 
           style="background:#6750A4; color:white; padding:12px 24px; border-radius:12px; text-decoration:none; font-weight:500; display:inline-block; margin:20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
           LOG IN VIA BROWSER
        </a>
        
        <div style="background:#F3EDF7; padding:16px; border-radius:12px; font-size:12px; color:#49454F; text-align:left; max-width:300px; margin:0 auto;">
            <strong>Steps:</strong><br>
            1. Click the button to open Chrome.<br>
            2. Complete your SSO login.<br>
            3. <b>Come back here and click SEND.</b>
        </div>
    </div>
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
    `;
    pm.visualizer.set(template);
} else {
    // --- 2. SESSION IS ALIVE - EXCHANGE COOKIE FOR BEARER ---
    // We send a POST to /login with NO body. 
    // Anypoint sees the active cookie and returns the JSON with the access_token.
    pm.sendRequest({
        url: 'https://anypoint.mulesoft.com/accounts/login',
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        body: { mode: 'raw', raw: JSON.stringify({}) }
    }, (err, res) => {
        if (!err && res.code === 200) {
            const token = res.json().access_token;
            
            // Save to LOCAL Scratchpad collection variables
            pm.collectionVariables.set("token", token);
            
            pm.visualizer.set(\`
                <div style="text-align:center; padding:40px; font-family: 'Roboto', sans-serif;">
                    <span class="material-icons" style="font-size:64px; color:#2E7D32;">check_circle</span>
                    <h2 style="color:#1C1B1F;">Success!</h2>
                    <p>Token captured and saved locally.</p>
                    <div style="background:#eee; padding:8px; border-radius:8px; font-family:monospace; font-size:11px;">
                        Bearer \${token.substring(0,15)}...
                    </div>
                </div>
                <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
            \`);
        } else {
            pm.visualizer.set("<h3>Cookie found, but exchange failed. Ensure 'mulesoft.com' is allowed in Cookie Settings.</h3>");
        }
    });
}
