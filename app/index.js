const express = require('express');
const app = express();
const PORT = 8000;

// First endpoint: /users/:userId - fetches from GitHub API
app.get('/users/:userId', async (req, res) => {
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

// Second endpoint: /app/users/:userId - fetches from GitHub API
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

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
