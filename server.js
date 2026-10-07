// Cambuz PDF Reader — Development Server
// Serves the PDF reader as a web application for preview/testing

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve root as static for node_modules, assets, src
app.use(express.static(__dirname));

// Root redirects to the viewer
app.get('/', (req, res) => {
  res.redirect('/src/index.html');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Cambuz PDF Reader running at http://localhost:${PORT}`);
  console.log('Open a PDF using the file picker or drag-and-drop.');
});