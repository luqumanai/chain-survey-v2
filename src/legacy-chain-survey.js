import { auth, db } from './firebase.js';
import {
    collection, doc, setDoc, getDoc, getDocs, query, where, updateDoc, arrayUnion
} from 'firebase/firestore';

export class ChainSurveyConverter {
    constructor() {
        this.map = null;
        this.plotLayer = null;
        this.coordinates = [];
        this.traverseData = [];
        this.currentEditRow = null;
        this.currentGeorefPoint = null;
        this.currentMapLayer = null;
        this.georeferenceMatrix = null;
        this.currentUser = null;
        this.mapLayers = {};
        this.editPointMode = false;
        this.gcpClickMode = false;
        this.gcpClickCount = 0;
        this.firstGCPClickPoint = null;
        this.legSeqCounter = 1; // the static first row in the HTML is always leg #1
        
        this.conversionFactors = {
            links: 0.201168,
            chains: 20.1168,
            feet: 0.3048,
            meters: 1
        };
        
        this.init();
    }

    init() {
        // proj4 only knows generic WGS84 (plain lat/long) out of the box -
        // UTM Zone 43N is a specific real-world projection that has to be
        // defined explicitly before it can be used for conversions.
        if (typeof proj4 !== 'undefined') {
            proj4.defs('EPSG:32643', '+proj=utm +zone=43 +datum=WGS84 +units=m +no_defs');
        }
        this.initMap();
        this.bindEvents();
        this.addInitialRow();
        this.updateDistancePlaceholders();
        this.applyRolePermissions();
        this.showMessage('Application loaded successfully!', 'success');
    }

    // A Viewer can open and look at anything shared with them, but
    // shouldn't be able to overwrite a project - so the Save button
    // gets disabled for that role specifically.
    applyRolePermissions() {
        const role = window.currentUserRole;
        const saveBtn = document.getElementById('saveProjectBtn');
        if (role === 'viewer') {
            saveBtn.disabled = true;
            saveBtn.title = 'Viewers cannot save changes';
        } else {
            saveBtn.disabled = false;
            saveBtn.title = '';
        }
    }

    getSelectedCRS() {
        const el = document.getElementById('crsSelect');
        return el ? el.value : 'local';
    }

    // Converts a real latitude/longitude into this app's local working
    // X/Y, based on whichever coordinate system is currently selected.
    // Returns null if the selected system has no real-world conversion
    // available yet.
    latLngToLocalXY(lat, lng) {
        const crs = this.getSelectedCRS();
        if (crs === 'utm43n' && typeof proj4 !== 'undefined') {
            const [x, y] = proj4('EPSG:4326', 'EPSG:32643', [lng, lat]); // proj4 takes [lng, lat]
            return { x, y };
        }
        if (crs === 'geographic') {
            // Degrees used directly as the working plane. Note: this
            // doesn't mix meaningfully with meter-based leg distances -
            // it's here mainly so imported lat/long isn't silently lost.
            return { x: lng, y: lat };
        }
        return null; // 'local' and 'custom' have no real-world conversion yet
    }

    // The reverse: local working X/Y back into a real latitude/longitude,
    // for showing points correctly on a real-world map layer.
    localXYToLatLng(x, y) {
        const crs = this.getSelectedCRS();
        if (crs === 'utm43n' && typeof proj4 !== 'undefined') {
            const [lng, lat] = proj4('EPSG:32643', 'EPSG:4326', [x, y]);
            return { lat, lng };
        }
        if (crs === 'geographic') {
            return { lat: y, lng: x };
        }
        return null;
    }

    // Same precedence the map uses: an explicit lat/long (from a GCP
    // transform or an imported anchor) wins; otherwise derive it from
    // the selected coordinate system if possible. Returns null if no
    // real-world position can be determined at all - callers should
    // treat that as "can't export this in a real-world format," not
    // silently fall back to local meters.
    getExportLatLng(coord) {
        if (coord.latitude != null && coord.longitude != null && !isNaN(coord.latitude) && !isNaN(coord.longitude)) {
            return { lat: coord.latitude, lng: coord.longitude };
        }
        return this.localXYToLatLng(coord.x, coord.y);
    }

    initMap() {
        this.createMapInstance(L.CRS.Simple, [0, 0], 16);
        this.setupMapLayers();
        this.addCoordinateGrid();
        this.plotLayer = L.layerGroup().addTo(this.map);
        this.attachMapClickHandler();
    }

    // Leaflet's coordinate system (CRS) is fixed when a map is created -
    // there's no supported way to change it on a live instance. Simple
    // Plot mode needs CRS.Simple (treats local meters as flat pixels);
    // real map layers (OSM/Satellite/Terrain) need the standard
    // CRS.EPSG3857 that real tile servers use. Crossing between the two
    // means the whole map instance has to be torn down and rebuilt.
    createMapInstance(crs, center, zoom) {
        // CRS.Simple treats 1 local meter as 1 pixel at zoom 0 - a survey
        // spanning a couple thousand meters needs to zoom out well past
        // that to fit on screen, which the default zoom range doesn't
        // allow. zoomSnap: 0.25 also lets it settle on a precise fit
        // instead of only whole zoom steps.
        const isSimple = crs === L.CRS.Simple;
        this.map = L.map('mapContainer', {
            center, zoom, crs, layers: [],
            minZoom: isSimple ? -15 : 2,
            zoomSnap: 0.25
        });

        L.control.scale({ position: 'bottomleft', metric: true, imperial: false }).addTo(this.map);

        const coordControl = L.control({ position: 'bottomleft' });
        coordControl.onAdd = () => {
            const div = L.DomUtil.create('div', 'mouse-coord-display');
            div.textContent = isSimple ? 'X: -   Y: -' : 'Lat: -   Lon: -';
            return div;
        };
        coordControl.addTo(this.map);

        this.map.on('mousemove', (e) => {
            const el = document.querySelector('.mouse-coord-display');
            if (!el) return;
            // Our own local convention (matching how plotShape draws
            // points): coord.x maps to lat, coord.y maps to lng.
            el.textContent = isSimple
                ? `X: ${e.latlng.lat.toFixed(2)}   Y: ${e.latlng.lng.toFixed(2)}`
                : `Lat: ${e.latlng.lat.toFixed(6)}   Lon: ${e.latlng.lng.toFixed(6)}`;
        });
    }

    attachMapClickHandler() {
        this.map.on('click', (e) => {
            if (this.editPointMode) {
                this.handleMapClickForPointEdit(e);
            } else if (this.gcpClickMode) {
                this.handleMapClickForGCPAdd(e);
            }
        });
    }

    // Finds whichever plotted point is closest to a map click, measured
    // in actual screen pixels - this works correctly no matter which map
    // layer is active (Simple Plot's local meters, or OSM/Satellite's
    // real lat/lng), unlike comparing the raw coordinate values directly.
    findClosestPlottedPointToClick(clickLatLng) {
        const clickPixel = this.map.latLngToContainerPoint(clickLatLng);
        let closest = null;
        let minPixelDist = Infinity;

        this.coordinates.forEach((coord, idx) => {
            const pos = this.getPlotPosition(coord);
            if (!pos) return;
            const pointPixel = this.map.latLngToContainerPoint(pos);
            const dist = clickPixel.distanceTo(pointPixel);
            if (dist < minPixelDist) {
                minPixelDist = dist;
                closest = idx;
            }
        });

        return { closest, minPixelDist };
    }

    handleMapClickForPointEdit(e) {
        const { closest, minPixelDist } = this.findClosestPlottedPointToClick(e.latlng);

        if (closest !== null && minPixelDist < 40) {
            this.editCoordinates(closest);
        } else {
            this.showMessage('No point near click. Click closer to a point.', 'error');
        }
    }

    handleMapClickForGCPAdd(e) {
        const { closest, minPixelDist } = this.findClosestPlottedPointToClick(e.latlng);

        if (closest !== null && minPixelDist < 40) {
            if (this.gcpClickCount === 0) {
                this.firstGCPClickPoint = this.coordinates[closest];
                this.gcpClickCount++;
                this.showMessage(`First GCP selected (X: ${this.firstGCPClickPoint.x.toFixed(2)}, Y: ${this.firstGCPClickPoint.y.toFixed(2)})`, 'success');
            } else {
                // Second point clicked - open modal
                document.getElementById('gcpClickSurveyX').value = this.firstGCPClickPoint.x.toFixed(3);
                document.getElementById('gcpClickSurveyY').value = this.firstGCPClickPoint.y.toFixed(3);
                document.getElementById('gcpClickModal').style.display = 'block';
                this.gcpClickMode = false;
                this.gcpClickCount = 0;
            }
        } else {
            this.showMessage('Click on a point on the plot', 'error');
        }
    }

    setupMapLayers() {
        this.mapLayers.simple = L.layerGroup().addTo(this.map);
        this.currentMapLayer = 'simple';

        this.mapLayers.osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap',
            maxZoom: 19,
            minZoom: 0
        });

        this.mapLayers.satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: '© Esri',
            maxZoom: 18,
            minZoom: 0
        });

        this.mapLayers.terrain = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenTopoMap',
            maxZoom: 17,
            minZoom: 0
        });
    }

    addCoordinateGrid() {
        const gridLayer = L.layerGroup();
        
        for (let x = -1000; x <= 1000; x += 100) {
            L.polyline([[x, -1000], [x, 1000]], {
                color: '#e0e0e0',
                weight: 1,
                opacity: 0.5
            }).addTo(gridLayer);
        }
        
        for (let y = -1000; y <= 1000; y += 100) {
            L.polyline([[-1000, y], [1000, y]], {
                color: '#e0e0e0',
                weight: 1,
                opacity: 0.5
            }).addTo(gridLayer);
        }
        
        gridLayer.addTo(this.map);
        this.gridLayer = gridLayer;
    }

    bindEvents() {
        // Traverse leg events
        document.getElementById('addLegBtn').addEventListener('click', () => this.addLeg());
        document.getElementById('calculateBtn').addEventListener('click', () => this.calculatePlot());
        document.getElementById('adjustClosureBtn').addEventListener('click', () => this.adjustClosure());
        
        // Map controls
        document.getElementById('zoomFitBtn').addEventListener('click', () => this.fitToView());
        document.getElementById('fullExtentBtn').addEventListener('click', () => this.fitToFullExtent());
        document.getElementById('mapFullscreenBtn').addEventListener('click', () => this.toggleMapFullscreen());
        document.getElementById('toggleLabelsBtn').addEventListener('click', () => this.toggleLabels());
        document.getElementById('toggleGridBtn').addEventListener('click', () => this.toggleGrid());
        document.getElementById('toggleMapLayerBtn').addEventListener('click', () => this.toggleMapLayerSelector());
        document.getElementById('getCurrentLocation').addEventListener('click', () => this.getCurrentLocation());
        document.getElementById('editPointBtn').addEventListener('click', () => this.toggleEditPointMode());

        // Panel hide/show
        document.getElementById('hideLeftPanelBtn').addEventListener('click', () => this.toggleLeftPanel());
        document.getElementById('showLeftPanelBtn').addEventListener('click', () => this.toggleLeftPanel());
        document.getElementById('hideBottomPanelBtn').addEventListener('click', () => this.toggleBottomPanel());

        // Map layer switching
        document.querySelectorAll('input[name="mapType"]').forEach(radio => {
            radio.addEventListener('change', (e) => this.switchMapLayer(e.target.value));
        });

        // Export events
        document.getElementById('exportCSV').addEventListener('click', () => this.exportCSV());
        document.getElementById('exportGeoJSON').addEventListener('click', () => this.exportGeoJSON());
        document.getElementById('exportKML').addEventListener('click', () => this.exportKML());
        document.getElementById('exportSHP').addEventListener('click', () => this.exportShapefile());
        document.getElementById('exportDXF').addEventListener('click', () => this.exportDXF());
        document.getElementById('exportPDF').addEventListener('click', () => this.exportPDF());

        // Save/Load events
        document.getElementById('saveProjectBtn').addEventListener('click', () => this.saveProject());
        document.getElementById('loadProjectBtn').addEventListener('click', () => this.loadProject());
        document.getElementById('listProjectsBtn').addEventListener('click', () => this.listProjects());
        document.getElementById('shareProjectBtn').addEventListener('click', () => this.shareProject());
        document.getElementById('projectSelect').addEventListener('change', (e) => this.selectProjectToLoad(e.target.value));

        // Import/Export events
        document.getElementById('importFile').addEventListener('change', (e) => this.handleFileImport(e));
        document.getElementById('importBtn').addEventListener('click', () => this.importData());
        document.getElementById('downloadTemplateBtn').addEventListener('click', () => this.downloadTemplate());

        // Georeference events
        document.getElementById('addGCPBtn').addEventListener('click', () => this.addGCP());
        document.getElementById('mapClickGCPBtn').addEventListener('click', () => this.toggleGCPClickMode());
        document.getElementById('calculateGeoreferenceBtn').addEventListener('click', () => this.calculateGeoreference());

        // Modal events - Edit Traverse
        const editModal = document.getElementById('editModal');
        const editClose = editModal.querySelector('.close');
        editClose.onclick = () => { editModal.style.display = 'none'; };
        
        document.getElementById('saveEdit').addEventListener('click', () => this.saveEdit());
        document.getElementById('cancelEdit').addEventListener('click', () => this.cancelEdit());

        // Modal events - Edit Georeference
        const georefModal = document.getElementById('georefModal');
        const georefClose = georefModal.querySelector('.close');
        georefClose.onclick = () => { georefModal.style.display = 'none'; };
        
        document.getElementById('saveGeorefEdit').addEventListener('click', () => this.saveGeorefEdit());
        document.getElementById('cancelGeorefEdit').addEventListener('click', () => { georefModal.style.display = 'none'; });

        // Modal events - GCP Click
        const gcpClickModal = document.getElementById('gcpClickModal');
        const gcpClickClose = gcpClickModal.querySelector('.close');
        gcpClickClose.onclick = () => { 
            gcpClickModal.style.display = 'none';
            this.gcpClickMode = false;
            this.gcpClickCount = 0;
        };
        
        document.getElementById('saveGCPClick').addEventListener('click', () => this.saveGCPClick());
        document.getElementById('cancelGCPClick').addEventListener('click', () => {
            gcpClickModal.style.display = 'none';
            this.gcpClickMode = false;
            this.gcpClickCount = 0;
        });

        // CRS change event
        document.getElementById('crsSelect').addEventListener('change', (e) => {
            const customDiv = document.getElementById('customCRS');
            customDiv.style.display = e.target.value === 'custom' ? 'block' : 'none';

            // Any imported anchor points, and any UTM-derived positions,
            // depend on which coordinate system is selected - recompute
            // everything now instead of showing stale positions.
            if (this.coordinates.length > 0) {
                this.calculatePlot();
            }
        });

        // Live preview on data entry
        document.addEventListener('change', (e) => {
            if (e.target.classList.contains('distance-input') || 
                e.target.classList.contains('bearing-input')) {
                this.updateLivePreview();
            }
        });

        // Live georeferencing: as soon as 4+ GCPs have valid values, keep
        // recalculating automatically on every edit - clicking the button
        // is no longer required (it's still there as an explicit action
        // that also shows a confirmation message).
        document.addEventListener('input', (e) => {
            if (e.target.classList.contains('gcp-survey-x') ||
                e.target.classList.contains('gcp-survey-y') ||
                e.target.classList.contains('gcp-real-lat') ||
                e.target.classList.contains('gcp-real-lng')) {
                clearTimeout(this.gcpAutoCalcTimer);
                this.gcpAutoCalcTimer = setTimeout(() => {
                    this.calculateGeoreference(true); // silent = no toast spam while typing
                }, 400);
            }
        });

        // Bearing boxes: digits only, and keep the hidden combined field
        // in sync with whatever fields the current format shows
        document.addEventListener('input', (e) => {
            const isDigitBearingBox =
                e.target.classList.contains('bearing-deg') ||
                e.target.classList.contains('bearing-min') ||
                e.target.classList.contains('bearing-sec') ||
                e.target.classList.contains('bearing-deg-q') ||
                e.target.classList.contains('bearing-min-q');

            if (isDigitBearingBox) {
                e.target.value = e.target.value.replace(/[^\d]/g, '');
            }

            if (isDigitBearingBox || e.target.classList.contains('bearing-decimal')) {
                const row = e.target.closest('tr');
                if (row) {
                    this.syncBearingHiddenField(row);
                    this.updateLivePreview();
                }
            }
        });

        // Quadrant N/S and E/W dropdowns
        document.addEventListener('change', (e) => {
            if (e.target.classList.contains('bearing-ns') || e.target.classList.contains('bearing-ew')) {
                const row = e.target.closest('tr');
                if (row) {
                    this.syncBearingHiddenField(row);
                    this.updateLivePreview();
                }
            }
        });

        // Switching Bearing Format rebuilds every row's bearing cell to
        // match, carrying over each row's existing value.
        document.getElementById('bearingFormat').addEventListener('change', () => {
            this.rebuildAllBearingCells();
        });

        // Switching Distance Unit updates the example placeholder shown
        // in every distance box, so it's clear which unit is expected.
        document.getElementById('distanceUnit').addEventListener('change', () => {
            this.updateDistancePlaceholders();
        });
    }

    updateDistancePlaceholders() {
        const examples = {
            links: '203.5',
            chains: '10.2',
            feet: '667',
            meters: '203.5'
        };
        const unit = document.getElementById('distanceUnit').value;
        const example = examples[unit] || '203.5';
        document.querySelectorAll('.distance-input').forEach(input => {
            input.placeholder = `${example} (${unit})`;
        });
    }

    toggleLeftPanel() {
        const leftPanel = document.getElementById('leftPanel');
        const mainContent = document.querySelector('.main-content');
        const showBtn = document.getElementById('showLeftPanelBtn');
        const hideBtn = document.getElementById('hideLeftPanelBtn');

        leftPanel.classList.toggle('hidden');
        mainContent.classList.toggle('left-hidden');
        
        if (leftPanel.classList.contains('hidden')) {
            showBtn.style.display = 'block';
            hideBtn.style.display = 'none';
        } else {
            showBtn.style.display = 'none';
            hideBtn.style.display = 'block';
        }

        // Leaflet caches the map's pixel size and has no way to know the
        // container just resized - the panel's CSS transition takes
        // 300ms, so wait for it to finish before telling Leaflet to
        // recheck, or it'll measure the size mid-animation.
        setTimeout(() => this.map.invalidateSize(), 320);
    }

    toggleBottomPanel() {
        const bottomPanel = document.getElementById('bottomPanel');
        const hideBtn = document.getElementById('hideBottomPanelBtn');

        bottomPanel.classList.toggle('hidden');
        
        if (bottomPanel.classList.contains('hidden')) {
            hideBtn.textContent = '▲';
        } else {
            hideBtn.textContent = '▼';
        }

        setTimeout(() => this.map.invalidateSize(), 320);
    }

    toggleEditPointMode() {
        this.editPointMode = !this.editPointMode;
        const btn = document.getElementById('editPointBtn');
        
        if (this.editPointMode) {
            btn.style.background = '#ff9800';
            this.showMessage('🔵 Edit Point Mode: Click a point on map to edit', 'success');
        } else {
            btn.style.background = '#17a2b8';
            this.showMessage('Edit Point Mode disabled', 'success');
        }
    }

    toggleGCPClickMode() {
        this.gcpClickMode = !this.gcpClickMode;
        this.gcpClickCount = 0;
        const btn = document.getElementById('mapClickGCPBtn');
        
        if (this.gcpClickMode) {
            btn.style.background = '#ff9800';
            this.showMessage('Click a point on the plot to select survey coordinates', 'success');
        } else {
            btn.style.background = '#17a2b8';
        }
    }

    saveGCPClick() {
        const lat = parseFloat(document.getElementById('gcpClickRealLat').value);
        const lng = parseFloat(document.getElementById('gcpClickRealLng').value);

        if (isNaN(lat) || isNaN(lng)) {
            this.showMessage('Please enter valid lat/long', 'error');
            return;
        }

        // Create a new GCP item
        const gcpList = document.getElementById('gcpList');
        const gcpCount = gcpList.children.length + 1;
        
        const gcpDiv = document.createElement('div');
        gcpDiv.className = 'gcp-item';
        gcpDiv.innerHTML = `
            <strong>GCP ${gcpCount}</strong>
            <input type="number" class="gcp-survey-x" placeholder="Survey X" step="any" value="${this.firstGCPClickPoint.x.toFixed(3)}" disabled>
            <input type="number" class="gcp-survey-y" placeholder="Survey Y" step="any" value="${this.firstGCPClickPoint.y.toFixed(3)}" disabled>
            <input type="number" class="gcp-real-lat" placeholder="Real Latitude" step="any" value="${lat}">
            <input type="number" class="gcp-real-lng" placeholder="Real Longitude" step="any" value="${lng}">
            <button onclick="chainSurvey.removeGCP(this)" style="background: #dc3545;">❌ Remove</button>
        `;
        gcpList.appendChild(gcpDiv);

        document.getElementById('gcpClickModal').style.display = 'none';
        document.getElementById('gcpClickRealLat').value = '';
        document.getElementById('gcpClickRealLng').value = '';
        
        this.showMessage(`GCP added: (${this.firstGCPClickPoint.x.toFixed(2)}, ${this.firstGCPClickPoint.y.toFixed(2)}) → (${lat}, ${lng})`, 'success');
    }

    /**
     * AUTOMATIC BEARING FORMAT CONVERSION
     * Input: "321530" (6 digits)
     * Output: "32°15'30"" (formatted)
     */
    formatBearingInput(input) {
        let value = input.value.replace(/[^\d]/g, '');
        
        if (value.length === 0) {
            input.value = '';
            return;
        }
        
        if (value.length <= 2) {
            input.value = value;
        } else if (value.length === 3) {
            input.value = value.slice(0, 2) + '°' + value.slice(2);
        } else if (value.length === 4) {
            input.value = value.slice(0, 2) + '°' + value.slice(2);
        } else if (value.length === 5) {
            input.value = value.slice(0, 2) + '°' + value.slice(2, 4) + "'" + value.slice(4);
        } else if (value.length >= 6) {
            const degrees = value.slice(0, 2);
            const minutes = value.slice(2, 4);
            const seconds = value.slice(4, 6);
            input.value = degrees + '°' + minutes + "'" + seconds + '"';
        }
    }

    parseBearing(bearingStr) {
        if (!bearingStr) return { degrees: 0, minutes: 0, seconds: 0 };

        bearingStr = bearingStr.trim();

        // Quadrant format, e.g. "N 32°15' E" or "S45°30'W"
        const quadMatch = bearingStr.match(/^([NS])\s*(\d+)[°d]?\s*(\d*)['\u2032]?\s*([EW])$/i);
        if (quadMatch) {
            const azimuth = this.quadrantToAzimuth(
                quadMatch[1].toUpperCase(),
                parseInt(quadMatch[2]) || 0,
                parseInt(quadMatch[3]) || 0,
                quadMatch[4].toUpperCase()
            );
            const degrees = Math.floor(azimuth);
            const minutes = Math.floor((azimuth - degrees) * 60);
            const seconds = Math.round(((azimuth - degrees) * 60 - minutes) * 60);
            return { degrees, minutes, seconds };
        }

        const dmsMatch = bearingStr.match(/(\d+)[°d](\d*)['\']?(\d*)[\""]?/i);
        if (dmsMatch) {
            return {
                degrees: parseInt(dmsMatch[1]) || 0,
                minutes: parseInt(dmsMatch[2]) || 0,
                seconds: parseInt(dmsMatch[3]) || 0
            };
        }

        const decimalMatch = bearingStr.match(/(\d+\.?\d*)/);
        if (decimalMatch) {
            const decimal = parseFloat(decimalMatch[1]);
            const degrees = Math.floor(decimal);
            const minutes = Math.floor((decimal - degrees) * 60);
            const seconds = Math.round(((decimal - degrees) * 60 - minutes) * 60);
            return { degrees, minutes, seconds };
        }

        return { degrees: 0, minutes: 0, seconds: 0 };
    }

    bearingToDecimal(degrees, minutes, seconds) {
        return degrees + (minutes / 60) + (seconds / 3600);
    }

    bearingToFormattedString(degrees, minutes, seconds) {
        return `${degrees}°${minutes}'${seconds}"`;
    }

    // Which bearing input style is currently selected in the dropdown.
    getBearingFormatMode() {
        const el = document.getElementById('bearingFormat');
        return el ? el.value : 'dms';
    }

    // Converts a quadrant bearing (e.g. N 32°15' E) into a standard
    // 0-360 azimuth in decimal degrees.
    quadrantToAzimuth(ns, degrees, minutes, ew) {
        const dm = degrees + minutes / 60;
        if (ns === 'N' && ew === 'E') return dm;
        if (ns === 'S' && ew === 'E') return 180 - dm;
        if (ns === 'S' && ew === 'W') return 180 + dm;
        return 360 - dm; // N...W
    }

    // The reverse: turns a 0-360 azimuth into quadrant notation parts.
    azimuthToQuadrant(azimuth) {
        let ns, ew, dm;
        if (azimuth <= 90) { ns = 'N'; ew = 'E'; dm = azimuth; }
        else if (azimuth <= 180) { ns = 'S'; ew = 'E'; dm = 180 - azimuth; }
        else if (azimuth <= 270) { ns = 'S'; ew = 'W'; dm = azimuth - 180; }
        else { ns = 'N'; ew = 'W'; dm = 360 - azimuth; }
        const degrees = Math.floor(dm);
        const minutes = Math.round((dm - degrees) * 60);
        return { ns, degrees, minutes, ew };
    }

    // Builds the bearing cell's HTML in whichever style is currently
    // selected. Whatever style is shown, the hidden ".bearing-input"
    // field always ends up holding a plain decimal string or a normal
    // "32°15'30"" string - so calculatePlot, save/load, import/export,
    // and the edit modal never need to know which style was used.
    // Bearing text legitimately contains a literal " character (the
    // arcseconds mark, e.g. 32°15'30"). Inserting that raw into an HTML
    // value="..." attribute closes the attribute early and corrupts the
    // whole row's markup. This makes it safe to insert.
    escapeHtmlAttr(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    bearingCellHTML(prefillBearingString) {
        const mode = this.getBearingFormatMode();
        let deg = 0, min = 0, sec = 0, decimal = 0;
        if (prefillBearingString) {
            const parsed = this.parseBearing(prefillBearingString);
            deg = parsed.degrees; min = parsed.minutes; sec = parsed.seconds;
            decimal = this.bearingToDecimal(deg, min, sec);
        }
        const hiddenValue = this.escapeHtmlAttr(prefillBearingString || '');

        if (mode === 'decimal') {
            const decStr = prefillBearingString ? decimal.toFixed(4) : '';
            return `<input type="text" class="bearing-decimal" placeholder="0-360" value="${decStr}" inputmode="decimal">°
                <input type="hidden" class="bearing-input" value="${hiddenValue}">`;
        }

        if (mode === 'quadrant') {
            let q = { ns: 'N', degrees: '', minutes: '', ew: 'E' };
            if (prefillBearingString) q = this.azimuthToQuadrant(decimal);
            return `<span class="bearing-group">
                <select class="bearing-ns">
                    <option ${q.ns === 'N' ? 'selected' : ''}>N</option>
                    <option ${q.ns === 'S' ? 'selected' : ''}>S</option>
                </select>
                <input type="text" class="bearing-deg-q" placeholder="DD" maxlength="2" value="${q.degrees}" inputmode="numeric">°
                <input type="text" class="bearing-min-q" placeholder="MM" maxlength="2" value="${q.minutes}" inputmode="numeric">'
                <select class="bearing-ew">
                    <option ${q.ew === 'E' ? 'selected' : ''}>E</option>
                    <option ${q.ew === 'W' ? 'selected' : ''}>W</option>
                </select>
            </span><input type="hidden" class="bearing-input" value="${hiddenValue}">`;
        }

        // Default: DMS, three boxes
        return `<span class="bearing-group">
            <input type="text" class="bearing-deg" placeholder="0-360" maxlength="3" value="${prefillBearingString ? deg : ''}" inputmode="numeric">°
            <input type="text" class="bearing-min" placeholder="MM" maxlength="2" value="${prefillBearingString ? min : ''}" inputmode="numeric">'
            <input type="text" class="bearing-sec" placeholder="SS" maxlength="2" value="${prefillBearingString ? sec : ''}" inputmode="numeric">"
        </span><input type="hidden" class="bearing-input" value="${hiddenValue}">`;
    }

    // Recombines whichever visible bearing fields a row has into the
    // hidden combined value, based on the currently selected format.
    syncBearingHiddenField(row) {
        const mode = this.getBearingFormatMode();
        const hidden = row.querySelector('.bearing-input');
        if (!hidden) return;

        if (mode === 'decimal') {
            const box = row.querySelector('.bearing-decimal');
            hidden.value = box && box.value.trim() !== '' ? box.value.trim() : '';
            return;
        }

        if (mode === 'quadrant') {
            const ns = row.querySelector('.bearing-ns');
            const ew = row.querySelector('.bearing-ew');
            const degBox = row.querySelector('.bearing-deg-q');
            const minBox = row.querySelector('.bearing-min-q');
            if (!ns || !ew || !degBox || !minBox) return;
            if (degBox.value === '' && minBox.value === '') {
                hidden.value = '';
                return;
            }
            const d = Math.min(90, Math.max(0, parseInt(degBox.value) || 0));
            const m = Math.min(59, Math.max(0, parseInt(minBox.value) || 0));
            const azimuth = this.quadrantToAzimuth(ns.value, d, m, ew.value);
            const degrees = Math.floor(azimuth);
            const minutes = Math.floor((azimuth - degrees) * 60);
            const seconds = Math.round(((azimuth - degrees) * 60 - minutes) * 60);
            hidden.value = `${degrees}°${String(minutes).padStart(2, '0')}'${String(seconds).padStart(2, '0')}"`;
            return;
        }

        // DMS mode
        const degBox = row.querySelector('.bearing-deg');
        const minBox = row.querySelector('.bearing-min');
        const secBox = row.querySelector('.bearing-sec');
        if (!degBox || !minBox || !secBox) return;
        if (degBox.value === '' && minBox.value === '' && secBox.value === '') {
            hidden.value = '';
            return;
        }
        const d = Math.min(360, Math.max(0, parseInt(degBox.value) || 0));
        const m = Math.min(59, Math.max(0, parseInt(minBox.value) || 0));
        const s = Math.min(59, Math.max(0, parseInt(secBox.value) || 0));
        hidden.value = `${d}°${String(m).padStart(2, '0')}'${String(s).padStart(2, '0')}"`;
    }

    // Rebuilds every row's bearing cell to match whichever format is
    // now selected, carrying over the value each row already had so
    // switching formats never loses data.
    rebuildAllBearingCells() {
        document.querySelectorAll('#traverseTable tbody tr').forEach(row => {
            const hidden = row.querySelector('.bearing-input');
            const currentValue = hidden ? hidden.value : '';
            const cell = hidden.closest('td');
            cell.innerHTML = this.bearingCellHTML(currentValue);
        });
    }

    // The table shows newest legs at the top for convenience, but a
    // traverse survey is inherently sequential - leg 5 continues from
    // wherever leg 4 ended. This always returns rows in their REAL
    // order (by creation sequence), never by visual position, so the
    // actual survey math is never affected by display order.
    getOrderedRows() {
        const rows = Array.from(document.querySelectorAll('#traverseTable tbody tr'));
        return rows.sort((a, b) => parseInt(a.dataset.legSeq) - parseInt(b.dataset.legSeq));
    }

    addLeg() {
        const tbody = document.querySelector('#traverseTable tbody');
        this.legSeqCounter++;
        const legSeq = this.legSeqCounter;
        
        const row = document.createElement('tr');
        row.dataset.legSeq = legSeq;
        row.innerHTML = `
            <td>${legSeq}</td>
            <td><input type="text" class="distance-input" placeholder="203.5"></td>
            <td>${this.bearingCellHTML('')}</td>
            <td>
                <button class="edit-btn" onclick="chainSurvey.editLeg(this)">✏️</button>
                <button class="delete-btn" onclick="chainSurvey.deleteLeg(this)">🗑️</button>
            </td>
        `;
        
        // Newest leg goes to the top of the table - with many rows, the
        // one you just added is always immediately visible.
        tbody.insertBefore(row, tbody.firstChild);
        this.updateLivePreview();
    }

    addInitialRow() {
        const tbody = document.querySelector('#traverseTable tbody');
        if (tbody.children.length === 1) {
            this.addLeg();
            this.addLeg();
            this.addLeg();
            
            const rows = this.getOrderedRows(); // true order: [leg1, leg2, leg3, leg4]
            if (rows.length >= 4) {
                rows[1].querySelector('.distance-input').value = '344';
                rows[2].querySelector('.distance-input').value = '516';
                rows[3].querySelector('.distance-input').value = '285';

                this.fillBearingBoxes(rows[1], 96, 0, 0);
                this.fillBearingBoxes(rows[2], 230, 0, 0);
                this.fillBearingBoxes(rows[3], 300, 0, 0);
            }
        }
    }

    // Fills a row's bearing cell (in whichever format is currently
    // selected) from a degrees/minutes/seconds value, and keeps the
    // hidden combined field in sync - used for demo data and for the
    // edit modal, so the cell never shows something different from
    // what's actually stored underneath.
    fillBearingBoxes(row, degrees, minutes, seconds) {
        const formatted = this.bearingToFormattedString(degrees, minutes, seconds);
        const cell = row.querySelector('.bearing-input').closest('td');
        cell.innerHTML = this.bearingCellHTML(formatted);
    }

    editLeg(button) {
        const row = button.closest('tr');
        this.currentEditRow = row;
        
        const distanceInput = row.querySelector('.distance-input');
        const bearingInput = row.querySelector('.bearing-input');
        
        document.getElementById('editDistance').value = distanceInput.value;
        
        const bearing = this.parseBearing(bearingInput.value);
        document.getElementById('editBearingDeg').value = bearing.degrees || 0;
        document.getElementById('editBearingMin').value = bearing.minutes || 0;
        document.getElementById('editBearingSec').value = bearing.seconds || 0;
        
        document.getElementById('editModal').style.display = 'block';
    }

    deleteLeg(button) {
        if (confirm('Are you sure you want to delete this leg?')) {
            const row = button.closest('tr');
            row.remove();
            this.updateLivePreview();
        }
    }

    saveEdit() {
        if (!this.currentEditRow) return;
        
        const distance = document.getElementById('editDistance').value;
        const degrees = parseInt(document.getElementById('editBearingDeg').value) || 0;
        const minutes = parseInt(document.getElementById('editBearingMin').value) || 0;
        const seconds = parseInt(document.getElementById('editBearingSec').value) || 0;
        
        const bearing = this.bearingToFormattedString(degrees, minutes, seconds);
        
        this.currentEditRow.querySelector('.distance-input').value = distance;
        this.fillBearingBoxes(this.currentEditRow, degrees, minutes, seconds);
        
        document.getElementById('editModal').style.display = 'none';
        this.currentEditRow = null;
        
        this.updateLivePreview();
        this.showMessage('Leg updated successfully', 'success');
    }

    cancelEdit() {
        document.getElementById('editModal').style.display = 'none';
        this.currentEditRow = null;
    }

    updateLivePreview() {
        const liveBox = document.getElementById('livePreviewBox');
        liveBox.innerHTML = '';
        
        const startX = parseFloat(document.getElementById('startX').value) || 0;
        const startY = parseFloat(document.getElementById('startY').value) || 0;
        
        const unit = document.getElementById('distanceUnit').value;
        const conversionFactor = this.conversionFactors[unit];
        
        let currentX = startX;
        let currentY = startY;
        let previewHTML = '';
        
        previewHTML += `
            <div class="preview-item active">
                <span><span class="preview-dot"></span>P0</span>
                <span>${currentX.toFixed(1)},${currentY.toFixed(1)}</span>
            </div>
        `;
        
        const rows = this.getOrderedRows(); // process legs in true survey order, never visual position
        
        rows.forEach((row, index) => {
            const distanceInput = row.querySelector('.distance-input');
            const bearingInput = row.querySelector('.bearing-input');
            
            if (!distanceInput.value || !bearingInput.value) {
                previewHTML += `
                    <div class="preview-item">
                        <span>P${index + 1}</span>
                        <span style="color: #999;">...</span>
                    </div>
                `;
                return;
            }
            
            const distance = parseFloat(distanceInput.value) * conversionFactor;
            const bearing = this.parseBearing(bearingInput.value);
            const bearingDecimal = this.bearingToDecimal(bearing.degrees, bearing.minutes, bearing.seconds);
            
            const bearingRad = (bearingDecimal * Math.PI) / 180;
            
            const deltaX = distance * Math.sin(bearingRad);
            const deltaY = distance * Math.cos(bearingRad);
            
            currentX += deltaX;
            currentY += deltaY;
            
            previewHTML += `
                <div class="preview-item active">
                    <span><span class="preview-line"></span>P${index + 1}</span>
                    <span>${currentX.toFixed(1)},${currentY.toFixed(1)}</span>
                </div>
            `;
        });
        
        liveBox.innerHTML = previewHTML;
        this.plotShapeRealTime();
    }

    plotShapeRealTime() {
        const layersToRemove = [];
        this.plotLayer.eachLayer(layer => {
            layersToRemove.push(layer);
        });
        layersToRemove.forEach(layer => this.plotLayer.removeLayer(layer));
        
        this.recalculateCoordinates();
        
        if (this.coordinates.length < 1) return;

        const positions = this.coordinates.map(coord => this.getPlotPosition(coord));
        if (positions.some(p => p === null)) {
            // Not georeferenced yet - fall back to local view instead of
            // plotting garbage on top of a real map.
            return;
        }
        
        this.coordinates.forEach((coord, index) => {
            const pos = positions[index];

            const marker = L.circleMarker(pos, {
                radius: 6,
                fillColor: index === 0 ? '#28a745' : '#ff6b6b',
                color: '#fff',
                weight: 2,
                fillOpacity: 0.8
            }).addTo(this.plotLayer);
            
            marker.bindPopup(`<strong>P${index}</strong><br>X:${coord.x.toFixed(2)}<br>Y:${coord.y.toFixed(2)}`);
            
            // Double-click event for editing
            marker.on('dblclick', () => {
                this.editCoordinates(index);
            });
            
            L.marker(pos, {
                icon: L.divIcon({
                    className: 'point-label',
                    html: `<div style="background: white; padding: 2px 6px; border-radius: 3px; font-weight: bold; font-size: 11px; border: 1px solid #ccc;">${index}</div>`,
                    iconSize: [20, 20],
                    iconAnchor: [10, 25]
                })
            }).addTo(this.plotLayer);
        });
        
        if (this.coordinates.length > 1) {
            const leafletCoords = positions;
            
            L.polyline(leafletCoords, {
                color: '#4a69bd',
                weight: 3,
                opacity: 0.8,
                dashArray: '5, 5'
            }).addTo(this.plotLayer);
            
            if (this.coordinates.length > 2) {
                L.polygon(leafletCoords, {
                    color: '#4a69bd',
                    fillColor: '#4a69bd',
                    fillOpacity: 0.1,
                    weight: 2
                }).addTo(this.plotLayer);
            }
        }
    }

    // Walks the traverse legs in true order, building each point's local
    // X/Y by dead-reckoning (distance + bearing from the previous point) -
    // UNLESS a row was imported with a known real lat/long, in which case
    // that becomes the point's actual position (converted via whichever
    // coordinate system is selected), and every leg after it continues
    // from that corrected point onward. This is standard survey practice:
    // checking into a known control point partway through a traverse.
    buildTraverseCoordinates() {
        const startX = parseFloat(document.getElementById('startX').value) || 0;
        const startY = parseFloat(document.getElementById('startY').value) || 0;

        const unit = document.getElementById('distanceUnit').value;
        const conversionFactor = this.conversionFactors[unit];

        let currentX = startX;
        let currentY = startY;
        const coordinates = [{ x: currentX, y: currentY, leg: 0 }];
        const traverseData = [];

        const rows = this.getOrderedRows(); // process legs in true survey order, never visual position
        let unsupportedCrsWarned = false;

        rows.forEach((row, index) => {
            const distanceInput = row.querySelector('.distance-input');
            const bearingInput = row.querySelector('.bearing-input');

            if (!distanceInput.value || !bearingInput.value) return;

            const distance = parseFloat(distanceInput.value) * conversionFactor;
            const bearing = this.parseBearing(bearingInput.value);
            const bearingDecimal = this.bearingToDecimal(bearing.degrees, bearing.minutes, bearing.seconds);
            const bearingRad = (bearingDecimal * Math.PI) / 180;

            const deltaX = distance * Math.sin(bearingRad);
            const deltaY = distance * Math.cos(bearingRad);

            currentX += deltaX;
            currentY += deltaY;

            const point = { x: currentX, y: currentY, leg: index + 1, distance, bearing: bearingDecimal };

            const importLat = row.dataset.importLat;
            const importLng = row.dataset.importLng;
            if (importLat !== undefined && importLng !== undefined) {
                const converted = this.latLngToLocalXY(parseFloat(importLat), parseFloat(importLng));
                if (converted) {
                    currentX = converted.x;
                    currentY = converted.y;
                    point.x = currentX;
                    point.y = currentY;
                    point.latitude = parseFloat(importLat);
                    point.longitude = parseFloat(importLng);
                } else if (!unsupportedCrsWarned) {
                    unsupportedCrsWarned = true;
                    this.showMessage(
                        `Some legs were imported with a real position, but "${this.getSelectedCRS()}" can't use it yet - select "WGS 84 / UTM Zone 43N" as the coordinate system.`,
                        'error'
                    );
                }
            }

            coordinates.push(point);
            traverseData.push({ leg: index + 1, distance, bearing: bearingDecimal, x: currentX, y: currentY });
        });

        // Point 0 (the traverse's starting point) normally just sits at
        // whatever Start X/Y default to (usually 0,0 - meaningless).
        // But if the first leg is anchored to a real position, point 0's
        // real position can be worked out too, by walking backwards
        // along that same leg's distance and bearing.
        if (coordinates.length > 1 && coordinates[1].latitude != null && coordinates[0].latitude == null) {
            const firstLeg = coordinates[1];
            const bearingRad = (firstLeg.bearing * Math.PI) / 180;
            const deltaX = firstLeg.distance * Math.sin(bearingRad);
            const deltaY = firstLeg.distance * Math.cos(bearingRad);
            coordinates[0].x = firstLeg.x - deltaX;
            coordinates[0].y = firstLeg.y - deltaY;
            const derived = this.localXYToLatLng(coordinates[0].x, coordinates[0].y);
            if (derived) {
                coordinates[0].latitude = derived.lat;
                coordinates[0].longitude = derived.lng;
            }
        }

        return { coordinates, traverseData };
    }

    recalculateCoordinates() {
        this.coordinates = this.buildTraverseCoordinates().coordinates;
    }

    calculatePlot() {
        const { coordinates, traverseData } = this.buildTraverseCoordinates();
        this.coordinates = coordinates;
        this.traverseData = traverseData;

        // Fixes the "shape only appears correctly after switching map
        // layers" issue - Leaflet doesn't automatically notice when its
        // container has changed size (e.g. right after the page loads,
        // or a panel was toggled earlier), so tell it to recheck now.
        this.map.invalidateSize();

        this.plotShape();
        this.calculateStats();
        this.updateCoordinatesTable();
        this.showMessage('Plot calculated successfully!', 'success');
    }

    // Simple Plot mode draws directly in local survey meters (x,y).
    // Real map layers (OpenStreetMap/Satellite/Terrain) need actual
    // latitude/longitude - which only exist once "Calculate Georeference"
    // has been run. Using local meters as if they were GPS degrees is
    // exactly what was causing points to appear on the wrong continent.
    getPlotPosition(coord) {
        if (this.currentMapLayer === 'simple' || !this.currentMapLayer) {
            return [coord.x, coord.y];
        }
        if (coord.latitude != null && coord.longitude != null && !isNaN(coord.latitude) && !isNaN(coord.longitude)) {
            return [coord.latitude, coord.longitude];
        }
        // No lat/long set yet (no GCP transform, no imported anchor point) -
        // if the selected coordinate system has a known real-world
        // projection (like UTM Zone 43N), derive it directly.
        const derived = this.localXYToLatLng(coord.x, coord.y);
        if (derived) {
            return [derived.lat, derived.lng];
        }
        return null;
    }

    plotShape() {
        this.plotLayer.clearLayers();
        
        if (this.coordinates.length < 2) return;
        
        const positions = this.coordinates.map(coord => this.getPlotPosition(coord));

        if (positions.some(p => p === null)) {
            this.showMessage('⚠ Click "Calculate Georeference" first to view this plot on a real-world map layer', 'error');
            return;
        }

        const leafletCoords = positions;
        
        const polyline = L.polyline(leafletCoords, {
            color: '#1a3d7c',
            weight: 3,
            opacity: 0.85
        }).addTo(this.plotLayer);
        
        if (this.coordinates.length > 2) {
            const polygon = L.polygon(leafletCoords, {
                color: '#1a3d7c',
                fillColor: '#4a69bd',
                fillOpacity: 0.2,
                weight: 2
            }).addTo(this.plotLayer);
        }
        
        this.coordinates.forEach((coord, index) => {
            const pos = positions[index];

            const marker = L.circleMarker(pos, {
                radius: 6,
                fillColor: '#ffffff',
                color: '#1a3d7c',
                weight: 2.5,
                fillOpacity: 1
            }).addTo(this.plotLayer);
            
            marker.bindPopup(`<strong>Point ${index}</strong><br>X: ${coord.x.toFixed(3)}<br>Y: ${coord.y.toFixed(3)}`);
            
            // Hover highlight - a point brightens to yellow under the
            // cursor, so it's obvious which one you're about to click.
            marker.on('mouseover', () => marker.setStyle({ fillColor: '#ffd54f', color: '#c9a227' }));
            marker.on('mouseout', () => marker.setStyle({ fillColor: '#ffffff', color: '#1a3d7c' }));

            // Double-click event for editing
            marker.on('dblclick', () => {
                this.editCoordinates(index);
            });
            
            L.marker(pos, {
                icon: L.divIcon({
                    className: 'point-label',
                    html: `<div style="background: white; padding: 2px 6px; border-radius: 3px; font-weight: bold; font-size: 12px; border: 1px solid #ccc;">${index}</div>`,
                    iconSize: [20, 20],
                    iconAnchor: [10, 25]
                })
            }).addTo(this.plotLayer);
        });
    }

    calculateStats() {
        if (this.coordinates.length < 3) {
            this.updateStatsDisplay(0, 0, 0, 0);
            return;
        }
        
        let area = 0;
        for (let i = 0; i < this.coordinates.length - 1; i++) {
            area += (this.coordinates[i].x * this.coordinates[i + 1].y) - 
                    (this.coordinates[i + 1].x * this.coordinates[i].y);
        }
        area = Math.abs(area) / 2;
        
        let perimeter = 0;
        for (let i = 0; i < this.coordinates.length - 1; i++) {
            const dx = this.coordinates[i + 1].x - this.coordinates[i].x;
            const dy = this.coordinates[i + 1].y - this.coordinates[i].y;
            perimeter += Math.sqrt(dx * dx + dy * dy);
        }
        
        const firstPoint = this.coordinates[0];
        const lastPoint = this.coordinates[this.coordinates.length - 1];
        const closureError = Math.sqrt(
            Math.pow(lastPoint.x - firstPoint.x, 2) + 
            Math.pow(lastPoint.y - firstPoint.y, 2)
        );
        
        this.updateStatsDisplay(area, perimeter, this.coordinates.length, closureError);
        this.updateClosureInfo(closureError, perimeter);
    }

    updateStatsDisplay(area, perimeter, points, closureError) {
        document.getElementById('areaDisplay').textContent = `${area.toFixed(2)} m²`;
        document.getElementById('perimeterDisplay').textContent = `${perimeter.toFixed(2)} m`;
        document.getElementById('pointsCount').textContent = points;
        document.getElementById('closureError').textContent = `${closureError.toFixed(3)} m`;
    }

    updateClosureInfo(closureError, perimeter) {
        const closureDiv = document.getElementById('closureResults');
        const relativePrecision = perimeter > 0 ? (closureError / perimeter) : 0;
        const precisionRatio = relativePrecision > 0 ? `1:${Math.round(1 / relativePrecision)}` : 'Perfect';
        
        const isGood = closureError < 2;
        
        closureDiv.innerHTML = `
            <strong>Error: ${closureError.toFixed(3)}m | Precision: ${precisionRatio}</strong><br>
            <span style="color: ${isGood ? 'green' : 'red'}">${isGood ? '✓ ACCEPTABLE' : '⚠ NEEDS ADJUSTMENT'}</span>
        `;
        
        const closureSection = document.querySelector('.closure-info');
        closureSection.className = isGood ? 'closure-info' : 'closure-info error';
    }

    adjustClosure() {
        if (this.coordinates.length < 3) {
            this.showMessage('Need at least 3 points', 'error');
            return;
        }
        
        const firstPoint = this.coordinates[0];
        const lastPoint = this.coordinates[this.coordinates.length - 1];
        
        const totalClosureX = lastPoint.x - firstPoint.x;
        const totalClosureY = lastPoint.y - firstPoint.y;
        
        let totalPerimeter = 0;
        for (let i = 0; i < this.traverseData.length; i++) {
            totalPerimeter += this.traverseData[i].distance;
        }
        
        let cumulativeDistance = 0;
        for (let i = 1; i < this.coordinates.length; i++) {
            if (i <= this.traverseData.length) {
                cumulativeDistance += this.traverseData[i - 1].distance;
                const proportion = cumulativeDistance / totalPerimeter;
                
                this.coordinates[i].x -= totalClosureX * proportion;
                this.coordinates[i].y -= totalClosureY * proportion;
            }
        }
        
        // Moving each point's local X/Y here would otherwise leave any
        // already-computed real lat/long stale and mismatched with the
        // new position. Re-sync it: if a GCP transform exists, re-apply
        // it to the corrected coordinates; otherwise clear the stale
        // values so the map re-derives them fresh from the new position.
        if (this.georeferenceMatrix) {
            this.transformCoordinates();
        } else {
            this.coordinates.forEach(c => {
                delete c.latitude;
                delete c.longitude;
            });
        }

        this.plotShape();
        this.calculateStats();
        this.updateCoordinatesTable();
        
        this.showMessage('Closure adjusted using Bowditch rule', 'success');
    }

    updateCoordinatesTable() {
        const tbody = document.querySelector('#coordTable tbody');
        tbody.innerHTML = '';
        
        this.coordinates.forEach((coord, index) => {
            const row = tbody.insertRow();
            row.style.cursor = 'pointer';
            row.onclick = () => this.editCoordinates(index);

            let lat = coord.latitude;
            let lng = coord.longitude;
            if (lat == null || lng == null) {
                const derived = this.localXYToLatLng(coord.x, coord.y);
                if (derived) { lat = derived.lat; lng = derived.lng; }
            }
            
            row.innerHTML = `
                <td>${index}</td>
                <td>${coord.x.toFixed(3)}</td>
                <td>${coord.y.toFixed(3)}</td>
                <td>${lat != null ? lat.toFixed(6) : '-'}</td>
                <td>${lng != null ? lng.toFixed(6) : '-'}</td>
                <td><button class="edit-btn" onclick="chainSurvey.editCoordinates(${index})" style="width: 40px; padding: 3px;">Edit</button></td>
            `;
        });
    }

    editCoordinates(pointIndex) {
        const coord = this.coordinates[pointIndex];
        
        document.getElementById('georefPointNum').value = pointIndex;
        document.getElementById('georefLocalX').value = coord.x.toFixed(3);
        document.getElementById('georefLocalY').value = coord.y.toFixed(3);
        document.getElementById('georefRealLat').value = coord.latitude || '';
        document.getElementById('georefRealLng').value = coord.longitude || '';
        
        this.currentGeorefPoint = pointIndex;
        
        const modal = document.getElementById('georefModal');
        modal.style.display = 'block';
    }

    saveGeorefEdit() {
        if (this.currentGeorefPoint === null) return;
        
        const lat = parseFloat(document.getElementById('georefRealLat').value);
        const lng = parseFloat(document.getElementById('georefRealLng').value);
        
        if (isNaN(lat) || isNaN(lng)) {
            this.showMessage('Please enter valid latitude and longitude', 'error');
            return;
        }

        // Validate lat/lng ranges
        if (lat < -90 || lat > 90) {
            this.showMessage('Latitude must be between -90 and 90', 'error');
            return;
        }
        if (lng < -180 || lng > 180) {
            this.showMessage('Longitude must be between -180 and 180', 'error');
            return;
        }
        
        this.coordinates[this.currentGeorefPoint].latitude = lat;
        this.coordinates[this.currentGeorefPoint].longitude = lng;
        
        this.updateCoordinatesTable();
        document.getElementById('georefModal').style.display = 'none';
        this.showMessage(`Point ${this.currentGeorefPoint} updated to Lat: ${lat.toFixed(6)}, Lng: ${lng.toFixed(6)}`, 'success');
    }

    // Expands the whole map panel (map + its controls + stats) to cover
    // the full screen, for a clearer working view - and back again.
    toggleMapFullscreen() {
        const rightPanel = document.querySelector('.right-panel');
        const btn = document.getElementById('mapFullscreenBtn');
        rightPanel.classList.toggle('map-fullscreen');

        const isFullscreen = rightPanel.classList.contains('map-fullscreen');
        btn.textContent = isFullscreen ? 'Collapse' : 'Expand';
        btn.title = isFullscreen ? 'Exit full screen' : 'Expand map to full screen';

        // The panel just changed size - Leaflet needs a moment to notice.
        setTimeout(() => this.map.invalidateSize(), 100);
    }

    fitToView() {
        if (this.coordinates.length === 0) {
            this.showMessage('No data to fit', 'error');
            return;
        }
        
        const group = new L.featureGroup(this.plotLayer.getLayers());
        this.map.fitBounds(group.getBounds().pad(0.1));
    }

    // Fits the view to everything currently on the map - the plotted
    // survey, plus the reference grid if it's showing - with headroom
    // around the edges. (GCPs and imported reference layers aren't
    // drawn as separate map objects yet, so they can't be included in
    // this bounds calculation until that exists - noted honestly rather
    // than silently pretending to include them.)
    fitToFullExtent() {
        const layers = [...this.plotLayer.getLayers()];
        if (this.gridLayer && this.map.hasLayer(this.gridLayer)) {
            layers.push(...this.gridLayer.getLayers());
        }

        if (layers.length === 0) {
            // Nothing plotted yet - fall back to a sensible default view.
            if (this.currentMapLayer === 'simple' || !this.currentMapLayer) {
                this.map.setView([0, 0], 16);
            } else {
                this.map.setView([20, 0], 2);
            }
            return;
        }

        const group = new L.featureGroup(layers);
        this.map.fitBounds(group.getBounds().pad(0.1));
    }

    toggleLabels() {
        const labels = document.querySelectorAll('.point-label');
        let hidden = false;
        labels.forEach(label => {
            if (label.style.display === 'none') {
                label.style.display = 'block';
            } else {
                label.style.display = 'none';
                hidden = true;
            }
        });
        this.showMessage(hidden ? 'Labels hidden' : 'Labels shown', 'success');
    }

    toggleGrid() {
        if (this.gridLayer) {
            if (this.map.hasLayer(this.gridLayer)) {
                this.map.removeLayer(this.gridLayer);
                this.showMessage('Grid hidden', 'success');
            } else {
                this.gridLayer.addTo(this.map);
                this.showMessage('Grid shown', 'success');
            }
        }
    }

    toggleMapLayerSelector() {
        const selector = document.querySelector('.map-layer-selector');
        selector.classList.toggle('active');
    }

    switchMapLayer(layerType) {
        const wasSimple = this.currentMapLayer === 'simple' || !this.currentMapLayer;
        const willBeSimple = layerType === 'simple';
        const realWorldCenter = [11.8745, 75.3572];

        if (wasSimple !== willBeSimple) {
            // Crossing between local-meters mode and real-world mode -
            // the map's CRS has to change, which means rebuilding it.
            this.map.remove();
            this.createMapInstance(
                willBeSimple ? L.CRS.Simple : L.CRS.EPSG3857,
                willBeSimple ? [0, 0] : realWorldCenter,
                willBeSimple ? 16 : 14
            );
            this.setupMapLayers();
            if (willBeSimple) {
                this.addCoordinateGrid();
            } else {
                this.gridLayer = null; // doesn't make sense at real-world scale
            }
            this.plotLayer = L.layerGroup().addTo(this.map);
            this.attachMapClickHandler();
        } else {
            // Staying within the same CRS (e.g. OSM -> Satellite) - just
            // swap which tile layer is showing.
            Object.keys(this.mapLayers).forEach(key => {
                this.map.removeLayer(this.mapLayers[key]);
            });
        }

        if (layerType === 'simple') {
            this.mapLayers.simple.addTo(this.map);
        } else if (layerType === 'osm') {
            this.mapLayers.osm.addTo(this.map);
            this.map.setView(realWorldCenter, 14);
        } else if (layerType === 'satellite') {
            this.mapLayers.satellite.addTo(this.map);
            this.map.setView(realWorldCenter, 14);
        } else if (layerType === 'terrain') {
            this.mapLayers.terrain.addTo(this.map);
            this.map.setView(realWorldCenter, 14);
        }

        if (this.plotLayer) {
            this.map.removeLayer(this.plotLayer);
            this.plotLayer.addTo(this.map);
        }

        this.currentMapLayer = layerType;
        this.plotShape();
        this.map.invalidateSize();

        // Close the layer picker now that a choice has been made, so it
        // doesn't sit open and block the map underneath it.
        document.querySelector('.map-layer-selector').classList.remove('active');
    }

    getCurrentLocation() {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const lat = position.coords.latitude;
                    const lng = position.coords.longitude;
                    
                    document.getElementById('startX').value = lng.toFixed(6);
                    document.getElementById('startY').value = lat.toFixed(6);
                    document.getElementById('crsSelect').value = 'geographic';
                    this.showMessage(`GPS: Lat ${lat.toFixed(4)}, Lng ${lng.toFixed(4)}`, 'success');
                },
                (error) => {
                    this.showMessage('GPS Error: ' + error.message, 'error');
                }
            );
        } else {
            this.showMessage('Geolocation not supported', 'error');
        }
    }

    // ===== GEOREFERENCE FUNCTIONS =====
    
    addGCP() {
        const gcpList = document.getElementById('gcpList');
        const gcpCount = gcpList.children.length + 1;
        
        const gcpDiv = document.createElement('div');
        gcpDiv.className = 'gcp-item';
        gcpDiv.innerHTML = `
            <strong>GCP ${gcpCount}</strong>
            <input type="number" class="gcp-survey-x" placeholder="Survey X" step="any">
            <input type="number" class="gcp-survey-y" placeholder="Survey Y" step="any">
            <input type="number" class="gcp-real-lat" placeholder="Real Latitude" step="any">
            <input type="number" class="gcp-real-lng" placeholder="Real Longitude" step="any">
            <button onclick="chainSurvey.removeGCP(this)" style="background: #dc3545;">❌ Remove</button>
        `;
        gcpList.appendChild(gcpDiv);
    }

    removeGCP(button) {
        button.parentElement.remove();
    }

    calculateGeoreference(silent = false) {
        const gcpItems = document.querySelectorAll('.gcp-item');
        
        if (gcpItems.length < 4) {
            if (!silent) this.showMessage('Please add minimum 4 Ground Control Points', 'error');
            return;
        }
        
        const gcps = [];
        try {
            gcpItems.forEach(item => {
                const gcp = {
                    surveyX: parseFloat(item.querySelector('.gcp-survey-x').value),
                    surveyY: parseFloat(item.querySelector('.gcp-survey-y').value),
                    realLat: parseFloat(item.querySelector('.gcp-real-lat').value),
                    realLng: parseFloat(item.querySelector('.gcp-real-lng').value)
                };

                if (isNaN(gcp.surveyX) || isNaN(gcp.surveyY) || isNaN(gcp.realLat) || isNaN(gcp.realLng)) {
                    throw new Error('All GCP fields must be filled');
                }

                // Validate lat/lng
                if (gcp.realLat < -90 || gcp.realLat > 90 || gcp.realLng < -180 || gcp.realLng > 180) {
                    throw new Error('Invalid latitude/longitude values');
                }

                gcps.push(gcp);
            });

            this.georeferenceMatrix = this.calculateAffineTransform(gcps);
            this.transformCoordinates();
            if (!silent) this.showMessage('✓ Georeferencing complete! All points transformed.', 'success');
        } catch (error) {
            // While typing, an incomplete/invalid GCP is normal and expected -
            // only surface the error when the user explicitly clicked the button.
            if (!silent) this.showMessage('Error: ' + error.message, 'error');
        }
    }

    calculateAffineTransform(gcps) {
        let sumX = 0, sumY = 0, sumLat = 0, sumLng = 0;
        let sumXX = 0, sumYY = 0, sumXY = 0;
        let sumXLat = 0, sumXLng = 0, sumYLat = 0, sumYLng = 0;
        let n = gcps.length;
        
        gcps.forEach(gcp => {
            sumX += gcp.surveyX;
            sumY += gcp.surveyY;
            sumLat += gcp.realLat;
            sumLng += gcp.realLng;
            sumXX += gcp.surveyX * gcp.surveyX;
            sumYY += gcp.surveyY * gcp.surveyY;
            sumXY += gcp.surveyX * gcp.surveyY;
            sumXLat += gcp.surveyX * gcp.realLat;
            sumXLng += gcp.surveyX * gcp.realLng;
            sumYLat += gcp.surveyY * gcp.realLat;
            sumYLng += gcp.surveyY * gcp.realLng;
        });
        
        const meanX = sumX / n;
        const meanY = sumY / n;
        const meanLat = sumLat / n;
        const meanLng = sumLng / n;
        
        let u2 = 0, v2 = 0, uv = 0, upLat = 0, upLng = 0, vpLat = 0, vpLng = 0;
        
        gcps.forEach(gcp => {
            const u = gcp.surveyX - meanX;
            const v = gcp.surveyY - meanY;
            const pLat = gcp.realLat - meanLat;
            const pLng = gcp.realLng - meanLng;
            
            u2 += u * u;
            v2 += v * v;
            uv += u * v;
            upLat += u * pLat;
            upLng += u * pLng;
            vpLat += v * pLat;
            vpLng += v * pLng;
        });
        
        const denom = u2 * v2 - uv * uv;
        
        if (Math.abs(denom) < 0.0001) {
            throw new Error('Singular matrix - GCP points may be collinear');
        }
        
        const aLat = (upLat * v2 - vpLat * uv) / denom;
        const bLat = (vpLat * u2 - upLat * uv) / denom;
        const eLat = meanLat - aLat * meanX - bLat * meanY;
        
        const aLng = (upLng * v2 - vpLng * uv) / denom;
        const bLng = (vpLng * u2 - upLng * uv) / denom;
        const eLng = meanLng - aLng * meanX - bLng * meanY;
        
        return {
            aLat, bLat, eLat,
            aLng, bLng, eLng
        };
    }

    transformCoordinates() {
        if (!this.georeferenceMatrix) return;
        
        const m = this.georeferenceMatrix;
        
        this.coordinates.forEach(coord => {
            const lat = m.aLat * coord.x + m.bLat * coord.y + m.eLat;
            const lng = m.aLng * coord.x + m.bLng * coord.y + m.eLng;
            
            coord.latitude = lat;
            coord.longitude = lng;
        });
        
        this.updateCoordinatesTable();
        this.plotShape();
    }

    // ===== SAVE/LOAD FUNCTIONS =====
    
    async saveProject() {
        if (!auth.currentUser) {
            this.showMessage('You must be logged in to save a project', 'error');
            return;
        }

        const projectName = document.getElementById('projectName').value || 'Unnamed Project';
        
        const projectData = {
            name: projectName,
            surveyNumber: document.getElementById('surveyNumber').value,
            village: document.getElementById('village').value,
            startX: document.getElementById('startX').value,
            startY: document.getElementById('startY').value,
            distanceUnit: document.getElementById('distanceUnit').value,
            bearingFormat: document.getElementById('bearingFormat').value,
            traverseData: [],
            coordinates: this.coordinates,
            timestamp: new Date().toISOString(),
            ownerId: auth.currentUser.uid
        };
        
        const rows = this.getOrderedRows(); // process legs in true survey order, never visual position
        rows.forEach((row) => {
            const distance = row.querySelector('.distance-input').value;
            const bearing = row.querySelector('.bearing-input').value;
            if (distance && bearing) {
                const leg = { distance, bearing };
                // Keep any imported real-world anchor position attached,
                // so reloading this project doesn't lose it.
                if (row.dataset.importLat !== undefined && row.dataset.importLng !== undefined) {
                    leg.latitude = parseFloat(row.dataset.importLat);
                    leg.longitude = parseFloat(row.dataset.importLng);
                }
                projectData.traverseData.push(leg);
            }
        });

        // Firestore document IDs can't contain slashes and a few other
        // characters - swap them out so any project name is safe to use.
        const safeName = projectName.replace(/[\/.#$\[\]]/g, '-');
        const docId = `${auth.currentUser.uid}_${safeName}`;
        this.currentProjectDocId = docId;
        
        try {
            await setDoc(doc(db, 'projects', docId), projectData);
            this.downloadFile(JSON.stringify(projectData, null, 2), `${projectName}.json`, 'application/json');
            this.showMessage(`✓ Project "${projectName}" saved to the cloud!`, 'success');
        } catch (error) {
            this.showMessage('Error saving project: ' + error.message, 'error');
        }
    }

    async loadProject() {
        await this.listProjects();
        document.getElementById('projectSelect').style.display = 'block';
    }

    async shareProject() {
        if (!this.currentProjectDocId) {
            this.showMessage('Save or load a project first, then share it', 'error');
            return;
        }

        const email = prompt('Enter the email address of the person to share this project with:');
        if (!email) return;

        try {
            // Find that person's account by email - everyone's email is
            // stored in their own user profile document at login time.
            const userQuery = query(collection(db, 'users'), where('email', '==', email.trim()));
            const userSnapshot = await getDocs(userQuery);

            if (userSnapshot.empty) {
                this.showMessage(`No account found for "${email}" - they need to sign up first`, 'error');
                return;
            }

            const targetUid = userSnapshot.docs[0].id;

            if (targetUid === auth.currentUser.uid) {
                this.showMessage("That's already your own account", 'error');
                return;
            }

            await updateDoc(doc(db, 'projects', this.currentProjectDocId), {
                sharedWith: arrayUnion(targetUid)
            });

            this.showMessage(`✓ Shared with ${email}`, 'success');
        } catch (error) {
            this.showMessage('Error sharing project: ' + error.message, 'error');
        }
    }

    async listProjects() {
        if (!auth.currentUser) {
            this.showMessage('You must be logged in to load projects', 'error');
            return;
        }

        const select = document.getElementById('projectSelect');
        select.innerHTML = '<option>-- Select Project --</option>';
        
        try {
            const uid = auth.currentUser.uid;
            const role = window.currentUserRole;
            const seenIds = new Set();
            const results = []; // { id, data, label }

            const addDocs = (snapshot, label) => {
                snapshot.forEach((docSnap) => {
                    if (seenIds.has(docSnap.id)) return;
                    seenIds.add(docSnap.id);
                    results.push({ id: docSnap.id, data: docSnap.data(), label });
                });
            };

            if (role === 'admin') {
                // Admins see every project in the system.
                const allSnapshot = await getDocs(collection(db, 'projects'));
                addDocs(allSnapshot, 'all projects');
            } else {
                const ownSnapshot = await getDocs(
                    query(collection(db, 'projects'), where('ownerId', '==', uid))
                );
                addDocs(ownSnapshot, 'yours');

                const sharedSnapshot = await getDocs(
                    query(collection(db, 'projects'), where('sharedWith', 'array-contains', uid))
                );
                addDocs(sharedSnapshot, 'shared with you');
            }

            if (results.length === 0) {
                this.showMessage('No saved projects yet', 'error');
                select.style.display = 'none';
                return;
            }

            results.forEach(({ id, data, label }) => {
                const option = document.createElement('option');
                option.value = id;
                const date = new Date(data.timestamp).toLocaleDateString();
                option.textContent = `${data.name} (${date}) - ${label}`;
                select.appendChild(option);
            });
        } catch (error) {
            this.showMessage('Error loading project list: ' + error.message, 'error');
        }
    }

    async selectProjectToLoad(docId) {
        if (!docId || docId === '-- Select Project --') return;
        this.currentProjectDocId = docId;
        
        try {
            const docSnap = await getDoc(doc(db, 'projects', docId));
            if (!docSnap.exists()) {
                this.showMessage('Project not found', 'error');
                return;
            }
            const projectData = docSnap.data();

            document.getElementById('projectName').value = projectData.name;
            document.getElementById('surveyNumber').value = projectData.surveyNumber;
            document.getElementById('village').value = projectData.village;
            document.getElementById('startX').value = projectData.startX;
            document.getElementById('startY').value = projectData.startY;
            document.getElementById('distanceUnit').value = projectData.distanceUnit;
            document.getElementById('bearingFormat').value = projectData.bearingFormat;
            
            const tbody = document.querySelector('#traverseTable tbody');
            tbody.innerHTML = '';
            
            projectData.traverseData.forEach((row, index) => {
                const legSeq = index + 1;
                const tr = document.createElement('tr');
                tr.dataset.legSeq = legSeq;

                const hasLatLng = row.latitude != null && row.longitude != null;
                if (hasLatLng) {
                    tr.dataset.importLat = row.latitude;
                    tr.dataset.importLng = row.longitude;
                }

                tr.innerHTML = `
                    <td>${legSeq}${hasLatLng ? ' <span title="Anchored to a real position" style="color:#28a745;">📍</span>' : ''}</td>
                    <td><input type="text" class="distance-input" value="${this.escapeHtmlAttr(row.distance)}"></td>
                    <td>${this.bearingCellHTML(row.bearing)}</td>
                    <td>
                        <button class="edit-btn" onclick="chainSurvey.editLeg(this)">✏️</button>
                        <button class="delete-btn" onclick="chainSurvey.deleteLeg(this)">🗑️</button>
                    </td>
                `;
                // Insert at the top each time, so by the end the newest
                // (highest-numbered) leg ends up visually on top.
                tbody.insertBefore(tr, tbody.firstChild);
            });
            this.legSeqCounter = projectData.traverseData.length;
            
            this.coordinates = projectData.coordinates;
            this.calculatePlot();
            document.getElementById('projectSelect').style.display = 'none';
            
            this.showMessage(`✓ Project "${projectData.name}" loaded!`, 'success');
        } catch (error) {
            this.showMessage('Error loading project: ' + error.message, 'error');
        }
    }

    // ===== IMPORT FUNCTIONS =====
    
    handleFileImport(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const content = e.target.result;
                this.parseImportedData(content, file.name);
            } catch (error) {
                this.showMessage('Error: ' + error.message, 'error');
            }
        };
        
        if (file.name.endsWith('.csv') || file.name.endsWith('.json')) {
            reader.readAsText(file);
        } else {
            reader.readAsBinaryString(file);
        }
    }

    // Finds a column's position by checking whether its header contains
    // one of the acceptable keywords (case-insensitive) - so "Lat",
    // "Latitude", and "Distance (chains)" all match correctly.
    findColumnIndex(headerRow, candidates) {
        for (let i = 0; i < headerRow.length; i++) {
            const h = String(headerRow[i] ?? '').trim().toLowerCase();
            if (candidates.some(c => h.includes(c))) return i;
        }
        return -1;
    }

    parseImportedData(content, filename) {
        let data = [];
        
        if (filename.endsWith('.csv')) {
            const lines = content.trim().split('\n');
            const header = lines[0].split(',').map(h => h.trim());
            const distIdx = this.findColumnIndex(header, ['distance']);
            const bearIdx = this.findColumnIndex(header, ['bearing']);
            const latIdx = this.findColumnIndex(header, ['latitude', 'lat']);
            const lngIdx = this.findColumnIndex(header, ['longitude', 'lng', 'long']);
            
            for (let i = 1; i < lines.length; i++) {
                const values = lines[i].split(',');
                if (values.length < 2) continue;

                const entry = {
                    distance: parseFloat(values[distIdx >= 0 ? distIdx : 0]),
                    bearing: (values[bearIdx >= 0 ? bearIdx : 1] || '').trim()
                };

                if (latIdx >= 0 && lngIdx >= 0 && values[latIdx] && values[lngIdx]) {
                    const lat = parseFloat(values[latIdx]);
                    const lng = parseFloat(values[lngIdx]);
                    if (!isNaN(lat) && !isNaN(lng)) {
                        entry.latitude = lat;
                        entry.longitude = lng;
                    }
                }

                data.push(entry);
            }
        } else if (filename.endsWith('.json')) {
            // JSON rows may already include latitude/longitude fields
            // directly - loadImportedData picks them up automatically.
            data = JSON.parse(content);
        } else if (filename.endsWith('.xlsx')) {
            const workbook = XLSX.read(content, { type: 'binary' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
            const header = (rows[0] || []).map(h => String(h ?? '').trim());
            const distIdx = this.findColumnIndex(header, ['distance']);
            const bearIdx = this.findColumnIndex(header, ['bearing']);
            const latIdx = this.findColumnIndex(header, ['latitude', 'lat']);
            const lngIdx = this.findColumnIndex(header, ['longitude', 'lng', 'long']);
            
            rows.forEach((r, idx) => {
                if (idx === 0) return;
                const distance = r[distIdx >= 0 ? distIdx : 0];
                const bearing = r[bearIdx >= 0 ? bearIdx : 1];
                if (!distance || !bearing) return;

                const entry = { distance, bearing };
                if (latIdx >= 0 && lngIdx >= 0 && r[latIdx] != null && r[lngIdx] != null) {
                    const lat = parseFloat(r[latIdx]);
                    const lng = parseFloat(r[lngIdx]);
                    if (!isNaN(lat) && !isNaN(lng)) {
                        entry.latitude = lat;
                        entry.longitude = lng;
                    }
                }
                data.push(entry);
            });
        }
        
        this.loadImportedData(data);
    }

    loadImportedData(data) {
        const tbody = document.querySelector('#traverseTable tbody');
        tbody.innerHTML = '';
        let anchoredCount = 0;
        
        data.forEach((row, index) => {
            const legSeq = index + 1;
            const tr = document.createElement('tr');
            tr.dataset.legSeq = legSeq;

            const hasLatLng = row.latitude != null && row.longitude != null && !isNaN(row.latitude) && !isNaN(row.longitude);
            if (hasLatLng) {
                tr.dataset.importLat = row.latitude;
                tr.dataset.importLng = row.longitude;
                anchoredCount++;
            }

            tr.innerHTML = `
                <td>${legSeq}${hasLatLng ? ' <span title="Anchored to imported lat/long" style="color:#28a745;">📍</span>' : ''}</td>
                <td><input type="text" class="distance-input" value="${this.escapeHtmlAttr(row.distance || '')}"></td>
                <td>${this.bearingCellHTML(row.bearing || '')}</td>
                <td>
                    <button class="edit-btn" onclick="chainSurvey.editLeg(this)">✏️</button>
                    <button class="delete-btn" onclick="chainSurvey.deleteLeg(this)">🗑️</button>
                </td>
            `;
            tbody.insertBefore(tr, tbody.firstChild);
        });
        this.legSeqCounter = data.length;
        
        if (anchoredCount > 0 && this.getSelectedCRS() !== 'utm43n' && this.getSelectedCRS() !== 'geographic') {
            this.showMessage(`✓ Imported ${data.length} records (${anchoredCount} with real coordinates - select "WGS 84 / UTM Zone 43N" to use them)`, 'success');
        } else {
            this.showMessage(`✓ Imported ${data.length} records!${anchoredCount > 0 ? ` (${anchoredCount} anchored to real coordinates 📍)` : ''}`, 'success');
        }
        this.updateLivePreview();
    }

    importData() {
        document.getElementById('importFile').click();
    }

    downloadTemplate() {
        const unit = document.getElementById('distanceUnit').value;
        const mode = this.getBearingFormatMode();

        const distanceExamples = {
            links: [203.5, 344, 516, 285],
            chains: [10.2, 17.2, 25.8, 14.3],
            feet: [667.7, 1128.6, 1692.9, 935.0],
            meters: [203.5, 344, 516, 285]
        }[unit] || [203.5, 344, 516, 285];

        // Same four real bearings (32°15'30", 96°, 230°, 300°) written in
        // whichever format is currently selected, so the template always
        // matches what the app is expecting you to type right now.
        const bearingsByMode = {
            dms: ['32°15\'30"', '96°0\'0"', '230°0\'0"', '300°0\'0"'],
            decimal: ['32.2583', '96.0000', '230.0000', '300.0000'],
            quadrant: ['N 32°15\' E', 'S 84°0\' E', 'S 50°0\' W', 'N 60°0\' W']
        };
        const bearings = bearingsByMode[mode] || bearingsByMode.dms;

        let csv = `Distance (${unit}),Bearing (${mode}),Latitude,Longitude\n`;
        distanceExamples.forEach((d, i) => {
            // Latitude/Longitude are optional - leave them blank for a
            // normal leg, or fill them in on any row to anchor that point
            // to a real GPS position (select "WGS 84 / UTM Zone 43N" as
            // the coordinate system to actually use them).
            csv += `${d},${bearings[i]},,\n`;
        });
        
        this.downloadFile(csv, `survey_template_${unit}_${mode}.csv`, 'text/csv');
        this.showMessage('Template downloaded!', 'success');
    }

    // ===== EXPORT FUNCTIONS (PART 2) =====
    
    exportCSV() {
        if (this.coordinates.length === 0) {
            this.showMessage('No data to export', 'error');
            return;
        }
        
        let csv = 'Point,X,Y,Latitude,Longitude,Distance,Bearing\n';
        
        this.coordinates.forEach((coord, index) => {
            const traverseItem = this.traverseData[index - 1];
            const pos = this.getExportLatLng(coord);
            csv += `${index},${coord.x.toFixed(3)},${coord.y.toFixed(3)},${pos ? pos.lat.toFixed(6) : ''},${pos ? pos.lng.toFixed(6) : ''},`;
            csv += `${traverseItem ? traverseItem.distance.toFixed(2) : ''},${traverseItem ? traverseItem.bearing.toFixed(2) : ''}\n`;
        });
        
        this.downloadFile(csv, 'survey_data.csv', 'text/csv');
        this.showMessage('✓ CSV exported!', 'success');
    }

    exportGeoJSON() {
        if (this.coordinates.length === 0) {
            this.showMessage('No data to export', 'error');
            return;
        }

        const positions = this.coordinates.map(coord => this.getExportLatLng(coord));
        if (positions.some(p => p === null)) {
            this.showMessage('⚠ GeoJSON needs real coordinates for every point - select "WGS 84 / UTM Zone 43N" or finish georeferencing with GCPs first', 'error');
            return;
        }
        
        const geojson = {
            type: 'FeatureCollection',
            crs: {
                type: 'name',
                properties: {
                    name: 'urn:ogc:def:crs:EPSG::4326'
                }
            },
            features: [
                {
                    type: 'Feature',
                    properties: {
                        name: document.getElementById('projectName').value,
                        survey_number: document.getElementById('surveyNumber').value,
                        village: document.getElementById('village').value,
                        area_m2: this.calculateAreaValue(),
                        perimeter_m: this.calculatePerimeterValue()
                    },
                    geometry: {
                        type: 'Polygon',
                        coordinates: [[
                            ...positions.map(p => [p.lng, p.lat]),
                            [positions[0].lng, positions[0].lat]
                        ]]
                    }
                }
            ]
        };
        
        this.downloadFile(JSON.stringify(geojson, null, 2), 'survey_plot.geojson', 'application/json');
        this.showMessage('✓ GeoJSON exported (QGIS compatible)!', 'success');
    }

    exportKML() {
        if (this.coordinates.length === 0) {
            this.showMessage('No data to export', 'error');
            return;
        }

        const positions = this.coordinates.map(coord => this.getExportLatLng(coord));
        if (positions.some(p => p === null)) {
            this.showMessage('⚠ KML needs real coordinates for every point - select "WGS 84 / UTM Zone 43N" or finish georeferencing with GCPs first', 'error');
            return;
        }
        
        const coords = positions.map(p => `${p.lng},${p.lat},0`).join(' ');
        const closedCoords = coords + ` ${positions[0].lng},${positions[0].lat},0`;
        
        const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${document.getElementById('projectName').value}</name>
    <description>Chain Survey Plot - Survey No: ${document.getElementById('surveyNumber').value}</description>
    <Placemark>
      <name>Survey Plot ${document.getElementById('surveyNumber').value}</name>
      <description>Village: ${document.getElementById('village').value}</description>
      <Polygon>
        <extrude>1</extrude>
        <altitudeMode>relativeToGround</altitudeMode>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>${closedCoords}</coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>`;
        
        this.downloadFile(kml, 'survey_plot.kml', 'application/vnd.google-earth.kml+xml');
        this.showMessage('✓ KML exported (Google Earth compatible)!', 'success');
    }

    exportShapefile() {
        if (this.coordinates.length === 0) {
            this.showMessage('No data to export', 'error');
            return;
        }

        const positions = this.coordinates.map(coord => this.getExportLatLng(coord));
        if (positions.some(p => p === null)) {
            this.showMessage('⚠ Shapefile needs real coordinates for every point - select "WGS 84 / UTM Zone 43N" or finish georeferencing with GCPs first', 'error');
            return;
        }
        
        const geojson = {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                properties: {
                    NAME: document.getElementById('projectName').value,
                    SURVEY_NO: document.getElementById('surveyNumber').value,
                    VILLAGE: document.getElementById('village').value,
                    AREA_M2: this.calculateAreaValue(),
                    PERIMETER: this.calculatePerimeterValue()
                },
                geometry: {
                    type: 'Polygon',
                    coordinates: [[
                        ...positions.map(p => [p.lng, p.lat]),
                        [positions[0].lng, positions[0].lat]
                    ]]
                }
            }]
        };
        
        const zip = new JSZip();
        zip.file('survey_plot.geojson', JSON.stringify(geojson, null, 2));
        zip.file('README.txt', 'Open this GeoJSON in QGIS:\n1. Layer > Add Layer > Add Vector Layer\n2. Select this file\n3. Right-click > Export As > ESRI Shapefile');
        
        zip.generateAsync({ type: 'blob' }).then(content => {
            saveAs(content, 'survey_plot_shapefile.zip');
            this.showMessage('✓ Shapefile exported!', 'success');
        });
    }

    exportDXF() {
        if (this.coordinates.length === 0) {
            this.showMessage('No data to export', 'error');
            return;
        }
        
        let dxf = `  0\nSECTION\n  2\nENTITIES\n`;
        
        dxf += `  0\nPOLYLINE\n  8\nSURVEY_BOUNDARY\n 70\n1\n`;
        
        this.coordinates.forEach(coord => {
            dxf += `  0\nVERTEX\n  8\nSURVEY_BOUNDARY\n 10\n${coord.x.toFixed(3)}\n 20\n${coord.y.toFixed(3)}\n`;
        });
        
        dxf += `  0\nVERTEX\n  8\nSURVEY_BOUNDARY\n 10\n${this.coordinates[0].x.toFixed(3)}\n 20\n${this.coordinates[0].y.toFixed(3)}\n`;
        dxf += `  0\nSEQEND\n  0\nENDSEC\n  0\nEOF\n`;
        
        this.downloadFile(dxf, 'survey_plot.dxf', 'application/dxf');
        this.showMessage('✓ DXF exported (AutoCAD compatible)!', 'success');
    }

    // Draws the traverse shape as a scaled vector diagram directly onto
    // the PDF page - not a screenshot, so it stays crisp at any zoom -
    // with each point numbered to match the coordinate table below it.
    drawShapeDiagram(doc, boxX, boxY, boxWidth, boxHeight) {
        doc.setDrawColor(180);
        doc.setLineWidth(0.3);
        doc.rect(boxX, boxY, boxWidth, boxHeight);

        if (this.coordinates.length < 2) {
            doc.setFontSize(10);
            doc.setTextColor(150);
            doc.text('No plot data available', boxX + boxWidth / 2, boxY + boxHeight / 2, { align: 'center' });
            doc.setTextColor(0);
            return;
        }

        const xs = this.coordinates.map(c => c.x);
        const ys = this.coordinates.map(c => c.y);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);
        const shapeWidth = (maxX - minX) || 1;
        const shapeHeight = (maxY - minY) || 1;

        const padding = 14; // mm, room for point labels near the edges
        const drawableWidth = boxWidth - padding * 2;
        const drawableHeight = boxHeight - padding * 2;
        const scale = Math.min(drawableWidth / shapeWidth, drawableHeight / shapeHeight);

        // Survey Y increases "up"; PDF Y increases downward - flip it.
        const toPage = (x, y) => [
            boxX + padding + (x - minX) * scale,
            boxY + boxHeight - padding - (y - minY) * scale
        ];

        doc.setDrawColor(74, 105, 189);
        doc.setLineWidth(0.5);
        for (let i = 0; i < this.coordinates.length - 1; i++) {
            const [x1, y1] = toPage(this.coordinates[i].x, this.coordinates[i].y);
            const [x2, y2] = toPage(this.coordinates[i + 1].x, this.coordinates[i + 1].y);
            doc.line(x1, y1, x2, y2);
        }

        this.coordinates.forEach((coord, index) => {
            const [px, py] = toPage(coord.x, coord.y);
            doc.setFillColor(255, 107, 107);
            doc.circle(px, py, 1.3, 'F');
            doc.setFontSize(8);
            doc.setTextColor(30);
            doc.text(String(index), px + 2.2, py - 1.5);
        });
        doc.setTextColor(0);

        doc.setFontSize(8);
        doc.setTextColor(140);
        doc.text('Diagram is scaled to fit the page - not to a fixed scale', boxX, boxY + boxHeight + 5);
        doc.setTextColor(0);
    }

    exportPDF() {
        if (this.coordinates.length === 0) {
            this.showMessage('No data to export', 'error');
            return;
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const projectName = document.getElementById('projectName').value || 'Survey';

        doc.setFontSize(18);
        doc.setFont(undefined, 'bold');
        doc.text('Chain Survey Report', 20, 20);
        doc.setFont(undefined, 'normal');

        doc.setFontSize(11);
        doc.text(`Project: ${projectName}`, 20, 30);
        doc.text(`Survey No: ${document.getElementById('surveyNumber').value}`, 20, 37);
        doc.text(`Village: ${document.getElementById('village').value}`, 20, 44);

        doc.setFontSize(10);
        doc.text(
            `Area: ${this.calculateAreaValue().toFixed(2)} m2   |   Perimeter: ${this.calculatePerimeterValue().toFixed(2)} m   |   Points: ${this.coordinates.length}`,
            20, 54
        );

        doc.setFontSize(12);
        doc.setFont(undefined, 'bold');
        doc.text('Plot Diagram', 20, 66);
        doc.setFont(undefined, 'normal');
        this.drawShapeDiagram(doc, 20, 71, 170, 100);

        // Coordinate table on its own page, properly formatted with
        // borders and a header row instead of hand-spaced plain text.
        doc.addPage();
        doc.setFontSize(14);
        doc.setFont(undefined, 'bold');
        doc.text('Coordinate Table', 20, 20);
        doc.setFont(undefined, 'normal');

        const rows = this.coordinates.map((coord, index) => {
            const traverseItem = this.traverseData[index - 1];
            const pos = this.getExportLatLng(coord);
            return [
                index,
                coord.x.toFixed(3),
                coord.y.toFixed(3),
                pos ? pos.lat.toFixed(6) : '-',
                pos ? pos.lng.toFixed(6) : '-',
                traverseItem ? traverseItem.distance.toFixed(2) : '-',
                traverseItem ? traverseItem.bearing.toFixed(2) + ' deg' : '-'
            ];
        });

        doc.autoTable({
            startY: 26,
            head: [['Pt', 'X (m)', 'Y (m)', 'Latitude', 'Longitude', 'Distance (m)', 'Bearing']],
            body: rows,
            theme: 'grid',
            headStyles: { fillColor: [44, 90, 160], textColor: 255, fontStyle: 'bold' },
            styles: { fontSize: 9, cellPadding: 3 },
            alternateRowStyles: { fillColor: [245, 247, 250] }
        });

        doc.save(`${projectName.replace(/[^a-z0-9]/gi, '_')}_report.pdf`);
        this.showMessage('✓ PDF report exported with diagram!', 'success');
    }

    calculateAreaValue() {
        if (this.coordinates.length < 3) return 0;
        
        let area = 0;
        for (let i = 0; i < this.coordinates.length - 1; i++) {
            area += (this.coordinates[i].x * this.coordinates[i + 1].y) - 
                    (this.coordinates[i + 1].x * this.coordinates[i].y);
        }
        return Math.abs(area) / 2;
    }

    calculatePerimeterValue() {
        if (this.coordinates.length < 2) return 0;
        
        let perimeter = 0;
        for (let i = 0; i < this.coordinates.length - 1; i++) {
            const dx = this.coordinates[i + 1].x - this.coordinates[i].x;
            const dy = this.coordinates[i + 1].y - this.coordinates[i].y;
            perimeter += Math.sqrt(dx * dx + dy * dy);
        }
        return perimeter;
    }

    downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    showMessage(message, type) {
        let container = document.getElementById('toastContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toastContainer';
            container.className = 'toast-container';
            document.body.appendChild(container);
        }

        const icons = { success: '✓', error: '⚠' };
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `<span class="toast-icon">${icons[type] || 'i'}</span><span>${message}</span>`;
        container.appendChild(toast);

        // Triggering the "in" animation on the next frame (rather than
        // immediately) is what makes the CSS transition actually play -
        // adding the class in the same instant the element is created
        // would skip straight to its end state with no visible motion.
        requestAnimationFrame(() => toast.classList.add('toast-visible'));

        setTimeout(() => {
            toast.classList.remove('toast-visible');
            toast.addEventListener('transitionend', () => toast.remove(), { once: true });
        }, 4000);
    }
}

