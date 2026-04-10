// Legend collapse state
let legendCollapsed = false;

// Capital municipality ADM3_PCODEs — have custom colors, photos, and may have distritos
const CAPITAL_PCODES = new Set([
    'BO030101', // Cochabamba
    'BO020101', // Nuestra Señora de La Paz (La Paz)
    'BO020105', // El Alto
    'BO070101', // Santa Cruz de La Sierra
    'BO040101', // Oruro
    'BO050101', // Potosí
    'BO010101', // Sucre
    'BO060101', // Tarija
    'BO080101', // Trinidad
    'BO090101', // Cobija
]);

// Zoom levels for capital municipalities (others use fitBounds)
const CAPITAL_ZOOM = {
    'BO030101': { m: 11, d: 12 },
    'BO020101': { m: 12, d: 13 },
    'BO020105': { m: 12, d: 13 },
    'BO070101': { m: 11, d: 12 },
    'BO040101': { m: 12, d: 13 },
    'BO050101': { m: 12, d: 13 },
    'BO010101': { m: 12, d: 13 },
    'BO060101': { m: 12, d: 13 },
    'BO080101': { m: 12, d: 13 },
    'BO090101': { m: 12, d: 13 },
};

// Coords for capitals (center of municipality)
const CAPITAL_COORDS = {
    'BO030101': [-17.3895, -66.1568],
    'BO020101': [-16.4897, -68.1193],
    'BO020105': [-16.5056, -68.1933],
    'BO070101': [-17.7833, -63.1822],
    'BO040101': [-17.9667, -67.1167],
    'BO050101': [-19.5836, -65.7531],
    'BO010101': [-19.0430, -65.2592],
    'BO060101': [-21.5237, -64.7296],
    'BO080101': [-14.8333, -64.9000],
    'BO090101': [-11.0280, -68.7697],
};

// CSV municipality name for capitals (CSV uses shorter names than geojson)
const CAPITAL_CSV_NAMES = {
    'BO030101': 'Cochabamba',
    'BO020101': 'La Paz',
    'BO020105': 'El Alto',
    'BO070101': 'Santa Cruz',
    'BO040101': 'Oruro',
    'BO050101': 'Potosí',
    'BO010101': 'Sucre',
    'BO060101': 'Tarija',
    'BO080101': 'Trinidad',
    'BO090101': 'Cobija',
};

// Override folder paths for municipalities whose names don't normalize correctly
const FOLDER_OVERRIDES = {
    'BO020101': { dept: 'la_paz', mun: 'nuestra_senora_de_la_paz' },
    'BO070101': { dept: 'santa_cruz', mun: 'santa_cruz_de_la_sierra' },
    'BO021801': { dept: 'la_paz', mun: 'san_pedro_de_curahuara' }, // "San Pedro Cuarahuara" → san_pedro_de_curahuara
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

L.control.zoom({ position: 'topright' }).addTo(map);

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '',
    maxZoom: 19,
    subdomains: 'abcd'
}).addTo(map);

// Boundary pane below data layers (zIndex 350 < default overlay 400)
map.createPane('boundaryPane');
map.getPane('boundaryPane').style.zIndex = 350;

// Global state
let currentMunicipality = null;  // ADM3_PCODE
let currentLayer = 'recintos';
let currentGeoJsonLayer = null;
let currentBoundaryLayer = null;
let boliviaLayer = null;         // Overview polygon layer
let municipalitiesIndex = {};    // { pcode: { name, department, ... } }
let geoJsonData = {};

// Party mode state
let currentParty = null;
let partyMunicipalitiesMap = {};  // { partido: [pcode, ...] }
let partyGlobalColors = {};        // { partido: color } first occurrence from CSV

// Manual match overrides for partidos_ganadores.json names not in geojson
const PARTY_MUN_OVERRIDES = {
    'san_pedro_de_curahuara|la_paz': 'BO021801',
    'curahuara_de_carangas|oruro': 'BO040401',
};

// Non-party GeoJSON property fields — used to detect party columns dynamically
const NON_PARTY_FIELDS = new Set([
    'asiento', 'recinto', 'NombreRecinto', 'votos_totales', 'InscritosHabilitados',
    'participacion', 'ganador', 'votos_ganador', 'pct_ganador', 'partido_2do',
    'votos_2do', 'pct_2do', 'margen_victoria', 'OBJECTID', 'gid', 'departamen',
    'provincia', 'municipio', 'nombreciud', 'distrito', 'Municipality', 'ADM3_PCODE',
    'Province', 'Department', 'ADM0_ES', 'area_ha', 'VotoBlanco', 'VotoNulo'
]);

function getPartyKeys(properties) {
    return Object.keys(properties).filter(k =>
        !NON_PARTY_FIELDS.has(k) &&
        !k.startsWith('pct_') &&
        typeof properties[k] === 'number'
    );
}

// Normalize a display name to a datamun folder slug
function toFolderName(name) {
    return name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .trim()
        .replace(/\s+/g, '_');
}

// Build municipality index from geojson features
function buildMunicipalitiesIndex(features) {
    const index = {};
    features.forEach(feature => {
        const props = feature.properties;
        const pcode = props.ADM3_PCODE;
        const override = FOLDER_OVERRIDES[pcode];
        const deptFolder = override ? override.dept : toFolderName(props.Department);
        const munFolder = override ? override.mun : toFolderName(props.Municipality);
        // Search text: municipality + province + department (accent-stripped)
        const searchText = `${props.Municipality} ${props.Province} ${props.Department}`
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
        index[pcode] = {
            name: props.Municipality,
            department: props.Department,
            province: props.Province,
            pcode,
            deptFolder,
            munFolder,
            hasDistritos: CAPITAL_PCODES.has(pcode),
            searchText,
            feature
        };
    });
    return index;
}

// Get datamun file paths for a municipality
function getMunicipalityPaths(pcode) {
    const cfg = municipalitiesIndex[pcode];
    if (!cfg) return null;
    const base = `datamun/${cfg.deptFolder}/${cfg.munFolder}`;
    const suffix = cfg.munFolder;
    return {
        municipio: `${base}/municipio_alcalde_${suffix}.geojson`,
        recintos: `${base}/recintos_alcalde_${suffix}.geojson`,
        distritos: `${base}/distritos_alcalde_${suffix}.geojson`,
    };
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
        return { color: CONFIG.neutral, weight: 1, opacity: 0.5, fillOpacity: 0.3 };
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
        return { radius, fillColor, color: 'transparent', weight: 0, opacity: 0, fillOpacity };
    } else {
        const { color, fillOpacity } = getColorByWinner(properties);
        return { fillColor: color, weight: 1.5, opacity: 0.8, color: 'white', fillOpacity };
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
                    return L.circleMarker(latlng, getFeatureStyle(feature));
                } catch (e) {
                    return L.circleMarker(latlng, { radius: 5, fillColor: CONFIG.neutral, color: '#fff', weight: 1, opacity: 0.5, fillOpacity: 0.3 });
                }
            },
            style: (feature) => {
                try {
                    const style = getFeatureStyle(feature);
                    const { radius, ...polygonStyle } = style;
                    return polygonStyle;
                } catch (e) {
                    return { color: CONFIG.neutral, weight: 1, opacity: 0.5, fillOpacity: 0.3 };
                }
            },
            onEachFeature: (feature, layer) => {
                try {
                    const properties = feature.properties;
                    if (properties) {
                        layer.bindTooltip(getFeatureName(properties), {
                            permanent: false, direction: 'auto', className: 'custom-tooltip'
                        });
                    }
                    if (properties && properties.votos_totales) {
                        layer.bindPopup(createPopupContent(properties));
                    }
                    if (layer.setRadius) layer._originalRadius = layer.options.radius;

                    layer.on('mouseover', function () {
                        if (!this.isPopupOpen()) {
                            this.setStyle({ weight: 2.5, opacity: 1, fillOpacity: 0.9 });
                            if (this.setRadius && this._originalRadius) this.setRadius(this._originalRadius * 1.3);
                        }
                    });
                    layer.on('mouseout', function () {
                        try {
                            geoJsonLayer.resetStyle(this);
                            if (this.setRadius && this._originalRadius) this.setRadius(this._originalRadius);
                        } catch (e) { /* ignore */ }
                    });
                    layer.on('popupopen', function () {
                        try {
                            geoJsonLayer.resetStyle(this);
                            if (this.setRadius && this._originalRadius) this.setRadius(this._originalRadius);
                        } catch (e) { /* ignore */ }
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
    return L.divIcon({ html: svg, className: 'pie-chart-marker', iconSize: [size, size], iconAnchor: [r, r], popupAnchor: [0, -r] });
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
                            permanent: false, direction: 'auto', className: 'custom-tooltip'
                        });
                        if (properties.votos_totales) {
                            layer.bindPopup(createPopupContent(properties));
                        }
                    }
                } catch (e) { /* ignore */ }
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
    if (loader) loader.style.display = 'none';
}

// Show a brief toast notification
function showToast(message) {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('toast-visible');
    clearTimeout(toast._hideTimeout);
    toast._hideTimeout = setTimeout(() => toast.classList.remove('toast-visible'), 2500);
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
            hideLoader();
            return;
        }
        currentGeoJsonLayer = newLayer.addTo(map);
        updateLegend();
        currentLayer = layerKey;
        hideLoader();
    } catch (error) {
        console.error(`Error switching to layer ${layerKey}:`, error);
        hideLoader();
    }
}

// Update legend
function updateLegend() {
    const legendDiv = document.getElementById('legend');
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

    legendDiv.innerHTML = `
        <div class="legend-header">
            <div class="legend-title">Partidos (%)</div>
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
async function loadPartiesData(pcode, detectedPartyKeys) {
    const csvName = CAPITAL_CSV_NAMES[pcode] || null;
    if (csvName) {
        try {
            const response = await fetch('datamun/data-partidos.csv');
            const text = await response.text();
            const lines = text.trim().split('\n');
            for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].split(',');
                const municipio = parts[0];
                const partido = parts[1];
                const candidato = parts[2];
                const color = parts[3];
                const img = (parts[4] || '').trim();
                if (!partido || municipio !== csvName) continue;
                CONFIG.partiesData[partido] = { candidato, color, img: img ? `fotos-candidatos/${img}` : '' };
                CONFIG.partyColors[partido] = color;
            }
        } catch (e) {
            console.error('Error loading parties data:', e);
        }
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
async function loadTotals(pcode) {
    const paths = getMunicipalityPaths(pcode);
    if (!paths) return [];
    try {
        const data = await fetch(paths.municipio).then(r => r.json());
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
function updateLayerPaths(pcode) {
    const paths = getMunicipalityPaths(pcode);
    if (!paths) return;
    CONFIG.layers.recintos = paths.recintos;
    CONFIG.layers.recintosPie = paths.recintos;  // same file, different rendering
    CONFIG.layers.distritos = paths.distritos;
}

// Load municipality boundary polygon
async function loadBoundary(pcode) {
    if (currentBoundaryLayer) {
        map.removeLayer(currentBoundaryLayer);
        currentBoundaryLayer = null;
    }
    const paths = getMunicipalityPaths(pcode);
    if (!paths) return;
    try {
        const data = await fetch(paths.municipio).then(r => r.json());
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

// Add Bolivia overview polygon layer
function addBoliviaLayer(geojsonData) {
    boliviaLayer = L.geoJSON(geojsonData, {
        style: {
            fillColor: '#2196F3',
            fillOpacity: 0.06,
            color: '#90CAF9',
            weight: 0.8,
            opacity: 0.8
        },
        onEachFeature: (feature, layer) => {
            const props = feature.properties;
            const pcode = props.ADM3_PCODE;
            layer.bindTooltip(props.Municipality, {
                permanent: false,
                direction: 'auto',
                className: 'custom-tooltip'
            });
            layer.on('mouseover', function () {
                if (currentParty) {
                    const partyPcodes = new Set(partyMunicipalitiesMap[currentParty] || []);
                    if (!partyPcodes.has(pcode)) return;
                    this.setStyle({ fillOpacity: 0.9, weight: 2, color: 'white' });
                } else {
                    this.setStyle({ fillOpacity: 0.22, color: '#1565C0', weight: 1.5 });
                }
            });
            layer.on('mouseout', function () {
                if (currentParty) {
                    const partyPcodes = new Set(partyMunicipalitiesMap[currentParty] || []);
                    if (!partyPcodes.has(pcode)) return;
                    updateBoliviaLayerStyle();
                } else if (boliviaLayer) {
                    boliviaLayer.resetStyle(this);
                }
            });
            layer.on('click', () => {
                if (currentParty) {
                    const partyPcodes = new Set(partyMunicipalitiesMap[currentParty] || []);
                    if (!partyPcodes.has(pcode)) return;
                }
                selectMunicipality(pcode);
            });
        }
    }).addTo(map);
}

// ---- Search UI ----

function openSearchDropdown() {
    document.getElementById('search-results').style.display = 'block';
}

function closeSearchDropdown() {
    document.getElementById('search-results').style.display = 'none';
}

function renderSearchResults(query) {
    const resultsDiv = document.getElementById('search-results');
    if (!query || query.length < 2) {
        resultsDiv.innerHTML = '';
        closeSearchDropdown();
        return;
    }
    const q = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    let entries = Object.values(municipalitiesIndex);
    if (currentParty && partyMunicipalitiesMap[currentParty]) {
        const partySet = new Set(partyMunicipalitiesMap[currentParty]);
        entries = entries.filter(e => partySet.has(e.pcode));
    }
    const startsWith = entries.filter(e => e.searchText.startsWith(q));
    const contains = entries.filter(e => !e.searchText.startsWith(q) && e.searchText.includes(q));
    const results = [...startsWith, ...contains].slice(0, 10);

    if (results.length === 0) {
        resultsDiv.innerHTML = '<div class="search-no-results">Sin resultados</div>';
        openSearchDropdown();
        return;
    }

    resultsDiv.innerHTML = results.map(r => `
        <div class="search-result-item" data-pcode="${r.pcode}">
            <span class="search-result-name">${r.name}</span>
            <span class="search-result-dept">${r.department}</span>
        </div>
    `).join('');
    openSearchDropdown();

    resultsDiv.querySelectorAll('.search-result-item').forEach(el => {
        el.addEventListener('click', () => {
            const pcode = el.dataset.pcode;
            document.getElementById('municipality-search').value = municipalitiesIndex[pcode]?.name || '';
            closeSearchDropdown();
            selectMunicipality(pcode);
        });
    });
}

// Handle municipality selection from search or map click
function selectMunicipality(pcode) {
    const cfg = municipalitiesIndex[pcode];
    if (!cfg) return;
    document.getElementById('municipality-search').value = cfg.name;
    closeSearchDropdown();
    document.getElementById('party-search-wrapper').style.display = 'none';
    switchMunicipality(pcode);
}

// Reset to Bolivia overview (or party view if a party is still selected)
function resetToBolivia() {
    if (currentGeoJsonLayer) { map.removeLayer(currentGeoJsonLayer); currentGeoJsonLayer = null; }
    if (currentBoundaryLayer) { map.removeLayer(currentBoundaryLayer); currentBoundaryLayer = null; }
    geoJsonData = {};
    CONFIG.partyColors = {}; CONFIG.partiesData = {}; CONFIG.totals = {};
    currentMunicipality = null;
    if (boliviaLayer) boliviaLayer.addTo(map);
    document.getElementById('layer-select-wrapper').style.display = 'none';
    document.getElementById('layer-select').value = 'recintos';
    document.getElementById('controls-subtitle').textContent = 'Bolivia - Subnacionales 2026';
    document.getElementById('party-search-wrapper').style.display = '';

    if (currentParty) {
        updateBoliviaLayerStyle();
        showPartyLegend();
        document.getElementById('legend').style.display = '';
    } else {
        updateBoliviaLayerStyle();
        document.getElementById('legend').style.display = 'none';
    }
    map.flyTo([-16.5, -65.0], 6, { duration: 1.2 });
}

// Switch to a new municipality — orchestrates all data loading
async function switchMunicipality(pcode) {
    const cfg = municipalitiesIndex[pcode];
    if (!cfg) return;

    // Clear current layers
    if (currentGeoJsonLayer) { map.removeLayer(currentGeoJsonLayer); currentGeoJsonLayer = null; }
    if (currentBoundaryLayer) { map.removeLayer(currentBoundaryLayer); currentBoundaryLayer = null; }

    // Hide Bolivia overview layer while viewing municipality
    if (boliviaLayer) map.removeLayer(boliviaLayer);

    // Clear cache
    geoJsonData = {};
    CONFIG.partyColors = {}; CONFIG.partiesData = {}; CONFIG.totals = {};

    // Load totals (also detects party keys)
    const detectedParties = await loadTotals(pcode);

    // No data available — notify user and return to Bolivia overview
    if (detectedParties.length === 0) {
        if (boliviaLayer) boliviaLayer.addTo(map);
        showToast(`Sin datos para ${cfg.name}`);
        document.getElementById('municipality-search').value = '';
        return;
    }

    // Load party colors/data
    await loadPartiesData(pcode, detectedParties);

    // Update layer file paths
    updateLayerPaths(pcode);

    // Load boundary
    await loadBoundary(pcode);

    // Show/hide distritos option based on whether this municipality has distritos
    const distritosOption = document.querySelector('#layer-select option[value="distritos"]');
    if (distritosOption) {
        distritosOption.style.display = cfg.hasDistritos ? '' : 'none';
    }

    // Fly to municipality
    let flyDone;
    if (CAPITAL_COORDS[pcode]) {
        const zoom = window.innerWidth <= 768 ? CAPITAL_ZOOM[pcode].m : CAPITAL_ZOOM[pcode].d;
        map.flyTo(CAPITAL_COORDS[pcode], zoom, { duration: 1.2 });
        flyDone = new Promise(resolve => map.once('moveend', resolve));
    } else {
        // Fit to the municipality polygon bounds
        try {
            const bounds = L.geoJSON(cfg.feature).getBounds();
            map.flyToBounds(bounds, { padding: [30, 30], duration: 1.2 });
            flyDone = new Promise(resolve => map.once('moveend', resolve));
        } catch (e) {
            flyDone = Promise.resolve();
        }
    }

    // Show controls and update subtitle
    document.getElementById('layer-select-wrapper').style.display = '';
    document.getElementById('legend').style.display = '';
    document.getElementById('controls-subtitle').textContent = `Alcaldía de ${cfg.name} 2026`;

    // Reset layer select (to recintos, or keep current if valid for this municipality)
    const layerSelect = document.getElementById('layer-select');
    if (layerSelect.value === 'distritos' && !cfg.hasDistritos) {
        layerSelect.value = 'recintos';
    }

    currentMunicipality = pcode;

    // Wait for fly animation before loading data layer
    await flyDone;
    await switchLayer(layerSelect.value || 'recintos');
}

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

// Close search dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrapper')) {
        closeSearchDropdown();
    }
});

// ── PARTY MODE FUNCTIONS ─────────────────────────────────────────────

function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

function buildPartyGlobalColors(csvText) {
    const colors = {};
    const lines = csvText.trim().split('\n');
    for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',');
        const partido = parts[1]?.trim();
        const color = parts[3]?.trim();
        if (partido && color && !colors[partido]) colors[partido] = color;
    }
    return colors;
}

function normMunDept(s) {
    return s.toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .trim()
        .replace(/\s+/g, '_');
}

function matchPartiesToPcodes(rawData) {
    const lookup = {};
    for (const pcode in municipalitiesIndex) {
        const cfg = municipalitiesIndex[pcode];
        lookup[normMunDept(cfg.name) + '|' + normMunDept(cfg.department)] = pcode;
    }
    const result = {};
    for (const entry of rawData) {
        const key = normMunDept(entry.municipio) + '|' + normMunDept(entry.departamento);
        const pcode = lookup[key] || PARTY_MUN_OVERRIDES[key];
        if (!pcode) continue;
        if (!result[entry.partido]) result[entry.partido] = [];
        result[entry.partido].push(pcode);
    }
    return result;
}

function getPartyGlobalColor(party) {
    if (partyGlobalColors[party]) return partyGlobalColors[party];
    let hash = 0;
    for (let i = 0; i < party.length; i++) hash = party.charCodeAt(i) + ((hash << 5) - hash);
    const hue = ((hash % 360) + 360) % 360;
    return `hsl(${hue}, 55%, 45%)`;
}

function populatePartySelect(partyMap) {
    const select = document.getElementById('party-select');
    if (!select) return;
    const parties = Object.keys(partyMap)
        .sort((a, b) => partyMap[b].length - partyMap[a].length);
    parties.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        select.appendChild(opt);
    });
}

function updateBoliviaLayerStyle() {
    if (!boliviaLayer) return;
    const partyPcodes = currentParty
        ? new Set(partyMunicipalitiesMap[currentParty] || [])
        : null;
    boliviaLayer.eachLayer(layer => {
        if (!partyPcodes) {
            layer.setStyle({
                fillColor: '#2196F3', fillOpacity: 0.06,
                color: '#90CAF9', weight: 0.8, opacity: 0.8
            });
        } else {
            const pcode = layer.feature.properties.ADM3_PCODE;
            if (partyPcodes.has(pcode)) {
                layer.setStyle({
                    fillColor: getPartyGlobalColor(currentParty),
                    fillOpacity: 0.75,
                    color: 'white', weight: 1.5, opacity: 0.9
                });
            } else {
                layer.setStyle({
                    fillColor: '#9aa5b1', fillOpacity: 0.04,
                    color: '#c8d0d8', weight: 0.4, opacity: 0.5
                });
            }
        }
    });
}

function showPartyLegend() {
    if (!currentParty) return;
    const legendDiv = document.getElementById('legend');
    const pcodes = partyMunicipalitiesMap[currentParty] || [];
    const color = getPartyGlobalColor(currentParty);
    const bgChip = hexToRgba(color, 0.13);
    const borderChip = hexToRgba(color, 0.35);
    const bgHover = hexToRgba(color, 0.25);

    const municipalities = pcodes
        .map(pcode => {
            const cfg = municipalitiesIndex[pcode];
            return cfg ? { pcode, name: cfg.name, department: cfg.department } : null;
        })
        .filter(Boolean)
        .sort((a, b) => a.department.localeCompare(b.department, 'es') || a.name.localeCompare(b.name, 'es'));

    const chipsHTML = municipalities.map(m => `
        <button class="party-chip" data-pcode="${m.pcode}"
            style="background:${bgChip};border-color:${borderChip};"
            onmouseover="this.style.background='${bgHover}'"
            onmouseout="this.style.background='${bgChip}'">
            <span class="party-chip-name">${m.name}</span>
            <span class="party-chip-dept">${m.department.slice(0, 3).toUpperCase()}</span>
        </button>
    `).join('');

    legendDiv.innerHTML = `
        <div class="legend-header">
            <div style="display:flex;align-items:center;gap:7px;min-width:0;overflow:hidden;">
                <div style="width:11px;height:11px;border-radius:50%;background:${color};flex-shrink:0;"></div>
                <div class="legend-title" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${currentParty}</div>
            </div>
            <button class="legend-toggle" aria-label="Colapsar">${legendCollapsed ? '▲' : '▼'}</button>
        </div>
        <div class="legend-body">
            <div class="party-mun-count">${pcodes.length} municipio${pcodes.length !== 1 ? 's' : ''} ganado${pcodes.length !== 1 ? 's' : ''} <span style="color:#7a8fa6;font-weight:500;">(${((pcodes.length / Object.keys(municipalitiesIndex).length) * 100).toFixed(1)}%)</span></div>
            <div class="party-chips-container">${chipsHTML}</div>
        </div>
    `;

    if (legendCollapsed) legendDiv.classList.add('legend-collapsed');
    else legendDiv.classList.remove('legend-collapsed');

    legendDiv.querySelectorAll('.party-chip[data-pcode]').forEach(chip => {
        chip.addEventListener('click', () => selectMunicipality(chip.dataset.pcode));
    });
}

function selectParty(party) {
    currentParty = party;
    currentMunicipality = null;

    if (currentGeoJsonLayer) { map.removeLayer(currentGeoJsonLayer); currentGeoJsonLayer = null; }
    if (currentBoundaryLayer) { map.removeLayer(currentBoundaryLayer); currentBoundaryLayer = null; }
    geoJsonData = {};
    CONFIG.partyColors = {}; CONFIG.partiesData = {}; CONFIG.totals = {};

    if (boliviaLayer) boliviaLayer.addTo(map);
    map.flyTo([-16.5, -65.0], 6, { duration: 1.0 });
    updateBoliviaLayerStyle();

    document.getElementById('legend').style.display = '';
    showPartyLegend();
    document.getElementById('layer-select-wrapper').style.display = 'none';
    document.getElementById('controls-subtitle').textContent = 'Bolivia - Subnacionales 2026';
    document.getElementById('municipality-search').value = '';
    closeSearchDropdown();
}

function clearParty() {
    currentParty = null;
    const sel = document.getElementById('party-select');
    if (sel) sel.value = '';
    updateBoliviaLayerStyle();
    if (!currentMunicipality) document.getElementById('legend').style.display = 'none';
}

// Initialize — load municipios.geojson, show Bolivia overview
async function init() {
    document.getElementById('layer-select-wrapper').style.display = 'none';
    document.getElementById('legend').style.display = 'none';

    try {
        const response = await fetch('datamun/municipios.geojson');
        if (!response.ok) throw new Error('Failed to load municipios.geojson');
        const geojsonData = await response.json();
        municipalitiesIndex = buildMunicipalitiesIndex(geojsonData.features);
        addBoliviaLayer(geojsonData);
    } catch (e) {
        console.error('Error loading municipios.geojson:', e);
    }

    // Load party winners data + global party colors
    try {
        const [csvRes, jsonRes] = await Promise.all([
            fetch('datamun/data-partidos.csv'),
            fetch('datamun/partidos_ganadores.json')
        ]);
        const csvText = await csvRes.text();
        partyGlobalColors = buildPartyGlobalColors(csvText);
        const rawPartyData = await jsonRes.json();
        partyMunicipalitiesMap = matchPartiesToPcodes(rawPartyData);
        populatePartySelect(partyMunicipalitiesMap);
    } catch (e) {
        console.error('Error loading party data:', e);
    }
}

// Search input wiring (script is at bottom of body, DOM is already ready)
const searchInput = document.getElementById('municipality-search');
if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        if (!val) {
            closeSearchDropdown();
            if (currentMunicipality) resetToBolivia();
        } else {
            // Show party search only if no party is active; otherwise stay filtered
            if (!currentParty) {
                document.getElementById('party-search-wrapper').style.display = '';
            }
            renderSearchResults(val);
        }
    });
    searchInput.addEventListener('focus', (e) => {
        if (e.target.value.trim().length >= 2) renderSearchResults(e.target.value.trim());
    });
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const first = document.querySelector('.search-result-item');
            if (first) first.click();
        }
        if (e.key === 'Escape') {
            closeSearchDropdown();
            searchInput.blur();
        }
    });
}

// Party select event
const partySelect = document.getElementById('party-select');
if (partySelect) {
    partySelect.addEventListener('change', (e) => {
        if (e.target.value) {
            selectParty(e.target.value);
        } else {
            clearParty();
        }
    });
}

init();
