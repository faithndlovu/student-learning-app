/** Fails fast with a clear message when Node is too old for the built-in SQLite driver. */
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`LearnHub needs Node.js 22.13 or newer (you are running ${process.version}).`);
  console.error('Install a newer Node.js from https://nodejs.org, or with nvm run: nvm install 22 && nvm use 22');
  process.exit(1);
}
