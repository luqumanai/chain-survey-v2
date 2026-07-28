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
        
        this.conversionFactors = {
            links: 0.201168,
            chains: 20.1168,
            feet: 0.3048,
            meters: 1
        };
        
        this.init();
    }

    init() {
        this.initMap();
        this.bindEvents();
        this.addInitialRow();
        this.showMessage('Application loaded successfully!', 'success');
    }

    initMap() {
        this.map = L.map('mapContainer', {
            center: [0, 0],
            zoom: 16,
            crs: L.CRS.Simple,
            layers: []
        });

        this.setupMapLayers();
        this.addCoordinateGrid();
        
        this.plotLayer = L.layerGroup().addTo(this.map);

        // Map click event for editing points
        this.map.on('click', (e) => {
            if (this.editPointMode) {
                this.handleMapClickForPointEdit(e);
            } else if (this.gcpClickMode) {
                this.handleMapClickForGCPAdd(e);
            }
        });
    }

    handleMapClickForPointEdit(e) {
        const latlng = e.latlng;
        
        // Find closest point to click
        let closest = null;
        let minDist = Infinity;
        
        this.coordinates.forEach((coord, idx) => {
            const dist = Math.sqrt(Math.pow(latlng.lat - coord.x, 2) + Math.pow(latlng.lng - coord.y, 2));
            if (dist < minDist) {
                minDist = dist;
                closest = idx;
            }
        });

        if (closest !== null && minDist < 50) {
            this.editCoordinates(closest);
        } else {
            this.showMessage('No point near click. Click closer to a point.', 'error');
        }
    }

    handleMapClickForGCPAdd(e) {
        const latlng = e.latlng;
        
        // Find closest point to click
        let closest = null;
        let minDist = Infinity;
        
        this.coordinates.forEach((coord, idx) => {
            const dist = Math.sqrt(Math.pow(latlng.lat - coord.x, 2) + Math.pow(latlng.lng - coord.y, 2));
            if (dist < minDist) {
                minDist = dist;
                closest = idx;
            }
        });

        if (closest !== null && minDist < 50) {
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
        });

        // Live preview on data entry
        document.addEventListener('change', (e) => {
            if (e.target.classList.contains('distance-input') || 
                e.target.classList.contains('bearing-input')) {
                this.updateLivePreview();
            }
        });

        // Bearing input formatting
        document.addEventListener('input', (e) => {
            if (e.target.classList.contains('bearing-input')) {
                this.formatBearingInput(e.target);
            }
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

    addLeg() {
        const tbody = document.querySelector('#traverseTable tbody');
        const rowCount = tbody.children.length + 1;
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${rowCount}</td>
            <td><input type="text" class="distance-input" placeholder="203.5"></td>
            <td><input type="text" class="bearing-input" placeholder="321530" maxlength="6"></td>
            <td>
                <button class="edit-btn" onclick="chainSurvey.editLeg(this)">✏️</button>
                <button class="delete-btn" onclick="chainSurvey.deleteLeg(this)">🗑️</button>
            </td>
        `;
        
        tbody.appendChild(row);
        this.updateLivePreview();
    }

    addInitialRow() {
        const tbody = document.querySelector('#traverseTable tbody');
        if (tbody.children.length === 1) {
            this.addLeg();
            this.addLeg();
            this.addLeg();
            
            const rows = tbody.querySelectorAll('tr');
            if (rows.length >= 4) {
                rows[1].querySelector('.distance-input').value = '344';
                rows[1].querySelector('.bearing-input').value = '960000';
                
                rows[2].querySelector('.distance-input').value = '516';
                rows[2].querySelector('.bearing-input').value = '2300000';
                
                rows[3].querySelector('.distance-input').value = '285';
                rows[3].querySelector('.bearing-input').value = '3000000';
                
                rows[1].querySelector('.bearing-input').value = '96°00\'00"';
                rows[2].querySelector('.bearing-input').value = '230°00\'00"';
                rows[3].querySelector('.bearing-input').value = '300°00\'00"';
            }
        }
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
            this.renumberRows();
            this.updateLivePreview();
        }
    }

    renumberRows() {
        const rows = document.querySelectorAll('#traverseTable tbody tr');
        rows.forEach((row, index) => {
            row.cells[0].textContent = index + 1;
        });
    }

    saveEdit() {
        if (!this.currentEditRow) return;
        
        const distance = document.getElementById('editDistance').value;
        const degrees = parseInt(document.getElementById('editBearingDeg').value) || 0;
        const minutes = parseInt(document.getElementById('editBearingMin').value) || 0;
        const seconds = parseInt(document.getElementById('editBearingSec').value) || 0;
        
        const bearing = this.bearingToFormattedString(degrees, minutes, seconds);
        
        this.currentEditRow.querySelector('.distance-input').value = distance;
        this.currentEditRow.querySelector('.bearing-input').value = bearing;
        
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
        
        const rows = document.querySelectorAll('#traverseTable tbody tr');
        
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
        
        this.coordinates.forEach((coord, index) => {
            const marker = L.circleMarker([coord.x, coord.y], {
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
            
            L.marker([coord.x, coord.y], {
                icon: L.divIcon({
                    className: 'point-label',
                    html: `<div style="background: white; padding: 2px 6px; border-radius: 3px; font-weight: bold; font-size: 11px; border: 1px solid #ccc;">${index}</div>`,
                    iconSize: [20, 20],
                    iconAnchor: [10, 25]
                })
            }).addTo(this.plotLayer);
        });
        
        if (this.coordinates.length > 1) {
            const leafletCoords = this.coordinates.map(coord => [coord.x, coord.y]);
            
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

    recalculateCoordinates() {
        this.coordinates = [];
        
        const startX = parseFloat(document.getElementById('startX').value) || 0;
        const startY = parseFloat(document.getElementById('startY').value) || 0;
        
        const unit = document.getElementById('distanceUnit').value;
        const conversionFactor = this.conversionFactors[unit];
        
        let currentX = startX;
        let currentY = startY;
        this.coordinates.push({ x: currentX, y: currentY, leg: 0 });
        
        const rows = document.querySelectorAll('#traverseTable tbody tr');
        
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
            
            this.coordinates.push({ 
                x: currentX, 
                y: currentY, 
                leg: index + 1,
                distance: distance,
                bearing: bearingDecimal
            });
        });
    }

    calculatePlot() {
        this.traverseData = [];
        this.coordinates = [];
        
        const startX = parseFloat(document.getElementById('startX').value) || 0;
        const startY = parseFloat(document.getElementById('startY').value) || 0;
        
        const unit = document.getElementById('distanceUnit').value;
        const conversionFactor = this.conversionFactors[unit];
        
        let currentX = startX;
        let currentY = startY;
        this.coordinates.push({ x: currentX, y: currentY, leg: 0 });
        
        const rows = document.querySelectorAll('#traverseTable tbody tr');
        
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
            
            this.coordinates.push({ 
                x: currentX, 
                y: currentY, 
                leg: index + 1,
                distance: distance,
                bearing: bearingDecimal
            });
            
            this.traverseData.push({
                leg: index + 1,
                distance: distance,
                bearing: bearingDecimal,
                x: currentX,
                y: currentY
            });
        });
        
        this.plotShape();
        this.calculateStats();
        this.updateCoordinatesTable();
        this.showMessage('Plot calculated successfully!', 'success');
    }

    plotShape() {
        this.plotLayer.clearLayers();
        
        if (this.coordinates.length < 2) return;
        
        const leafletCoords = this.coordinates.map(coord => [coord.x, coord.y]);
        
        const polyline = L.polyline(leafletCoords, {
            color: '#4a69bd',
            weight: 3,
            opacity: 0.8
        }).addTo(this.plotLayer);
        
        if (this.coordinates.length > 2) {
            const polygon = L.polygon(leafletCoords, {
                color: '#4a69bd',
                fillColor: '#4a69bd',
                fillOpacity: 0.2,
                weight: 2
            }).addTo(this.plotLayer);
        }
        
        this.coordinates.forEach((coord, index) => {
            const marker = L.circleMarker([coord.x, coord.y], {
                radius: 6,
                fillColor: '#ff6b6b',
                color: '#fff',
                weight: 2,
                fillOpacity: 0.8
            }).addTo(this.plotLayer);
            
            marker.bindPopup(`<strong>Point ${index}</strong><br>X: ${coord.x.toFixed(3)}<br>Y: ${coord.y.toFixed(3)}`);
            
            // Double-click event for editing
            marker.on('dblclick', () => {
                this.editCoordinates(index);
            });
            
            L.marker([coord.x, coord.y], {
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
            
            row.innerHTML = `
                <td>${index}</td>
                <td>${coord.x.toFixed(3)}</td>
                <td>${coord.y.toFixed(3)}</td>
                <td>${coord.latitude ? coord.latitude.toFixed(6) : '-'}</td>
                <td>${coord.longitude ? coord.longitude.toFixed(6) : '-'}</td>
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

    fitToView() {
        if (this.coordinates.length === 0) {
            this.showMessage('No data to fit', 'error');
            return;
        }
        
        const group = new L.featureGroup(this.plotLayer.getLayers());
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
        Object.keys(this.mapLayers).forEach(key => {
            if (this.mapLayers[key] instanceof L.LayerGroup) {
                this.map.removeLayer(this.mapLayers[key]);
            } else if (this.mapLayers[key] instanceof L.TileLayer) {
                this.map.removeLayer(this.mapLayers[key]);
            }
        });

        if (layerType === 'simple') {
            this.mapLayers.simple.addTo(this.map);
            this.map.options.crs = L.CRS.Simple;
        } else if (layerType === 'osm') {
            this.mapLayers.osm.addTo(this.map);
            this.map.options.crs = L.CRS.EPSG3857;
            this.map.setView([11.8745, 75.3572], 14);
        } else if (layerType === 'satellite') {
            this.mapLayers.satellite.addTo(this.map);
            this.map.options.crs = L.CRS.EPSG3857;
            this.map.setView([11.8745, 75.3572], 14);
        } else if (layerType === 'terrain') {
            this.mapLayers.terrain.addTo(this.map);
            this.map.options.crs = L.CRS.EPSG3857;
            this.map.setView([11.8745, 75.3572], 14);
        }

        if (this.plotLayer) {
            this.map.removeLayer(this.plotLayer);
            this.plotLayer.addTo(this.map);
        }

        this.currentMapLayer = layerType;

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
        
        if (gcpCount > 4) {
            this.showMessage('Maximum 4 GCPs allowed', 'error');
            return;
        }
        
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

    calculateGeoreference() {
        const gcpItems = document.querySelectorAll('.gcp-item');
        
        if (gcpItems.length < 4) {
            this.showMessage('Please add minimum 4 Ground Control Points', 'error');
            return;
        }
        
        const gcps = [];
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
        
        try {
            this.georeferenceMatrix = this.calculateAffineTransform(gcps);
            this.transformCoordinates();
            this.showMessage('✓ Georeferencing complete! All points transformed.', 'success');
        } catch (error) {
            this.showMessage('Error: ' + error.message, 'error');
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
    
    saveProject() {
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
            timestamp: new Date().toISOString()
        };
        
        const rows = document.querySelectorAll('#traverseTable tbody tr');
        rows.forEach((row) => {
            const distance = row.querySelector('.distance-input').value;
            const bearing = row.querySelector('.bearing-input').value;
            if (distance && bearing) {
                projectData.traverseData.push({ distance, bearing });
            }
        });
        
        const projects = JSON.parse(localStorage.getItem('surveyProjects') || '{}');
        projects[projectName] = projectData;
        localStorage.setItem('surveyProjects', JSON.stringify(projects));
        
        this.downloadFile(JSON.stringify(projectData, null, 2), `${projectName}.json`, 'application/json');
        
        this.showMessage(`✓ Project "${projectName}" saved!`, 'success');
    }

    loadProject() {
        this.listProjects();
        document.getElementById('projectSelect').style.display = 'block';
    }

    listProjects() {
        const projects = JSON.parse(localStorage.getItem('surveyProjects') || '{}');
        const select = document.getElementById('projectSelect');
        
        select.innerHTML = '<option>-- Select Project --</option>';
        
        Object.keys(projects).forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            const date = new Date(projects[name].timestamp).toLocaleDateString();
            option.textContent = `${name} (${date})`;
            select.appendChild(option);
        });
        
        if (Object.keys(projects).length === 0) {
            this.showMessage('No saved projects', 'error');
            select.style.display = 'none';
        }
    }

    selectProjectToLoad(projectName) {
        if (projectName === '-- Select Project --') return;
        
        const projects = JSON.parse(localStorage.getItem('surveyProjects') || '{}');
        const projectData = projects[projectName];
        
        if (!projectData) {
            this.showMessage('Project not found', 'error');
            return;
        }
        
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
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${index + 1}</td>
                <td><input type="text" class="distance-input" value="${row.distance}"></td>
                <td><input type="text" class="bearing-input" value="${row.bearing}"></td>
                <td>
                    <button class="edit-btn" onclick="chainSurvey.editLeg(this)">✏️</button>
                    <button class="delete-btn" onclick="chainSurvey.deleteLeg(this)">🗑️</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
        
        this.coordinates = projectData.coordinates;
        this.calculatePlot();
        document.getElementById('projectSelect').style.display = 'none';
        
        this.showMessage(`✓ Project "${projectName}" loaded!`, 'success');
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

    parseImportedData(content, filename) {
        let data = [];
        
        if (filename.endsWith('.csv')) {
            const lines = content.trim().split('\n');
            
            for (let i = 1; i < lines.length; i++) {
                const values = lines[i].split(',');
                if (values.length >= 2) {
                    data.push({
                        distance: parseFloat(values[0]),
                        bearing: values[1].trim()
                    });
                }
            }
        } else if (filename.endsWith('.json')) {
            data = JSON.parse(content);
        } else if (filename.endsWith('.xlsx')) {
            const workbook = XLSX.read(content, { type: 'binary' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
            
            rows.forEach((row, idx) => {
                if (idx === 0) return;
                const [distance, bearing] = row;
                if (distance && bearing) {
                    data.push({ distance, bearing });
                }
            });
        }
        
        this.loadImportedData(data);
    }

    loadImportedData(data) {
        const tbody = document.querySelector('#traverseTable tbody');
        tbody.innerHTML = '';
        
        data.forEach((row, index) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${index + 1}</td>
                <td><input type="text" class="distance-input" value="${row.distance || ''}"></td>
                <td><input type="text" class="bearing-input" value="${row.bearing || ''}"></td>
                <td>
                    <button class="edit-btn" onclick="chainSurvey.editLeg(this)">✏️</button>
                    <button class="delete-btn" onclick="chainSurvey.deleteLeg(this)">🗑️</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
        
        this.showMessage(`✓ Imported ${data.length} records!`, 'success');
        this.updateLivePreview();
    }

    importData() {
        document.getElementById('importFile').click();
    }

    downloadTemplate() {
        const csv = `Distance,Bearing
203.5,32°15'30"
344,96°0'0"
516,230°0'0"
285,300°0'0"`;
        
        this.downloadFile(csv, 'survey_template.csv', 'text/csv');
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
            csv += `${index},${coord.x.toFixed(3)},${coord.y.toFixed(3)},${coord.latitude ? coord.latitude.toFixed(6) : ''},${coord.longitude ? coord.longitude.toFixed(6) : ''},`;
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
                            ...this.coordinates.map(coord => [coord.longitude || coord.x, coord.latitude || coord.y]),
                            [this.coordinates[0].longitude || this.coordinates[0].x, this.coordinates[0].latitude || this.coordinates[0].y]
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
        
        const coords = this.coordinates.map(coord => `${coord.longitude || coord.x},${coord.latitude || coord.y},0`).join(' ');
        const closedCoords = coords + ` ${this.coordinates[0].longitude || this.coordinates[0].x},${this.coordinates[0].latitude || this.coordinates[0].y},0`;
        
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
                        ...this.coordinates.map(coord => [coord.longitude || coord.x, coord.latitude || coord.y]),
                        [this.coordinates[0].longitude || this.coordinates[0].x, this.coordinates[0].latitude || this.coordinates[0].y]
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

    exportPDF() {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        doc.setFontSize(16);
        doc.text('Chain Survey Report', 20, 20);
        
        doc.setFontSize(12);
        doc.text(`Project: ${document.getElementById('projectName').value}`, 20, 35);
        doc.text(`Survey No: ${document.getElementById('surveyNumber').value}`, 20, 45);
        doc.text(`Village: ${document.getElementById('village').value}`, 20, 55);
        
        doc.text(`Area: ${this.calculateAreaValue().toFixed(2)} m²`, 20, 70);
        doc.text(`Perimeter: ${this.calculatePerimeterValue().toFixed(2)} m`, 20, 80);
        doc.text(`Points: ${this.coordinates.length}`, 20, 90);
        
        doc.text('Coordinates:', 20, 105);
        let y = 115;
        doc.setFontSize(10);
        doc.text('Pt    X           Y           Lat        Lng', 20, y);
        
        this.coordinates.forEach((coord, index) => {
            y += 10;
            if (y > 270) {
                doc.addPage();
                y = 20;
            }
            const lat = coord.latitude ? coord.latitude.toFixed(4) : '-';
            const lng = coord.longitude ? coord.longitude.toFixed(4) : '-';
            doc.text(`${index.toString().padStart(2, ' ')}  ${coord.x.toFixed(3).padStart(9, ' ')}  ${coord.y.toFixed(3).padStart(9, ' ')}  ${lat}  ${lng}`, 20, y);
        });
        
        doc.save('survey_report.pdf');
        this.showMessage('✓ PDF report exported!', 'success');
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
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        messageDiv.textContent = message;
        document.body.appendChild(messageDiv);
        
        setTimeout(() => {
            if (messageDiv.parentNode) {
                messageDiv.parentNode.removeChild(messageDiv);
            }
        }, 4000);
    }
}

