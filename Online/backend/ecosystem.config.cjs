// PM2 process definition for the production backend.
// .cjs extension is required because package.json sets "type": "module" —
// PM2 loads this file with require(), which fails on a plain ESM .js file.
//
// Usage on the production server (from backend/):
//   pm2 start ecosystem.config.cjs
//   pm2 save
//
// Expects backend/.env (production values — see .env.production.example)
// to already exist in this directory; src/index.js loads it via dotenv.
module.exports = {
  apps: [
    {
      name: 'd2d-backend',
      cwd: __dirname,
      script: 'src/index.js',
      env: {
        NODE_ENV: 'production',
      },
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      out_file: 'logs/out.log',
      error_file: 'logs/error.log',
      time: true,
    },
  ],
}
