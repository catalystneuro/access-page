#!/usr/bin/env python3
"""
DANDI Download Progression Video Generator

This script creates a video showing the progression of data downloads over time,
with each frame representing cumulative downloads up to a specific month.
"""

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from matplotlib.animation import FuncAnimation
import cartopy.crs as ccrs
import cartopy.feature as cfeature
from datetime import datetime, timedelta
import imageio
import os
from pathlib import Path
import warnings
warnings.filterwarnings('ignore')

class DownloadVideoGenerator:
    def __init__(self, parquet_path="database_with_coordinates.parquet", output_dir="video_frames"):
        self.parquet_path = parquet_path
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(exist_ok=True)
        
        # Color scheme matching the web app
        self.volume_thresholds = {
            'threshold1': 10485760,       # 10 MB
            'threshold2': 10737418240,    # 10 GB
            'threshold3': 10995116277760  # 10 TB
        }
        
        self.color_map = {
            'low': {'fill': '#26c6da', 'stroke': '#0097a7'},     # Cyan
            'medium': {'fill': '#66bb6a', 'stroke': '#388e3c'},   # Light green
            'high': {'fill': '#ffca28', 'stroke': '#f57f17'},     # Yellow
            'very-high': {'fill': '#ff7043', 'stroke': '#d84315'} # Orange-red
        }
        
    def load_and_process_data(self):
        """Load parquet data and process for monthly aggregation."""
        print("Loading data from parquet file...")
        df = pd.read_parquet(self.parquet_path)
        
        # Convert download_date to datetime
        df['download_date'] = pd.to_datetime(df['download_date'])
        
        # Create year-week column for grouping
        df['year_week'] = df['download_date'].dt.to_period('W')
        
        # Sort by date to ensure proper progression
        df = df.sort_values('download_date')
        
        print(f"Loaded {len(df)} records from {df['download_date'].min()} to {df['download_date'].max()}")
        print(f"Data spans {df['year_week'].nunique()} weeks")
        
        return df
    
    def get_volume_category(self, total_bytes):
        """Categorize volume based on thresholds matching web app."""
        if total_bytes <= self.volume_thresholds['threshold1']:
            return 'low'
        elif total_bytes <= self.volume_thresholds['threshold2']:
            return 'medium'
        elif total_bytes <= self.volume_thresholds['threshold3']:
            return 'high'
        else:
            return 'very-high'
    
    def format_bytes(self, bytes_value):
        """Format bytes into human readable format."""
        if bytes_value == 0:
            return "0 B"
        
        for unit in ['B', 'KB', 'MB', 'GB', 'TB', 'PB']:
            if bytes_value < 1024.0:
                return f"{bytes_value:.1f} {unit}"
            bytes_value /= 1024.0
        return f"{bytes_value:.1f} EB"
    
    def create_weekly_snapshots(self, df):
        """Create cumulative weekly snapshots of downloads by region."""
        print("Creating weekly snapshots...")
        
        # Get all unique weeks
        all_weeks = sorted(df['year_week'].unique())
        
        snapshots = {}
        
        for i, current_week in enumerate(all_weeks):
            # Get all data up to and including current week
            mask = df['year_week'] <= current_week
            cumulative_df = df[mask]
            
            # Aggregate by region
            region_totals = cumulative_df.groupby(['region', 'latitude', 'longitude']).agg({
                'total_bytes_sent': 'sum',
                'dandiset_id': 'nunique'
            }).reset_index()
            
            # Filter out regions with no downloads
            region_totals = region_totals[region_totals['total_bytes_sent'] > 0]
            
            snapshots[current_week] = region_totals
            
            if (i + 1) % 25 == 0:
                print(f"Processed {i + 1}/{len(all_weeks)} weeks")
        
        print(f"Created {len(snapshots)} weekly snapshots")
        
        # Calculate global min/max for consistent bubble sizing across all frames
        print("Calculating global scaling parameters...")
        all_values = []
        for snapshot in snapshots.values():
            if len(snapshot) > 0:
                all_values.extend(snapshot['total_bytes_sent'].values)
        
        if all_values:
            self.global_min_bytes = min(all_values)
            self.global_max_bytes = max(all_values)
            self.global_log_min = np.log(self.global_min_bytes)
            self.global_log_max = np.log(self.global_max_bytes)
            print(f"Global range: {self.format_bytes(self.global_min_bytes)} to {self.format_bytes(self.global_max_bytes)}")
        else:
            self.global_min_bytes = 1
            self.global_max_bytes = 1
            self.global_log_min = 0
            self.global_log_max = 0
            
        return snapshots
    
    def create_frame(self, month_data, month_period, frame_num, total_frames):
        """Create a single frame of the video."""
        fig = plt.figure(figsize=(16, 10), facecolor='white')
        
        # Create map with flat PlateCarree projection, excluding Antarctica and cutting Pacific west of Hawaii
        ax = plt.axes(projection=ccrs.PlateCarree())
        ax.set_extent([-170, 180, -60, 85], crs=ccrs.PlateCarree())
        
        # Add map features
        ax.add_feature(cfeature.LAND, color='#f5f5f5', alpha=0.8)
        ax.add_feature(cfeature.OCEAN, color='#e3f2fd', alpha=0.8)
        ax.add_feature(cfeature.COASTLINE, color='#666666', linewidth=0.5)
        ax.add_feature(cfeature.BORDERS, color='#999999', linewidth=0.3)
        
        if len(month_data) == 0:
            # No data for this month, show empty map
            pass
        else:
            # Use global scaling for consistent bubble sizes across all frames
            if self.global_max_bytes > self.global_min_bytes:
                # Create bubble markers
                for _, region in month_data.iterrows():
                    # Calculate bubble size using global scaling (logarithmic)
                    log_bytes = np.log(region['total_bytes_sent'])
                    normalized_size = (log_bytes - self.global_log_min) / (self.global_log_max - self.global_log_min)
                    
                    # Smaller size range from 10 to 200 square points (reduced from 20-400)
                    min_size = 10
                    max_size = 200
                    bubble_size = min_size + (normalized_size * (max_size - min_size))
                    
                    # Get color based on volume category
                    category = self.get_volume_category(region['total_bytes_sent'])
                    color = self.color_map[category]['fill']
                    edge_color = self.color_map[category]['stroke']
                    
                    # Plot bubble
                    ax.scatter(
                        region['longitude'], region['latitude'],
                        s=bubble_size,
                        c=color,
                        edgecolors=edge_color,
                        linewidths=1,
                        alpha=0.7,
                        transform=ccrs.PlateCarree(),
                        zorder=5
                    )
        
        # Add title with current month
        month_str = month_period.strftime('%B %Y')
        plt.suptitle(
            f'DANDI Archive Downloads Progression\n{month_str}',
            fontsize=20,
            fontweight='bold',
            y=0.95
        )
        
        # Add statistics text
        if len(month_data) > 0:
            total_downloads = month_data['total_bytes_sent'].sum()
            total_regions = len(month_data)
            total_datasets = month_data['dandiset_id'].sum()
            
            stats_text = (
                f"Total Downloads: {self.format_bytes(total_downloads)}\n"
                f"Active Regions: {total_regions}\n"
                f"Datasets: {total_datasets}"
            )
        else:
            stats_text = "No downloads recorded yet"
        
        # Add stats box
        props = dict(boxstyle='round', facecolor='white', alpha=0.8)
        ax.text(
            0.02, 0.98, stats_text,
            transform=ax.transAxes,
            fontsize=12,
            verticalalignment='top',
            bbox=props,
            zorder=10
        )
        
        # Add legend
        self.add_legend(ax)
        
        # Add progress bar
        self.add_progress_bar(ax, frame_num, total_frames)
        
        plt.tight_layout()
        
        return fig
    
    def add_legend(self, ax):
        """Add color legend to the plot."""
        legend_elements = []
        
        categories = ['low', 'medium', 'high', 'very-high']
        labels = ['≤ 10 MB', '10 MB - 10 GB', '10 GB - 10 TB', '> 10 TB']
        
        for category, label in zip(categories, labels):
            color = self.color_map[category]['fill']
            legend_elements.append(
                plt.scatter([], [], c=color, s=100, label=label, alpha=0.7)
            )
        
        legend = ax.legend(
            handles=legend_elements,
            title='Download Volume',
            loc='lower left',
            bbox_to_anchor=(0.02, 0.02),
            frameon=True,
            fancybox=True,
            shadow=True
        )
        legend.get_frame().set_facecolor('white')
        legend.get_frame().set_alpha(0.8)
    
    def add_progress_bar(self, ax, current_frame, total_frames):
        """Add progress bar to show video progression."""
        progress = current_frame / total_frames
        
        # Progress bar background
        bar_bg = patches.Rectangle(
            (0.7, 0.02), 0.28, 0.02,
            transform=ax.transAxes,
            facecolor='lightgray',
            edgecolor='black',
            linewidth=1,
            zorder=10
        )
        ax.add_patch(bar_bg)
        
        # Progress bar fill
        bar_fill = patches.Rectangle(
            (0.7, 0.02), 0.28 * progress, 0.02,
            transform=ax.transAxes,
            facecolor='#2196F3',
            zorder=11
        )
        ax.add_patch(bar_fill)
        
        # Progress text
        ax.text(
            0.84, 0.06, f'{current_frame}/{total_frames}',
            transform=ax.transAxes,
            fontsize=10,
            ha='center',
            zorder=12
        )
    
    def generate_frames(self, snapshots):
        """Generate all video frames."""
        print("Generating video frames...")
        
        months = sorted(snapshots.keys())
        total_frames = len(months)
        
        frame_paths = []
        
        for i, month in enumerate(months):
            month_data = snapshots[month]
            
            # Create frame
            fig = self.create_frame(month_data, month.to_timestamp(), i + 1, total_frames)
            
            # Save frame
            frame_path = self.output_dir / f"frame_{i:04d}.png"
            plt.savefig(frame_path, dpi=150, bbox_inches='tight', facecolor='white')
            plt.close(fig)
            
            frame_paths.append(frame_path)
            
            if (i + 1) % 5 == 0:
                print(f"Generated {i + 1}/{total_frames} frames")
        
        print(f"Generated all {total_frames} frames")
        return frame_paths
    
    def create_video(self, frame_paths, output_path="dandi_downloads_progression.mp4", fps=2):
        """Create video from frames."""
        print(f"Creating video: {output_path}")
        
        with imageio.get_writer(output_path, fps=fps) as writer:
            for frame_path in frame_paths:
                image = imageio.imread(frame_path)
                writer.append_data(image)
        
        print(f"Video saved: {output_path}")
    
    def create_gif(self, frame_paths, output_path="dandi_downloads_progression.gif", duration=0.5):
        """Create animated GIF from frames."""
        print(f"Creating GIF: {output_path}")
        
        images = []
        for frame_path in frame_paths:
            images.append(imageio.imread(frame_path))
        
        imageio.mimsave(output_path, images, duration=duration)
        print(f"GIF saved: {output_path}")
    
    def cleanup_frames(self, frame_paths):
        """Remove temporary frame files."""
        print("Cleaning up temporary frames...")
        for frame_path in frame_paths:
            frame_path.unlink()
        self.output_dir.rmdir()
        print("Cleanup complete")
    
    def generate_video(self, output_video="dandi_downloads_progression.mp4", 
                      output_gif="dandi_downloads_progression.gif", 
                      fps=2, cleanup=True):
        """Main method to generate the complete video."""
        print("Starting DANDI download progression video generation...")
        
        # Load and process data
        df = self.load_and_process_data()
        
        # Create weekly snapshots
        snapshots = self.create_weekly_snapshots(df)
        
        # Generate frames
        frame_paths = self.generate_frames(snapshots)
        
        # Create video outputs
        self.create_video(frame_paths, output_video, fps)
        self.create_gif(frame_paths, output_gif, duration=1.0/fps)
        
        # Cleanup
        if cleanup:
            self.cleanup_frames(frame_paths)
        
        print("\n=== Video Generation Complete ===")
        print(f"Video: {output_video}")
        print(f"GIF: {output_gif}")
        print(f"Frames: {len(frame_paths)}")
        print(f"Duration: {len(frame_paths)/fps:.1f} seconds")

def main():
    """Main execution function."""
    generator = DownloadVideoGenerator()
    generator.generate_video(
        output_video="dandi_downloads_progression.mp4",
        output_gif="dandi_downloads_progression.gif",
        fps=8,  # 8 frames per second (0.125 seconds per week)
        cleanup=True
    )

if __name__ == "__main__":
    main()
