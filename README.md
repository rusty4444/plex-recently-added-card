# Plex Recently Added Card

A custom Home Assistant Lovelace card that shows your recently added movies and TV shows from Plex. Auto-cycles through items with poster art, blurred background, synopsis, ratings, and color-coded indicators.

[![HACS](https://img.shields.io/badge/HACS-Custom-blue)](https://github.com/hacs/integration)
![Platform](https://img.shields.io/badge/Platform-Home_Assistant-blue)

<p align="center">
  <img src="screenshots/recently-added.jpg" alt="Plex Recently Added Card" width="600">
</p>

## Features

- Displays the 5 most recently added movies and 5 most recently added TV shows
- Interleaved cycling — alternates between movies and TV shows
- Poster art with blurred background transitions
- Synopsis, ratings, genre, and "time ago" for each item
- Color-coded dots — gold for movies, blue for TV shows
- Connects directly to your Plex server (no additional integrations required)
- Deduplicates TV shows — only shows the most recent entry per series

---

## Install via HACS (Recommended)

1. Open **HACS** in Home Assistant
2. Click the three dots (top right) → **Custom repositories**
3. Enter `https://github.com/rusty4444/plex-recently-added-card` and select **Dashboard** as the category
4. Click **Add**
5. Search for "Plex Recently Added Card" in HACS and click **Install**
6. Restart Home Assistant

The Lovelace resource will be registered automatically.

## Install Manually

1. Download `plex-recently-added-card.js` from the [latest release](https://github.com/rusty4444/plex-recently-added-card/releases/latest)
2. Place it in your `<config>/www/` directory
3. Go to **Settings → Dashboards** → three dots (top right) → **Resources**
4. Click **Add Resource**
5. URL: `/local/plex-recently-added-card.js`
6. Type: **JavaScript Module**

---

## Configuration

Add a **Manual card** to your dashboard with this YAML:

```yaml
type: custom:plex-recently-added-card
plex_url: http://YOUR_PLEX_IP:32400
plex_token: YOUR_PLEX_TOKEN
movies_count: 5
shows_count: 5
cycle_interval: 8
title: Recently Added
```

For best results, set the card to span the full width of a section and give it plenty of vertical space (e.g., 8+ grid rows).

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `plex_url` | string | **Required** | Your Plex server URL (e.g., `http://192.168.1.100:32400`) |
| `plex_token` | string | **Required** | Your Plex authentication token |
| `movies_count` | number | `5` | Number of recently added movies to display |
| `shows_count` | number | `5` | Number of recently added TV shows to display |
| `cycle_interval` | number | `8` | Seconds between cycling to the next item |
| `title` | string | `"Recently Added"` | Header text (set to empty string to hide) |

### Finding your Plex token

1. Sign in to the Plex Web App
2. Browse to any media item
3. Click **Get Info** → **View XML**
4. The token is in the URL as `X-Plex-Token=XXXXX`

---

## How It Works

- Connects directly to your Plex server's API (no HA Plex integration needed for this card)
- Discovers all movie and TV libraries automatically
- Fetches recently added items from each library
- Deduplicates TV shows so you only see one entry per series (the most recent)
- Interleaves movies and shows for variety (movie, show, movie, show...)
- Pre-loads poster and background art for smooth transitions

---

## Troubleshooting

- **Card not appearing after install**: Clear your browser cache, or append `?v=2` to the resource URL in Settings → Dashboards → Resources
- **No items showing**: Double-check your `plex_url` and `plex_token` — the card connects directly to Plex, not through HA. Make sure the Plex URL is reachable from the device viewing the dashboard.
- **CORS errors in browser console**: If your Plex server is on a different host, you may need to allow CORS in Plex settings or access the dashboard via the same network.

---

## Related

Looking for a cinema-style "Now Showing" display for when Plex is actively playing? Check out [plex-now-showing](https://github.com/rusty4444/plex-now-showing).

---

## Credits

Built by Sam Russell — AI used in development.
