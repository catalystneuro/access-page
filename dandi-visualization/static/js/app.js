// Global application state
const AppState = {
    regions: [],
    datasets: [],
    stats: {},
    selectedDataset: 'ALL',
    selectedRegion: null,
    map: null,
    charts: {},
    isCumulative: false
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
    }
};

// Event handlers
const EventHandlers = {
    setupDatasetFilter() {
        const select = document.getElementById('dataset-filter');
        select.addEventListener('change', Utils.debounce(async (e) => {
            AppState.selectedDataset = e.target.value;
            await App.updateVisualization();
        }, 300));
    },

    setupResetButton() {
        document.getElementById('reset-view').addEventListener('click', () => {
            AppState.selectedRegion = null;
            AppState.selectedDataset = 'ALL';
            document.getElementById('dataset-filter').value = 'ALL';
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
window.DATASET_COLORS = DATASET_COLORS;
