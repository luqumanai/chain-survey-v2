import { useEffect, useState } from 'react';
import { ChainSurveyConverter } from './legacy-chain-survey.js';
import About from './About.jsx';
import './legacy-chain-survey.css';

function App() {
  const [showAbout, setShowAbout] = useState(false);

  useEffect(() => {
    const app = new ChainSurveyConverter();
    window.chainSurvey = app;
  }, []);

  return (
    <>
      {showAbout && <About onClose={() => setShowAbout(false)} />}
      <div className="container" style={{ display: showAbout ? 'none' : 'block' }}>
      <header>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1>🗺️ Chain Survey to GIS Converter</h1>
            <p>Convert historical chain survey records to modern GIS formats</p>
          </div>
          <div>
            <button
              onClick={() => setShowAbout(true)}
              style={{
                color: 'white', textDecoration: 'none', background: 'rgba(255,255,255,0.2)',
                padding: '10px 20px', borderRadius: '5px', fontWeight: 600, border: 'none', cursor: 'pointer', fontSize: '14px'
              }}
            >
              ℹ️ About
            </button>
          </div>
        </div>
      </header>

      <div className="main-content">
        {/* Left Panel - Data Entry */}
        <div className="left-panel" id="leftPanel">
          <div className="panel-header">
            <h3>📝 Data Entry</h3>
            <button className="hide-panel-btn" id="hideLeftPanelBtn" title="Hide Panel">◄</button>
          </div>

          <div className="project-info">
            <h3>Project Details</h3>
            <input type="text" id="projectName" placeholder="Project Name" defaultValue="Survey Plot 1" />
            <input type="text" id="surveyNumber" placeholder="Survey Number" defaultValue="165" />
            <input type="text" id="village" placeholder="Village" defaultValue="Tirumelli" />
          </div>

          <div className="save-load-section">
            <h3>💾 Save & Load</h3>
            <button id="saveProjectBtn">💾 Save Project</button>
            <button id="loadProjectBtn">📂 Load Project</button>
            <button id="listProjectsBtn">📋 List Projects</button>
            <button id="shareProjectBtn">🤝 Share Project</button>
            <select id="projectSelect" style={{ display: 'none' }}>
              <option>-- Select Project --</option>
            </select>
          </div>

          <div className="coordinate-system">
            <h3>Coordinate System</h3>
            <select id="crsSelect">
              <option value="local">Local Coordinates (0,0)</option>
              <option value="utm43n">WGS 84 / UTM Zone 43N (EPSG:32643)</option>
              <option value="geographic">WGS 84 Geographic (EPSG:4326)</option>
              <option value="custom">Custom CRS</option>
            </select>
            <div id="customCRS" style={{ display: 'none' }}>
              <input type="text" id="customEPSG" placeholder="EPSG Code (e.g., 32643)" />
            </div>
          </div>

          <div className="reference-point">
            <h3>🌍 Georeferencing</h3>
            <h4 style={{ marginTop: 0 }}>Method 1: Reference Point</h4>
            <input type="number" id="startX" placeholder="Start X (Longitude)" defaultValue="0" step="any" />
            <input type="number" id="startY" placeholder="Start Y (Latitude)" defaultValue="0" step="any" />
            <button id="getCurrentLocation">📍 Use GPS</button>

            <hr style={{ margin: '15px 0', border: '1px solid #ddd' }} />

            <h4>Method 2: 4-Point Georeferencing</h4>
            <p style={{ fontSize: '12px', color: '#666', margin: '0 0 10px 0' }}>
              <strong>⭐ Auto-Detect:</strong> Add GCP or Click Map Point twice to create reference
            </p>
            <div id="gcpSection">
              <button id="addGCPBtn">➕ Add GCP</button>
              <button id="mapClickGCPBtn" style={{ background: '#17a2b8' }}>📍 Click Map to Add</button>
              <div id="gcpList"></div>
            </div>

            <button id="calculateGeoreferenceBtn" style={{ width: '100%', marginTop: '10px', background: '#28a745' }}>
              📐 Calculate Georeference
            </button>
          </div>

          <div className="units-section">
            <h3>Units & Format</h3>
            <select id="distanceUnit">
              <option value="links">Links (Gunter's Chain)</option>
              <option value="chains">Chains</option>
              <option value="feet">Feet</option>
              <option value="meters">Meters</option>
            </select>
            <select id="bearingFormat">
              <option value="dms">Degrees Minutes Seconds (32°15'30")</option>
              <option value="decimal">Decimal Degrees (32.258)</option>
              <option value="quadrant">Quadrant Bearing (N 32° 15' E)</option>
            </select>
          </div>

          <div className="import-section">
            <h3>📥 Import Data</h3>
            <input type="file" id="importFile" accept=".csv,.json,.xlsx" />
            <button id="importBtn">📤 Import File</button>
            <button id="downloadTemplateBtn">📋 Download Template</button>
          </div>

          <div className="live-preview">
            <h3>📍 Live Preview</h3>
            <div id="livePreviewBox">
              <p style={{ color: '#999', textAlign: 'center' }}>Points will appear here as you enter data</p>
            </div>
          </div>

          <div className="traverse-data">
            <h3>Traverse Data</h3>
            <div className="table-container">
              <table id="traverseTable">
                <thead>
                  <tr>
                    <th>Leg</th>
                    <th>Distance</th>
                    <th>Bearing (°'")</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr data-leg-seq="1">
                    <td>1</td>
                    <td><input type="text" className="distance-input" placeholder="203.5" /></td>
                    <td>
                      <span className="bearing-group">
                        <input type="text" className="bearing-deg" placeholder="0-360" maxLength={3} inputMode="numeric" />°
                        <input type="text" className="bearing-min" placeholder="MM" maxLength={2} inputMode="numeric" />'
                        <input type="text" className="bearing-sec" placeholder="SS" maxLength={2} inputMode="numeric" />"
                      </span>
                      <input type="hidden" className="bearing-input" defaultValue="" />
                    </td>
                    <td>
                      <button className="edit-btn" onClick={(e) => window.chainSurvey.editLeg(e.currentTarget)}>✏️</button>
                      <button className="delete-btn" onClick={(e) => window.chainSurvey.deleteLeg(e.currentTarget)}>🗑️</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <button id="addLegBtn">+ Add Leg</button>
            <button id="calculateBtn">🔄 Calculate Plot</button>
          </div>

          <div className="closure-info">
            <h3>Closure Analysis</h3>
            <div id="closureResults">
              <p>Enter data and calculate to see closure error</p>
            </div>
            <button id="adjustClosureBtn">⚙️ Auto-Adjust Closure</button>
          </div>
        </div>

        {/* Right Panel - Visualization */}
        <div className="right-panel">
          <div className="map-controls">
            <div className="control-top">
              <h3>Plot Visualization</h3>
              <button className="hide-panel-btn" id="showLeftPanelBtn" title="Show Panel" style={{ display: 'none' }}>►</button>
            </div>
            <div className="control-buttons">
              <button id="zoomFitBtn">🔍 Fit to View</button>
              <button id="fullExtentBtn">🌐 Full Extent</button>
              <button id="toggleLabelsBtn">🏷️ Labels</button>
              <button id="toggleGridBtn">⊞ Grid</button>
              <button id="toggleMapLayerBtn">🗺️ Layers</button>
              <button id="editPointBtn" style={{ background: '#17a2b8' }}>✏️ Edit Point</button>
            </div>
            <div className="map-layer-selector">
              <label><input type="radio" name="mapType" value="simple" defaultChecked /> Simple Plot</label>
              <label><input type="radio" name="mapType" value="osm" /> OpenStreetMap</label>
              <label><input type="radio" name="mapType" value="satellite" /> Satellite (Bing)</label>
              <label><input type="radio" name="mapType" value="terrain" /> Terrain</label>
            </div>
          </div>

          <div style={{ position: 'relative' }}>
            <div id="mapContainer"></div>
            <button
              id="mapFullscreenBtn"
              title="Expand map to full screen"
              style={{
                position: 'absolute', top: '10px', right: '10px', zIndex: 1000,
                background: 'white', border: '2px solid rgba(0,0,0,0.2)', borderRadius: '4px',
                width: '34px', height: '34px', fontSize: '16px', cursor: 'pointer'
              }}
            >⛶</button>
          </div>

          <div className="plot-info">
            <div className="info-grid">
              <div><strong>Area:</strong> <span id="areaDisplay">- m²</span></div>
              <div><strong>Perimeter:</strong> <span id="perimeterDisplay">- m</span></div>
              <div><strong>Points:</strong> <span id="pointsCount">0</span></div>
              <div><strong>Closure Error:</strong> <span id="closureError">- m</span></div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Panel - Export & Coordinates Table */}
      <div className="bottom-panel" id="bottomPanel">
        <div className="panel-toggle">
          <button className="hide-panel-btn" id="hideBottomPanelBtn" title="Hide Panel">▼</button>
        </div>

        <div className="export-section">
          <h3>Export & Download</h3>
          <div className="export-buttons">
            <button id="exportCSV">📊 CSV</button>
            <button id="exportGeoJSON">🗂️ GeoJSON</button>
            <button id="exportKML">🌍 KML</button>
            <button id="exportSHP">📦 Shapefile</button>
            <button id="exportDXF">📐 DXF</button>
            <button id="exportPDF">📄 PDF Report</button>
          </div>
        </div>

        <div className="coordinates-table">
          <h3>Coordinate Table <span style={{ fontSize: '12px' }}>(Click row to edit • Double-click map point to edit)</span></h3>
          <div id="coordinatesDisplay">
            <table id="coordTable">
              <thead>
                <tr>
                  <th>Pt</th>
                  <th>X (Local)</th>
                  <th>Y (Local)</th>
                  <th>Latitude</th>
                  <th>Longitude</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody></tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Edit Traverse Leg Modal */}
      <div id="editModal" className="modal">
        <div className="modal-content">
          <span className="close">&times;</span>
          <h3>Edit Traverse Leg</h3>
          <div className="modal-form">
            <label>Distance:</label>
            <input type="text" id="editDistance" placeholder="203.5" />
            <label>Bearing - Degrees (0-359):</label>
            <input type="text" id="editBearingDeg" placeholder="32" maxLength={3} />
            <label>Minutes (0-59):</label>
            <input type="text" id="editBearingMin" placeholder="15" maxLength={2} />
            <label>Seconds (0-59):</label>
            <input type="text" id="editBearingSec" placeholder="30" maxLength={2} />
            <div className="modal-buttons">
              <button id="saveEdit">💾 Save</button>
              <button id="cancelEdit">❌ Cancel</button>
            </div>
          </div>
        </div>
      </div>

      {/* Edit Point Coordinates Modal */}
      <div id="georefModal" className="modal">
        <div className="modal-content">
          <span className="close">&times;</span>
          <h3>Edit Point Coordinates</h3>
          <div className="modal-form">
            <label>Point Number:</label>
            <input type="number" id="georefPointNum" disabled />
            <label>Local Coordinates:</label>
            <input type="number" id="georefLocalX" placeholder="X" step="any" disabled />
            <input type="number" id="georefLocalY" placeholder="Y" step="any" disabled />
            <label>Real-World Coordinates (Lat/Long from Google Earth):</label>
            <p style={{ fontSize: '11px', color: '#666', margin: '5px 0' }}>
              ⭐ In Google Earth: Right-click point → Copy coordinates → Paste here
            </p>
            <input type="number" id="georefRealLat" placeholder="Latitude (e.g., 11.8745)" step="any" />
            <input type="number" id="georefRealLng" placeholder="Longitude (e.g., 75.3572)" step="any" />
            <div className="modal-buttons">
              <button id="saveGeorefEdit">💾 Save Coordinates</button>
              <button id="cancelGeorefEdit">❌ Cancel</button>
            </div>
          </div>
        </div>
      </div>

      {/* GCP Click Mode Modal */}
      <div id="gcpClickModal" className="modal">
        <div className="modal-content" style={{ width: '350px' }}>
          <span className="close">&times;</span>
          <h3>📍 Add GCP via Map Click</h3>
          <div className="modal-form">
            <p style={{ color: '#666', marginBottom: '15px' }}>
              Click a point on the map to add as Ground Control Point
            </p>
            <label>Survey Coordinates (Click point on plot):</label>
            <input type="number" id="gcpClickSurveyX" placeholder="X" step="any" disabled />
            <input type="number" id="gcpClickSurveyY" placeholder="Y" step="any" disabled />
            <label>Real-World Coordinates (From Google Earth):</label>
            <input type="number" id="gcpClickRealLat" placeholder="Latitude" step="any" />
            <input type="number" id="gcpClickRealLng" placeholder="Longitude" step="any" />
            <div className="modal-buttons">
              <button id="saveGCPClick">💾 Add GCP</button>
              <button id="cancelGCPClick">❌ Cancel</button>
            </div>
          </div>
        </div>
      </div>

      {/* Footer Credit */}
      <div className="footer-credit">👤 Prepared by LH</div>
    </div>
    </>
  );
}

export default App;
