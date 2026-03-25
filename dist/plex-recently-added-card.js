/**
 * Plex Recently Added Card
 * Custom Lovelace card that displays the 5 latest movies and 5 latest TV shows
 * with interleaved movie/show/movie/show cycling and cinematic transitions.
 */

class PlexRecentlyAddedCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._items = [];
    this._currentIndex = 0;
    this._cycleTimer = null;
    this._config = {};
    this._trailerCache = {};
  }

  setConfig(config) {
    if (!config.plex_url) throw new Error('Please define plex_url');
    if (!config.plex_token) throw new Error('Please define plex_token');

    this._config = {
      plex_url: config.plex_url,
      plex_token: config.plex_token,
      movies_count: config.movies_count || 5,
      shows_count: config.shows_count || 5,
      cycle_interval: config.cycle_interval || 8,
      title: config.title !== undefined ? config.title : 'Recently Added',
      ...config,
    };

    this._render();
    this._fetchData();
  }

  set hass(hass) {
    this._hass = hass;
  }

  _getImageUrl(path, width, height) {
    if (!path) return '';
    const base = this._config.plex_url.replace(/\/$/, '');
    const token = this._config.plex_token;
    return `${base}/photo/:/transcode?width=${width}&height=${height}&minSize=1&url=${encodeURIComponent(path)}&X-Plex-Token=${token}`;
  }

  _getRawImageUrl(path) {
    if (!path) return '';
    const base = this._config.plex_url.replace(/\/$/, '');
    const token = this._config.plex_token;
    return `${base}${path}?X-Plex-Token=${token}`;
  }

  async _fetchData() {
    try {
      const base = this._config.plex_url.replace(/\/$/, '');
      const token = this._config.plex_token;
      const moviesCount = this._config.movies_count;
      const showsCount = this._config.shows_count;

      // First, discover library sections to get separate movie and TV libraries
      const sectionsResp = await fetch(
        `${base}/library/sections?X-Plex-Token=${token}`,
        { headers: { Accept: 'application/json' } }
      );

      if (!sectionsResp.ok) throw new Error(`HTTP ${sectionsResp.status}`);
      const sectionsData = await sectionsResp.json();
      const sections = sectionsData.MediaContainer?.Directory || [];

      const movieSections = sections.filter(s => s.type === 'movie');
      const tvSections = sections.filter(s => s.type === 'show');

      // Fetch recent movies (request more to have a buffer)
      let movies = [];
      for (const section of movieSections) {
        const resp = await fetch(
          `${base}/library/sections/${section.key}/recentlyAdded?X-Plex-Token=${token}&limit=${moviesCount * 2}`,
          { headers: { Accept: 'application/json' } }
        );
        if (resp.ok) {
          const data = await resp.json();
          const metadata = data.MediaContainer?.Metadata || [];
          movies = movies.concat(metadata);
        }
      }

      // Sort by addedAt descending and take top N
      movies.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
      movies = movies.slice(0, moviesCount);

      // Fetch recent TV shows (seasons/episodes)
      let tvItems = [];
      for (const section of tvSections) {
        const resp = await fetch(
          `${base}/library/sections/${section.key}/recentlyAdded?X-Plex-Token=${token}&limit=${showsCount * 4}`,
          { headers: { Accept: 'application/json' } }
        );
        if (resp.ok) {
          const data = await resp.json();
          const metadata = data.MediaContainer?.Metadata || [];
          tvItems = tvItems.concat(metadata);
        }
      }

      // Sort by addedAt descending
      tvItems.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));

      // Deduplicate TV shows — only keep first (most recent) entry per show
      const seenShows = new Set();
      const uniqueTvItems = [];
      for (const item of tvItems) {
        // Use grandparentTitle (show name) for episodes, parentTitle for seasons
        const showName = item.grandparentTitle || item.parentTitle || item.title;
        if (!seenShows.has(showName)) {
          seenShows.add(showName);
          uniqueTvItems.push(item);
        }
        if (uniqueTvItems.length >= showsCount) break;
      }

      // Map movies to display items
      const movieItems = movies.map((item) => ({
        title: item.title,
        subtitle: [item.year, item.contentRating, item.Genre?.map(g => g.tag).join(', ')].filter(Boolean).join(' · '),
        type: 'movie',
        typeLabel: 'Movie',
        rating: item.rating || null,
        duration: item.duration ? Math.round(item.duration / 60000) : null,
        summary: item.summary || '',
        thumb: item.thumb || '',
        art: item.art || '',
        addedAt: item.addedAt || 0,
        ratingKey: item.ratingKey || null,
        trailerUrl: null,
      }));

      // Map TV shows to display items
      const tvDisplayItems = uniqueTvItems.map((item) => {
        const isSeason = item.type === 'season';
        const isEpisode = item.type === 'episode';
        return {
          title: isEpisode ? (item.grandparentTitle || item.title) : isSeason ? (item.parentTitle || item.title) : item.title,
          subtitle: isEpisode
            ? `S${String(item.parentIndex || '').padStart(2, '0')}E${String(item.index || '').padStart(2, '0')} · ${item.title}`
            : isSeason
              ? item.title
              : '',
          type: 'tv',
          typeLabel: 'TV Show',
          rating: item.rating || null,
          duration: item.duration ? Math.round(item.duration / 60000) : null,
          summary: item.summary || '',
          thumb: isEpisode ? (item.grandparentThumb || item.thumb || '') : (item.thumb || ''),
          art: isEpisode ? (item.grandparentArt || item.art || '') : (item.art || ''),
          addedAt: item.addedAt || 0,
        };
      });

      // Interleave: movie, show, movie, show, ...
      const interleaved = [];
      const maxLen = Math.max(movieItems.length, tvDisplayItems.length);
      for (let i = 0; i < maxLen; i++) {
        if (i < movieItems.length) interleaved.push(movieItems[i]);
        if (i < tvDisplayItems.length) interleaved.push(tvDisplayItems[i]);
      }

      this._items = interleaved;
      this._currentIndex = 0;
      this._updateDisplay();
      this._startCycle();
    } catch (err) {
      console.warn('Plex Recently Added Card: Fetch error', err);
      const errEl = this.shadowRoot.querySelector('.error-msg');
      if (errEl) {
        errEl.textContent = `Could not connect to Plex: ${err.message}`;
        errEl.style.display = 'block';
      }
    }
  }

  _startCycle() {
    if (this._cycleTimer) clearInterval(this._cycleTimer);
    if (this._items.length <= 1) return;

    this._cycleTimer = setInterval(() => {
      this._currentIndex = (this._currentIndex + 1) % this._items.length;
      this._updateDisplay();
    }, this._config.cycle_interval * 1000);
  }

  _updateDisplay() {
    if (!this._items.length) return;
    const item = this._items[this._currentIndex];
    const root = this.shadowRoot;

    // Background art
    const bgEl = root.querySelector('.bg-art');
    const bgNew = root.querySelector('.bg-art-next');
    if (bgNew && item.art) {
      bgNew.style.backgroundImage = `url(${this._getImageUrl(item.art, 800, 450)})`;
      bgNew.classList.add('active');
      setTimeout(() => {
        if (bgEl) bgEl.style.backgroundImage = bgNew.style.backgroundImage;
        bgNew.classList.remove('active');
      }, 800);
    }

    // Poster
    const posterEl = root.querySelector('.poster');
    if (posterEl && item.thumb) {
      posterEl.style.opacity = '0';
      const img = new Image();
      img.onload = () => {
        posterEl.src = img.src;
        posterEl.style.opacity = '1';
      };
      img.src = this._getImageUrl(item.thumb, 400, 600);
    }

    // Text
    const titleEl = root.querySelector('.item-title');
    const subtitleEl = root.querySelector('.item-subtitle');
    const typeEl = root.querySelector('.item-type');
    const ratingEl = root.querySelector('.item-rating');
    const summaryEl = root.querySelector('.item-summary');
    const dotsEl = root.querySelector('.dots');
    const counterEl = root.querySelector('.counter');

    if (titleEl) titleEl.textContent = item.title;
    if (subtitleEl) subtitleEl.textContent = item.subtitle;
    if (typeEl) {
      typeEl.textContent = item.typeLabel;
      typeEl.className = `item-type ${item.type}`;
    }
    if (ratingEl) {
      if (item.rating) {
        ratingEl.textContent = `★ ${item.rating}`;
        ratingEl.style.display = 'inline-block';
      } else {
        ratingEl.style.display = 'none';
      }
    }
    if (summaryEl) {
      summaryEl.textContent = item.summary;
    }

    // Dots — color-coded: gold for movies, blue for TV
    if (dotsEl) {
      dotsEl.innerHTML = this._items
        .map((it, i) => {
          const colorClass = it.type === 'movie' ? 'movie' : 'tv';
          const activeClass = i === this._currentIndex ? 'active' : '';
          return `<span class="dot ${colorClass} ${activeClass}"></span>`;
        })
        .join('');
    }

    // Counter
    if (counterEl) {
      counterEl.textContent = `${this._currentIndex + 1} / ${this._items.length}`;
    }

    // Time ago
    const timeEl = root.querySelector('.time-ago');
    if (timeEl && item.addedAt) {
      const now = Date.now() / 1000;
      const diff = now - item.addedAt;
      let timeStr;
      if (diff < 3600) timeStr = `${Math.round(diff / 60)}m ago`;
      else if (diff < 86400) timeStr = `${Math.round(diff / 3600)}h ago`;
      else timeStr = `${Math.round(diff / 86400)}d ago`;
      timeEl.textContent = timeStr;
    }

    // Trailer button — show for movies only; lazy-fetch trailer URL
    const trailerBtn = root.querySelector('.trailer-btn');
    if (trailerBtn) {
      // Hide by default while we determine availability
      trailerBtn.classList.remove('visible');
      trailerBtn.onclick = null;

      if (item.type === 'movie' && item.ratingKey) {
        if (item.trailerUrl) {
          // Already fetched and found
          trailerBtn.classList.add('visible');
          trailerBtn.onclick = (e) => {
            e.stopPropagation();
            this._playTrailer(item.trailerUrl);
          };
        } else if (item.trailerUrl === null) {
          // Not yet fetched — kick off fetch
          this._fetchTrailer(item.ratingKey).then((url) => {
            item.trailerUrl = url || undefined; // undefined = fetched, not found
            if (url && this._items[this._currentIndex] === item) {
              trailerBtn.classList.add('visible');
              trailerBtn.onclick = (e) => {
                e.stopPropagation();
                this._playTrailer(url);
              };
            }
          });
        }
        // if trailerUrl === undefined, fetch was done and nothing found — leave hidden
      }
    }
  }

  _getYouTubeId(url) {
    if (!url) return null;
    const match = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/|youtube\.com\/v\/)([-\w]{11})/);
    return match ? match[1] : null;
  }

  async _fetchTrailer(ratingKey) {
    if (!this._config.tmdb_api_key) return null;
    if (ratingKey in this._trailerCache) {
      return this._trailerCache[ratingKey];
    }
    try {
      const base = this._config.plex_url.replace(/\/$/, '');
      const token = this._config.plex_token;

      // Step 1: Get the movie metadata to find the TMDB ID
      const metaResp = await fetch(
        `${base}/library/metadata/${ratingKey}?X-Plex-Token=${token}`,
        { headers: { Accept: 'application/json' } }
      );
      if (!metaResp.ok) throw new Error(`Plex metadata HTTP ${metaResp.status}`);
      const metaData = await metaResp.json();
      const item = metaData?.MediaContainer?.Metadata?.[0];
      if (!item) throw new Error('No metadata found');

      // Extract TMDB ID from Guid array
      let tmdbId = null;
      const guids = item.Guid || [];
      for (const g of guids) {
        const id = g.id || g;
        if (typeof id === 'string' && id.startsWith('tmdb://')) {
          tmdbId = id.replace('tmdb://', '').split('?')[0];
          break;
        }
      }

      if (!tmdbId) {
        // Fallback: check old-style guid format
        const oldGuid = item.guid || '';
        const tmdbMatch = oldGuid.match(/themoviedb[:\/]+([\d]+)/);
        if (tmdbMatch) tmdbId = tmdbMatch[1];
      }

      if (!tmdbId) {
        this._trailerCache[ratingKey] = null;
        return null;
      }

      // Step 2: Fetch trailer from TMDB API
      const tmdbResp = await fetch(
        `https://api.themoviedb.org/3/movie/${tmdbId}/videos?language=en-US`,
        { headers: { Accept: 'application/json', Authorization: `Bearer ${this._config.tmdb_api_key}` } }
      );
      if (!tmdbResp.ok) throw new Error(`TMDB HTTP ${tmdbResp.status}`);
      const tmdbData = await tmdbResp.json();
      const videos = tmdbData.results || [];

      // Find official trailer (prefer official YouTube trailers)
      const trailer = videos.find(v => v.type === 'Trailer' && v.site === 'YouTube' && v.official) ||
                      videos.find(v => v.type === 'Trailer' && v.site === 'YouTube') ||
                      videos.find(v => v.site === 'YouTube');

      const youtubeUrl = trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null;
      this._trailerCache[ratingKey] = youtubeUrl;
      return youtubeUrl;
    } catch (err) {
      console.warn('Plex Recently Added Card: Trailer fetch error', err);
      this._trailerCache[ratingKey] = null;
      return null;
    }
  }

  _playTrailer(url) {
    const ytId = this._getYouTubeId(url);
    if (!ytId) return;

    // Open YouTube in a popup window sized like a video player
    const w = Math.min(960, Math.round(window.screen.width * 0.85));
    const h = Math.round(w * 9 / 16);
    const left = Math.round((window.screen.width - w) / 2);
    const top = Math.round((window.screen.height - h) / 2);
    window.open(
      `https://www.youtube.com/watch?v=${ytId}`,
      'trailer',
      `width=${w},height=${h},left=${left},top=${top},popup=yes,toolbar=no,menubar=no,location=no,status=no`
    );
  }

  _render() {
    const title = this._config.title;

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          height: 100%;
          --card-bg: #1a1a1a;
          --card-border: rgba(255,255,255,0.06);
          --text-primary: #f0f0f0;
          --text-secondary: #999;
          --text-dim: #666;
          --accent-gold: #c9a73b;
          --accent-movie: #c9a73b;
          --accent-tv: #5b9bd5;
        }

        ha-card {
          height: 100%;
          box-sizing: border-box;
          position: relative;
          background: var(--card-bg) !important;
          border-radius: 12px;
          overflow: hidden;
          border: 1px solid var(--card-border) !important;
        }

        .card {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: var(--card-bg);
          overflow: hidden;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }

        /* Background art with blur */
        .bg-art, .bg-art-next {
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background-size: cover;
          background-position: center;
          filter: blur(20px) brightness(0.3);
          transform: scale(1.1);
          transition: opacity 0.8s ease;
        }
        .bg-art-next {
          opacity: 0;
        }
        .bg-art-next.active {
          opacity: 1;
        }

        /* Dark overlay */
        .bg-overlay {
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background: linear-gradient(
            135deg,
            rgba(0,0,0,0.7) 0%,
            rgba(0,0,0,0.4) 50%,
            rgba(0,0,0,0.7) 100%
          );
        }

        /* Content */
        .content {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 1;
          padding: 20px;
          display: flex;
          flex-direction: column;
        }

        /* Header */
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 14px;
        }

        .header-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 15px;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-secondary);
        }

        .plex-logo {
          width: 20px;
          height: 20px;
          flex-shrink: 0;
          display: inline-block;
          vertical-align: middle;
        }

        .counter {
          font-size: 13px;
          color: var(--text-dim);
          font-variant-numeric: tabular-nums;
        }

        /* Main area */
        .main {
          display: flex;
          gap: 20px;
          flex: 1;
          min-height: 0;
        }

        /* Poster */
        .poster-wrap {
          flex-shrink: 0;
          width: auto;
          aspect-ratio: 2/3;
          height: 100%;
          border-radius: 6px;
          overflow: hidden;
          box-shadow: 0 4px 20px rgba(0,0,0,0.5);
          background: #111;
          position: relative;
        }

        .poster {
          width: 100%;
          height: 100%;
          object-fit: cover;
          transition: opacity 0.5s ease;
        }

        .poster-shimmer {
          position: absolute;
          inset: 0;
          background: linear-gradient(
            90deg,
            transparent 0%,
            rgba(255,255,255,0.03) 50%,
            transparent 100%
          );
          animation: shimmer 2s infinite;
        }

        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }

        /* Info */
        .info {
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: center;
          min-width: 0;
          gap: 8px;
        }

        .item-type {
          display: inline-block;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          padding: 5px 12px;
          border-radius: 3px;
          width: fit-content;
        }

        .item-type.movie {
          background: rgba(201, 167, 59, 0.15);
          color: var(--accent-movie);
        }

        .item-type.tv {
          background: rgba(91, 155, 213, 0.15);
          color: var(--accent-tv);
        }

        .item-title {
          font-size: 28px;
          font-weight: 700;
          color: var(--text-primary);
          line-height: 1.2;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }

        .item-subtitle {
          font-size: 17px;
          color: var(--text-secondary);
          line-height: 1.3;
        }

        .meta-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .item-rating {
          font-size: 16px;
          font-weight: 600;
          color: var(--accent-gold);
        }

        .time-ago {
          font-size: 15px;
          color: var(--text-dim);
        }

        .item-summary {
          font-size: 16px;
          color: var(--text-dim);
          line-height: 1.5;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 6;
          -webkit-box-orient: vertical;
          margin-top: 2px;
        }

        /* Dots — color-coded */
        .dots {
          display: flex;
          justify-content: center;
          gap: 6px;
          padding-top: 16px;
          flex-shrink: 0;
        }

        .dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: rgba(255,255,255,0.15);
          transition: all 0.3s ease;
        }

        .dot.movie {
          background: rgba(201, 167, 59, 0.25);
        }

        .dot.tv {
          background: rgba(91, 155, 213, 0.25);
        }

        .dot.active.movie {
          background: var(--accent-movie);
          box-shadow: 0 0 6px rgba(201, 167, 59, 0.4);
          width: 18px;
          border-radius: 3px;
        }

        .dot.active.tv {
          background: var(--accent-tv);
          box-shadow: 0 0 6px rgba(91, 155, 213, 0.4);
          width: 18px;
          border-radius: 3px;
        }

        /* Trailer button */
        .trailer-btn {
          display: none;
          align-items: center;
          gap: 6px;
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.2);
          color: #ddd;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          padding: 6px 14px;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .trailer-btn:hover {
          background: rgba(255, 255, 255, 0.2);
          color: #fff;
        }

        .trailer-btn.visible {
          display: inline-flex;
        }

        .trailer-btn svg {
          width: 14px;
          height: 14px;
          fill: currentColor;
        }

        /* Trailer embed overlay */
        .trailer-container {
          display: none;
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 10;
          background: #000;
          align-items: center;
          justify-content: center;
        }

        .trailer-container.active {
          display: flex;
        }

        .trailer-container iframe {
          width: 100%;
          height: 100%;
          border: none;
        }

        .trailer-close {
          position: absolute;
          top: 8px;
          right: 8px;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: rgba(0, 0, 0, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.3);
          color: #fff;
          font-size: 18px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 11;
          transition: background 0.2s;
        }

        .trailer-close:hover {
          background: rgba(255, 255, 255, 0.2);
        }

        /* Error */
        .error-msg {
          display: none;
          text-align: center;
          padding: 20px;
          color: #cc4444;
          font-size: 12px;
        }

        /* Loading */
        .loading {
          text-align: center;
          padding: 40px 20px;
          color: var(--text-dim);
          font-size: 12px;
        }
      </style>

      <ha-card>
        <div class="card">
          <div class="bg-art"></div>
          <div class="bg-art-next"></div>
          <div class="bg-overlay"></div>

          <div class="content">
            ${title ? `
            <div class="header">
              <span class="header-title">
                <img class="plex-logo" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='148 70 216 372'%3E%3Cpath fill='%23e5a00d' d='M256 70H148l108 186-108 186h108l108-186z'/%3E%3C/svg%3E" alt="Plex">
                ${title}
              </span>
              <span class="counter"></span>
            </div>
            ` : ''}

            <div class="error-msg"></div>

            <div class="main">
              <div class="poster-wrap">
                <img class="poster" src="" alt="">
                <div class="poster-shimmer"></div>
              </div>
              <div class="info">
                <span class="item-type"></span>
                <div class="item-title">Loading...</div>
                <div class="item-subtitle"></div>
                <div class="meta-row">
                  <span class="item-rating"></span>
                  <span class="time-ago"></span>
                </div>
                <div class="item-summary"></div>
                <button class="trailer-btn" id="trailerBtn">
                  <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                  Trailer
                </button>
              </div>
            </div>

            <div class="trailer-container" id="trailerContainer">
              <button class="trailer-close" id="trailerClose">&#x2715;</button>
              <iframe id="trailerFrame" allow="autoplay; encrypted-media" allowfullscreen></iframe>
            </div>

            <div class="dots"></div>
          </div>
        </div>
      </ha-card>
    `;
  }

  getCardSize() {
    return 4;
  }

  static getStubConfig() {
    return {
      plex_url: 'http://192.168.1.100:32400',
      plex_token: 'YOUR_PLEX_TOKEN',
      movies_count: 5,
      shows_count: 5,
      cycle_interval: 8,
      title: 'Recently Added',
    };
  }

  disconnectedCallback() {
    if (this._cycleTimer) {
      clearInterval(this._cycleTimer);
      this._cycleTimer = null;
    }
  }
}

customElements.define('plex-recently-added-card', PlexRecentlyAddedCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'plex-recently-added-card',
  name: 'Plex Recently Added',
  description: 'Auto-cycling display of recently added Plex media — 5 movies and 5 TV shows, interleaved.',
});
