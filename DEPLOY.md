# Deploying the admin console

Pushing to `prod` runs `.github/workflows/deploy.yml`: GitHub Actions builds the console with the
settings in `.env.production`, uploads it to `/opt/routeguard/admin/releases/<commit>` on the VPS
and switches `/opt/routeguard/admin/current` to it. Apache serves `current` at
**https://admin.routeguard.finances.tools**.

See the step-by-step setup in the conversation / below:

1. DNS: `A admin.routeguard.finances.tools → <VPS IP>`.
2. VPS: `sudo mkdir -p /opt/routeguard/admin/releases`
3. Apache: copy `deploy/admin.routeguard.finances.tools.conf` to `/etc/apache2/sites-available/`,
   `sudo a2enmod headers rewrite expires && sudo a2ensite admin.routeguard.finances.tools`,
   `sudo apache2ctl configtest && sudo systemctl reload apache2`,
   then `sudo certbot --apache -d admin.routeguard.finances.tools`.
4. Backend `.env`: add `https://admin.routeguard.finances.tools` to `CORS_ALLOWED_ORIGINS`, recreate the backend.
5. GitHub repo secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_SSH_PASSPHRASE` (same values as the backend repo).
6. Push to `prod` (or run the workflow manually from the Actions tab).

Roll back: `cd /opt/routeguard/admin && ls -1t releases` then
`ln -sfn releases/<older-commit> current.tmp && mv -Tf current.tmp current`.
