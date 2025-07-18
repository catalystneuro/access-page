from flask import Flask, jsonify, request, render_template
from flask_cors import CORS
import sqlite3
import json
from datetime import datetime, timedelta
import pandas as pd

app = Flask(__name__)
CORS(app)

DATABASE_PATH = 'data/database.db'

@app.route('/')
def index():
    """Serve the main dashboard page"""
    return render_template('index.html')

def get_db_connection():
    """Get database connection"""
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def format_bytes(bytes_value):
    """Format bytes into human readable format"""
    if bytes_value is None:
        return "0 B"
    
    for unit in ['B', 'KB', 'MB', 'GB', 'TB', 'PB']:
        if bytes_value < 1024.0:
            return f"{bytes_value:.1f} {unit}"
        bytes_value /= 1024.0
    return f"{bytes_value:.1f} EB"

@app.route('/api/regions')
def get_regions():
    """Get all regions with their download statistics"""
    dataset_filter = request.args.get('dataset_id')
    
    conn = get_db_connection()
    
    if dataset_filter and dataset_filter != 'ALL':
        # Filter by specific dataset
        query = '''
            SELECT 
                r.code,
                r.name,
                r.country,
                r.latitude,
                r.longitude,
                COALESCE(dr.bytes_sent, 0) as total_bytes,
                1 as dataset_count
            FROM regions r
            LEFT JOIN downloads_by_region dr ON r.code = dr.region_code AND dr.dataset_id = ?
            WHERE r.latitude IS NOT NULL AND r.longitude IS NOT NULL
            AND (dr.bytes_sent > 0 OR dr.bytes_sent IS NULL)
        '''
        cursor = conn.execute(query, (dataset_filter,))
    else:
        # All datasets
        query = '''
            SELECT 
                code, name, country, latitude, longitude, total_bytes, dataset_count
            FROM regional_summary 
            WHERE latitude IS NOT NULL AND longitude IS NOT NULL
            AND total_bytes > 0
        '''
        cursor = conn.execute(query)
    
    regions = []
    for row in cursor.fetchall():
        regions.append({
            'code': row['code'],
            'name': row['name'],
            'country': row['country'],
            'latitude': float(row['latitude']),
            'longitude': float(row['longitude']),
            'total_bytes': int(row['total_bytes']),
            'total_bytes_formatted': format_bytes(row['total_bytes']),
            'dataset_count': int(row['dataset_count'])
        })
    
    conn.close()
    return jsonify(regions)

@app.route('/api/downloads/region/<path:region_code>')
def get_region_downloads(region_code):
    """Get time series downloads for a specific region"""
    conn = get_db_connection()
    
    # Get region's downloads by dataset
    region_query = '''
        SELECT 
            dr.dataset_id,
            dr.bytes_sent as region_bytes,
            d.total_bytes as dataset_total
        FROM downloads_by_region dr
        JOIN datasets d ON dr.dataset_id = d.id
        WHERE dr.region_code = ? AND d.id != 'ARCHIVE_TOTAL'
        ORDER BY dr.bytes_sent DESC
    '''
    
    cursor = conn.execute(region_query, (region_code,))
    region_results = cursor.fetchall()
    
    if not region_results:
        conn.close()
        return jsonify({
            'region_code': region_code,
            'time_series': [],
            'top_datasets': [],
            'dataset_totals': {}
        })
    
    # Calculate region's proportion for each dataset
    dataset_proportions = {}
    dataset_totals = {}
    
    for row in region_results:
        dataset_id = row['dataset_id']
        region_bytes = row['region_bytes']
        dataset_total = row['dataset_total']
        
        if dataset_total > 0:
            proportion = region_bytes / dataset_total
            dataset_proportions[dataset_id] = proportion
            dataset_totals[dataset_id] = region_bytes
    
    # Get top 7 datasets by region download volume
    sorted_datasets = sorted(dataset_totals.items(), key=lambda x: x[1], reverse=True)
    top_datasets = [ds[0] for ds in sorted_datasets[:7]]
    
    # Get global daily downloads for these datasets
    if top_datasets:
        placeholders = ','.join('?' * len(top_datasets))
        daily_query = f'''
            SELECT 
                dd.dataset_id,
                dd.date,
                dd.bytes_sent
            FROM downloads_by_day dd
            WHERE dd.dataset_id IN ({placeholders})
            ORDER BY dd.date, dd.dataset_id
        '''
        
        cursor = conn.execute(daily_query, top_datasets)
        daily_results = cursor.fetchall()
        
        # Apply region proportions to global daily data
        daily_data = {}
        
        for row in daily_results:
            date = row['date']
            dataset_id = row['dataset_id']
            global_bytes = row['bytes_sent']
            
            if dataset_id in dataset_proportions:
                # Estimate region's portion of daily downloads
                region_daily_bytes = int(global_bytes * dataset_proportions[dataset_id])
                
                if date not in daily_data:
                    daily_data[date] = {}
                
                daily_data[date][dataset_id] = region_daily_bytes
        
        # Prepare time series data
        time_series = []
        for date, datasets in sorted(daily_data.items()):
            day_data = {'date': date}
            other_bytes = 0
            
            for dataset_id, bytes_sent in datasets.items():
                if dataset_id in top_datasets:
                    day_data[dataset_id] = bytes_sent
                else:
                    other_bytes += bytes_sent
            
            if other_bytes > 0:
                day_data['OTHER'] = other_bytes
                
            time_series.append(day_data)
    else:
        time_series = []
    
    conn.close()
    
    return jsonify({
        'region_code': region_code,
        'time_series': time_series,
        'top_datasets': top_datasets,
        'dataset_totals': dict(sorted_datasets[:7])
    })

@app.route('/api/downloads/global')
def get_global_downloads():
    """Get global time series downloads across all regions"""
    conn = get_db_connection()
    
    # Get daily downloads by dataset globally
    query = '''
        SELECT 
            dd.dataset_id,
            dd.date,
            SUM(dd.bytes_sent) as total_bytes
        FROM downloads_by_day dd
        JOIN datasets d ON dd.dataset_id = d.id
        WHERE d.id != 'ARCHIVE_TOTAL'
        GROUP BY dd.dataset_id, dd.date
        ORDER BY dd.date, dd.dataset_id
    '''
    
    cursor = conn.execute(query)
    results = cursor.fetchall()
    
    # Group by date and aggregate datasets
    daily_data = {}
    dataset_totals = {}
    
    for row in results:
        date = row['date']
        dataset_id = row['dataset_id']
        bytes_sent = row['total_bytes']
        
        if date not in daily_data:
            daily_data[date] = {}
        
        daily_data[date][dataset_id] = bytes_sent
        dataset_totals[dataset_id] = dataset_totals.get(dataset_id, 0) + bytes_sent
    
    # Sort datasets by total and keep top 7
    sorted_datasets = sorted(dataset_totals.items(), key=lambda x: x[1], reverse=True)
    top_datasets = [ds[0] for ds in sorted_datasets[:7]]
    
    # Prepare time series data
    time_series = []
    for date, datasets in sorted(daily_data.items()):
        day_data = {'date': date}
        other_bytes = 0
        
        for dataset_id, bytes_sent in datasets.items():
            if dataset_id in top_datasets:
                day_data[dataset_id] = bytes_sent
            else:
                other_bytes += bytes_sent
        
        if other_bytes > 0:
            day_data['OTHER'] = other_bytes
            
        time_series.append(day_data)
    
    conn.close()
    
    return jsonify({
        'time_series': time_series,
        'top_datasets': top_datasets,
        'dataset_totals': dict(sorted_datasets[:7])
    })

@app.route('/api/datasets')
def get_datasets():
    """Get list of all datasets"""
    conn = get_db_connection()
    
    query = '''
        SELECT 
            id, total_bytes, unique_regions, unique_countries
        FROM datasets 
        WHERE id != 'ARCHIVE_TOTAL'
        ORDER BY total_bytes DESC
    '''
    
    cursor = conn.execute(query)
    datasets = []
    
    for row in cursor.fetchall():
        datasets.append({
            'id': row['id'],
            'total_bytes': int(row['total_bytes']),
            'total_bytes_formatted': format_bytes(row['total_bytes']),
            'unique_regions': int(row['unique_regions']),
            'unique_countries': int(row['unique_countries'])
        })
    
    conn.close()
    return jsonify(datasets)

@app.route('/api/stats')
def get_stats():
    """Get overall statistics"""
    conn = get_db_connection()
    
    # Get archive totals
    cursor = conn.execute('''
        SELECT total_bytes, unique_regions, unique_countries 
        FROM datasets WHERE id = 'ARCHIVE_TOTAL'
    ''')
    archive_stats = cursor.fetchone()
    
    # Get dataset count
    cursor = conn.execute('''
        SELECT COUNT(*) as dataset_count FROM datasets WHERE id != 'ARCHIVE_TOTAL'
    ''')
    dataset_count = cursor.fetchone()['dataset_count']
    
    # Get regions with downloads
    cursor = conn.execute('''
        SELECT COUNT(DISTINCT region_code) as active_regions 
        FROM downloads_by_region
    ''')
    active_regions = cursor.fetchone()['active_regions']
    
    conn.close()
    
    return jsonify({
        'total_bytes': int(archive_stats['total_bytes']),
        'total_bytes_formatted': format_bytes(archive_stats['total_bytes']),
        'total_datasets': dataset_count,
        'unique_regions': int(archive_stats['unique_regions']),
        'unique_countries': int(archive_stats['unique_countries']),
        'active_regions': active_regions
    })

if __name__ == '__main__':
    app.run(debug=True, port=5000)
