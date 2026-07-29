function About({ onClose }) {
  return (
    <div style={styles.page}>
      <div style={styles.headerBar}>
        <h1 style={styles.title}>ℹ️ About &amp; How to Use</h1>
        <button onClick={onClose} style={styles.backBtn}>← Back to App</button>
      </div>

      <div style={styles.content}>
        <p style={styles.intro}>
          This app converts historical chain survey field records (distance + bearing per leg)
          into modern GIS data - real coordinates, maps, and export formats like GeoJSON, KML,
          Shapefile, DXF, and PDF. Every section below explains one part of the screen.
        </p>

        <Section title="📝 Project Details">
          <p>Give your survey a name, survey number, and village - these appear on every
          exported report and file. They're just labels; changing them doesn't affect any
          calculations.</p>
        </Section>

        <Section title="💾 Save, Load & Share">
          <ul>
            <li><b>Save Project</b> - saves everything (project details, traverse data, plotted
            coordinates) to the cloud, tied to your account. Also downloads a local backup copy.</li>
            <li><b>Load Project</b> / <b>List Projects</b> - shows every project you own, plus
            anything shared with you. Selecting one restores it completely, including the plot.</li>
            <li><b>Share Project</b> - enter someone's email to give them access to the project
            you currently have open. They need an existing account first. Save or load a project
            before sharing it, so the app knows which one to share.</li>
            <li>Viewers (a role an admin can assign) can open and look at shared projects but
            can't save changes - the Save button is disabled for that role.</li>
          </ul>
        </Section>

        <Section title="🌍 Coordinate System">
          <p>Controls how the app relates your local drawing to the real world:</p>
          <ul>
            <li><b>Local Coordinates</b> - your plot is just a drawing with no real-world
            meaning. Fine for quick sketches, but map layers like OpenStreetMap won't show your
            shape in the right place.</li>
            <li><b>WGS 84 / UTM Zone 43N</b> - the one with real math behind it. Once selected,
            every point automatically gets a correct real-world position, using actual projection
            math (not an approximation) - no Ground Control Points required.</li>
            <li><b>Geographic (EPSG:4326)</b> - passes coordinates through as raw degrees. Doesn't
            mix meaningfully with meter-based leg distances - mainly for tagging, not calculation.</li>
            <li><b>Custom CRS</b> - not fully supported yet for real conversion.</li>
          </ul>
        </Section>

        <Section title="📍 Georeferencing">
          <p><b>Method 1 (Start X / Y)</b> is not a GPS location - it just sets where your
          drawing begins on its own local grid, in meters. Typing a real latitude/longitude
          here causes exactly the wrong-location bugs you might have seen - don't use real GPS
          numbers in these two fields.</p>
          <p><b>Method 2 (4+ Ground Control Points)</b> is the traditional way to anchor your
          drawing to the real world: pair 4 or more of your survey points with their real
          latitude/longitude (from Google Earth, for example), either by typing them in or using
          <b> "📍 Click Map to Add"</b> to pick two points directly off your plotted shape. Once 4+
          are filled in, the map and coordinate table update automatically as you type or edit -
          no button click needed. More than 4 points generally improves accuracy.</p>
        </Section>

        <Section title="📏 Units & Bearing Format">
          <p>Set the unit your field distances were recorded in (Gunter's links, chains, feet, or
          meters) and how you want to enter bearings:</p>
          <ul>
            <li><b>DMS</b> - three boxes: degrees (0-360), minutes, seconds. No symbols to type.</li>
            <li><b>Decimal Degrees</b> - one box, e.g. <code>32.2583</code>.</li>
            <li><b>Quadrant</b> - N/S and E/W dropdowns plus degrees/minutes, e.g. N 32° 15' E.</li>
          </ul>
          <p>Switching either dropdown updates every row automatically, converting existing
          values so nothing is lost.</p>
        </Section>

        <Section title="📥 Import Data">
          <p>Import a CSV, Excel, or JSON file with Distance and Bearing columns (any column
          order, flexible naming - "Lat", "Latitude" both work). Download the template button
          first to get a file matching your current unit and bearing format exactly.</p>
          <p>Optionally add Latitude/Longitude columns - a row with both filled in becomes an
          <b> anchor point</b> (marked 📍): the app treats that as a known real position rather
          than only calculating it from distance and bearing, and every leg after it continues
          correctly from that corrected point. This only works with "WGS 84 / UTM Zone 43N"
          selected as the coordinate system.</p>
        </Section>

        <Section title="Traverse Data (the leg table)">
          <ul>
            <li>Each row is one leg: distance + bearing from the previous point.</li>
            <li><b>+ Add Leg</b> adds a new row at the <b>top</b> of the table for visibility with
            long lists - but the underlying survey math always uses the true order legs were
            created in, never the visual order, so this is always safe.</li>
            <li><b>Calculate Plot</b> recalculates everything and redraws the map.</li>
            <li>✏️ edits a leg's distance/bearing in a popup; 🗑️ deletes it.</li>
          </ul>
        </Section>

        <Section title="Closure Analysis">
          <p>Shows how far your traverse's last point is from where it should meet the first
          point (a "closed" survey should return to its start). <b>Auto-Adjust Closure</b>
          distributes that error proportionally across all points (the Bowditch method) - a
          standard technique for cleaning up small measurement drift.</p>
        </Section>

        <Section title="🗺️ Plot Visualization">
          <ul>
            <li><b>Fit to View</b> - zooms/pans to show your whole shape.</li>
            <li><b>Full Extent</b> - resets the view all the way out (independent of your
            survey's shape) - useful for getting your bearings after panning or zooming
            somewhere confusing.</li>
            <li><b>Labels</b> - toggles point number labels on/off.</li>
            <li><b>Grid</b> - toggles the local reference grid (Simple Plot mode only).</li>
            <li><b>Layers</b> - switch between Simple Plot (local, no real-world meaning),
            OpenStreetMap, Satellite, and Terrain.</li>
            <li><b>Edit Point</b> - click a plotted point to edit its coordinates directly.</li>
            <li>Double-clicking a point on the map also opens it for editing.</li>
          </ul>
        </Section>

        <Section title="📊 Export & Download">
          <ul>
            <li><b>CSV</b> - a spreadsheet-friendly table of every point, with real coordinates
            where available.</li>
            <li><b>GeoJSON</b>, <b>KML</b>, <b>Shapefile</b> - real-world GIS formats for QGIS,
            Google Earth, etc. These need a real position for every point - if you haven't
            georeferenced yet, you'll get a clear message instead of a broken file.</li>
            <li><b>DXF</b> - for AutoCAD, always uses your local plan coordinates (correct for
            CAD drawings, which aren't GPS-based).</li>
            <li><b>PDF Report</b> - a printable summary including a scaled diagram of your plotted
            shape with labeled points, plus the full coordinate table.</li>
          </ul>
        </Section>

        <Section title="Coordinate Table (bottom panel)">
          <p>Shows every point's local X/Y and (where determinable) real latitude/longitude.
          Click any row, or double-click its point on the map, to edit it directly.</p>
        </Section>

        <div style={styles.credit}>
          <p style={styles.creditName}>Prepared by Luqumanul Hakeem</p>
          <p style={styles.creditRole}>GIS Expert</p>
          <p style={styles.creditContact}>+91 9014834863</p>
          <p style={styles.creditContact}>luquman75@gmail.com</p>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <details style={styles.section} open>
      <summary style={styles.summary}>{title}</summary>
      <div style={styles.sectionBody}>{children}</div>
    </details>
  );
}

const styles = {
  page: {
    position: 'fixed',
    inset: 0,
    overflowY: 'auto',
    zIndex: 15000,
    background: '#f8f9fa',
    fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif"
  },
  headerBar: {
    background: 'linear-gradient(135deg, #2c5aa0 0%, #4a69bd 100%)',
    color: 'white',
    padding: '18px 24px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '10px'
  },
  title: { fontSize: '20px', margin: 0 },
  backBtn: {
    background: 'rgba(255,255,255,0.2)', color: 'white', border: 'none',
    padding: '10px 18px', borderRadius: '5px', fontWeight: 600, cursor: 'pointer'
  },
  content: { maxWidth: '820px', margin: '0 auto', padding: '24px 20px 60px' },
  intro: { fontSize: '14px', color: '#444', lineHeight: 1.6, marginBottom: '24px' },
  section: {
    background: 'white', borderRadius: '8px', padding: '14px 18px',
    marginBottom: '14px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
  },
  summary: { fontWeight: 700, fontSize: '15px', color: '#2c5aa0', cursor: 'pointer' },
  sectionBody: { fontSize: '13.5px', color: '#333', lineHeight: 1.6, marginTop: '10px' },
  credit: {
    textAlign: 'center',
    marginTop: '32px',
    padding: '20px',
    borderTop: '1px solid #e0e0e0'
  },
  creditName: { fontWeight: 700, fontSize: '14.5px', color: '#2c5aa0', margin: '0 0 4px' },
  creditRole: { fontSize: '12.5px', color: '#666', margin: '0 0 8px' },
  creditContact: { fontSize: '12.5px', color: '#666', margin: '2px 0' }
};

export default About;
