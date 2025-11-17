// ========================================
// MAP SETUP
// ========================================
const map = L.map('map', {
    preferCanvas: true
}).setView([32.95, -96.85], 10);

const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
}).addTo(map);

// Layer group for schools - no clustering so all charts always display
const schoolLayerGroup = L.layerGroup();
map.addLayer(schoolLayerGroup);

// County boundaries GeoJSON layer (expects tx-counties.geojson in same folder)
let countiesLayer = null;

// Track selected county
let selectedCountyLayer = null;
let selectedCountyTooltip = null;

// Only show these counties
const wantedCounties = ['Dallas County', 'Collin County', 'Denton County', 'Tarrant County', 'Rockwall County'];

// Color palette for counties (different color for each of the 5 counties)
const countyColors = [
    'rgba(255, 200, 200, 0.3)',  // Light red - Dallas
    'rgba(200, 255, 200, 0.3)',  // Light green - Collin
    'rgba(200, 200, 255, 0.3)',  // Light blue - Denton
    'rgba(255, 255, 200, 0.3)',  // Light yellow - Tarrant
    'rgba(255, 200, 255, 0.3)',  // Light magenta - Rockwall
];

const countyColorMap = new Map(); // Map county name to color

// Layer control
const baseMaps = {
    'OpenStreetMap': osmLayer
};

// Layer control will be updated after counties are loaded
let layerControl = null;

// Legend for marker colors
const legendControl = L.control({ position: 'bottomright' });

legendControl.onAdd = function () {
    const div = L.DomUtil.create('div', 'legend-control');
    div.innerHTML = `
        <div><strong>School type</strong></div>
        <div class="legend-item">
            <div class="legend-swatch public"></div><span>Public</span>
        </div>
        <div class="legend-item">
            <div class="legend-swatch private"></div><span>Private</span>
        </div>
        <div class="legend-item">
            <div class="legend-swatch charter"></div><span>Charter</span>
        </div>
    `;
    return div;
};

legendControl.addTo(map);

// ========================================
// DATA + FILTER STATE
// ========================================
let schools = [];
let yearKeys = [];
const markers = []; // {school, marker, iconEl}
let GLOBAL_MAX = 0; // Maximum NMSF value across all schools and years

// ========================================
// UTILITIES
// ========================================
function parseCoords(c) {
    const [lat, lng] = String(c).split(',').map(Number);
    return [lat, lng];
}

function normalizeSector(raw) {
    if (!raw) return 'public';
    const s = raw.toLowerCase();
    if (s.includes('charter')) return 'public charter';
    if (s.includes('private')) return 'private';
    return 'public';
}

// ========================================
// ZOOM-BASED SIZING
// ========================================
function maxHeightForZoom(z) {
    // Reduced heights to prevent overlap - scale down significantly
    if (z >= 19) return 120;
    if (z === 18) return 100;
    if (z === 17) return 85;
    if (z === 16) return 70;
    if (z === 15) return 60;
    if (z === 14) return 50;
    if (z === 13) return 40;
    if (z === 12) return 35;
    if (z === 11) return 30;
    if (z === 10) return 25;
    if (z === 9) return 20;
    return 15;
}

function barWidthForZoom(z) {
    // Narrower bars - as narrow as possible but still clickable (minimum 8px)
    if (z >= 19) return 10;
    if (z === 18) return 9;
    if (z === 17) return 9;
    if (z === 16) return 8;
    if (z === 15) return 8;
    if (z === 14) return 8;
    if (z === 13) return 8;
    if (z === 12) return 8;
    if (z === 11) return 8;
    if (z === 10) return 8;
    if (z <= 9) return 8;
    return 8;
}

function getSectorColorClass(sector) {
    if (sector === 'private') return 'sector-private';
    if (sector === 'public charter') return 'sector-charter';
    return 'sector-public';
}

// ========================================
// FILTERS
// ========================================
function getActiveYears() {
    return yearKeys.filter(y => {
        const cb = document.querySelector(`.year-filter[value="${y}"]`);
        return cb && cb.checked;
    });
}

function getActiveSectors() {
    return Array.from(document.querySelectorAll('.sector-filter:checked')).map(cb => cb.value);
}

function getMinTotal() {
    const slider = document.getElementById('minTotal');
    return slider ? Number(slider.value) : 0;
}

function updateMinTotalLabel() {
    const slider = document.getElementById('minTotal');
    const label = document.getElementById('minTotalLabel');
    if (slider && label) {
        label.textContent = slider.value;
    }
}

function passesFilters(school) {
    const activeYears = getActiveYears();
    if (activeYears.length === 0) return false;

    const activeSectors = getActiveSectors();
    if (!activeSectors.includes(school.sector)) return false;

    let total = 0;
    activeYears.forEach(y => {
        total += school.counts[y] || 0;
    });

    const minTotal = getMinTotal();
    if (total < minTotal) return false;
    if (total === 0) return false;

    return true;
}

function applyFilters() {
    schoolLayerGroup.clearLayers();
    markers.forEach(({ marker, school }) => {
        if (passesFilters(school)) {
            schoolLayerGroup.addLayer(marker);
        }
    });
    updateBarsForFilters();
}

// ========================================
// CHART HTML GENERATION
// ========================================
function makeSchoolHTML(school, idx) {
    const sectorClass = getSectorColorClass(school.sector);
    const bars = yearKeys.map(year => {
        const count = school.counts[year] || 0;
        return `
            <div class="nmsf-bar-wrap" data-year="${year}">
                <div class="nmsf-hover-label">${year}: ${count} NMSF</div>
                <div class="nmsf-bar ${sectorClass}" data-school="${idx}" data-year="${year}"></div>
            </div>
        `;
    }).join('');
    
    return `
        <div class="nmsf-wrapper" data-school="${idx}">
            <div class="nmsf-chart">
                ${bars}
            </div>
            <div class="nmsf-label">${school.name}</div>
        </div>
    `;
}

function refreshIconElements() {
    markers.forEach(({ marker }, idx) => {
        if (marker._icon) {
            markers[idx].iconEl = marker._icon;
        }
    });
}

function updateBarsForZoom() {
    refreshIconElements();
    const z = map.getZoom();
    const maxH = maxHeightForZoom(z);
    const barW = barWidthForZoom(z);
    
    markers.forEach(({ school, iconEl }, idx) => {
        if (!iconEl) return;
        const bars = iconEl.querySelectorAll(`.nmsf-bar[data-school="${idx}"]`);
        bars.forEach(bar => {
            const year = bar.getAttribute('data-year');
            const val = school.counts[year] || 0;
            bar.style.height = Math.max(4, (val / GLOBAL_MAX) * maxH) + 'px';
            bar.style.width = barW + 'px';
        });
    });
}

function updateBarsForFilters() {
    refreshIconElements();
    const activeYears = getActiveYears();
    const activeYearsSet = new Set(activeYears);
    
    markers.forEach(({ iconEl }) => {
        if (!iconEl) return;
        const barWraps = iconEl.querySelectorAll('.nmsf-bar-wrap');
        barWraps.forEach(wrap => {
            const year = wrap.getAttribute('data-year');
            const bar = wrap.querySelector('.nmsf-bar');
            if (activeYearsSet.has(year)) {
                wrap.style.display = '';
                bar.classList.remove('hidden');
            } else {
                wrap.style.display = 'none';
                bar.classList.add('hidden');
            }
        });
    });
}

// ========================================
// BUILD MARKERS
// ========================================
function buildMarkers() {
    markers.length = 0; // Clear existing markers
    
    schools.forEach((school, index) => {
        const html = makeSchoolHTML(school, index);
        const icon = L.divIcon({
            className: 'nmsf-marker',
            html,
            iconSize: [1, 1],
            iconAnchor: [0, 0]
        });
        
        const marker = L.marker(school.coords, { icon });
        marker._schoolData = school;
        
        // Simple popup with school info
        marker.bindPopup(`
            <div>
                <div style="font-weight:bold; font-size:15px;">${school.name}</div>
                <div style="margin-top:4px;">${school.rawSector}</div>
            </div>
        `);
        
        markers.push({ school, marker, iconEl: null });
        schoolLayerGroup.addLayer(marker);
    });
    
    // Store icon elements after markers are added
    markers.forEach(({ marker }) => {
        if (marker._icon) {
            const idx = markers.findIndex(m => m.marker === marker);
            if (idx >= 0) {
                markers[idx].iconEl = marker._icon;
            }
        }
    });
    
    // Initial update
    updateBarsForZoom();
    updateBarsForFilters();
}

// ========================================
// FILTER UI INITIALIZATION
// ========================================
function initYearFilters() {
    const container = document.getElementById('yearFilters');
    if (!container) return;

    container.innerHTML = '';

    // Show most recent year first
    const sortedYears = [...yearKeys].sort().reverse();

    sortedYears.forEach(year => {
        const label = document.createElement('label');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'year-filter';
        cb.value = year;
        cb.checked = true;

        label.appendChild(cb);
        label.appendChild(document.createTextNode(' ' + year));
        container.appendChild(label);
        container.appendChild(document.createElement('br'));
    });

    // Attach listeners
    container.querySelectorAll('.year-filter').forEach(cb => {
        cb.addEventListener('change', () => {
            applyFilters();
            updateBarsForFilters();
        });
    });
}

function initSectorFilters() {
    document.querySelectorAll('.sector-filter').forEach(cb => {
        cb.addEventListener('change', () => {
            applyFilters();
        });
    });
}

function initMinTotalSlider(maxTotal) {
    const slider = document.getElementById('minTotal');
    if (!slider) return;
    slider.max = String(maxTotal);
    slider.value = '0';
    updateMinTotalLabel();

    slider.addEventListener('input', () => {
        updateMinTotalLabel();
        applyFilters();
    });
}

// ========================================
// LOAD DATA
// ========================================
function clearCountySelection() {
    if (selectedCountyLayer) {
        selectedCountyLayer.setStyle({
            fillColor: 'transparent',
            fillOpacity: 0,
            color: 'transparent',  // Hide boundary line
            weight: 0
        });
        selectedCountyLayer = null;
    }
    if (selectedCountyTooltip) {
        map.removeLayer(selectedCountyTooltip);
        selectedCountyTooltip = null;
    }
}

async function loadCountyBoundaries() {
    try {
        const response = await fetch('tx-counties.geojson');
        if (!response.ok) {
            console.warn('Could not load tx-counties.geojson');
            return;
        }
        const geojson = await response.json();
        
        // Initialize color map for wanted counties
        wantedCounties.forEach((countyName, index) => {
            countyColorMap.set(countyName, countyColors[index]);
        });
        
        countiesLayer = L.geoJSON(geojson, {
            filter: (feature) => {
                // Only include wanted counties
                const countyName = feature.properties.COUNTY;
                return wantedCounties.includes(countyName);
            },
            style: {
                color: 'transparent',  // Hide boundary lines by default
                weight: 0,
                fill: false,
                fillOpacity: 0
            },
            onEachFeature: (feature, layer) => {
                const countyName = feature.properties.COUNTY;
                const color = countyColorMap.get(countyName);
                
                layer.on('click', (e) => {
                    L.DomEvent.stopPropagation(e);
                    
                    // If clicking the same county, deselect it
                    if (selectedCountyLayer === layer) {
                        clearCountySelection();
                        return;
                    }
                    
                    // Clear previous selection
                    clearCountySelection();
                    
                    // Select this county - show boundary line and shade
                    layer.setStyle({
                        fillColor: color,
                        fillOpacity: 0.4,
                        color: '#333',
                        weight: 2
                    });
                    selectedCountyLayer = layer;
                    
                    // Show county name
                    const center = layer.getBounds().getCenter();
                    selectedCountyTooltip = L.tooltip({
                        permanent: true,
                        direction: 'center',
                        className: 'county-tooltip'
                    })
                    .setContent('<strong style="font-size:14px;">' + countyName.replace(' County', '') + '</strong>')
                    .setLatLng(center)
                    .addTo(map);
                    
                    layer.bringToFront();
                });
            }
        });
        
        countiesLayer.addTo(map);
        
        // Update layer control
        if (!layerControl) {
            const overlayMaps = {
                'School markers': schoolLayerGroup,
                'County boundaries': countiesLayer
            };
            layerControl = L.control.layers(baseMaps, overlayMaps).addTo(map);
        }
        
        // Clear selection when clicking on map (not on county)
        map.on('click', () => {
            clearCountySelection();
        });
    } catch (err) {
        console.warn('Error loading tx-counties.geojson:', err);
    }
}

async function loadSchoolData() {
    try {
        const response = await fetch('nmsf-data.json');
        if (!response.ok) throw new Error('Failed to load nmsf-data.json');

        const raw = await response.json();

        // Determine year fields dynamically from first record
        const sample = raw[0] || {};
        yearKeys = Object.keys(sample)
            .filter(k => /^\d{4}$/.test(k))
            .sort(); // ascending

        schools = raw.map(d => {
            const sector = normalizeSector(d['private-public']);

            const counts = {};
            yearKeys.forEach(y => {
                counts[y] = Number(d[y]) || 0;
            });

            return {
                name: d['Name'],
                coords: parseCoords(d['Coords']),
                rawSector: d['private-public'],
                sector,
                counts
            };
        });

        // Calculate global max for consistent scaling
        const allVals = [];
        schools.forEach(s => {
            yearKeys.forEach(y => {
                allVals.push(s.counts[y] || 0);
            });
        });
        GLOBAL_MAX = Math.max.apply(null, allVals.length > 0 ? allVals : [1]);

        // Initialize filters based on data
        initYearFilters();
        initSectorFilters();

        const maxTotal = Math.max(
            0,
            ...schools.map(s =>
                yearKeys.reduce((sum, y) => sum + (s.counts[y] || 0), 0)
            )
        );
        initMinTotalSlider(maxTotal);

        // Build markers and apply initial filters
        buildMarkers();
        applyFilters();
        
        // Update icon elements after a short delay to ensure they're rendered
        setTimeout(() => {
            markers.forEach(({ marker }, idx) => {
                if (marker._icon) {
                    markers[idx].iconEl = marker._icon;
                }
            });
            updateBarsForZoom();
            updateBarsForFilters();
        }, 100);
    } catch (err) {
        console.error('Error loading school data:', err);
    }
}

// ========================================
// ZOOM EVENT HANDLERS
// ========================================
const zoomEl = document.getElementById('zoom-level');
function updateZoomLabel() {
    if (zoomEl) {
        zoomEl.textContent = 'Zoom: ' + map.getZoom();
    }
}

map.on('zoomend', () => {
    updateZoomLabel();
    updateBarsForZoom();
});

// Also update when zooming starts for smoother experience
map.on('zoom', () => {
    updateZoomLabel();
    updateBarsForZoom();
});

// Update bars when map view changes (for any marker visibility updates)
map.on('moveend', () => {
    updateBarsForZoom();
    updateBarsForFilters();
});

// ========================================
// STARTUP
// ========================================
map.whenReady(() => {
    // Ensure bars are updated when map is ready
    updateZoomLabel();
    setTimeout(() => {
        updateBarsForZoom();
        updateBarsForFilters();
    }, 200);
});

loadSchoolData();
loadCountyBoundaries();
