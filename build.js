#!/usr/bin/env node

const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

try {
  // Get short commit hash
  const commitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();

  // Get commit timestamp in ISO format
  const commitTimestamp = execSync('git log -1 --format=%aI', { encoding: 'utf-8' }).trim();

  // Format timestamp nicely
  const date = new Date(commitTimestamp);
  const formattedTimestamp = date.toUTCString();

  // Build the new constants
  const buildNumber = commitHash;
  const buildTimestampString = formattedTimestamp;

  // Read app.js
  const appJsPath = path.join(__dirname, 'app.js');
  let content = fs.readFileSync(appJsPath, 'utf-8');

  // Replace BUILD_NUMBER and BUILD_TIMESTAMP constants
  content = content.replace(
    /const BUILD_NUMBER = "[^"]*";/,
    `const BUILD_NUMBER = "${buildNumber}";`
  );

  content = content.replace(
    /const BUILD_TIMESTAMP = "[^"]*";/,
    `const BUILD_TIMESTAMP = "${buildTimestampString}";`
  );

  // Write back
  fs.writeFileSync(appJsPath, content, 'utf-8');

  console.log(`✓ Build metadata updated:`);
  console.log(`  Build Number: ${buildNumber}`);
  console.log(`  Timestamp: ${buildTimestampString}`);
} catch (error) {
  console.error('✗ Failed to update build metadata:', error.message);
  process.exit(1);
}
