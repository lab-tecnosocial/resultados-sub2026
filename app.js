// Legend collapse state
let legendCollapsed = false;

// Municipality configuration
const MUNICIPALITIES_CONFIG = {
    'cochabamba': { name: 'Cochabamba', coords: [-17.3895, -66.1568], zoom: { m: 11, d: 12 }, folder: 'cochabamba', fileSuffix: 'cochabamba' },
    'la-paz':     { name: 'La Paz',     coords: [-16.4897, -68.1193], zoom: { m: 12, d: 13 }, folder: 'la-paz',     fileSuffix: 'la_paz' },
    'el-alto':    { name: 'El Alto',    coords: [-16.5056, -68.1933], zoom: { m: 12, d: 13 }, folder: 'el-alto',    fileSuffix: 'el_alto' },
    'santa-cruz': { name: 'Santa Cruz', coords: [-17.7833, -63.1822], zoom: { m: 11, d: 12 }, folder: 'santa-cruz', fileSuffix: 'santa_cruz' },
    'oruro':      { name: 'Oruro',      coords: [-17.9667, -67.1167], zoom: { m: 12, d: 13 }, folder: 'oruro',      fileSuffix: 'oruro' },
    'potosi':     { name: 'Potosí',     coords: [-19.5836, -65.7531], zoom: { m: 12, d: 13 }, folder: 'potosi',     fileSuffix: 'potosi' },
    'sucre':      { name: 'Sucre',      coords: [-19.0430, -65.2592], zoom: { m: 12, d: 13 }, folder: 'sucre',      fileSuffix: 'sucre' },
    'tarija':     { name: 'Tarija',     coords: [-21.5237, -64.7296], zoom: { m: 12, d: 13 }, folder: 'tarija',     fileSuffix: 'tarija' },
    'trinidad':   { name: 'Trinidad',   coords: [-14.8333, -64.9000], zoom: { m: 12, d: 13 }, folder: 'trinidad',   fileSuffix: 'trinidad' },
    'cobija':     { name: 'Cobija',     coords: [-11.0280, -68.7697], zoom: { m: 12, d: 13 }, folder: 'cobija',     fileSuffix: 'cobija' },
};

// Configuration
const CONFIG = {
    partyColors: {},
    partiesData: {},
    totals: {},
    neutral: '#E8E8E8',
    layers: {
        recintos: '',
        recintosPie: '',
        distritos: ''
    },
    layerNames: {
        recintos: 'Recintos (ganador)',
        recintosPie: 'Recintos (distribución)',
        distritos: 'Distritos'
    }
};

// Map initialization — Bolivia overview
const map = L.map('map', {
    zoomControl: false,
    minZoom: 5
}).setView([-16.5, -65.0], 6);

L.control.zoom({
    position: 'topright'
}).addTo(map);

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '',
    maxZoom: 19,
    subdomains: 'abcd'
}).addTo(map);

// Create boundary pane below data layers (zIndex 350 < default overlay 400)
map.createPane('boundaryPane');
map.getPane('boundaryPane').style.zIndex = 350;

// Global state
let currentMunicipality = null;
let currentLayer = 'recintos';
let currentGeoJsonLayer = null;
let currentBoundaryLayer = null;
let boliviaMarkersLayer = null;
let geoJsonData = {};

// Non-party GeoJSON property fields — used to detect party columns dynamically
const NON_PARTY_FIELDS = new Set([
    'asiento', 'recinto', 'NombreRecinto', 'votos_totales', 'InscritosHabilitados',
    'participacion', 'ganador', 'votos_ganador', 'pct_ganador', 'partido_2do',
    'votos_2do', 'pct_2do', 'margen_victoria', 'OBJECTID', 'gid', 'departamen',
    'provincia', 'municipio', 'nombreciud', 'distrito', 'Municipality', 'ADM3_PCODE',
    'Province', 'Department', 'ADM0_ES', 'area_ha', 'VotoBlanco', 'VotoNulo'
]);

// Return party column names from a GeoJSON feature's properties
function getPartyKeys(properties) {
    return Object.keys(properties).filter(k =>
        !NON_PARTY_FIELDS.has(k) &&
        !k.startsWith('pct_') &&
        typeof properties[k] === 'number'
    );
}

// Categorical color by winning party
function getColorByWinner(properties) {
    if (!properties || !properties.ganador) {
        return { color: CONFIG.neutral, fillOpacity: 0.5 };
    }
    const baseColor = CONFIG.partyColors[properties.ganador] || '#888888';
    return { color: baseColor, fillOpacity: 0.75 };
}

// Get feature name based on layer type
function getFeatureName(properties) {
    if (properties.NombreRecinto) return properties.NombreRecinto;
    if (properties.recinto) return `Recinto ${properties.recinto}`;
    if (properties.Municipality) return properties.Municipality;
    if (properties.NombreMunicipio) return properties.NombreMunicipio;
    if (properties.NombreDepartamento) return properties.NombreDepartamento;
    if (properties.Department) return properties.Department;
    if (properties.department) return properties.department;
    if (properties.Circun) return `Circunscripción - ${properties.Circun}`;
    if (properties.circunscripcion) return `Circunscripción - ${properties.circunscripcion}`;
    if (properties.nombreciud && properties.distrito) {
        return `${properties.nombreciud} - Distrito ${parseInt(properties.distrito, 10)}`;
    }
    if (properties.nombreciud) return properties.nombreciud;
    if (properties.name && properties.area_tipo) return `${properties.name} - ${properties.area_tipo}`;
    if (properties.name) return properties.name;
    for (let key in properties) {
        if (key.toLowerCase().includes('nombre') || key.toLowerCase().includes('name')) {
            return properties[key];
        }
    }
    return 'Sin nombre';
}

// Create popup content
function createPopupContent(properties) {
    const name = getFeatureName(properties);
    const total = properties.votos_totales || 0;
    const ganador = properties.ganador || 'N/A';
    const ganadorData = CONFIG.partiesData[ganador] || {};
    const ganadorColor = ganadorData.color || CONFIG.partyColors[ganador] || '#888';
    const ganadorCandidato = ganadorData.candidato || ganador;
    const ganadorImg = ganadorData.img || '';
    const pct_ganador = properties.pct_ganador || 0;
    const participacion = properties.participacion || 0;
    const isRecinto = properties.NombreRecinto !== undefined;

    const formatNumber = (num) => Math.round(num).toLocaleString('es-BO');
    const formatPct = (pct) => isRecinto ? Number(pct).toFixed(1) : Math.round(pct);

    const partyKeys = getPartyKeys(properties);
    const partyVotes = partyKeys
        .map(k => ({ key: k, votes: properties[k] || 0 }))
        .filter(p => p.votes > 0 && p.key !== ganador)
        .sort((a, b) => b.votes - a.votes);

    const partyRowsHTML = partyVotes.map(({ key, votes }) => {
        const pct = properties[`pct_${key}`] || 0;
        const pd = CONFIG.partiesData[key] || {};
        const color = pd.color || CONFIG.partyColors[key] || '#888';
        const img = pd.img || '';
        const candidato = pd.candidato || '';
        const photoHTML = img
            ? `<img src="${img}" style="width:20px;height:20px;border-radius:50%;object-fit:cover;border:1.5px solid ${color};flex-shrink:0;" onerror="this.style.display='none'">`
            : `<span style="display:inline-block;width:20px;height:20px;border-radius:50%;background:${color};flex-shrink:0;"></span>`;
        return `
            <div class="popup-row">
                <span class="popup-label" style="display:flex;align-items:center;gap:6px;">
                    ${photoHTML}
                    <span>
                        <span style="display:block;font-size:11px;">${key}</span>
                        <span style="display:block;font-size:10px;color:#7a8fa6;font-weight:400;">${candidato}</span>
                    </span>
                </span>
                <span class="popup-value">${formatNumber(votes)} <span style="color:#5a6c7d;font-weight:400;">(${formatPct(pct)}%)</span></span>
            </div>
        `;
    }).join('');

    const ganadorPhotoHTML = ganadorImg
        ? `<img src="${ganadorImg}" style="width:52px;height:52px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,0.6);flex-shrink:0;" onerror="this.style.display='none'">`
        : '';

    return `
        <div class="popup-inner">
            <div class="popup-title">${name}</div>
            <div style="background:${ganadorColor};color:#fff;border-radius:8px;padding:10px 12px;margin-bottom:10px;display:flex;align-items:center;gap:10px;">
                ${ganadorPhotoHTML}
                <div>
                    <div style="font-size:10px;opacity:0.8;text-transform:uppercase;letter-spacing:0.5px;">Ganador</div>
                    <div style="font-size:14px;font-weight:700;line-height:1.2;">${ganadorCandidato}</div>
                    <div style="font-size:11px;opacity:0.9;">${ganador} · ${formatNumber(properties[ganador] || 0)} (${formatPct(pct_ganador)}%)</div>
                </div>
            </div>
            ${partyRowsHTML}
            <div class="popup-divider"></div>
            <div class="popup-row">
                <span class="popup-label">Total votos:</span>
                <span class="popup-value">${formatNumber(total)}</span>
            </div>
            <div class="popup-row">
                <span class="popup-label">Participación:</span>
                <span class="popup-value">${formatPct(participacion)}%</span>
            </div>
        </div>
    `;
}

// Style function for features
function getFeatureStyle(feature) {
    const properties = feature.properties;

    if (!properties || !properties.votos_totales) {
        return {
            color: CONFIG.neutral,
            weight: 1,
            opacity: 0.5,
            fillOpacity: 0.3
        };
    }

    if (feature.geometry.type === 'Point') {
        const votosTotales = properties.votos_totales || 0;
        const { color: fillColor, fillOpacity } = getColorByWinner(properties);
        let radius;

        if (votosTotales <= 2000) radius = 2.5;
        else if (votosTotales <= 3000) radius = 4.0;
        else if (votosTotales <= 4000) radius = 5.5;
        else if (votosTotales <= 5000) radius = 7.0;
        else if (votosTotales <= 6000) radius = 8.5;
        else if (votosTotales <= 7000) radius = 10.0;
        else radius = 12.0;

        return {
            radius,
            fillColor,
            color: 'transparent',
            weight: 0,
            opacity: 0,
            fillOpacity
        };
    } else {
        const { color, fillOpacity } = getColorByWinner(properties);
        return {
            fillColor: color,
            weight: 1.5,
            opacity: 0.8,
            color: 'white',
            fillOpacity
        };
    }
}

// Create layer from GeoJSON
function createGeoJsonLayer(data) {
    try {
        const geoJsonLayer = L.geoJSON(data, {
            filter: (feature) => {
                const props = feature.properties;
                return props && props.votos_totales > 0;
            },
            pointToLayer: (feature, latlng) => {
                try {
                    const style = getFeatureStyle(feature);
                    return L.circleMarker(latlng, style);
                } catch (e) {
                    console.warn('Error styling point feature:', e);
                    return L.circleMarker(latlng, {
                        radius: 5,
                        fillColor: CONFIG.neutral,
                        color: '#fff',
                        weight: 1,
                        opacity: 0.5,
                        fillOpacity: 0.3
                    });
                }
            },
            style: (feature) => {
                try {
                    const style = getFeatureStyle(feature);
                    const { radius, ...polygonStyle } = style;
                    return polygonStyle;
                } catch (e) {
                    console.warn('Error styling polygon feature:', e);
                    return {
                        color: CONFIG.neutral,
                        weight: 1,
                        opacity: 0.5,
                        fillOpacity: 0.3
                    };
                }
            },
            onEachFeature: (feature, layer) => {
                try {
                    const properties = feature.properties;

                    if (properties) {
                        const name = getFeatureName(properties);
                        layer.bindTooltip(name, {
                            permanent: false,
                            direction: 'auto',
                            className: 'custom-tooltip'
                        });
                    }

                    if (properties && properties.votos_totales) {
                        layer.bindPopup(createPopupContent(properties));
                    }

                    if (layer.setRadius) {
                        layer._originalRadius = layer.options.radius;
                    }

                    layer.on('mouseover', function () {
                        if (!this.isPopupOpen()) {
                            this.setStyle({
                                weight: 2.5,
                                opacity: 1,
                                fillOpacity: 0.9
                            });
                            if (this.setRadius && this._originalRadius) {
                                this.setRadius(this._originalRadius * 1.3);
                            }
                        }
                    });

                    layer.on('mouseout', function () {
                        try {
                            geoJsonLayer.resetStyle(this);
                            if (this.setRadius && this._originalRadius) {
                                this.setRadius(this._originalRadius);
                            }
                        } catch (e) {
                            console.warn('Error resetting style:', e);
                        }
                    });

                    layer.on('popupopen', function () {
                        try {
                            geoJsonLayer.resetStyle(this);
                            if (this.setRadius && this._originalRadius) {
                                this.setRadius(this._originalRadius);
                            }
                        } catch (e) {
                            console.warn('Error resetting style on popup open:', e);
                        }
                    });
                } catch (e) {
                    console.warn('Error processing feature:', e);
                }
            }
        });

        return geoJsonLayer;
    } catch (e) {
        console.error('Error creating GeoJSON layer:', e);
        return null;
    }
}

// Generate SVG pie chart icon for a recinto
function createPieIcon(properties) {
    const partyKeys = getPartyKeys(properties);
    const total = properties.votos_totales || 1;

    const slices = partyKeys
        .map(k => ({ color: CONFIG.partyColors[k] || '#888', votes: properties[k] || 0 }))
        .filter(s => s.votes > 0)
        .sort((a, b) => b.votes - a.votes);

    const v = properties.votos_totales || 0;
    const size = v <= 2000 ? 18 : v <= 3000 ? 22 : v <= 4000 ? 28
        : v <= 5000 ? 33 : v <= 6000 ? 38 : v <= 7000 ? 44 : 50;
    const r = size / 2;

    let svgContent;
    if (slices.length === 1) {
        svgContent = `<circle cx="${r}" cy="${r}" r="${r}" fill="${slices[0].color}"/>`;
    } else {
        let paths = '';
        let angle = -Math.PI / 2;
        for (const slice of slices) {
            const sweep = (slice.votes / total) * 2 * Math.PI;
            const end = angle + sweep;
            const x1 = (r + r * Math.cos(angle)).toFixed(3);
            const y1 = (r + r * Math.sin(angle)).toFixed(3);
            const x2 = (r + r * Math.cos(end)).toFixed(3);
            const y2 = (r + r * Math.sin(end)).toFixed(3);
            const large = sweep > Math.PI ? 1 : 0;
            paths += `<path d="M${r} ${r} L${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2}Z" fill="${slice.color}" stroke="white" stroke-width="0.8"/>`;
            angle = end;
        }
        svgContent = paths;
    }

    const svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="display:block;overflow:visible;">${svgContent}</svg>`;
    return L.divIcon({
        html: svg,
        className: 'pie-chart-marker',
        iconSize: [size, size],
        iconAnchor: [r, r],
        popupAnchor: [0, -r]
    });
}

// Create pie chart layer for recintos
function createRecintosPieLayer(data) {
    try {
        const pieLayer = L.geoJSON(data, {
            filter: (feature) => {
                const props = feature.properties;
                return props && props.votos_totales > 0;
            },
            pointToLayer: (feature, latlng) => {
                return L.marker(latlng, { icon: createPieIcon(feature.properties) });
            },
            onEachFeature: (feature, layer) => {
                try {
                    const properties = feature.properties;
                    if (properties) {
                        layer.bindTooltip(getFeatureName(properties), {
                            permanent: false,
                            direction: 'auto',
                            className: 'custom-tooltip'
                        });
                        if (properties.votos_totales) {
                            layer.bindPopup(createPopupContent(properties));
                        }
                    }
                } catch (e) {
                    console.warn('Error processing pie feature:', e);
                }
            }
        });
        return pieLayer;
    } catch (e) {
        console.error('Error creating pie layer:', e);
        return null;
    }
}

// Load GeoJSON data for a layer
async function loadGeoJsonData(layerKey) {
    try {
        const response = await fetch(CONFIG.layers[layerKey]);
        if (!response.ok) throw new Error(`Failed to load ${layerKey}`);
        return await response.json();
    } catch (error) {
        console.error(`Error loading layer ${layerKey}:`, error);
        return null;
    }
}

// Show/hide loader
function showLoader() {
    let loader = document.getElementById('loader');
    if (!loader) {
        loader = document.createElement('div');
        loader.id = 'loader';
        loader.className = 'loader';
        loader.innerHTML = '<div class="loader-spinner"></div><p>Cargando capa...</p>';
        document.body.appendChild(loader);
    }
    loader.style.display = 'flex';
}

function hideLoader() {
    const loader = document.getElementById('loader');
    if (loader) {
        loader.style.display = 'none';
    }
}

// Load and display a layer
async function switchLayer(layerKey) {
    try {
        showLoader();

        if (currentGeoJsonLayer) {
            map.removeLayer(currentGeoJsonLayer);
        }

        if (!geoJsonData[layerKey]) {
            geoJsonData[layerKey] = await loadGeoJsonData(layerKey);
        }

        if (!geoJsonData[layerKey]) {
            console.error(`Failed to load layer: ${layerKey}`);
            hideLoader();
            return;
        }

        const newLayer = layerKey === 'recintosPie'
            ? createRecintosPieLayer(geoJsonData[layerKey])
            : createGeoJsonLayer(geoJsonData[layerKey]);

        if (!newLayer) {
            console.error(`Failed to create layer: ${layerKey}`);
            hideLoader();
            return;
        }

        currentGeoJsonLayer = newLayer.addTo(map);
        updateLegend(layerKey);
        currentLayer = layerKey;

        hideLoader();
    } catch (error) {
        console.error(`Error switching to layer ${layerKey}:`, error);
        hideLoader();
    }
}

// Update legend
function updateLegend(layerKey) {
    const legendDiv = document.getElementById('legend');

    // Use only parties present in totals (i.e., active in current municipality)
    const sortedParties = Object.keys(CONFIG.totals)
        .sort((a, b) => ((CONFIG.totals[b] || {}).pct || 0) - ((CONFIG.totals[a] || {}).pct || 0));
    const maxPct = sortedParties.length ? ((CONFIG.totals[sortedParties[0]] || {}).pct || 1) : 1;

    const partyBarHTML = (party, photoSize) => {
        const pd = CONFIG.partiesData[party] || {};
        const color = pd.color || CONFIG.partyColors[party] || '#888';
        const img = pd.img || '';
        const candidato = pd.candidato || '';
        const pct = (CONFIG.totals[party] || {}).pct || 0;
        const barW = (pct / maxPct * 100).toFixed(1);
        const photoHTML = img
            ? `<img src="${img}" style="width:${photoSize}px;height:${photoSize}px;border-radius:50%;object-fit:cover;border:2px solid ${color};flex-shrink:0;" onerror="this.style.display='none'">`
            : `<div style="width:${photoSize}px;height:${photoSize}px;border-radius:50%;background:${color};flex-shrink:0;"></div>`;
        return `
            <div class="legend-party-item" style="margin-bottom:7px;">
                <div class="legend-party-row" style="display:flex;align-items:center;gap:7px;margin-bottom:3px;">
                    ${photoHTML}
                    <div style="flex:1;min-width:0;">
                        <div class="legend-party-name" style="font-size:11px;font-weight:700;color:#2c3e50;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${party}</div>
                        <div class="legend-candidate" style="font-size:9px;color:#7a8fa6;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${candidato}</div>
                    </div>
                    <span class="legend-party-pct" style="font-size:12px;font-weight:700;color:${color};flex-shrink:0;margin-left:4px;">${pct.toFixed(1)}%</span>
                </div>
                <div class="legend-party-bar" style="background:#e8ecf0;border-radius:3px;height:4px;margin-left:${photoSize + 7}px;">
                    <div style="background:${color};width:${barW}%;height:4px;border-radius:3px;"></div>
                </div>
            </div>
        `;
    };

    const swatchesHTML = sortedParties.map(p => partyBarHTML(p, 26)).join('');

    const legendTitle = layerKey === 'recintosPie'
        ? 'Partidos por recinto'
        : 'Partido (total municipio)';

    legendDiv.innerHTML = `
        <div class="legend-header">
            <div class="legend-title">${legendTitle}</div>
            <button class="legend-toggle" aria-label="Colapsar leyenda">${legendCollapsed ? '▲' : '▼'}</button>
        </div>
        <div class="legend-body">
            <div class="legend-party-items">${swatchesHTML}</div>
        </div>
    `;
    if (legendCollapsed) legendDiv.classList.add('legend-collapsed');
    else legendDiv.classList.remove('legend-collapsed');
}

// Load party/candidate data from CSV; auto-generate colors for parties not in CSV
async function loadPartiesData(municipalityKey, detectedPartyKeys) {
    const municipioName = MUNICIPALITIES_CONFIG[municipalityKey].name;
    try {
        const response = await fetch('data/data-partidos.csv');
        const text = await response.text();
        const lines = text.trim().split('\n');
        for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split(',');
            const municipio = parts[0];
            const partido = parts[1];
            const candidato = parts[2];
            const color = parts[3];
            const img = (parts[4] || '').trim();
            if (!partido || municipio !== municipioName) continue;
            CONFIG.partiesData[partido] = { candidato, color, img: img ? `fotos-candidatos/${img}` : '' };
            CONFIG.partyColors[partido] = color;
        }
    } catch (e) {
        console.error('Error loading parties data:', e);
    }

    // Auto-generate colors for any party not covered by the CSV
    const unknown = (detectedPartyKeys || []).filter(k => !CONFIG.partyColors[k]);
    if (unknown.length > 0) {
        const palette = chroma.scale([
            '#e41a1c', '#377eb8', '#4daf4a', '#984ea3', '#ff7f00',
            '#a65628', '#f781bf', '#999999', '#66c2a5', '#fc8d62'
        ]).colors(Math.max(unknown.length, 2));
        unknown.forEach((k, i) => {
            const color = palette[i % palette.length];
            CONFIG.partyColors[k] = color;
            CONFIG.partiesData[k] = { candidato: '', color, img: '' };
        });
    }
}

// Load municipal vote totals from the municipio GeoJSON; returns detected party keys
async function loadTotals(municipalityKey) {
    const cfg = MUNICIPALITIES_CONFIG[municipalityKey];
    const url = `data/${cfg.folder}/municipio_alcalde_${cfg.fileSuffix}.geojson`;
    try {
        const data = await fetch(url).then(r => r.json());
        const props = data.features[0].properties;
        const parties = getPartyKeys(props);
        const grandTotal = props.votos_totales || 1;
        CONFIG.totals = {};
        parties.forEach(p => {
            CONFIG.totals[p] = { votes: props[p] || 0, pct: (props[p] || 0) / grandTotal * 100 };
        });
        return parties;
    } catch (e) {
        console.error('Error loading totals:', e);
        return [];
    }
}

// Update layer file paths for the selected municipality
function updateLayerPaths(municipalityKey) {
    const cfg = MUNICIPALITIES_CONFIG[municipalityKey];
    const base = `data/${cfg.folder}`;
    const suffix = cfg.fileSuffix;
    CONFIG.layers.recintos = `${base}/recintos_alcalde_${suffix}.geojson`;
    CONFIG.layers.recintosPie = `${base}/recintos_alcalde_${suffix}.geojson`;
    CONFIG.layers.distritos = `${base}/distritos_alcalde_${suffix}.geojson`;
}

// Load municipality boundary polygon
async function loadBoundary(municipalityKey) {
    if (currentBoundaryLayer) {
        map.removeLayer(currentBoundaryLayer);
        currentBoundaryLayer = null;
    }
    const cfg = MUNICIPALITIES_CONFIG[municipalityKey];
    const url = `data/${cfg.folder}/municipio_alcalde_${cfg.fileSuffix}.geojson`;
    try {
        const data = await fetch(url).then(r => r.json());
        currentBoundaryLayer = L.geoJSON(data, {
            pane: 'boundaryPane',
            interactive: false,
            style: {
                fillColor: '#29b6f6',
                fillOpacity: 0.12,
                color: '#0288d1',
                weight: 2,
                opacity: 0.65
            }
        }).addTo(map);
    } catch (e) {
        console.error('Error loading boundary:', e);
    }
}

// Add clickable markers for Bolivia overview
function addBoliviaMarkers() {
    boliviaMarkersLayer = L.layerGroup();
    Object.entries(MUNICIPALITIES_CONFIG).forEach(([key, cfg]) => {
        L.circleMarker(cfg.coords, {
            radius: 9,
            fillColor: '#0288d1',
            color: '#fff',
            weight: 2,
            fillOpacity: 0.85
        })
        .bindTooltip(cfg.name, {
            permanent: false,
            direction: 'auto',
            className: 'custom-tooltip'
        })
        .on('click', () => {
            document.getElementById('municipality-select').value = key;
            switchMunicipality(key);
        })
        .addTo(boliviaMarkersLayer);
    });
    boliviaMarkersLayer.addTo(map);
}

// Reset to Bolivia overview
function resetToBolivia() {
    if (currentGeoJsonLayer) { map.removeLayer(currentGeoJsonLayer); currentGeoJsonLayer = null; }
    if (currentBoundaryLayer) { map.removeLayer(currentBoundaryLayer); currentBoundaryLayer = null; }
    geoJsonData = {};
    CONFIG.partyColors = {}; CONFIG.partiesData = {}; CONFIG.totals = {};
    currentMunicipality = null;
    if (boliviaMarkersLayer) boliviaMarkersLayer.addTo(map);
    document.getElementById('layer-select-wrapper').style.display = 'none';
    document.getElementById('legend').style.display = 'none';
    document.getElementById('layer-select').value = 'recintos';
    document.getElementById('controls-subtitle').textContent = 'Bolivia - Subnacionales 2026';
    map.flyTo([-16.5, -65.0], 6, { duration: 1.2 });
}

// Switch to a new municipality — orchestrates all data loading
async function switchMunicipality(key) {
    // Clear current layers
    if (currentGeoJsonLayer) { map.removeLayer(currentGeoJsonLayer); currentGeoJsonLayer = null; }
    if (currentBoundaryLayer) { map.removeLayer(currentBoundaryLayer); currentBoundaryLayer = null; }

    // Hide Bolivia overview markers
    if (boliviaMarkersLayer) map.removeLayer(boliviaMarkersLayer);

    // Clear GeoJSON cache (paths change per municipality)
    geoJsonData = {};

    // Reset party/config state
    CONFIG.partyColors = {}; CONFIG.partiesData = {}; CONFIG.totals = {};

    // Load totals from municipio GeoJSON (also detects party keys)
    const detectedParties = await loadTotals(key);

    // Load party colors/data (CSV filtered by municipality, auto-generate for others)
    await loadPartiesData(key, detectedParties);

    // Update layer file paths
    updateLayerPaths(key);

    // Load boundary
    await loadBoundary(key);

    // Fly to municipality
    const cfg = MUNICIPALITIES_CONFIG[key];
    const zoom = window.innerWidth <= 768 ? cfg.zoom.m : cfg.zoom.d;
    map.flyTo(cfg.coords, zoom, { duration: 1.2 });

    // Show controls and update subtitle
    document.getElementById('layer-select-wrapper').style.display = '';
    document.getElementById('legend').style.display = '';
    document.getElementById('controls-subtitle').textContent = `Alcaldía de ${cfg.name} 2026`;
    document.getElementById('layer-select').value = 'recintos';
    currentMunicipality = key;

    // Wait for fly animation to finish before showing data
    await new Promise(resolve => map.once('moveend', resolve));
    await switchLayer('recintos');
}

// Event listener for municipality selection
document.getElementById('municipality-select').addEventListener('change', (e) => {
    if (e.target.value) {
        switchMunicipality(e.target.value);
    } else {
        resetToBolivia();
    }
});

// Event listener for layer selection
document.getElementById('layer-select').addEventListener('change', (e) => {
    switchLayer(e.target.value);
});

// Legend toggle click (event delegation — survives innerHTML rebuilds)
const legendDiv = document.getElementById('legend');
legendDiv.addEventListener('click', (e) => {
    if (e.target.closest('.legend-toggle')) {
        legendCollapsed = !legendCollapsed;
        legendDiv.classList.toggle('legend-collapsed', legendCollapsed);
        const btn = legendDiv.querySelector('.legend-toggle');
        if (btn) btn.textContent = legendCollapsed ? '▲' : '▼';
    }
});

// Swipe down on legend to collapse
let legendTouchStartY = 0;
legendDiv.addEventListener('touchstart', (e) => {
    legendTouchStartY = e.touches[0].clientY;
}, { passive: true });
legendDiv.addEventListener('touchend', (e) => {
    const dy = e.changedTouches[0].clientY - legendTouchStartY;
    if (dy > 40 && !legendCollapsed) {
        legendCollapsed = true;
        legendDiv.classList.add('legend-collapsed');
        const btn = legendDiv.querySelector('.legend-toggle');
        if (btn) btn.textContent = '▲';
    }
}, { passive: true });

// Initialize — Bolivia overview, controls hidden until municipality selected
function init() {
    addBoliviaMarkers();
    document.getElementById('layer-select-wrapper').style.display = 'none';
    document.getElementById('legend').style.display = 'none';
}
init();
