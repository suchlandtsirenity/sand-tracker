# Sand Tracker

Remembers revealed colours in blind sand-sort levels, per level, across restarts.
See `docs/spec.md`.

## Run locally

    npm test
    npm start            # http://localhost:8787

Needs Node ≥ 22.5. No npm dependencies.

## Deploy (Debian/Ubuntu + nginx)

    sudo useradd --system --no-create-home sandtracker
    sudo rsync -a --exclude data --exclude .git --exclude .superpowers ./ /opt/sand-tracker/
    sudo cp deploy/sand-tracker.service /etc/systemd/system/
    sudo systemctl daemon-reload && sudo systemctl enable --now sand-tracker
    curl -s localhost:8787/api/palettes          # sanity check

    sudo htpasswd -c /etc/nginx/sand-tracker.htpasswd <user>   # apache2-utils
    sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/sand-tracker
    # edit server_name, then:
    sudo ln -s /etc/nginx/sites-available/sand-tracker /etc/nginx/sites-enabled/
    sudo nginx -t && sudo systemctl reload nginx
    sudo certbot --nginx -d sand.<your-domain>

Data lives in `/var/lib/sand-tracker/sand.db`. Back it up by copying that file.

## Update

    sudo rsync -a --exclude data --exclude .git --exclude .superpowers ./ /opt/sand-tracker/
    sudo systemctl restart sand-tracker
