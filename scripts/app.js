(function () {
  const els = {
    step1: document.getElementById('step1'),
    step2: document.getElementById('step2'),
    embyInput: document.getElementById('embyLinkInput'),
    step1Status: document.getElementById('step1Status'),
    serverInfo: document.getElementById('serverInfo'),
    toStep2: document.getElementById('toStep2'),
    resetAll: document.getElementById('resetAll'),

    step2Status: document.getElementById('step2Status'),
    cfResults: document.getElementById('cfResults'),
    ispCard: document.getElementById('ispCard'),
    cfRow: document.getElementById('cfRow'),
    asnWarning: document.getElementById('asnWarning'),
    backTo1: document.getElementById('backTo1'),
    pingEval: document.getElementById('pingEval'),
  };

  let state = {
    embyBase: '',
    embyHost: '',
    embyInfo: null,
    cfColo: '',
    cfComponentName: '',
    mapInstance: null,
    distanceMeters: null,
    remoteLabel: '',
    clientAsn: null,
    clientAsOrg: '',
    pingSamplesMs: [],
    pingMedianMs: null,
  };

  // Helpers
  function $(selector, root = document) {
    return root.querySelector(selector);
  }

  function show(el) {
    el.classList.remove('hidden');
    el.removeAttribute('aria-hidden');
  }

  function hide(el) {
    el.classList.add('hidden');
    el.setAttribute('aria-hidden', 'true');
  }

  function setStatus(el, type, text) {
    const hasText = Boolean(text && String(text).trim());
    el.className = `status${type ? ' ' + type : ''}`;
    el.textContent = hasText ? text : '';
    if (hasText) {
      show(el);
    } else {
      hide(el);
    }
  }

  function sanitizeBaseUrl(input) {
    if (!input) return '';
    let url = input.trim();
    // If missing scheme, assume https
    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
    }
    // Remove trailing spaces and slashes (but keep embedded /emby if present)
    url = url.replace(/\s+/g, '');
    // Remove trailing slash
    url = url.replace(/\/$/, '');
    return url;
  }

  function tryGetHost(u) {
    try {
      return new URL(u).host;
    } catch (_) {
      return '';
    }
  }

  function scrollIntoView(section) {
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function fetchJson(url, opts = {}) {
    const res = await fetch(url, {
      method: 'GET',
      // Important: no-cors would hide status; we want explicit CORS errors if any
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      ...opts,
      headers: {
        'Accept': 'application/json, text/plain, */*',
        ...opts.headers,
      },
    });
    return res;
  }

  async function fetchText(url, opts = {}) {
    const res = await fetch(url, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      ...opts,
      headers: {
        'Accept': 'text/plain, */*',
        ...opts.headers,
      },
    });
    return res;
  }

  function renderServerInfo(info) {
    els.serverInfo.innerHTML = `
      <div class="info-row"><span class="k">Name</span><span class="v">${escapeHtml(info.ServerName)}</span></div>
      <div class="info-row"><span class="k">Version</span><span class="v">${escapeHtml(info.Version)}</span></div>
    `;
    show(els.serverInfo);
  }

  function renderCfResults({ componentName }) {
    const compText = componentName || 'Nicht gefunden';
    const distRow = (state.distanceMeters != null)
      ? `<div class="info-row"><span class="k">Distanz</span><span class="v">${formatDistance(state.distanceMeters)}</span></div>`
      : '';
    els.cfResults.innerHTML = `
      <div class="info-row"><span class="k">Server</span><span class="v">${escapeHtml(compText)}</span></div>
      ${distRow}
    `;
    show(els.cfResults);
    if (els.cfRow) show(els.cfRow);
  }

  function formatDistance(m) {
    if (m == null || isNaN(m)) return '';
    if (m < 1000) return `${Math.round(m)} m`;
    const km = m / 1000;
    return `${km.toFixed(km < 10 ? 2 : 1)} km`;
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function formatMs(ms) {
    if (ms == null || isNaN(ms)) return '';
    if (ms < 100) return `${ms.toFixed(1)} ms`;
    return `${Math.round(ms)} ms`;
  }

  function toggleSteps(stepIndex) {
    const s1 = els.step1;
    const s2 = els.step2;
    if (stepIndex === 1) {
      s1.hidden = false; s1.classList.add('active');
      s2.hidden = true; s2.classList.remove('active');
      scrollIntoView(s1);
    } else if (stepIndex === 2) {
      s1.hidden = true; s1.classList.remove('active');
      s2.hidden = false; s2.classList.add('active');
      scrollIntoView(s2);
    }
  }

  async function validateEmby(base) {
    // Always validate against the origin root to avoid user path mistakes
    // Emby endpoint: `${u.protocol}//${u.host}/emby/system/info/public`
    let url;
    try {
      const u = new URL(base);
      url = `${u.protocol}//${u.host}/emby/system/info/public`;
    } catch (e) {
      setStatus(els.step1Status, 'error', 'Ungültige URL. Bitte Link prüfen.');
      els.toStep2.disabled = true;
      hide(els.serverInfo);
      return false;
    }

    setStatus(els.step1Status, 'pending', 'Prüfe Emby-Server…');
    try {
      const res = await fetchJson(url);
      if (!res.ok) {
        setStatus(els.step1Status, 'error', `Fehler: HTTP ${res.status}. Ist dies ein Emby-Server?`);
        els.toStep2.disabled = true;
        hide(els.serverInfo);
        return false;
      }
      const data = await res.json();
      const isValid = data && typeof data === 'object' && 'ServerName' in data && 'Version' in data;
      if (!isValid) {
        setStatus(els.step1Status, 'error', 'Antwort sieht nicht wie Emby aus.');
        els.toStep2.disabled = true;
        hide(els.serverInfo);
        return false;
      }
      state.embyInfo = data;
      setStatus(els.step1Status, 'success', 'Emby-Server erkannt.');
      renderServerInfo(data);
      els.toStep2.disabled = false;
      return true;
    } catch (err) {
      console.error(err);
      setStatus(els.step1Status, 'error', `Netzwerk-/CORS-Problem: ${err?.message || err}`);
      els.toStep2.disabled = true;
      hide(els.serverInfo);
      return false;
    }
  }

  async function checkCloudflareColo() {
    const base = state.embyBase;
    if (!base) return;

    // Build trace URL at the origin root (protocol + host)
    let traceUrl = '';
    // Build Emby public info URL for ping measurement
    let embyInfoUrl = '';
    try {
      const u = new URL(base);
      traceUrl = `${u.protocol}//${u.host}/cdn-cgi/trace`;
      embyInfoUrl = `${u.protocol}//${u.host}/emby/system/info/public`;
    } catch {
      traceUrl = base.replace(/\/$/, '') + '/cdn-cgi/trace';
      embyInfoUrl = base.replace(/\/$/, '') + '/emby/system/info/public';
    }

    setStatus(els.step2Status, 'pending', 'Ermittle Cloudflare-Standort…');
    hide(els.cfResults);
    if (els.cfRow) hide(els.cfRow);
    if (els.ispCard) hide(els.ispCard);
    if (els.asnWarning) hide(els.asnWarning);
    if (els.pingEval) hide(els.pingEval);
    const mapCardEl = document.getElementById('mapCard');
    if (mapCardEl) hide(mapCardEl);
    if (state.mapInstance) { try { state.mapInstance.remove(); } catch { } state.mapInstance = null; }
    state.pingSamplesMs = []; state.pingMedianMs = null;

    let colo = '';
    try {
      const res = await fetchText(traceUrl);
      if (!res.ok) {
        setStatus(els.step2Status, 'error', `Fehler bei /cdn-cgi/trace: HTTP ${res.status}`);
        renderCfResults({ componentName: '' });
        return;
      }
      const text = await res.text();
      // Parse key=value pairs per line
      // We care about 'colo=' and also host 'h='
      let hostFromTrace = '';
      for (const line of text.split(/\r?\n/)) {
        if (line.startsWith('colo=')) colo = line.slice(5).trim();
        else if (line.startsWith('h=')) hostFromTrace = line.slice(2).trim();
      }
      if (!state.embyHost && hostFromTrace) state.embyHost = hostFromTrace;
    } catch (err) {
      console.error(err);
      setStatus(els.step2Status, 'error', `Netzwerk-/CORS-Problem bei Trace: ${err?.message || err}`);
      renderCfResults({ componentName: '' });
      return;
    }

    // Pull Cloudflare location mapping via Speed API
    let componentName = '';
    let coloCity = '';
    let coloLat = null;
    let coloLon = null;
    try {
      const res = await fetchJson('https://speed.cloudflare.com/locations');
      if (res.ok) {
        const list = await res.json();
        if (Array.isArray(list)) {
          const match = list.find(item => item && typeof item.iata === 'string' && item.iata.toUpperCase() === colo.toUpperCase());
          if (match) {
            coloCity = match.city || '';
            componentName = match.city ? `${match.city}, ${match.cca2} - (${match.iata})` : '';
            coloLat = typeof match.lat === 'number' ? match.lat : null;
            coloLon = typeof match.lon === 'number' ? match.lon : null;
          }
        }
      } else {
        setStatus(els.step2Status, 'warn', `Cloudflare Locations nicht erreichbar (HTTP ${res.status}).`);
      }
    } catch (err) {
      console.warn('Cloudflare locations fetch failed', err);
      setStatus(els.step2Status, 'warn', 'Cloudflare-Standortliste konnte nicht geladen werden.');
    }

    state.cfColo = colo;
    state.cfComponentName = componentName;
    state.remoteLabel = componentName || coloCity || colo;

    if (colo) {
      setStatus(els.step2Status, 'success', 'Cloudflare-Standort ermittelt.');
    } else {
      setStatus(els.step2Status, 'warn', 'Konnte keinen colo-Wert ermitteln. Ist der Server wirklich über Cloudflare erreichbar?');
    }

    // Measure ping against Emby public info endpoint
    try {
      const pingCount = 8;
      setStatus(els.step2Status, 'pending', `Messe Ping (${pingCount}x) …`);
      const { samples, median } = await measureTracePing(embyInfoUrl, pingCount);
      state.pingSamplesMs = samples;
      state.pingMedianMs = median;
      setStatus(els.step2Status, 'success', 'Ping-Messung abgeschlossen.');
      renderPingEvaluation();
    } catch (e) {
      console.warn('Ping measurement failed', e);
    }

    // Render results including ping
    renderCfResults({ componentName });

    // Also try to fetch client meta for own approximate location
    try {
      const res = await fetchJson('https://speed.cloudflare.com/meta');
      if (res.ok) {
        const meta = await res.json();
        // meta contains latitude/longitude as strings
        const myLat = meta && meta.latitude ? parseFloat(meta.latitude) : null;
        const myLon = meta && meta.longitude ? parseFloat(meta.longitude) : null;
        state.clientAsn = typeof meta?.asn === 'number' ? meta.asn : (meta?.asn ? parseInt(meta.asn, 10) : null);
        state.clientAsOrg = meta?.asOrganization || '';
        if (myLat && myLon && typeof coloLat === 'number' && typeof coloLon === 'number') {
          renderMap({ myLat, myLon, remoteLat: coloLat, remoteLon: coloLon, remoteLabel: state.remoteLabel });
        }
      }
    } catch (err) {
      console.warn('Meta fetch failed', err);
    }
  }

  function renderPingEvaluation() {
    if (!els.pingEval) return;
    const median = state.pingMedianMs;
    if (median == null || !isFinite(median)) {
      hide(els.pingEval);
      return;
    }
    // Bewertung: Exzellent < 20 ms, Sehr gut 20–50 ms, In Ordnung 50–80 ms, Schlecht > 80 ms
    let verdict = '';
    let levelClass = '';
    if (median < 20) {
      verdict = 'Exzellent – optimale Voraussetzungen fürs Streaming';
      levelClass = 'success';
    } else if (median <= 50) {
      verdict = 'Sehr gut – sehr gute Voraussetzungen fürs Streaming';
      levelClass = 'success';
    } else if (median <= 80) {
      verdict = 'In Ordnung – kann vereinzelt zu Pufferungen führen';
      levelClass = 'warn';
    } else {
      verdict = 'Schlecht – hohe Latenz, Pufferungen zu erwarten';
      levelClass = 'error';
    }
    els.pingEval.innerHTML = `
      <div class="info-row"><span class="k">Ping (Median)</span><span class="v">${escapeHtml(formatMs(median))}</span></div>
      <div class="info-row"><span class="k">Einschätzung</span><span class="v">${escapeHtml(verdict)}</span></div>
    `;
    show(els.pingEval);
    els.pingEval.className = 'card ' + levelClass;
  }

  async function measureTracePing(traceUrl, count = 5) {
    const samples = [];
    for (let i = 0; i < count; i++) {
      const url = traceUrl + (traceUrl.includes('?') ? '&' : '?') + 'ping_ts=' + Date.now() + '_' + i;
      const t0 = performance.now();
      try {
        const res = await fetch(url, {
          method: 'GET',
          mode: 'cors',
          credentials: 'omit',
          cache: 'no-store',
          headers: { 'Accept': 'application/json, text/plain, */*' },
        });
        // Ensure body is received so timing reflects full response
        // Try to parse JSON; fall back to text if needed
        try { await res.json(); } catch { await res.text(); }
        const dt = performance.now() - t0;
        if (res.ok && isFinite(dt)) samples.push(dt);
      } catch (_) {
        // ignore failed sample
      }
    }
    samples.sort((a, b) => a - b);
    let median = null;
    if (samples.length) {
      const mid = Math.floor(samples.length / 2);
      if (samples.length % 2 === 1) {
        median = samples[mid];
      } else {
        median = (samples[mid - 1] + samples[mid]) / 2;
      }
    }
    return { samples, median };
  }

  function renderMap({ myLat, myLon, remoteLat, remoteLon, remoteLabel }) {
    const mapCard = document.getElementById('mapCard');
    const mapEl = document.getElementById('map');
    if (!mapEl) return;
    show(mapCard);
    if (els.cfRow) show(els.cfRow);

    // Initialize or reset map
    if (state.mapInstance) { try { state.mapInstance.remove(); } catch { } }
    mapEl.innerHTML = '';
    const map = L.map('map').setView([myLat, myLon], 5);
    // Use OpenFreeMap via MapLibre GL Leaflet binding
    L.maplibreGL({
      style: 'https://tiles.openfreemap.org/styles/liberty',
    }).addTo(map);

    const myIcon = L.AwesomeMarkers.icon({ icon: 'map-pin', markerColor: 'blue', prefix: 'fa', iconColor: 'white' });
    const remoteIcon = L.AwesomeMarkers.icon({ icon: 'server', markerColor: 'orange', prefix: 'fa', iconColor: 'white' });

    const myMarker = L.marker([myLat, myLon], { icon: myIcon }).addTo(map)
      .bindPopup('<b>Dein Standort</b>');

    const remoteMarker = L.marker([remoteLat, remoteLon], { icon: remoteIcon }).addTo(map)
      .bindPopup(`<b>Cloudflare Standort</b><br>${escapeHtml(remoteLabel)}`);

    const polyline = L.polyline([[myLat, myLon], [remoteLat, remoteLon]], { color: '#ff0000' }).addTo(map);
    map.fitBounds(polyline.getBounds(), { padding: [40, 40] });
    state.mapInstance = map;

    // Compute distance using Leaflet's spherical distance
    try {
      state.distanceMeters = L.latLng(myLat, myLon).distanceTo([remoteLat, remoteLon]);
      renderCfResults({ colo: state.cfColo, componentName: state.cfComponentName });
      renderIspCard();
      maybeShowAsnWarning();
    } catch (_) {
      state.distanceMeters = null;
    }
  }

  function renderIspCard() {
    if (!els.ispCard) return;
    const asn = state.clientAsn != null ? String(state.clientAsn) : 'Unbekannt';
    const org = state.clientAsOrg || 'Unbekannt';
    els.ispCard.innerHTML = `
      <div class="info-row"><span class="k">ISP</span><span class="v">${escapeHtml(org)}</span></div>
      <div class="info-row"><span class="k">ASN</span><span class="v">${escapeHtml(asn)}</span></div>
    `;
    show(els.ispCard);
  }

  function maybeShowAsnWarning() {
    if (!els.asnWarning) return;
    hide(els.asnWarning);
    const distKm = (state.distanceMeters || 0) / 1000;
    if (distKm < 600) return; // km limit
    const telekomAsns = new Set([3320, 48951, 5483, 5391, 6855, 12713, 8412, 13036, 12912, 5588, 5603, 6878, 2773]);
    if (!state.clientAsn || !telekomAsns.has(Number(state.clientAsn))) return;
    els.asnWarning.innerHTML = `
      Du bist derzeit über ein Telekom-Netz verbunden. In einigen Fällen werden Verbindungen netzseitig über einen
      weiter entfernten Cloudflare-Standort geroutet. Hintergrundinformationen findest du auf
      <a href="https://netzbremse.de" target="_blank" rel="noopener">NetzBremse.de</a>.
      Dies kann langes Laden und Paketverlust verursachen.
      Als mögliche Abhilfe kann testweise die Nutzung eines <a href="https://youtu.be/jv-uYoh-cz0" target="_blank" rel="noopener">VPN</a>-Dienstes helfen.
      Die meisten VPN-Anbieter "kooperieren" mit der Telekom, wodurch eine nähere Anbindung erreicht werden kann. Beim kostenlosen Cloudflare-Plan
      (wie bei StreamBoy) ist dies nicht gewährleistet.`;
    show(els.asnWarning);
  }

  // replaced asn hint with professional warning above

  function resetAll() {
    if (state.mapInstance) { try { state.mapInstance.remove(); } catch { } }
    state = { embyBase: '', embyHost: '', embyInfo: null, cfColo: '', cfComponentName: '', mapInstance: null, distanceMeters: null, remoteLabel: '', clientAsn: null, clientAsOrg: '', pingSamplesMs: [], pingMedianMs: null };
    els.embyInput.value = '';
    els.toStep2.disabled = true;
    setStatus(els.step1Status, '', '');
    hide(els.serverInfo);
    setStatus(els.step2Status, '', '');
    hide(els.cfResults);
    if (els.cfRow) hide(els.cfRow);
    if (els.ispCard) hide(els.ispCard);
    if (els.asnWarning) hide(els.asnWarning);
    if (els.pingEval) hide(els.pingEval);
    toggleSteps(1);
  }

  // Event wiring
  els.embyInput.addEventListener('change', onInputSubmit);
  els.embyInput.addEventListener('blur', onInputSubmit);
  els.embyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onInputSubmit();
    }
  });

  async function onInputSubmit() {
    const base = sanitizeBaseUrl(els.embyInput.value);
    state.embyBase = base;
    state.embyHost = tryGetHost(base);
    if (!base) {
      setStatus(els.step1Status, 'error', 'Bitte einen gültigen Link eingeben.');
      els.toStep2.disabled = true;
      hide(els.serverInfo);
      return;
    }
    await validateEmby(base);
  }

  els.toStep2.addEventListener('click', async () => {
    toggleSteps(2);
    await checkCloudflareColo();
  });

  els.backTo1.addEventListener('click', () => {
    toggleSteps(1);
  });

  els.resetAll.addEventListener('click', resetAll);

  // removed proximity buttons

  // Initialize
  // No-op
})();
