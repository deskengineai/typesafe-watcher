module.exports = {
  apps: [{
    name: 'typesafe-watcher',
    script: 'watcher.js',
    cwd: __dirname,
    autorestart: true,
  }],
};
