const express = require('express');
const app = express();
const PORT = 8000;

// Middleware to parse JSON bodies in POST requests
app.use(express.json());

// --- EXISTING ENDPOINTS ---

// GET /users/:userId - fetches from GitHub API
app.get('/users/:userId', async (req, res) => {
  const userId = req.params.userId;
  
  try {
    // Note: 'fetch' is usually available in modern Node.js environments
    const response = await fetch(`https://api.github.com/users/${userId}`, {
      headers: {
        'User-Agent': 'Express-App'
      }
    });
    
    if (!response.ok) {
      return res.status(response.status).json({ 
        error: 'User not found or API error' 
      });
    }
    
    const userData = await response.json();
    res.json(userData);
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to fetch user data',
      message: error.message 
    });
  }
});

// GET /app/users/:userId - fetches from GitHub API
app.get('/app/users/:userId', async (req, res) => {
  const userId = req.params.userId;
  
  try {
    const response = await fetch(`https://api.github.com/users/${userId}`, {
      headers: {
        'User-Agent': 'Express-App'
      }
    });
    
    if (!response.ok) {
      return res.status(response.status).json({ 
        error: 'User not found or API error' 
      });
    }
    
    const userData = await response.json();
    res.json(userData);
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to fetch user data',
      message: error.message 
    });
  }
});

// --- NEW ENDPOINTS ADDED BELOW ---

// POST /app/user - Creates a new user resource
app.post('/app/user', (req, res) => {
    const correlationId = req.header('x-correlation-id');
    const userPayload = req.body; // JSON body is available here

    console.log(`[POST /app/user] Correlation ID: ${correlationId}`);
    console.log(`[POST /app/user] Received Payload:`, userPayload);

    // Dummy logic: Assume the user creation was successful
    if (!userPayload || !userPayload.username) {
        return res.status(400).json({
            status: 'Failed',
            message: 'Invalid request: username is required in the body.'
        });
    }
    
    res.status(201).json({
        status: 'Success',
        message: `User '${userPayload.username}' created successfully via /app/user. Correlation ID: ${correlationId}`
    });
});

// POST /user - Creates a new user resource
app.post('/user', (req, res) => {
    const correlationId = req.header('x-correlation-id');
    const userPayload = req.body;

    console.log(`[POST /user] Correlation ID: ${correlationId}`);
    console.log(`[POST /user] Received Payload:`, userPayload);

    // Dummy logic: Simulate a successful response
    if (!userPayload || !userPayload.email) {
        return res.status(400).json({
            status: 'Failed',
            message: 'Invalid request: email is required in the body.'
        });
    }

    res.status(201).json({
        status: 'Success',
        message: `User '${userPayload.username}' created successfully via /app/user. Correlation ID: ${correlationId}`
    });
});


// Start the server
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});