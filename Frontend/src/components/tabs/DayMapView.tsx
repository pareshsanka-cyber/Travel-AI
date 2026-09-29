import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Layers, Map as MapIcon, Globe, Navigation } from 'lucide-react';
import { ActivitySegment, RouteLeg } from '../../types';

interface DayMapViewProps {
  activities: ActivitySegment[];
  destination?: string;
  dayNumber: number;
  legs?: RouteLeg[];
  activeLegIndex?: number;
  onSelectLeg?: (index: number) => void;
}

type MapLayerType = 'street' | 'satellite' | 'osm';

const MAP_TILE_CONFIGS: Record<MapLayerType, { url: string; attribution: string; maxZoom: number }> = {
  street: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, DeLorme, NAVTEQ, USGS, Intermap, iPC, NRCAN, Esri Japan, METI, Esri China (Hong Kong), Esri (Thailand), TomTom, 2012',
    maxZoom: 19,
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
    maxZoom: 19,
  },
  osm: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
};

export const DayMapView: React.FC<DayMapViewProps> = ({ 
  activities, 
  destination, 
  dayNumber,
  legs,
  activeLegIndex = 0,
  onSelectLeg,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const [mapLayer, setMapLayer] = useState<MapLayerType>('street');

  // Switch tile layer on user selection
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    if (tileLayerRef.current) {
      tileLayerRef.current.remove();
    }

    const config = MAP_TILE_CONFIGS[mapLayer];
    const newLayer = L.tileLayer(config.url, {
      attribution: config.attribution,
      maxZoom: config.maxZoom,
    }).addTo(mapInstanceRef.current);

    tileLayerRef.current = newLayer;
  }, [mapLayer]);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Extended fallback — only used when backend sends no coordinates.
    // Backend-provided lat/lon always takes priority.
    const fallbackCoords: Record<string, [number, number]> = {
      // India
      delhi: [28.6139, 77.2090],
      'new delhi': [28.6139, 77.2090],
      goa: [15.2993, 74.1240],
      jaipur: [26.9124, 75.7873],
      mumbai: [19.0760, 72.8777],
      bengaluru: [12.9716, 77.5946],
      bangalore: [12.9716, 77.5946],
      agra: [27.1767, 78.0081],
      varanasi: [25.3176, 82.9739],
      udaipur: [24.5854, 73.7125],
      kerala: [9.9312, 76.2673],
      kochi: [9.9312, 76.2673],
      manali: [32.2432, 77.1892],
      shimla: [31.1048, 77.1734],
      hyderabad: [17.3850, 78.4867],
      chennai: [13.0827, 80.2707],
      kolkata: [22.5726, 88.3639],
      // Australia & Oceania
      sydney: [-33.8688, 151.2093],
      melbourne: [-37.8136, 144.9631],
      brisbane: [-27.4698, 153.0251],
      perth: [-31.9505, 115.8605],
      adelaide: [-34.9285, 138.6007],
      auckland: [-36.8509, 174.7645],
      // International
      london: [51.5074, -0.1278],
      paris: [48.8566, 2.3522],
      dubai: [25.2048, 55.2708],
      singapore: [1.3521, 103.8198],
      tokyo: [35.6762, 139.6503],
      bangkok: [13.7563, 100.5018],
      'kuala lumpur': [3.1390, 101.6869],
      bali: [-8.3405, 115.0920],
      'new york': [40.7128, -74.0060],
      'new york city': [40.7128, -74.0060],
      'los angeles': [34.0522, -118.2437],
      toronto: [43.6532, -79.3832],
      seoul: [37.5665, 126.9780],
      beijing: [39.9042, 116.4074],
      shanghai: [31.2304, 121.4737],
      rome: [41.9028, 12.4964],
      barcelona: [41.3851, 2.1734],
      amsterdam: [52.3676, 4.9041],
      berlin: [52.5200, 13.4050],
    };

    const destKey = (destination || '').toLowerCase().split(',')[0].trim();
    const defaultCenter: [number, number] | null =
      fallbackCoords[destKey] ||
      fallbackCoords[destKey.split(' ')[0]] ||
      null;

    // Validate coordinate
    function isValidCoord(lat: number | undefined, lon: number | undefined): boolean {
      return (
        typeof lat === 'number' &&
        typeof lon === 'number' &&
        !isNaN(lat) && !isNaN(lon) &&
        lat >= -90 && lat <= 90 &&
        lon >= -180 && lon <= 180 &&
        !(lat === 0 && lon === 0)
      );
    }

    const waypoints: Array<{
      name: string;
      timeOfDay: string;
      lat: number;
      lon: number;
      thumbnail?: string;
      status?: string;
      location?: string;
    }> = [];

    activities.forEach((act, idx) => {
      let lat = act.lat;
      let lon = act.lon;

      if (isValidCoord(lat, lon)) {
        // Use real backend coordinates — no override
      } else if (defaultCenter) {
        // Fallback to correct destination city with small offset
        const offsetLat = (idx === 0 ? 0.008 : idx === 1 ? -0.006 : 0.004) + (Math.sin(dayNumber + idx) * 0.003);
        const offsetLon = (idx === 0 ? -0.006 : idx === 1 ? 0.008 : 0.006) + (Math.cos(dayNumber + idx) * 0.003);
        lat = defaultCenter[0] + offsetLat;
        lon = defaultCenter[1] + offsetLon;
      } else {
        // No valid coords at all — skip this waypoint rather than place it in Delhi
        return;
      }

      waypoints.push({
        name: act.title,
        timeOfDay: act.timeOfDay,
        lat: lat!,
        lon: lon!,
        thumbnail: act.thumbnail,
        status: act.operatingStatus,
        location: act.location,
      });
    });

    if (waypoints.length === 0) return;

    // Destroy existing instance if any
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    // Initialize Map
    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      scrollWheelZoom: false,
    }).setView([waypoints[0].lat, waypoints[0].lon], 13);

    mapInstanceRef.current = map;

    // Add initial tile layer
    const config = MAP_TILE_CONFIGS[mapLayer];
    const initialTileLayer = L.tileLayer(config.url, {
      attribution: config.attribution,
      maxZoom: config.maxZoom,
    }).addTo(map);

    tileLayerRef.current = initialTileLayer;

    const allRoutePoints: L.LatLngTuple[] = [];

    // Helper: draw a curved flight arc between two coordinate points
    function drawFlightArc(fromC: [number, number], toC: [number, number]) {
      // Bezier curve via a midpoint offset (arc curves upward / northward)
      const latDiff = toC[0] - fromC[0];
      const lonDiff = toC[1] - fromC[1];
      // Perpendicular offset — push mid-point "up" relative to the line
      const midLat = (fromC[0] + toC[0]) / 2 - Math.abs(latDiff) * 0.3;
      const midLon = (fromC[1] + toC[1]) / 2 - lonDiff * 0.05;

      const arcPoints: L.LatLngTuple[] = [];
      for (let t = 0; t <= 1; t += 0.02) {
        const lat =
          (1 - t) * (1 - t) * fromC[0] +
          2 * (1 - t) * t * midLat +
          t * t * toC[0];
        const lon =
          (1 - t) * (1 - t) * fromC[1] +
          2 * (1 - t) * t * midLon +
          t * t * toC[1];
        arcPoints.push([lat, lon]);
        allRoutePoints.push([lat, lon]);
      }

      // Draw dashed arc line
      L.polyline(arcPoints, {
        color: '#0ea5e9',
        weight: 3,
        dashArray: '10, 7',
        opacity: 0.9,
        lineCap: 'round',
      }).addTo(map);

      // ✈️ plane icon at midpoint of arc
      const midIdx = Math.floor(arcPoints.length / 2);
      const midPoint = arcPoints[midIdx];
      L.marker(midPoint, {
        icon: L.divIcon({
          html: '<div style="font-size:22px;line-height:1;">✈️</div>',
          className: '',
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
        interactive: false,
      }).addTo(map);
    }

    // 1. Draw routes (road or flight arc)
    if (legs && legs.length > 0) {
      legs.forEach((leg, idx) => {
        const isSelectedLeg = activeLegIndex === -1 || idx === activeLegIndex;

        if (leg.isFlightLeg || leg.status === 'flight') {
          // Draw curved flight arc instead of road polyline
          if (leg.fromCoords && leg.toCoords &&
              isValidCoord(leg.fromCoords[0], leg.fromCoords[1]) &&
              isValidCoord(leg.toCoords[0], leg.toCoords[1])) {
            drawFlightArc(leg.fromCoords, leg.toCoords);
          }
          return;
        }

        const polyCoords: L.LatLngTuple[] = leg.geometry.map((c) => [c[0], c[1]]);
        polyCoords.forEach((p) => allRoutePoints.push(p));

        if (polyCoords.length > 0) {
          if (isSelectedLeg) {
            L.polyline(polyCoords, {
              color: '#0284c7',
              weight: 8,
              opacity: 0.35,
              lineCap: 'round',
              lineJoin: 'round',
            }).addTo(map);
          }

          const line = L.polyline(polyCoords, {
            color: isSelectedLeg ? '#0284c7' : '#64748b',
            weight: isSelectedLeg ? 5 : 3.5,
            opacity: isSelectedLeg ? 1.0 : 0.65,
            dashArray: isSelectedLeg ? undefined : '6, 6',
          }).addTo(map);

          if (onSelectLeg) {
            line.on('click', () => onSelectLeg(idx));
          }
        }
      });
    } else {
      // Fallback: draw connecting path across waypoints (local only)
      const simpleCoords: L.LatLngTuple[] = waypoints.map((w) => [w.lat, w.lon]);
      simpleCoords.forEach((p) => allRoutePoints.push(p));

      if (simpleCoords.length > 1) {
        L.polyline(simpleCoords, {
          color: '#0284c7',
          weight: 3.5,
          opacity: 0.85,
          dashArray: '8, 8',
        }).addTo(map);
      }
    }

    // 2. Add Waypoint Pin Markers
    waypoints.forEach((wp, i) => {
      allRoutePoints.push([wp.lat, wp.lon]);

      const pinColors = [
        { bg: '#0284c7', ring: '#38bdf8', label: '1', name: 'Morning' },
        { bg: '#7c3aed', ring: '#a78bfa', label: '2', name: 'Afternoon' },
        { bg: '#059669', ring: '#34d399', label: '3', name: 'Evening' },
      ];

      const pin = pinColors[i % pinColors.length];

      const customIcon = L.divIcon({
        className: 'custom-map-pin',
        html: `
          <div style="position: relative; display: flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: 50%; background: ${pin.bg}; border: 2.5px solid #ffffff; box-shadow: 0 4px 14px rgba(0,0,0,0.4); color: #ffffff; font-weight: 700; font-size: 13px; font-family: sans-serif;">
            ${pin.label}
            <div style="position: absolute; bottom: -5px; width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-top: 6px solid ${pin.bg};"></div>
          </div>
        `,
        iconSize: [34, 38],
        iconAnchor: [17, 38],
        popupAnchor: [0, -36],
      });

      const popupContent = `
        <div style="font-family: 'Geist', sans-serif; min-width: 180px; max-width: 240px; padding: 4px;">
          ${wp.thumbnail ? `<img src="${wp.thumbnail}" alt="${wp.name}" style="width: 100%; height: 85px; object-fit: cover; border-radius: 8px; margin-bottom: 6px; box-shadow: 0 2px 6px rgba(0,0,0,0.2);" />` : ''}
          <div style="font-size: 10px; font-weight: 700; text-transform: uppercase; color: ${pin.bg}; letter-spacing: 0.05em; margin-bottom: 2px;">
            Stop ${i + 1} • ${wp.timeOfDay}
          </div>
          <div style="font-size: 12px; font-weight: 600; color: #0f172a; margin-bottom: 3px; line-height: 1.2;">
            ${wp.name}
          </div>
          ${wp.location ? `<div style="font-size: 10px; color: #64748b; margin-bottom: 4px;">📍 ${wp.location}</div>` : ''}
          ${wp.status ? `<div style="display: inline-block; font-size: 9px; font-weight: 700; text-transform: uppercase; padding: 2px 6px; border-radius: 4px; ${wp.status === 'OPEN' ? 'background: #dcfce7; color: #15803d;' : wp.status === 'CLOSED' ? 'background: #fee2e2; color: #b91c1c;' : 'background: #fef3c7; color: #b45309;'}">${wp.status}</div>` : ''}
        </div>
      `;

      L.marker([wp.lat, wp.lon], { icon: customIcon })
        .addTo(map)
        .bindPopup(popupContent);
    });

    // 3. Fit Bounds to show all route points
    if (allRoutePoints.length > 1) {
      const bounds = L.latLngBounds(allRoutePoints);
      map.fitBounds(bounds, { padding: [45, 45], maxZoom: 15 });
    } else if (waypoints.length === 1) {
      map.setView([waypoints[0].lat, waypoints[0].lon], 13);
    }

    setTimeout(() => {
      map.invalidateSize();
    }, 200);

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [activities, destination, dayNumber, legs, activeLegIndex, onSelectLeg]);


  return (
    <div className="relative w-full h-full min-h-[350px] lg:min-h-[500px] rounded-2xl overflow-hidden shadow-lg border border-surface-container-highest/60">
      <div ref={mapContainerRef} className="w-full h-full z-0" />

      {/* Floating Status & Map Style Switcher Controls */}
      <div className="absolute top-3 right-3 z-[400] flex items-center gap-2">
        {/* Layer Selector Pill */}
        <div className="bg-surface-container-lowest/90 backdrop-blur-md p-1 rounded-xl border border-surface-container-highest/70 text-xs font-semibold shadow-md flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMapLayer('street')}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg transition-all text-[11px] ${
              mapLayer === 'street'
                ? 'bg-primary text-on-primary shadow-sm'
                : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest'
            }`}
            title="Crisp Street Map"
          >
            <MapIcon className="w-3 h-3" />
            <span>Street</span>
          </button>

          <button
            type="button"
            onClick={() => setMapLayer('satellite')}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg transition-all text-[11px] ${
              mapLayer === 'satellite'
                ? 'bg-primary text-on-primary shadow-sm'
                : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest'
            }`}
            title="High-Res Satellite Imagery"
          >
            <Globe className="w-3 h-3" />
            <span>Satellite</span>
          </button>

          <button
            type="button"
            onClick={() => setMapLayer('osm')}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg transition-all text-[11px] ${
              mapLayer === 'osm'
                ? 'bg-primary text-on-primary shadow-sm'
                : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest'
            }`}
            title="Standard OpenStreetMap"
          >
            <Layers className="w-3 h-3" />
            <span>OSM</span>
          </button>
        </div>

        {/* Day Badge */}
        <div className="hidden sm:flex bg-surface-container-lowest/90 backdrop-blur-md px-3 py-1.5 rounded-xl border border-surface-container-highest/70 text-xs font-semibold text-on-surface shadow-md items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
          <span>Day {dayNumber} Street Map</span>
        </div>
      </div>
    </div>
  );
};
