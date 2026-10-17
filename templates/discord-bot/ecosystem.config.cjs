// pm2 settings. Start with:  pm2 start ecosystem.config.cjs
// Running several customers' bots on one server? Give each copy its own folder and a unique name below.
module.exports = {
  apps: [
    {
      name: "discord-bot",
      cwd: __dirname,
      script: "src/index.js",
      node_args: "--disable-warning=ExperimentalWarning",
      autorestart: true,
      restart_delay: 5000, // wait 5 seconds before restarting after a crash
      max_memory_restart: "300M",
      env: { NODE_ENV: "production" },
    },
  ],
};
