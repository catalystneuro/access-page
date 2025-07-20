// Global application state
const AppState = {
    regions: [],
    datasets: [],
    stats: {},
    selectedDataset: 'ALL',
    selectedRegion: null,
    map: null,
    charts: {},
    isCumulative: false,
    colorScheme: 'volume',
    chartData: {} // Store chart data for access by other components
};

// API base URL
const API_BASE = '/api';

// Color palette for datasets
const DATASET_COLORS = [
    '#e74c3c', '#3498db', '#2ecc71', '#f39c12', 
    '#9b59b6', '#1abc9c', '#e67e22', '#95a5a6'
];

// Utility functions
const Utils = {
    formatBytes: (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    },

    formatNumber: (num) => {
        return new Intl.NumberFormat().format(num);
    },

    debounce: (func, wait) => {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    showLoading: () => {
        document.getElementById('loading-overlay').classList.remove('hidden');
    },

    hideLoading: () => {
        document.getElementById('loading-overlay').classList.add('hidden');
    },

    showError: (message) => {
        console.error('Error:', message);
        // You could implement a toast notification here
        alert('Error: ' + message);
    },

    // Calculate total bytes from chart data for a specific region
    calculateChartTotal: (regionCode) => {
        if (!AppState.chartData || !AppState.chartData.time_series) {
            return null;
        }

        // If this is global data, we can't calculate region-specific totals
        if (!AppState.chartData.region_code) {
            return null;
        }

        // If this is region data and matches the requested region
        if (AppState.chartData.region_code === regionCode) {
            const timeSeries = AppState.chartData.time_series;
            const datasets = AppState.chartData.top_datasets || [];
            
            // Add "OTHER" to datasets if it exists in the data
            const allDatasets = [...datasets];
            if (timeSeries.some(d => d.OTHER)) {
                allDatasets.push('OTHER');
            }

            // Calculate total as sum of all dataset totals from chart data
            let total = 0;
            if (AppState.chartData.dataset_totals) {
                // Use the dataset_totals from the API response (this is the actual chart data)
                total = Object.values(AppState.chartData.dataset_totals).reduce((sum, value) => sum + value, 0);
            } else {
                // Fallback: sum the latest values from time series
                if (timeSeries.length > 0) {
                    const latestDay = timeSeries[timeSeries.length - 1];
                    total = allDatasets.reduce((sum, dataset) => sum + (latestDay[dataset] || 0), 0);
                }
            }

            return total;
        }

        return null;
    }
};

// API calls
const API = {
    async fetchStats() {
        try {
            const response = await fetch(`${API_BASE}/stats`);
            if (!response.ok) throw new Error('Failed to fetch stats');
            return await response.json();
        } catch (error) {
            Utils.showError('Failed to load statistics');
            throw error;
        }
    },

    async fetchDatasets() {
        try {
            const response = await fetch(`${API_BASE}/datasets`);
            if (!response.ok) throw new Error('Failed to fetch datasets');
            return await response.json();
        } catch (error) {
            Utils.showError('Failed to load datasets');
            throw error;
        }
    },

    async fetchRegions(datasetId = 'ALL') {
        try {
            const url = datasetId === 'ALL' 
                ? `${API_BASE}/regions` 
                : `${API_BASE}/regions?dataset_id=${datasetId}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error('Failed to fetch regions');
            return await response.json();
        } catch (error) {
            Utils.showError('Failed to load regions data');
            throw error;
        }
    },

    async fetchGlobalDownloads() {
        try {
            const response = await fetch(`${API_BASE}/downloads/global`);
            if (!response.ok) throw new Error('Failed to fetch global downloads');
            return await response.json();
        } catch (error) {
            Utils.showError('Failed to load global download data');
            throw error;
        }
    },

    async fetchRegionDownloads(regionCode) {
        try {
            const encodedRegionCode = encodeURIComponent(regionCode);
            const response = await fetch(`${API_BASE}/downloads/region/${encodedRegionCode}`);
            if (!response.ok) throw new Error('Failed to fetch region downloads');
            return await response.json();
        } catch (error) {
            Utils.showError('Failed to load region download data');
            throw error;
        }
    },

    async fetchFeaturedDandisets() {
        try {
            const response = await fetch(`${API_BASE}/featured-dandisets`);
            if (!response.ok) throw new Error('Failed to fetch featured dandisets');
            return await response.json();
        } catch (error) {
            Utils.showError('Failed to load featured dandisets');
            throw error;
        }
    }
};

// UI update functions
const UI = {
    updateStats(stats) {
        document.getElementById('total-bytes').textContent = stats.total_bytes_formatted;
        document.getElementById('total-datasets').textContent = Utils.formatNumber(stats.total_datasets);
        document.getElementById('total-countries').textContent = Utils.formatNumber(stats.unique_countries);
        document.getElementById('total-regions').textContent = Utils.formatNumber(stats.active_regions);
    },

    populateDatasetFilter(datasets) {
        const select = document.getElementById('dataset-filter');
        
        // Clear existing options except "All Datasets"
        while (select.children.length > 1) {
            select.removeChild(select.lastChild);
        }

        // Add dataset options
        datasets.forEach(dataset => {
            const option = document.createElement('option');
            option.value = dataset.id;
            option.textContent = `${dataset.id} (${dataset.total_bytes_formatted})`;
            select.appendChild(option);
        });
    },

    updateChartTitle(regionCode, regionName) {
        const title = document.getElementById('chart-title');
        const globalBtn = document.getElementById('show-global-btn');
        
        if (regionCode) {
            title.textContent = `Downloads in ${regionName || regionCode}`;
            globalBtn.style.display = 'block';
        } else {
            title.textContent = 'Global Downloads Over Time';
            globalBtn.style.display = 'none';
        }
    },

    displayFeaturedDandisets(dandisetsData) {
        const container = document.getElementById('featured-dandisets-container');
        
        if (dandisetsData.error) {
            container.innerHTML = `
                <div class="error-message">
                    ${dandisetsData.error}
                </div>
                ${dandisetsData.featured_dandisets ? 
                    this.createDandisetsListHTML(dandisetsData.featured_dandisets) : ''
                }
            `;
        } else if (dandisetsData.featured_dandisets && dandisetsData.featured_dandisets.length > 0) {
            container.innerHTML = this.createDandisetsListHTML(dandisetsData.featured_dandisets);
        } else {
            container.innerHTML = '<div class="loading-message">No featured dandisets available</div>';
        }
    },

    async updateFeaturedDandisetsFromChartData(chartData, regionName = null) {
        const container = document.getElementById('featured-dandisets-container');
        
        if (!chartData.top_datasets || !chartData.dataset_totals) {
            container.innerHTML = '<div class="loading-message">No featured dandisets available</div>';
            return;
        }

        // Update the panel title based on context
        const panelTitle = document.querySelector('.featured-dandisets-panel h4');
        if (regionName) {
            panelTitle.textContent = `Top Datasets in ${regionName}`;
        } else {
            panelTitle.textContent = 'Featured Dandisets';
        }

        try {
            // Call the API to get metadata for the specific datasets
            const response = await fetch(`${API_BASE}/dandisets/metadata`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    dataset_ids: chartData.top_datasets,
                    dataset_totals: chartData.dataset_totals
                })
            });

            if (!response.ok) {
                throw new Error(`API request failed: ${response.status}`);
            }

            const data = await response.json();
            
            if (data.error) {
                throw new Error(data.error);
            }

            // Display the dandisets
            container.innerHTML = this.createDandisetsListHTML(data.dandisets);

        } catch (error) {
            console.error('Failed to update featured dandisets:', error);
            // Fallback: show datasets without metadata
            const fallbackDandisets = chartData.top_datasets.map(datasetId => {
                const bytes = chartData.dataset_totals[datasetId] || 0;
                return {
                    id: datasetId,
                    name: `Dataset ${datasetId}`,
                    landing_url: `https://dandiarchive.org/dandiset/${datasetId}/draft`,
                    version: 'draft',
                    total_bytes: bytes,
                    total_bytes_formatted: Utils.formatBytes(bytes)
                };
            });

            container.innerHTML = this.createDandisetsListHTML(fallbackDandisets);
        }
    },

    createDandisetsListHTML(dandisets) {
        if (!dandisets || dandisets.length === 0) {
            return '<div class="loading-message">No dandisets available</div>';
        }

        return dandisets.map(dandiset => {
            const downloadInfo = dandiset.total_bytes_formatted ? 
                ` (${dandiset.total_bytes_formatted} downloaded)` : '';
            
            return `
                <div class="dandiset-list-item">
                    <a href="#" class="dandiset-title-link" onclick="App.selectDataset('${dandiset.id}'); return false;">
                        ${dandiset.id}: ${dandiset.name}
                    </a>${downloadInfo}
                    <a href="${dandiset.landing_url}" target="_blank" class="dandiset-external-link">DANDI</a>
                </div>
            `;
        }).join('');
    },

    createDandisetHTML(dandiset) {
        const downloadInfo = dandiset.total_bytes_formatted ? 
            `<div class="dandiset-downloads">Downloads: ${dandiset.total_bytes_formatted}</div>` : '';
        
        return `
            <div class="dandiset-item">
                <a href="${dandiset.landing_url}" target="_blank" class="dandiset-title-link">
                    ${dandiset.id}: ${dandiset.name}
                </a>
                ${downloadInfo}
            </div>
        `;
    }
};

// Event handlers
const EventHandlers = {
    setupDatasetFilter() {
        const select = document.getElementById('dataset-filter');
        select.addEventListener('change', Utils.debounce(async (e) => {
            AppState.selectedDataset = e.target.value;
            const colorSchemeSelect = document.getElementById('color-scheme');
            
            // Automatically set color scheme to "Data Volume" and disable dropdown when filtering by a specific dataset
            if (e.target.value !== 'ALL') {
                colorSchemeSelect.value = 'volume';
                colorSchemeSelect.disabled = true;
                AppState.colorScheme = 'volume';
                MapVisualization.setColorScheme('volume');
            } else {
                // Re-enable the dropdown when "All Datasets" is selected
                colorSchemeSelect.disabled = false;
            }
            
            await App.updateVisualization();
        }, 300));
    },

    setupColorSchemeSelector() {
        const select = document.getElementById('color-scheme');
        select.addEventListener('change', (e) => {
            AppState.colorScheme = e.target.value;
            MapVisualization.setColorScheme(e.target.value);
        });
    },

    setupResetButton() {
        document.getElementById('reset-view').addEventListener('click', () => {
            AppState.selectedRegion = null;
            AppState.selectedDataset = 'ALL';
            document.getElementById('dataset-filter').value = 'ALL';
            document.getElementById('color-scheme').value = 'volume';
            document.getElementById('color-scheme').disabled = false; // Re-enable the dropdown
            AppState.colorScheme = 'volume';
            MapVisualization.setColorScheme('volume');
            App.updateVisualization();
        });
    },

    setupShowGlobalButton() {
        document.getElementById('show-global-btn').addEventListener('click', () => {
            App.showGlobalData();
        });
    },

    setupCumulativeToggle() {
        const toggle = document.getElementById('cumulative-toggle');
        toggle.addEventListener('change', (e) => {
            AppState.isCumulative = e.target.checked;
            App.refreshCurrentChart();
        });
    }
};

// Main application object
const App = {
    async init() {
        try {
            Utils.showLoading();
            
            // Initialize event handlers
            EventHandlers.setupDatasetFilter();
            EventHandlers.setupColorSchemeSelector();
            EventHandlers.setupResetButton();
            EventHandlers.setupShowGlobalButton();
            EventHandlers.setupCumulativeToggle();

            // Load initial data
            await this.loadInitialData();
            
            // Initialize visualizations
            await this.initializeVisualizations();
            
            Utils.hideLoading();
        } catch (error) {
            Utils.hideLoading();
            Utils.showError('Failed to initialize application');
            console.error('Initialization error:', error);
        }
    },

    async loadInitialData() {
        // Load stats and datasets in parallel
        const [stats, datasets] = await Promise.all([
            API.fetchStats(),
            API.fetchDatasets()
        ]);

        AppState.stats = stats;
        AppState.datasets = datasets;

        // Update UI
        UI.updateStats(stats);
        UI.populateDatasetFilter(datasets);

        // Load regions for current dataset filter
        AppState.regions = await API.fetchRegions(AppState.selectedDataset);
    },

    async initializeVisualizations() {
        // Initialize map
        MapVisualization.init();
        
        // Load and display initial charts
        const globalData = await API.fetchGlobalDownloads();
        ChartsVisualization.renderMainChart(globalData);
        
        // Note: Featured dandisets are now updated automatically by the chart rendering
        // No need to load them separately as they will be based on chart data
    },

    async loadFeaturedDandisets() {
        try {
            const dandisetsData = await API.fetchFeaturedDandisets();
            UI.displayFeaturedDandisets(dandisetsData);
        } catch (error) {
            console.error('Failed to load featured dandisets:', error);
            // Display error in the container
            const container = document.getElementById('featured-dandisets-container');
            container.innerHTML = '<div class="error-message">Failed to load featured dandisets</div>';
        }
    },

    async updateVisualization() {
        try {
            Utils.showLoading();
            
            // Update regions based on selected dataset
            AppState.regions = await API.fetchRegions(AppState.selectedDataset);
            
            // Update map
            MapVisualization.updateRegions(AppState.regions);
            
            // Update chart based on current state
            if (!AppState.selectedRegion) {
                // Show global data when no region selected
                const globalData = await API.fetchGlobalDownloads();
                ChartsVisualization.renderMainChart(globalData);
                UI.updateChartTitle(null);
            }
            
            Utils.hideLoading();
        } catch (error) {
            Utils.hideLoading();
            Utils.showError('Failed to update visualization');
            console.error('Update error:', error);
        }
    },

    async selectRegion(regionCode, regionName) {
        try {
            AppState.selectedRegion = regionCode;
            AppState.selectedRegionName = regionName;
            UI.updateChartTitle(regionCode, regionName);
            
            // Load and display region-specific data
            const regionData = await API.fetchRegionDownloads(regionCode);
            ChartsVisualization.renderMainChart(regionData);
            
        } catch (error) {
            Utils.showError('Failed to load region data');
            console.error('Region selection error:', error);
        }
    },

    async showGlobalData() {
        try {
            AppState.selectedRegion = null;
            AppState.selectedRegionName = null;
            UI.updateChartTitle(null);
            
            // Reset map selection
            MapVisualization.resetSelection();
            
            // Load and display global data
            const globalData = await API.fetchGlobalDownloads();
            ChartsVisualization.renderMainChart(globalData);
            
        } catch (error) {
            Utils.showError('Failed to load global data');
            console.error('Global data error:', error);
        }
    },

    async refreshCurrentChart() {
        try {
            if (AppState.selectedRegion) {
                // Refresh region chart
                const regionData = await API.fetchRegionDownloads(AppState.selectedRegion);
                ChartsVisualization.renderMainChart(regionData);
            } else {
                // Refresh global chart
                const globalData = await API.fetchGlobalDownloads();
                ChartsVisualization.renderMainChart(globalData);
            }
        } catch (error) {
            Utils.showError('Failed to refresh chart');
            console.error('Chart refresh error:', error);
        }
    },

    async selectDataset(datasetId) {
        try {
            // Update the dropdown
            document.getElementById('dataset-filter').value = datasetId;
            
            // Update app state
            AppState.selectedDataset = datasetId;
            
            const colorSchemeSelect = document.getElementById('color-scheme');
            
            // Automatically set color scheme to "Data Volume" and disable dropdown when selecting a specific dataset
            if (datasetId !== 'ALL') {
                colorSchemeSelect.value = 'volume';
                colorSchemeSelect.disabled = true;
                AppState.colorScheme = 'volume';
                MapVisualization.setColorScheme('volume');
            } else {
                // Re-enable the dropdown when "All Datasets" is selected
                colorSchemeSelect.disabled = false;
            }
            
            // Reset region selection when dataset changes
            AppState.selectedRegion = null;
            AppState.selectedRegionName = null;
            
            // Update visualization
            await this.updateVisualization();
            
        } catch (error) {
            Utils.showError('Failed to select dataset');
            console.error('Dataset selection error:', error);
        }
    }
};

// Initialize application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});

// Export globals for other modules
window.App = App;
window.AppState = AppState;
window.Utils = Utils;
window.UI = UI;
window.DATASET_COLORS = DATASET_COLORS;
