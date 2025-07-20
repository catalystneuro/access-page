// Map visualization module
const MapVisualization = {
    map: null,
    markersLayer: null,
    selectedMarker: null,

    init() {
        this.initializeMap();
        this.setupMarkerLayer();
        this.loadRegions();
    },

    initializeMap() {
        // Initialize Leaflet map
        this.map = L.map('map', {
            center: [20, 0], // Center on world
            zoom: 2,
            minZoom: 1,
            maxZoom: 10,
            worldCopyJump: true,
            zoomControl: true
        });

        // Add tile layer
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 18,
            noWrap: false
        }).addTo(this.map);

        // Store reference in AppState
        AppState.map = this.map;

        // Add zoom event listener to resize bubbles dynamically
        this.map.on('zoomend', () => {
            this.resizeMarkersOnZoom();
        });
    },

    setupMarkerLayer() {
        // Create layer group for markers
        this.markersLayer = L.layerGroup().addTo(this.map);
    },

    async loadRegions() {
        try {
            const regions = AppState.regions;
            this.updateRegions(regions);
        } catch (error) {
            console.error('Error loading regions:', error);
        }
    },

    updateRegions(regions) {
        // Clear existing markers
        this.markersLayer.clearLayers();
        this.selectedMarker = null;

        if (!regions || regions.length === 0) {
            this.updateLegend([]);
            return;
        }

        // Filter regions with data and sort by volume (ascending order)
        // This ensures higher volume regions are added last and appear on top
        const sortedRegions = regions
            .filter(region => region.total_bytes > 0)
            .sort((a, b) => a.total_bytes - b.total_bytes);

        // Calculate size scaling for bubbles
        const maxBytes = Math.max(...sortedRegions.map(r => r.total_bytes));
        const minBytes = Math.min(...sortedRegions.map(r => r.total_bytes));
        const logMax = Math.log(maxBytes);
        const logMin = Math.log(minBytes);

        // Create markers in ascending volume order (low to high)
        // Higher volume markers will be on top
        sortedRegions.forEach(region => {
            this.createRegionMarker(region, logMin, logMax);
        });

        // Update legend with actual data ranges
        this.updateLegend(sortedRegions);
    },

    createRegionMarker(region, logMin, logMax) {
        // Calculate bubble size based on download volume and zoom level
        const logBytes = Math.log(region.total_bytes);
        const normalizedSize = (logBytes - logMin) / (logMax - logMin);
        
        // Get current zoom level for responsive sizing
        const currentZoom = this.map.getZoom();
        const zoomFactor = Math.max(0.3, Math.min(1.5, currentZoom / 10)); // Scale factor based on zoom
        
        // Smaller base radius values and zoom-responsive scaling
        const minRadius = Math.max(2, 3 * zoomFactor);
        const maxRadius = Math.max(8, 15 * zoomFactor);
        const radius = minRadius + (normalizedSize * (maxRadius - minRadius));

        // Create color scale based on download volume
        const color = this.getVolumeColor(normalizedSize);
        
        // Determine opacity based on dataset diversity
        const opacity = Math.min(0.3 + (region.dataset_count / 20), 0.8);

        // Create circle marker with volume-based color
        const marker = L.circleMarker([region.latitude, region.longitude], {
            radius: radius,
            fillColor: color.fill,
            color: color.stroke,
            weight: 2,
            opacity: 0.8,
            fillOpacity: opacity
        });

        // Create popup content
        const popupContent = this.createPopupContent(region);
        marker.bindPopup(popupContent, {
            maxWidth: 300,
            className: 'custom-popup'
        });

        // Add click handler
        marker.on('click', (e) => {
            this.selectRegion(region, marker);
        });

        // Add hover effects
        marker.on('mouseover', (e) => {
            marker.setStyle({
                weight: 3,
                fillOpacity: Math.min(opacity + 0.2, 1.0)
            });
        });

        marker.on('mouseout', (e) => {
            if (marker !== this.selectedMarker) {
                marker.setStyle({
                    weight: 2,
                    fillOpacity: opacity
                });
            }
        });

        // Add to markers layer
        marker.addTo(this.markersLayer);

        // Store region data in marker
        marker.regionData = region;
    },

    createPopupContent(region) {
        const displayName = region.name !== region.code ? 
            `${region.name} (${region.code})` : region.code;
        
        return `
            <div class="popup-content">
                <div class="popup-title">${displayName}</div>
                <div class="popup-stats">
                    <div><strong>Country:</strong> ${region.country}</div>
                    <div><strong>Total Downloads:</strong> ${region.total_bytes_formatted}</div>
                    <div><strong>Datasets:</strong> ${Utils.formatNumber(region.dataset_count)}</div>
                </div>
            </div>
        `;
    },

    selectRegion(region, marker) {
        // Reset previous selection
        if (this.selectedMarker && this.selectedMarker !== marker) {
            const prevRegion = this.selectedMarker.regionData;
            const prevOpacity = Math.min(0.3 + (prevRegion.dataset_count / 20), 0.8);
            this.selectedMarker.setStyle({
                weight: 2,
                fillOpacity: prevOpacity,
                color: '#4a5fb8'
            });
        }

        // Highlight selected marker
        marker.setStyle({
            weight: 4,
            fillOpacity: 0.9,
            color: '#e74c3c'
        });

        this.selectedMarker = marker;

        // Trigger region selection in main app
        App.selectRegion(region.code, region.name);

        // Center map on selected region (with some offset for better view)
        this.map.setView([region.latitude, region.longitude], Math.max(this.map.getZoom(), 4));
    },

    resetSelection() {
        if (this.selectedMarker) {
            const region = this.selectedMarker.regionData;
            const opacity = Math.min(0.3 + (region.dataset_count / 20), 0.8);
            this.selectedMarker.setStyle({
                weight: 2,
                fillOpacity: opacity,
                color: '#4a5fb8'
            });
            this.selectedMarker = null;
        }
    },

    fitToRegions() {
        if (this.markersLayer.getLayers().length > 0) {
            const group = new L.featureGroup(this.markersLayer.getLayers());
            this.map.fitBounds(group.getBounds(), { padding: [20, 20] });
        }
    },

    // Utility methods for external calls
    zoomToRegion(regionCode) {
        const marker = this.findMarkerByRegionCode(regionCode);
        if (marker) {
            this.selectRegion(marker.regionData, marker);
        }
    },

    findMarkerByRegionCode(regionCode) {
        const markers = this.markersLayer.getLayers();
        return markers.find(marker => marker.regionData && marker.regionData.code === regionCode);
    },

    // Method to update map based on dataset filter
    filterByDataset(datasetId) {
        // This will be called when dataset filter changes
        // The actual filtering is handled by updating regions from the API
        AppState.selectedDataset = datasetId;
    },

    // Method to highlight regions based on search or other criteria
    highlightRegions(regionCodes) {
        const markers = this.markersLayer.getLayers();
        markers.forEach(marker => {
            if (marker.regionData) {
                const isHighlighted = regionCodes.includes(marker.regionData.code);
                marker.setStyle({
                    fillOpacity: isHighlighted ? 0.9 : 0.3,
                    weight: isHighlighted ? 3 : 2
                });
            }
        });
    },

    // Add legend update method
    updateLegend(regions) {
        const legendItems = document.querySelectorAll('.legend-item span');
        
        if (!regions || regions.length === 0) {
            // Reset legend when no data
            legendItems.forEach((item, index) => {
                const labels = ['Low Volume', 'Medium Volume', 'Medium-High Volume', 'High Volume'];
                if (item && labels[index]) {
                    item.textContent = labels[index];
                }
            });
            return;
        }

        const maxBytes = Math.max(...regions.map(r => r.total_bytes));
        const minBytes = Math.min(...regions.filter(r => r.total_bytes > 0).map(r => r.total_bytes));
        
        // Calculate logarithmic ranges to match the marker sizing
        const logMax = Math.log(maxBytes);
        const logMin = Math.log(minBytes);
        const logRange = logMax - logMin;
        
        // Define thresholds that match the color categories (0.2, 0.4, 0.6, 0.8)
        const threshold1 = Math.exp(logMin + logRange * 0.2);  // Low volume threshold
        const threshold2 = Math.exp(logMin + logRange * 0.4);  // Medium volume threshold  
        const threshold3 = Math.exp(logMin + logRange * 0.6);  // Medium-high volume threshold
        const threshold4 = Math.exp(logMin + logRange * 0.8);  // High volume threshold
        
        // Update legend text with actual data ranges
        if (legendItems.length >= 4) {
            legendItems[0].textContent = `< ${Utils.formatBytes(threshold1)}`;
            legendItems[1].textContent = `${Utils.formatBytes(threshold1)} - ${Utils.formatBytes(threshold2)}`;
            legendItems[2].textContent = `${Utils.formatBytes(threshold2)} - ${Utils.formatBytes(threshold3)}`;
            legendItems[3].textContent = `> ${Utils.formatBytes(threshold3)}`;
        }
    },

    // Method to resize markers based on zoom level
    resizeMarkersOnZoom() {
        const markers = this.markersLayer.getLayers();
        if (markers.length === 0) return;

        // Calculate new size scaling based on current zoom
        const currentZoom = this.map.getZoom();
        const zoomFactor = Math.max(0.3, Math.min(1.5, currentZoom / 10));
        
        // Get the overall size range for all markers
        const allRegions = markers.map(marker => marker.regionData);
        const maxBytes = Math.max(...allRegions.map(r => r.total_bytes));
        const minBytes = Math.min(...allRegions.filter(r => r.total_bytes > 0).map(r => r.total_bytes));
        const logMax = Math.log(maxBytes);
        const logMin = Math.log(minBytes);

        // Update each marker's radius
        markers.forEach(marker => {
            if (marker.regionData && marker.regionData.total_bytes > 0) {
                const region = marker.regionData;
                const logBytes = Math.log(region.total_bytes);
                const normalizedSize = (logBytes - logMin) / (logMax - logMin);
                
                // Calculate new radius with zoom factor
                const minRadius = Math.max(2, 3 * zoomFactor);
                const maxRadius = Math.max(8, 15 * zoomFactor);
                const newRadius = minRadius + (normalizedSize * (maxRadius - minRadius));
                
                // Update marker radius
                marker.setRadius(newRadius);
            }
        });
    },

    // Method to get color based on download volume
    getVolumeColor(normalizedSize) {
        // Create a color gradient from low (blue) to high (red) volume
        // Using a smooth gradient through green/yellow for mid-range values
        
        if (normalizedSize <= 0.2) {
            // Low volume: Blue tones
            return {
                fill: '#4fc3f7',     // Light blue
                stroke: '#0288d1'     // Darker blue
            };
        } else if (normalizedSize <= 0.4) {
            // Low-medium volume: Teal/Cyan
            return {
                fill: '#26c6da',     // Cyan
                stroke: '#0097a7'     // Dark cyan
            };
        } else if (normalizedSize <= 0.6) {
            // Medium volume: Green
            return {
                fill: '#66bb6a',     // Light green
                stroke: '#388e3c'     // Dark green
            };
        } else if (normalizedSize <= 0.8) {
            // Medium-high volume: Yellow/Orange
            return {
                fill: '#ffca28',     // Yellow
                stroke: '#f57f17'     // Dark yellow
            };
        } else {
            // High volume: Red/Orange
            return {
                fill: '#ff7043',     // Orange-red
                stroke: '#d84315'     // Dark red
            };
        }
    }
};

// Export for global access
window.MapVisualization = MapVisualization;
