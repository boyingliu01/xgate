const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

/**
 * Recursively copy a directory.
 * @param {string} src - Source directory
 * @param {string} dest - Destination directory
 */
function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Download a file from URL to local path, following redirects.
 * @param {string} url - URL to download
 * @param {string} dest - Destination file path
 * @param {object} [options]
 * @param {boolean} [options.verbose=false] - Log progress to console
 * @returns {Promise<void>}
 */
async function downloadFile(url, dest, options = {}) {
  const { verbose = false } = options;
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);

    const protocol = url.startsWith('https') ? https : http;

    if (verbose) console.log(`Downloading ${url}...`);

    protocol.get(url, { timeout: 30000 }, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        file.close();
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        downloadFile(redirectUrl, dest, options).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        file.close();
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      file.close();
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      reject(err);
    });
  });
}

module.exports = { copyDirRecursive, downloadFile };
