const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

let mainWindow;
let server;

// Mime types helper to serve modules correctly
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function startLocalServer() {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      // Decode URL to handle spaces or special characters
      let safeUrl = decodeURIComponent(req.url.split('?')[0]);
      let filePath = path.join(__dirname, safeUrl === '/' ? 'index.html' : safeUrl);

      // Check if file is outside of project path (security check)
      if (!filePath.startsWith(__dirname)) {
        res.writeHead(403);
        res.end('Access Denied');
        return;
      }

      fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('404 Not Found');
          return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        res.writeHead(200, { 'Content-Type': contentType });
        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
      });
    });

    // Listen on random open port (port 0 selects an open port automatically)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      console.log(`Local static server running at http://127.0.0.1:${port}`);
      resolve(port);
    });

    server.on('error', (err) => {
      reject(err);
    });
  });
}

async function createWindow() {
  try {
    const port = await startLocalServer();

    mainWindow = new BrowserWindow({
      width: 1100,
      height: 750,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      },
      title: "P.G: Physics Game",
      autoHideMenuBar: true
    });

    // Load config.json to check for Netlify URL
    let targetUrl = `http://127.0.0.1:${port}`;
    const configPath = path.join(__dirname, 'config.json');
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config.liveUrl && !config.liveUrl.includes('YOUR-NETLIFY-SUBDOMAIN')) {
          targetUrl = config.liveUrl;
          console.log(`Loading online hybrid build from: ${targetUrl}`);
        }
      } catch (e) {
        console.warn("Could not parse config.json, loading local server fallback.", e);
      }
    }

    mainWindow.loadURL(targetUrl);

    // If loading online URL fails (e.g. offline), fall back to local server
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      // Only redirect if the main frame itself failed to load, and it was trying to reach the live URL
      if (isMainFrame && validatedURL === targetUrl && mainWindow) {
        console.warn(`Failed to load online URL (${errorDescription}). Loading local fallback...`);
        mainWindow.loadURL(`http://127.0.0.1:${port}`);
      }
    });

    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  } catch (err) {
    console.error("Failed to start application:", err);
    app.quit();
  }
}

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on('will-quit', () => {
  if (server) {
    server.close();
  }
});
