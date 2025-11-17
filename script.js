// ========================================
// MAP SETUP
// ========================================
const map = L.map('map', {
    preferCanvas: true
}).setView([32.95, -96.85], 10);

const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
}).addTo(map);

// Marker cluster group for schools
const clusterGroup = L.markerClusterGroup({
    disableClusteringAtZoom: 15
});
map.addLayer(clusterGroup);

// County boundaries GeoJSON layer (expects tx-counties.geojson in same folder)
let countiesLayer = L.geoJSON(null, {
    style: {
        color: '#555',
        weight: 1,
        fill: false
    }
});

// Layer control
const baseMaps = {
    'OpenStreetMap': osmLayer
};

const overlayMaps = {
    'School markers': clusterGroup,
    'County boundaries': countiesLayer
};

L.control.layers(baseMaps, overlayMaps).addTo(map);

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
const markers = [];
const popupCharts = {};

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

function makeSectorIcon(sector) {
    let className = 'school-marker';
    if (sector === 'private') {
        className += ' sector-private';
    } else if (sector === 'public charter') {
        className += ' sector-charter';
    } else {
        className += ' sector-public';
    }

    return L.divIcon({
        className,
        iconSize: [18, 18]
    });
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
    clusterGroup.clearLayers();
    markers.forEach(marker => {
        const school = marker._schoolData;
        if (passesFilters(school)) {
            clusterGroup.addLayer(marker);
        }
    });
}

// ========================================
// POPUP + CHART
// ========================================
function getChartIdForSchool(school) {
    return school.chartId;
}

function buildPopupHTML(school) {
    const activeYears = getActiveYears();
    const yearsToShow = activeYears.length ? activeYears : yearKeys;

    const rows = yearsToShow.map(y =>
        `${y}: ${school.counts[y] ?? 0}`
    ).join('<br>');

    return `
        <div>
            <div style="font-weight:bold; font-size:15px;">
                ${school.name}
            </div>
            <div style="margin-top:4px;">
                ${school.rawSector}
            </div>
            <hr>
            <div>${rows}</div>
            <div class="popup-chart-wrapper">
                <canvas id="${school.chartId}"></canvas>
            </div>
        </div>
    `;
}

function renderPopupChart(school) {
    const chartId = getChartIdForSchool(school);
    const canvas = document.getElementById(chartId);
    if (!canvas) return;

    const activeYears = getActiveYears();
    const yearsToShow = activeYears.length ? activeYears : yearKeys;
    if (yearsToShow.length === 0) return;

    const data = yearsToShow.map(y => school.counts[y] || 0);

    if (popupCharts[chartId]) {
        popupCharts[chartId].destroy();
    }

    popupCharts[chartId] = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: yearsToShow,
            datasets: [{
                label: 'NMSF',
                data: data
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: { ticks: { autoSkip: false } },
                y: { beginAtZero: true, precision: 0 }
            }
        }
    });
}

// When popup opens, render the chart for that school
map.on('popupopen', function (e) {
    const marker = e.popup._source;
    const school = marker._schoolData;
    if (!school) return;
    renderPopupChart(school);
});

// ========================================
// BUILD MARKERS
// ========================================
function buildMarkers() {
    schools.forEach((school, index) => {
        const marker = L.marker(school.coords, {
            icon: makeSectorIcon(school.sector)
        });

        school.chartId = `chart-${index}`;
        marker._schoolData = school;
        marker.bindPopup(buildPopupHTML(school));

        markers.push(marker);
        clusterGroup.addLayer(marker);
    });
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
async function loadCountyBoundaries() {
    try {
        const response = await fetch('tx-counties.geojson');
        if (!response.ok) {
            console.warn('Could not load tx-counties.geojson');
            return;
        }
        const geojson = await response.json();
        countiesLayer.addData(geojson);
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
    } catch (err) {
        console.error('Error loading school data:', err);
    }
}

// ========================================
// STARTUP
// ========================================
loadSchoolData();
loadCountyBoundaries();
