// Configuration
const CONFIG = {
    partyColors: {},   // populated from data-partidos.csv
    partiesData: {},   // { partido: { candidato, color, img } }
    neutral: '#E8E8E8',
    layers: {
        recintos: 'data/recintos_alcalde_cb.geojson',
        recintosPie: 'data/recintos_alcalde_cb.geojson',
        circunscripciones: 'data/circunscripciones_alcalde_cb.geojson',
        distritos: 'data/distritos_alcalde_cb.geojson'
    },
    layerNames: {
        recintos: 'Recintos (ganador)',
        recintosPie: 'Recintos (top 3)',
        circunscripciones: 'Circunscripciones',
        distritos: 'Distritos'
    }
};

// Map initialization
const map = L.map('map', {
    zoomControl: false,
    minZoom: 10
}).setView([-17.3935, -66.1570], window.innerWidth <= 768 ? 11 : 12);

// Agregar control de zoom en la esquina superior derecha
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
let currentLayer = 'recintos';
let currentGeoJsonLayer = null;
let geoJsonData = {};
let currentPartyFilter = null;

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
    // Recintos - nombre del establecimiento
    if (properties.NombreRecinto) return properties.NombreRecinto;
    if (properties.recinto) return `Recinto ${properties.recinto}`;

    // Municipios - dar prioridad a Municipality
    if (properties.Municipality) return properties.Municipality;
    if (properties.NombreMunicipio) return properties.NombreMunicipio;

    // Departamentos
    if (properties.NombreDepartamento) return properties.NombreDepartamento;
    if (properties.Department) return properties.Department;
    if (properties.department) return properties.department;

    // Circunscripciones - formato "C-##"
    if (properties.Circun) return `Circunscripción - ${properties.Circun}`;
    if (properties.circunscripcion) return `Circunscripción - ${properties.circunscripcion}`;

    // Distritos - formato "Ciudad - Distrito ##"
    if (properties.nombreciud && properties.distrito) {
        return `${properties.nombreciud} - Distrito ${properties.distrito}`;
    }
    if (properties.nombreciud) return properties.nombreciud;

    // Áreas urbano/rural - formato "Nombre - Tipo"
    if (properties.name && properties.area_tipo) {
        return `${properties.name} - ${properties.area_tipo}`;
    }
    if (properties.name) return properties.name;

    // Fallback a cualquier propiedad que contenga "nombre" o "name"
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

    const partyKeys = ['FRI', 'SOLUCIONES-CON-TODOS', 'PATRIA-UNIDOS', 'A-UPP', 'LIBRE',
        'PDC', 'NGP', 'MTS', 'APB-SUMATE', 'UNIDOS-'];
    const partyVotes = partyKeys
        .map(k => ({ key: k, votes: properties[k] || 0 }))
        .filter(p => p.votes > 0)
        .sort((a, b) => b.votes - a.votes);

    const partyRowsHTML = partyVotes.map(({ key, votes }) => {
        const pct = properties[`pct_${key}`] || 0;
        const pd = CONFIG.partiesData[key] || {};
        const color = pd.color || CONFIG.partyColors[key] || '#888';
        const img = pd.img || '';
        const candidato = pd.candidato || '';
        const isWinner = key === ganador;
        const photoHTML = img
            ? `<img src="${img}" style="width:20px;height:20px;border-radius:50%;object-fit:cover;border:1.5px solid ${color};flex-shrink:0;" onerror="this.style.display='none'">`
            : `<span style="display:inline-block;width:20px;height:20px;border-radius:50%;background:${color};flex-shrink:0;"></span>`;
        return `
            <div class="popup-row" style="${isWinner ? 'font-weight:700;' : ''}">
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
                    <div style="font-size:11px;opacity:0.9;">${ganador} · ${formatPct(pct_ganador)}%</div>
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

    // Skip features without vote data
    if (!properties || !properties.votos_totales) {
        return {
            color: CONFIG.neutral,
            weight: 1,
            opacity: 0.5,
            fillOpacity: 0.3
        };
    }

    if (feature.geometry.type === 'Point') {
        // Points (recintos) - scale by votos_totales using 7 groups
        const votosTotales = properties.votos_totales || 0;
        let radius, fillColor, fillOpacity, sizeBase;
        if (currentPartyFilter) {
            fillColor = CONFIG.partyColors[currentPartyFilter] || '#888';
            fillOpacity = 0.75;
            sizeBase = properties[currentPartyFilter] || 0;
        } else {
            const result = getColorByWinner(properties);
            fillColor = result.color;
            fillOpacity = result.fillOpacity;
            sizeBase = votosTotales;
        }

        if (sizeBase <= 2000) radius = 2.5;
        else if (sizeBase <= 3000) radius = 4.0;
        else if (sizeBase <= 4000) radius = 5.5;
        else if (sizeBase <= 5000) radius = 7.0;
        else if (sizeBase <= 6000) radius = 8.5;
        else if (sizeBase <= 7000) radius = 10.0;
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
        // Polygons (other layers)
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
                if (!props || !(props.votos_totales > 0)) return false;
                if (currentPartyFilter) return (props[currentPartyFilter] || 0) > 0;
                return true;
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
                    // Remove radius for polygons
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

                    // Add tooltip with name on hover
                    if (properties) {
                        const name = getFeatureName(properties);
                        layer.bindTooltip(name, {
                            permanent: false,
                            direction: 'auto',
                            className: 'custom-tooltip'
                        });
                    }

                    // Only add popups for features with data
                    if (properties && properties.votos_totales) {
                        layer.bindPopup(createPopupContent(properties));
                    }

                    // Store original radius for points
                    if (layer.setRadius) {
                        layer._originalRadius = layer.options.radius;
                    }

                    // Add hover effect
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

                    // Reset style when popup opens
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
    const partyKeys = ['FRI', 'SOLUCIONES-CON-TODOS', 'PATRIA-UNIDOS', 'A-UPP', 'LIBRE',
        'PDC', 'NGP', 'MTS', 'APB-SUMATE', 'UNIDOS-'];
    const total = properties.votos_totales || 1;

    const slices = partyKeys
        .map(k => ({ color: CONFIG.partyColors[k], votes: properties[k] || 0 }))
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

// Load GeoJSON data
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

// Load and display layer
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

        geoJsonLayer = layerKey === 'recintosPie'
            ? createRecintosPieLayer(geoJsonData[layerKey])
            : createGeoJsonLayer(geoJsonData[layerKey]);

        if (!geoJsonLayer) {
            console.error(`Failed to create layer: ${layerKey}`);
            hideLoader();
            return;
        }

        currentGeoJsonLayer = geoJsonLayer.addTo(map);

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

    const allParties = Object.keys(CONFIG.partyColors);

    // When party filter active: show only that party swatch
    const swatchesHTML = (layerKey === 'recintos' && currentPartyFilter) ? (() => {
        const pd = CONFIG.partiesData[currentPartyFilter] || {};
        const color = pd.color || CONFIG.partyColors[currentPartyFilter] || '#888';
        const img = pd.img || '';
        const candidato = pd.candidato || '';
        const photoHTML = img
            ? `<img src="${img}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;border:2px solid ${color};" onerror="this.style.display='none'">`
            : `<div style="width:40px;height:40px;border-radius:50%;background:${color};"></div>`;
        return `
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
                ${photoHTML}
                <div>
                    <div style="font-size:12px;font-weight:700;color:#2c3e50;">${currentPartyFilter}</div>
                    <div style="font-size:11px;color:#5a6c7d;">${candidato}</div>
                </div>
            </div>
            <div style="font-size:10px;color:#5a6c7d;font-style:italic;">
                Tamaño proporcional a votos del partido
            </div>
        `;
    })() : allParties.map(party => {
        const pd = CONFIG.partiesData[party] || {};
        const color = pd.color || CONFIG.partyColors[party] || '#888';
        const img = pd.img || '';
        const candidato = pd.candidato || '';
        const photoHTML = img
            ? `<img src="${img}" style="width:30px;height:30px;border-radius:50%;object-fit:cover;border:2px solid ${color};flex-shrink:0;" onerror="this.style.display='none'">`
            : `<div style="width:30px;height:30px;border-radius:50%;background:${color};flex-shrink:0;"></div>`;
        return `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                ${photoHTML}
                <div>
                    <div style="font-size:11px;font-weight:700;color:#2c3e50;line-height:1.2;">${party}</div>
                    <div style="font-size:10px;color:#5a6c7d;line-height:1.2;">${candidato}</div>
                </div>
            </div>
        `;
    }).join('');

    const legendTitle = layerKey === 'recintosPie'
        ? 'Partidos por recinto'
        : (layerKey === 'recintos' && currentPartyFilter)
            ? currentPartyFilter
            : 'Partido ganador';

    const sizeLegendHTML = (layerKey === 'recintos' || layerKey === 'recintosPie') ? `
        <div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(224,230,237,0.7);">
            <div style="font-size:10px;font-weight:600;color:#2c3e50;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">
                Tamaño por votos totales
            </div>
            <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:2px;">
                <div style="display:flex;flex-direction:column;align-items:center;flex:1;">
                    <svg width="10" height="10"><circle cx="5" cy="5" r="2.5" fill="#999" opacity="0.7"/></svg>
                    <span style="font-size:8px;color:#666;margin-top:2px;">&lt;2K</span>
                </div>
                <div style="display:flex;flex-direction:column;align-items:center;flex:1;">
                    <svg width="14" height="14"><circle cx="7" cy="7" r="4" fill="#999" opacity="0.7"/></svg>
                    <span style="font-size:8px;color:#666;margin-top:2px;">&lt;3K</span>
                </div>
                <div style="display:flex;flex-direction:column;align-items:center;flex:1;">
                    <svg width="18" height="18"><circle cx="9" cy="9" r="5.5" fill="#999" opacity="0.7"/></svg>
                    <span style="font-size:8px;color:#666;margin-top:2px;">&lt;4K</span>
                </div>
                <div style="display:flex;flex-direction:column;align-items:center;flex:1;">
                    <svg width="22" height="22"><circle cx="11" cy="11" r="7" fill="#999" opacity="0.7"/></svg>
                    <span style="font-size:8px;color:#666;margin-top:2px;">&lt;5K</span>
                </div>
                <div style="display:flex;flex-direction:column;align-items:center;flex:1;">
                    <svg width="26" height="26"><circle cx="13" cy="13" r="8.5" fill="#999" opacity="0.7"/></svg>
                    <span style="font-size:8px;color:#666;margin-top:2px;">&lt;6K</span>
                </div>
                <div style="display:flex;flex-direction:column;align-items:center;flex:1;">
                    <svg width="30" height="30"><circle cx="15" cy="15" r="10" fill="#999" opacity="0.7"/></svg>
                    <span style="font-size:8px;color:#666;margin-top:2px;">&lt;7K</span>
                </div>
                <div style="display:flex;flex-direction:column;align-items:center;flex:1;">
                    <svg width="36" height="36"><circle cx="18" cy="18" r="12" fill="#999" opacity="0.7"/></svg>
                    <span style="font-size:8px;color:#666;margin-top:2px;">7K+</span>
                </div>
            </div>
        </div>
    ` : '';

    legendDiv.innerHTML = `
        <div class="legend-title">${legendTitle}</div>
        ${swatchesHTML}
        ${sizeLegendHTML}
    `;
}

// Load party/candidate data from CSV
async function loadPartiesData() {
    try {
        const response = await fetch('data/data-partidos.csv');
        const text = await response.text();
        const lines = text.trim().split('\n');
        for (let i = 1; i < lines.length; i++) {
            const [partido, candidato, color, img] = lines[i].split(',');
            if (!partido) continue;
            CONFIG.partiesData[partido] = { candidato, color, img: `fotos-candidatos/${img}` };
            CONFIG.partyColors[partido] = color;
        }
    } catch (e) {
        console.error('Error loading parties data:', e);
    }
}

// Load permanent Cochabamba boundary
function loadBoundary() {
    fetch('data/cochabamba_municipio.geojson')
        .then(r => r.json())
        .then(data => {
            L.geoJSON(data, {
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
        })
        .catch(e => console.error('Error loading boundary:', e));
}

const partySelect = document.getElementById('party-select');

// Event listener for layer selection
document.getElementById('layer-select').addEventListener('change', (e) => {
    const layerKey = e.target.value;
    const partyWrapper = document.getElementById('party-filter-wrapper');
    if (layerKey === 'recintos') {
        partyWrapper.style.display = '';
    } else {
        partyWrapper.style.display = 'none';
        currentPartyFilter = null;
        partySelect.value = '';
    }
    switchLayer(layerKey);
});

// Event listener for party filter
partySelect.addEventListener('change', (e) => {
    currentPartyFilter = e.target.value || null;
    switchLayer('recintos');
});

// Initialize: load party data first, then render
async function init() {
    await loadPartiesData();
    // Populate party select from loaded data
    Object.keys(CONFIG.partyColors).forEach(party => {
        const opt = document.createElement('option');
        opt.value = party;
        opt.textContent = party;
        partySelect.appendChild(opt);
    });
    loadBoundary();
    switchLayer('recintos');
}
init();
