import sqlite3
import json
import yaml
import pandas as pd
import os
from pathlib import Path
from datetime import datetime
import re
from typing import Optional

class DANDIDataIngestor:
    def __init__(self, db_path="data/database.db", content_path="../content"):
        self.db_path = db_path
        self.content_path = content_path
        self.conn: Optional[sqlite3.Connection] = None
        
    def initialize_database(self):
        """Create database tables for DANDI data"""
        self.conn = sqlite3.connect(self.db_path)
        cursor = self.conn.cursor()
        
        # Datasets table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS datasets (
                id TEXT PRIMARY KEY,
                total_bytes INTEGER,
                unique_regions INTEGER,
                unique_countries INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Regions table with coordinates
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS regions (
                code TEXT PRIMARY KEY,
                name TEXT,
                country TEXT,
                latitude REAL,
                longitude REAL
            )
        ''')
        
        # Downloads by region
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS downloads_by_region (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                dataset_id TEXT,
                region_code TEXT,
                bytes_sent INTEGER,
                FOREIGN KEY (dataset_id) REFERENCES datasets(id),
                FOREIGN KEY (region_code) REFERENCES regions(code)
            )
        ''')
        
        # Downloads by day
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS downloads_by_day (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                dataset_id TEXT,
                date TEXT,
                bytes_sent INTEGER,
                FOREIGN KEY (dataset_id) REFERENCES datasets(id)
            )
        ''')
        
        # Asset downloads
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS downloads_by_asset (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                dataset_id TEXT,
                asset_path TEXT,
                bytes_sent INTEGER,
                FOREIGN KEY (dataset_id) REFERENCES datasets(id)
            )
        ''')
        
        # Create indexes for better performance
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_downloads_region_dataset ON downloads_by_region(dataset_id, region_code)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_downloads_day_dataset ON downloads_by_day(dataset_id, date)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_downloads_asset_dataset ON downloads_by_asset(dataset_id)')
        
        self.conn.commit()
        print("Database initialized successfully")
        
    def load_coordinates(self):
        """Load region coordinates from YAML file"""
        if self.conn is None:
            raise RuntimeError("Database connection not initialized")
            
        coords_file = os.path.join(self.content_path, "region_codes_to_coordinates.yaml")
        with open(coords_file, 'r', encoding='utf-8') as f:
            coords_data = yaml.safe_load(f)
        
        cursor = self.conn.cursor()
        for region_code, coords in coords_data.items():
            # Parse region code to extract country and region name
            if '/' in region_code:
                country, region_name = region_code.split('/', 1)
            else:
                country = region_code
                region_name = region_code
                
            latitude = coords.get('latitude')
            longitude = coords.get('longitude')
            
            cursor.execute('''
                INSERT OR REPLACE INTO regions (code, name, country, latitude, longitude)
                VALUES (?, ?, ?, ?, ?)
            ''', (region_code, region_name, country, latitude, longitude))
        
        self.conn.commit()
        print(f"Loaded coordinates for {len(coords_data)} regions")
        
    def load_dataset_totals(self):
        """Load dataset summary information"""
        if self.conn is None:
            raise RuntimeError("Database connection not initialized")
            
        # Load archive totals
        archive_file = os.path.join(self.content_path, "archive_totals.json")
        with open(archive_file, 'r') as f:
            archive_data = json.load(f)
            
        # Load individual dataset totals
        totals_file = os.path.join(self.content_path, "totals.json")
        with open(totals_file, 'r') as f:
            totals_data = json.load(f)
            
        cursor = self.conn.cursor()
        
        # Insert archive-wide totals as a special dataset
        cursor.execute('''
            INSERT OR REPLACE INTO datasets (id, total_bytes, unique_regions, unique_countries)
            VALUES (?, ?, ?, ?)
        ''', ('ARCHIVE_TOTAL', 
              archive_data['total_bytes_sent'],
              archive_data['number_of_unique_regions'],
              archive_data['number_of_unique_countries']))
        
        # Insert individual datasets
        for dataset_id, data in totals_data.items():
            cursor.execute('''
                INSERT OR REPLACE INTO datasets (id, total_bytes, unique_regions, unique_countries)
                VALUES (?, ?, ?, ?)
            ''', (dataset_id,
                  data['total_bytes_sent'],
                  data['number_of_unique_regions'],
                  data['number_of_unique_countries']))
        
        self.conn.commit()
        print(f"Loaded {len(totals_data)} datasets plus archive total")
        
    def load_dataset_details(self):
        """Load detailed download data for each dataset"""
        if self.conn is None:
            raise RuntimeError("Database connection not initialized")
            
        summaries_dir = os.path.join(self.content_path, "summaries")
        
        cursor = self.conn.cursor()
        dataset_count = 0
        
        for dataset_dir in os.listdir(summaries_dir):
            dataset_path = os.path.join(summaries_dir, dataset_dir)
            if not os.path.isdir(dataset_path):
                continue
                
            dataset_id = dataset_dir
            print(f"Processing dataset {dataset_id}...")
            
            # Load by_region.tsv
            region_file = os.path.join(dataset_path, "by_region.tsv")
            if os.path.exists(region_file):
                df_region = pd.read_csv(region_file, sep='\t')
                for _, row in df_region.iterrows():
                    cursor.execute('''
                        INSERT OR REPLACE INTO downloads_by_region (dataset_id, region_code, bytes_sent)
                        VALUES (?, ?, ?)
                    ''', (dataset_id, row['region'], row['bytes_sent']))
            
            # Load by_day.tsv
            day_file = os.path.join(dataset_path, "by_day.tsv")
            if os.path.exists(day_file):
                df_day = pd.read_csv(day_file, sep='\t')
                for _, row in df_day.iterrows():
                    cursor.execute('''
                        INSERT OR REPLACE INTO downloads_by_day (dataset_id, date, bytes_sent)
                        VALUES (?, ?, ?)
                    ''', (dataset_id, row['date'], row['bytes_sent']))
            
            # Load by_asset.tsv
            asset_file = os.path.join(dataset_path, "by_asset.tsv")
            if os.path.exists(asset_file):
                df_asset = pd.read_csv(asset_file, sep='\t')
                for _, row in df_asset.iterrows():
                    cursor.execute('''
                        INSERT OR REPLACE INTO downloads_by_asset (dataset_id, asset_path, bytes_sent)
                        VALUES (?, ?, ?)
                    ''', (dataset_id, row['asset_path'], row['bytes_sent']))
            
            dataset_count += 1
            if dataset_count % 10 == 0:
                self.conn.commit()
                print(f"Processed {dataset_count} datasets...")
        
        self.conn.commit()
        print(f"Loaded detailed data for {dataset_count} datasets")
        
    def create_aggregated_views(self):
        """Create aggregated views for better performance"""
        if self.conn is None:
            raise RuntimeError("Database connection not initialized")
            
        cursor = self.conn.cursor()
        
        # Regional summary view
        cursor.execute('''
            CREATE VIEW IF NOT EXISTS regional_summary AS
            SELECT 
                r.code,
                r.name,
                r.country,
                r.latitude,
                r.longitude,
                COALESCE(SUM(dr.bytes_sent), 0) as total_bytes,
                COUNT(DISTINCT dr.dataset_id) as dataset_count
            FROM regions r
            LEFT JOIN downloads_by_region dr ON r.code = dr.region_code
            GROUP BY r.code, r.name, r.country, r.latitude, r.longitude
        ''')
        
        # Dataset summary view
        cursor.execute('''
            CREATE VIEW IF NOT EXISTS dataset_summary AS
            SELECT 
                d.id,
                d.total_bytes,
                d.unique_regions,
                d.unique_countries,
                COUNT(DISTINCT dr.region_code) as regions_with_downloads,
                COUNT(DISTINCT dd.date) as days_with_downloads
            FROM datasets d
            LEFT JOIN downloads_by_region dr ON d.id = dr.dataset_id
            LEFT JOIN downloads_by_day dd ON d.id = dd.dataset_id
            WHERE d.id != 'ARCHIVE_TOTAL'
            GROUP BY d.id, d.total_bytes, d.unique_regions, d.unique_countries
        ''')
        
        self.conn.commit()
        print("Created aggregated views")
        
    def run_full_ingestion(self):
        """Run the complete data ingestion pipeline"""
        print("Starting DANDI data ingestion...")
        
        self.initialize_database()
        self.load_coordinates()
        self.load_dataset_totals()
        self.load_dataset_details()
        self.create_aggregated_views()
        
        # Print summary statistics
        if self.conn is None:
            raise RuntimeError("Database connection not initialized")
            
        cursor = self.conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM datasets WHERE id != 'ARCHIVE_TOTAL'")
        dataset_count = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM regions WHERE latitude IS NOT NULL")
        region_count = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM downloads_by_region")
        download_records = cursor.fetchone()[0]
        
        print(f"\n=== Ingestion Complete ===")
        print(f"Datasets: {dataset_count}")
        print(f"Regions with coordinates: {region_count}")
        print(f"Download records: {download_records}")
        
        self.conn.close()

if __name__ == "__main__":
    ingestor = DANDIDataIngestor()
    ingestor.run_full_ingestion()
